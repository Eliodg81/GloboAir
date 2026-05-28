/**
 * AudioStreamPlayer — riproduce chunk PCM 8kHz 8-bit in tempo reale
 *
 * Gestisce:
 * - iOS WKWebView: AudioContext sospeso → resume() obbligatorio
 * - Sample rate nativo variabile (44100/48000 Hz) → upsampling da 8kHz
 * - Buffer-ahead di 80ms per compensare il jitter BLE
 */
export class AudioStreamPlayer {
  private context: AudioContext | null = null;
  private nextPlayTime = 0;
  private started = false;
  private actualRate = 44100;

  private readonly SOURCE_RATE = 8000;   // rate in cui arriva il PCM dal broadcaster
  private readonly BUFFER_AHEAD = 0.08;  // 80ms di anticipo per il jitter BLE

  async initialize(): Promise<void> {
    // Usa il sample rate nativo del dispositivo (iOS: 44100 o 48000)
    this.context = new AudioContext();
    this.actualRate = this.context.sampleRate;

    // iOS richiede resume() esplicito dopo creazione
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.nextPlayTime = 0;
    this.started = false;
    console.log(`[AudioStreamPlayer] initialized at ${this.actualRate}Hz`);
  }

  playChunk(pcm8: Uint8Array): void {
    if (!this.context || pcm8.length === 0) return;

    // Resume se sospeso (può succedere su iOS dopo interrupt)
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    // Upsampling da SOURCE_RATE (8kHz) → actualRate (44100/48000)
    const ratio = this.actualRate / this.SOURCE_RATE;
    const outputSamples = Math.floor(pcm8.length * ratio);

    const buffer = this.context.createBuffer(1, outputSamples, this.actualRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < outputSamples; i++) {
      // Indice nel buffer sorgente (nearest neighbor upsampling)
      const srcIdx = Math.min(Math.floor(i / ratio), pcm8.length - 1);
      // Converti Uint8 [0,255] → Float32 [-1,1]
      data[i] = (pcm8[srcIdx] - 127.5) / 127.5;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;

    if (!this.started || this.nextPlayTime < now) {
      this.nextPlayTime = now + this.BUFFER_AHEAD;
      this.started = true;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  stop(): void {
    this.context?.close();
    this.context = null;
    this.nextPlayTime = 0;
    this.started = false;
  }
}
