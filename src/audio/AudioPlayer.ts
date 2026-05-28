/**
 * AudioPlayer — riceve frame audio ADPCM e li riproduce in real-time
 *
 * Strategia: jitter buffer di 3 frame (600ms) per assorbire
 * la variabilità della trasmissione BLE, poi playback continuo.
 */

import { adpcmDecode, SAMPLE_RATE, SAMPLES_PER_FRAME } from './AudioCapture';

const JITTER_BUFFER_FRAMES = 3;   // frame in attesa prima di iniziare playback
const MAX_BUFFER_FRAMES = 12;     // soglia di drop (evita lag crescente)

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private queue: Uint8Array[] = [];
  private nextPlayTime = 0;
  private started = false;
  private frameDuration: number;

  constructor() {
    this.frameDuration = SAMPLES_PER_FRAME / SAMPLE_RATE; // 0.2s
  }

  start(): void {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.queue = [];
    this.nextPlayTime = 0;
    this.started = false;
  }

  stop(): void {
    this.ctx?.close();
    this.ctx = null;
    this.queue = [];
    this.started = false;
  }

  /** Riceve un frame ADPCM e lo schedula per la riproduzione */
  receiveFrame(encoded: Uint8Array): void {
    if (!this.ctx) return;

    // Drop se il buffer è troppo pieno (lag protection)
    if (this.queue.length > MAX_BUFFER_FRAMES) {
      console.warn('[AudioPlayer] Buffer overflow — dropping oldest frame');
      this.queue.shift();
    }

    this.queue.push(encoded);

    // Inizia playback dopo aver accumulato il jitter buffer
    if (!this.started && this.queue.length >= JITTER_BUFFER_FRAMES) {
      this.started = true;
      this.nextPlayTime = this.ctx.currentTime + 0.05; // 50ms startup delay
      this._scheduleAll();
    } else if (this.started) {
      this._scheduleNext();
    }
  }

  private _scheduleAll(): void {
    while (this.queue.length > 0) this._scheduleNext();
  }

  private _scheduleNext(): void {
    if (!this.ctx || this.queue.length === 0) return;
    const encoded = this.queue.shift()!;
    const pcm = adpcmDecode(encoded, SAMPLES_PER_FRAME);
    const audioBuffer = this.ctx.createBuffer(1, SAMPLES_PER_FRAME, SAMPLE_RATE);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      channelData[i] = pcm[i] / 32768;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const playAt = Math.max(this.nextPlayTime, this.ctx.currentTime + 0.01);
    source.start(playAt);
    this.nextPlayTime = playAt + this.frameDuration;
  }

  /** Ritorna latenza corrente in ms */
  get latencyMs(): number {
    if (!this.ctx) return 0;
    return Math.max(0, (this.nextPlayTime - this.ctx.currentTime) * 1000);
  }

  /** Ritorna numero frame in buffer */
  get bufferSize(): number {
    return this.queue.length;
  }
}
