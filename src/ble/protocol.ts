/**
 * GloboAir BLE Protocol v0.2
 *
 * Architettura:
 *   - Broadcaster agisce come GATT Peripheral (server)
 *   - Receivers agiscono come GATT Central (client)
 *   - v0.2: testo trascritto (STT) → BLE → ogni receiver traduce + TTS
 *     Payload tipico: 30-150 bytes per frase (vs 800+ bytes audio)
 *   - Header 5 bytes → data
 *
 * Fase 2 (illimitati): switch a BLE Extended Advertising (no connessione richiesta)
 */

// ─── UUIDs ────────────────────────────────────────────────────────────────────
// UUID base GloboAir: 4741 = G(71) A(41) in hex ascii
export const GLOBOAIR_SERVICE_UUID       = '47410000-0000-1000-8000-00805f9b34fb';
export const AUDIO_CHARACTERISTIC_UUID  = '47410001-0000-1000-8000-00805f9b34fb';
export const CONTROL_CHARACTERISTIC_UUID = '47410002-0000-1000-8000-00805f9b34fb';
export const SESSION_CHARACTERISTIC_UUID = '47410003-0000-1000-8000-00805f9b34fb';

// ─── Packet structure (header 5 bytes) ───────────────────────────────────────
// [frame_hi][frame_lo][total_chunks][chunk_idx][flags][...audio_data...]
//
// flags: bit0 = is_first_frame (contiene parametri init)
//        bit1 = is_silence (skip playback)
//        bit2-7 = riservati
//
export const HEADER_SIZE = 5;
export const MAX_BLE_MTU = 512;    // BLE 5.0 con MTU negotiation
export const MAX_CHUNK_DATA = MAX_BLE_MTU - HEADER_SIZE; // 507 bytes

export const FLAG_FIRST_FRAME = 0x01;
export const FLAG_SILENCE     = 0x02;
export const FLAG_TEXT        = 0x04;  // v0.2: il payload è testo UTF-8, non audio
export const FLAG_TEXT_FINAL  = 0x08;  // v0.2: è la frase finale/completa (non interim)

export interface AudioChunk {
  frameId: number;       // 16-bit — identifica il frame audio (200ms di audio)
  totalChunks: number;   // quanti pacchetti BLE compongono questo frame
  chunkIndex: number;    // indice di questo pacchetto (0-based)
  flags: number;
  data: Uint8Array;
}

export function encodeChunk(chunk: AudioChunk): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE + chunk.data.length);
  buf[0] = (chunk.frameId >> 8) & 0xFF;
  buf[1] = chunk.frameId & 0xFF;
  buf[2] = chunk.totalChunks;
  buf[3] = chunk.chunkIndex;
  buf[4] = chunk.flags;
  buf.set(chunk.data, HEADER_SIZE);
  return buf;
}

export function decodeChunk(raw: Uint8Array): AudioChunk {
  if (raw.length < HEADER_SIZE) throw new Error('Packet too short');
  return {
    frameId: (raw[0] << 8) | raw[1],
    totalChunks: raw[2],
    chunkIndex: raw[3],
    flags: raw[4],
    data: raw.slice(HEADER_SIZE),
  };
}

// ─── Frame Reassembler ────────────────────────────────────────────────────────
// Usato dal receiver per ricostruire i frame audio dai chunk BLE
export class FrameReassembler {
  private frames: Map<number, { chunks: (Uint8Array | null)[]; total: number; received: number }> = new Map();
  private onFrame: (data: Uint8Array, flags: number) => void;
  private lastFrameId = -1;

  constructor(onFrame: (data: Uint8Array, flags: number) => void) {
    this.onFrame = onFrame;
  }

  receive(chunk: AudioChunk): void {
    const { frameId, totalChunks, chunkIndex, data, flags } = chunk;

    // Scarta frame già processati (protezione da duplicati)
    if (frameId === this.lastFrameId) return;

    if (!this.frames.has(frameId)) {
      this.frames.set(frameId, {
        chunks: new Array(totalChunks).fill(null),
        total: totalChunks,
        received: 0,
      });
    }

    const frame = this.frames.get(frameId)!;
    if (frame.chunks[chunkIndex] === null) {
      frame.chunks[chunkIndex] = data;
      frame.received++;
    }

    // Frame completo
    if (frame.received === frame.total) {
      const fullData = mergeChunks(frame.chunks as Uint8Array[]);
      this.frames.delete(frameId);
      this.lastFrameId = frameId;
      this.onFrame(fullData, flags);

      // Pulizia frame vecchi (anti-leak memoria)
      for (const [id] of this.frames) {
        if (this._frameDistance(frameId, id) > 20) this.frames.delete(id);
      }
    }
  }

  private _frameDistance(a: number, b: number): number {
    return Math.abs(((a - b + 32768) % 65536) - 32768);
  }

  reset(): void {
    this.frames.clear();
    this.lastFrameId = -1;
  }
}

// ─── v0.2 Text Frame ─────────────────────────────────────────────────────────
// Formato: [seqId_hi][seqId_lo][flags: FLAG_TEXT | FLAG_TEXT_FINAL?][...utf8...]
// Inviato sullo stesso AUDIO_CHARACTERISTIC_UUID — il receiver discrimina via FLAG_TEXT

export const TEXT_FRAME_HEADER_SIZE = 3;

export interface TextFrame {
  seqId: number;    // 16-bit sequence ID
  isFinal: boolean; // true = frase completa, false = risultato parziale (interim)
  text: string;
}

export function encodeTextFrame(frame: TextFrame): Uint8Array {
  const textBytes = new TextEncoder().encode(frame.text);
  const buf = new Uint8Array(TEXT_FRAME_HEADER_SIZE + textBytes.length);
  buf[0] = (frame.seqId >> 8) & 0xFF;
  buf[1] = frame.seqId & 0xFF;
  buf[2] = FLAG_TEXT | (frame.isFinal ? FLAG_TEXT_FINAL : 0);
  buf.set(textBytes, TEXT_FRAME_HEADER_SIZE);
  return buf;
}

export function decodeTextFrame(raw: Uint8Array): TextFrame {
  if (raw.length < TEXT_FRAME_HEADER_SIZE) throw new Error('TextFrame too short');
  const flags = raw[2];
  return {
    seqId: (raw[0] << 8) | raw[1],
    isFinal: (flags & FLAG_TEXT_FINAL) !== 0,
    text: new TextDecoder('utf-8').decode(raw.slice(TEXT_FRAME_HEADER_SIZE)),
  };
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}
