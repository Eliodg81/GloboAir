/**
 * AudioStreamCapture — cattura microfono e produce chunk PCM 8kHz 8-bit
 *
 * Usa Web Audio API per catturare audio a bassa latenza.
 * Downsampling automatico alla frequenza nativa del dispositivo → 8kHz.
 * Output: callback ogni ~40ms con ~320 byte di PCM Uint8 (qualità telefonica).
 */
export class AudioStreamCapture {
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  public isCapturing = false;

  private readonly TARGET_RATE = 8000;
  private readonly BUFFER_SIZE = 4096; // campioni per callback (al sample rate nativo)

  async start(onPCM: (samples: Uint8Array) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Usa il sample rate nativo del dispositivo (44100 / 48000 Hz)
    this.context = new AudioContext();
    const nativeRate = this.context.sampleRate;
    const ratio = nativeRate / this.TARGET_RATE;

    const source = this.context.createMediaStreamSource(this.stream);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.processor = this.context.createScriptProcessor(this.BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.isCapturing) return;
      const input = e.inputBuffer.getChannelData(0);
      const outputLength = Math.floor(input.length / ratio);
      const pcm8 = new Uint8Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
        // Downsample: prendi il campione più vicino
        const sample = input[Math.min(Math.floor(i * ratio), input.length - 1)];
        // Converti Float32 [-1,1] → Uint8 [0,255]
        pcm8[i] = Math.max(0, Math.min(255, Math.round((sample + 1) * 127.5)));
      }

      onPCM(pcm8);
    };

    source.connect(this.processor);
    this.processor.connect(this.context.destination);
    this.isCapturing = true;
  }

  stop(): void {
    this.isCapturing = false;
    this.processor?.disconnect();
    this.context?.close();
    this.stream?.getTracks().forEach(t => t.stop());
    this.processor = null;
    this.context = null;
    this.stream = null;
  }
}
