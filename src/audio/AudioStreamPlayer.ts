/**
 * AudioStreamPlayer — riproduce chunk PCM 8kHz 8-bit in tempo reale
 *
 * Usa Web Audio API per schedulare i chunk in sequenza senza stacchi.
 * Buffer-ahead di 80ms per compensare la variabilità BLE (jitter).
 */
export class AudioStreamPlayer {
  private context: AudioContext | null = null;
  private nextPlayTime = 0;
  private started = false;

  private readonly SAMPLE_RATE = 8000;
  private readonly BUFFER_AHEAD = 0.08; // 80ms di anticipo per compensare jitter BLE

  initialize(): void {
    this.context = new AudioContext({ sampleRate: this.SAMPLE_RATE });
    this.nextPlayTime = 0;
    this.started = false;
  }

  playChunk(pcm8: Uint8Array): void {
    if (!this.context || pcm8.length === 0) return;

    const samples = pcm8.length;
    const buffer = this.context.createBuffer(1, samples, this.SAMPLE_RATE);
    const data = buffer.getChannelData(0);

    // Converti Uint8 [0,255] → Float32 [-1,1]
    for (let i = 0; i < samples; i++) {
      data[i] = (pcm8[i] - 127.5) / 127.5;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;

    if (!this.started || this.nextPlayTime < now) {
      // Primo chunk o buffer esaurito: riparti con un piccolo anticipo
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
