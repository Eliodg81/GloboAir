/**
 * BLEBroadcaster — gestisce il lato trasmissione
 *
 * Usa il plugin nativo BLEPeripheralPlugin (Swift/Kotlin) per:
 *   1. Creare un GATT Server con il servizio GloboAir
 *   2. Fare advertising (visibile ai receiver)
 *   3. Inviare frame audio ai Central connessi tramite GATT Notify
 *
 * Chiamato da useBLEBroadcaster.ts (React hook)
 */

import { registerPlugin } from '@capacitor/core';
import {
  GLOBOAIR_SERVICE_UUID,
  AUDIO_CHARACTERISTIC_UUID,
  encodeChunk,
  MAX_CHUNK_DATA,
  FLAG_FIRST_FRAME,
  encodeTextFrame,
  langToCode,
  LANG_BROADCAST,
} from './protocol';

// ─── Plugin nativo (Swift iOS / Kotlin Android) ───────────────────────────────
export interface BLEPeripheralPlugin {
  initialize(): Promise<void>;
  requestMicPermission(): Promise<{ granted: boolean }>;
  startAudioCapture(): Promise<void>;
  stopAudioCapture(): Promise<void>;
  addListener(event: 'audioChunk', cb: (data: { data: string }) => void): Promise<{ remove: () => void }>;
  startAdvertising(options: { serviceUuid: string; localName: string }): Promise<void>;
  stopAdvertising(): Promise<void>;
  sendNotification(options: {
    serviceUuid: string;
    characteristicUuid: string;
    value: string; // base64
  }): Promise<void>;
  getConnectedCentralsCount(): Promise<{ count: number }>;
  addListener(event: 'centralConnected', cb: (data: { id: string }) => void): Promise<{ remove: () => void }>;
  addListener(event: 'centralDisconnected', cb: (data: { id: string }) => void): Promise<{ remove: () => void }>;
  addListener(event: 'stateChange', cb: (data: { state: number }) => void): Promise<{ remove: () => void }>;
}

export const BLEPeripheral = registerPlugin<BLEPeripheralPlugin>('BLEPeripheral', {
  // Fallback web: stub per sviluppo in browser
  web: () => import('./BLEPeripheralWeb').then(m => new m.BLEPeripheralWeb()),
});

// ─── BLEBroadcaster ──────────────────────────────────────────────────────────
export class BLEBroadcaster {
  private frameId = 0;
  private isFirstFrame = true;
  public isActive = false;
  public connectedCount = 0;
  private listeners: { remove: () => void }[] = [];

  onConnectedCountChange?: (count: number) => void;

  async initialize(): Promise<void> {
    await BLEPeripheral.initialize();

    const l1 = await BLEPeripheral.addListener('centralConnected', async () => {
      const { count } = await BLEPeripheral.getConnectedCentralsCount();
      this.connectedCount = count;
      this.onConnectedCountChange?.(count);
    });
    const l2 = await BLEPeripheral.addListener('centralDisconnected', async () => {
      const { count } = await BLEPeripheral.getConnectedCentralsCount();
      this.connectedCount = count;
      this.onConnectedCountChange?.(count);
    });
    this.listeners.push(l1, l2);
  }

  async startBroadcast(): Promise<void> {
    await BLEPeripheral.startAdvertising({
      serviceUuid: GLOBOAIR_SERVICE_UUID,
      localName: 'GloboAir',
    });
    this.isActive = true;
    this.isFirstFrame = true;
    this.frameId = 0;
    console.log('[BLEBroadcaster] Advertising started');
  }

  async stopBroadcast(): Promise<void> {
    await BLEPeripheral.stopAdvertising();
    this.isActive = false;
    console.log('[BLEBroadcaster] Advertising stopped');
  }

  /**
   * Invia un frame audio (ADPCM encoded) spezzato in chunk BLE
   * Chiamato da AudioCapture.onFrame ogni 200ms
   */
  async sendFrame(encoded: Uint8Array): Promise<void> {
    if (!this.isActive || this.connectedCount === 0) return;

    const totalChunks = Math.ceil(encoded.length / MAX_CHUNK_DATA);
    const flags = this.isFirstFrame ? FLAG_FIRST_FRAME : 0;
    this.isFirstFrame = false;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_CHUNK_DATA;
      const end = Math.min(start + MAX_CHUNK_DATA, encoded.length);
      const chunkData = encoded.slice(start, end);

      const packet = encodeChunk({
        frameId: this.frameId,
        totalChunks,
        chunkIndex: i,
        flags: i === 0 ? flags : 0,
        data: chunkData,
      });

      const b64 = uint8ToBase64(packet);
      await BLEPeripheral.sendNotification({
        serviceUuid: GLOBOAIR_SERVICE_UUID,
        characteristicUuid: AUDIO_CHARACTERISTIC_UUID,
        value: b64,
      });
    }

    // 16-bit rollover
    this.frameId = (this.frameId + 1) & 0xFFFF;
  }

  /**
   * v0.2 — MODELLO RECEIVER PAGA
   * Invia il testo originale trascritto (senza tag lingua).
   * Ogni receiver lo traduce per conto suo (MyMemory gratis o OpenAI a sue spese).
   *
   * @param text     testo trascritto (UTF-8, max ~500 bytes)
   * @param isFinal  true = frase completa, false = risultato parziale
   */
  async sendText(text: string, isFinal: boolean): Promise<void> {
    if (!this.isActive || this.connectedCount === 0) return;

    const frame = encodeTextFrame({
      seqId: this.frameId,
      isFinal,
      langCode: LANG_BROADCAST, // 0x0000 = nessun tag → receiver traduce
      text,
    });
    this.frameId = (this.frameId + 1) & 0xFFFF;

    await BLEPeripheral.sendNotification({
      serviceUuid: GLOBOAIR_SERVICE_UUID,
      characteristicUuid: AUDIO_CHARACTERISTIC_UUID,
      value: uint8ToBase64(frame),
    });
  }

  /**
   * v0.2 — MODELLO BROADCASTER PAGA (OpenAI)
   * Invia le traduzioni pre-calcolate, una per lingua.
   * Ogni receiver riceve solo il pacchetto nella sua lingua → gratis per lui.
   *
   * @param translations  Map: { 'en' → 'Hello!', 'ja' → 'こんにちは！', ... }
   * @param isFinal       true = frase completa
   */
  async sendTranslatedTexts(
    translations: Map<string, string>,
    isFinal: boolean
  ): Promise<void> {
    if (!this.isActive || this.connectedCount === 0) return;

    const seqId = this.frameId;
    this.frameId = (this.frameId + 1) & 0xFFFF;

    // Invia un pacchetto per ogni lingua
    const sends = [...translations.entries()].map(([lang, text]) => {
      const frame = encodeTextFrame({
        seqId,
        isFinal,
        langCode: langToCode(lang), // es. 'en' → 0x656E
        text,
      });
      return BLEPeripheral.sendNotification({
        serviceUuid: GLOBOAIR_SERVICE_UUID,
        characteristicUuid: AUDIO_CHARACTERISTIC_UUID,
        value: uint8ToBase64(frame),
      });
    });

    await Promise.allSettled(sends); // invia in parallelo, ignora errori singoli
  }

  destroy(): void {
    this.listeners.forEach(l => l.remove());
    this.listeners = [];
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
