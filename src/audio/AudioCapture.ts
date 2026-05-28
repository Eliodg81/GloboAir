/**
 * AudioCapture — cattura microfono e produce chunk PCM compressi
 *
 * Pipeline:
 *   getUserMedia → AudioContext → ScriptProcessor → downsample 8kHz mono
 *   → ADPCM encode → callback ogni FRAME_DURATION_MS
 *
 * Nota: ScriptProcessorNode è deprecated ma supportato ovunque.
 *       In produzione sostituire con AudioWorklet.
 *
 * ADPCM IMA: 4:1 compressione su PCM 16-bit → ~16kbps per 8kHz mono
 * Opus (fase 2): ~8kbps con qualità vocale superiore
 */

export const SAMPLE_RATE = 8000;      // Hz — sufficiente per voce
export const FRAME_DURATION_MS = 200; // ms per frame audio
export const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 1600

// ─── ADPCM IMA encoder (semplificato) ────────────────────────────────────────
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
  143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
  494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
  1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428,
  4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export function adpcmEncode(samples: Int16Array): Uint8Array {
  let prevSample = 0;
  let stepIndex = 0;
  const out = new Uint8Array(Math.ceil(samples.length / 2));
  let outIdx = 0;
  let nibble = 0;
  let isHigh = false;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const step = STEP_TABLE[stepIndex];
    let diff = sample - prevSample;
    let code = 0;
    if (diff < 0) { code = 8; diff = -diff; }
    if (diff >= step)     { code |= 4; diff -= step; }
    if (diff >= step / 2) { code |= 2; diff -= step / 2; }
    if (diff >= step / 4) { code |= 1; }

    stepIndex = Math.max(0, Math.min(88, stepIndex + INDEX_TABLE[code & 7]));

    let diffq = step >> 3;
    if (code & 4) diffq += step;
    if (code & 2) diffq += step >> 1;
    if (code & 1) diffq += step >> 2;
    prevSample = Math.max(-32768, Math.min(32767, prevSample + (code & 8 ? -diffq : diffq)));

    if (isHigh) {
      out[outIdx++] |= (code << 4);
      isHigh = false;
    } else {
      nibble = code;
      out[outIdx] = nibble;
      isHigh = true;
    }
  }
  return out;
}

export function adpcmDecode(encoded: Uint8Array, numSamples: number): Int16Array {
  let prevSample = 0;
  let stepIndex = 0;
  const out = new Int16Array(numSamples);
  let outIdx = 0;

  for (let i = 0; i < encoded.length && outIdx < numSamples; i++) {
    for (let nibbleIdx = 0; nibbleIdx < 2 && outIdx < numSamples; nibbleIdx++) {
      const code = nibbleIdx === 0 ? encoded[i] & 0x0F : (encoded[i] >> 4) & 0x0F;
      const step = STEP_TABLE[stepIndex];
      let diffq = step >> 3;
      if (code & 4) diffq += step;
      if (code & 2) diffq += step >> 1;
      if (code & 1) diffq += step >> 2;
      prevSample = Math.max(-32768, Math.min(32767, prevSample + (code & 8 ? -diffq : diffq)));
      out[outIdx++] = prevSample;
      stepIndex = Math.max(0, Math.min(88, stepIndex + INDEX_TABLE[code & 7]));
    }
  }
  return out;
}

// ─── AudioCapture class ───────────────────────────────────────────────────────
export type OnFrameCallback = (encoded: Uint8Array) => void;

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private onFrame: OnFrameCallback;
  public isCapturing = false;

  constructor(onFrame: OnFrameCallback) {
    this.onFrame = onFrame;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: SAMPLE_RATE },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // AudioContext al sample rate nativo — downsampliamo manualmente
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.stream);

    // Buffer size 4096 = ~85ms a 48kHz (tipico)
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this._processChunk(inputData);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this.isCapturing = true;
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
    this.buffer = [];
    this.bufferedSamples = 0;
    this.isCapturing = false;
  }

  /**
   * Downsample da sample rate nativo (es. 48kHz) a 8kHz
   * e accumula campioni finché non abbiamo un frame completo (200ms)
   */
  private _processChunk(input: Float32Array): void {
    if (!this.ctx) return;
    const nativeRate = this.ctx.sampleRate;
    const ratio = nativeRate / SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const downsampled = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      downsampled[i] = input[Math.floor(i * ratio)];
    }

    this.buffer.push(downsampled);
    this.bufferedSamples += outputLength;

    // Emetti frames da 200ms
    while (this.bufferedSamples >= SAMPLES_PER_FRAME) {
      const frame = this._extractFrame();
      const pcm = floatToInt16(frame);
      const encoded = adpcmEncode(pcm);
      this.onFrame(encoded);
    }
  }

  private _extractFrame(): Float32Array {
    const frame = new Float32Array(SAMPLES_PER_FRAME);
    let filled = 0;
    while (filled < SAMPLES_PER_FRAME && this.buffer.length > 0) {
      const chunk = this.buffer[0];
      const needed = SAMPLES_PER_FRAME - filled;
      if (chunk.length <= needed) {
        frame.set(chunk, filled);
        filled += chunk.length;
        this.buffer.shift();
        this.bufferedSamples -= chunk.length;
      } else {
        frame.set(chunk.subarray(0, needed), filled);
        this.buffer[0] = chunk.subarray(needed);
        this.bufferedSamples -= needed;
        filled = SAMPLES_PER_FRAME;
      }
    }
    return frame;
  }

  /** Ritorna il livello RMS (0-1) del segnale corrente — per il VU meter */
  getLevel(input: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    return Math.sqrt(sum / input.length);
  }
}

function floatToInt16(floatArray: Float32Array): Int16Array {
  const int16 = new Int16Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, floatArray[i] * 32768));
  }
  return int16;
}
