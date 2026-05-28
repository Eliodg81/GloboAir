import { BLEPeripheral } from '../ble/BLEBroadcaster';

/**
 * AudioStreamCapture — cattura microfono e produce chunk PCM 8kHz 8-bit
 *
 * Usa Web Audio API per catturare audio a bassa latenza.
 * Downsampling automatico alla frequenza nativa del dispositivo → 8kHz.
 * Output: callback ogni ~85ms con ~680 byte di PCM Uint8 (qualità telefonica).
 *
 * IMPORTANTE: il nodo processor è connesso a un GainNode muto (gain=0)
 * per evitare il feedback microfono → casse che causa "could not start audio source".
 */
export class AudioStreamCapture {
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  public isCapturing = false;

  private readonly TARGET_RATE = 8000;
  private readonly BUFFER_SIZE = 4096;

  async start(onPCM: (samples: Uint8Array) => void): Promise<void> {
    // Su Android/iOS richiedi il permesso microfono prima di getUserMedia
    try {
      await BLEPeripheral.requestMicPermission();
    } catch { /* procedi comunque se il metodo non è disponibile */ }

    // Verifica che getUserMedia sia disponibile
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia non disponibile su questo dispositivo');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.context = new AudioContext();

    // Resume se sospeso (richiesto da alcune versioni Android)
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

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
        const sample = input[Math.min(Math.floor(i * ratio), input.length - 1)];
        pcm8[i] = Math.max(0, Math.min(255, Math.round((sample + 1) * 127.5)));
      }

      onPCM(pcm8);
    };

    // ⚠️ Collegare a un GainNode muto (gain=0) invece che al destination direttamente
    // evita il feedback microfono → casse che causa "could not start audio source"
    const silentGain = this.context.createGain();
    silentGain.gain.value = 0;

    source.connect(this.processor);
    this.processor.connect(silentGain);
    silentGain.connect(this.context.destination);

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
