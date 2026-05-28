/**
 * BLEReceiver — gestisce il lato ricezione
 *
 * Usa @capacitor-community/bluetooth-le (Central mode) per:
 *   1. Scan dei dispositivi che pubblicizzano GLOBOAIR_SERVICE_UUID
 *   2. Connessione al broadcaster
 *   3. Subscribe alle GATT Notifications dell'Audio Characteristic
 *   4. Passa i chunk al FrameReassembler → AudioPlayer
 */

import { BleClient, BleDevice, ScanResult } from '@capacitor-community/bluetooth-le';
import {
  GLOBOAIR_SERVICE_UUID,
  AUDIO_CHARACTERISTIC_UUID,
  decodeChunk,
  decodeTextFrame,
  FrameReassembler,
  TEXT_PACKET_TYPE,
  TEXT_FRAME_HEADER_SIZE,
  LANG_BROADCAST,
  langToCode,
} from './protocol';

export type ReceiverState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

export interface BroadcastSession {
  device: BleDevice;
  name: string;
  rssi: number;
}

export class BLEReceiver {
  private device: BleDevice | null = null;
  private reassembler: FrameReassembler;
  private _state: ReceiverState = 'idle';

  public onStateChange?: (state: ReceiverState) => void;
  public onSessionFound?: (session: BroadcastSession) => void;
  public onFrame?: (encoded: Uint8Array) => void;

  /**
   * v0.2 — Chiamato quando arriva un frame testo.
   * @param text       Testo (originale se broadcaster non usa OpenAI, già tradotto se usa OpenAI)
   * @param isFinal    true = frase completa
   * @param isPreTranslated  true = testo già tradotto nella lingua del receiver (broadcaster ha pagato)
   */
  public onText?: (text: string, isFinal: boolean, isPreTranslated: boolean) => void;

  /** Chiamato per ogni notifica BLE raw ricevuta — usato per diagnostica */
  public onRawPacket?: () => void;

  /** Lingua preferita del receiver — usata per filtrare i pacchetti con tag lingua */
  public targetLang = 'en';

  public framesReceived = 0;

  constructor() {
    this.reassembler = new FrameReassembler((data, _flags) => {
      this.framesReceived++;
      this.onFrame?.(data);
    });
  }

  private setState(s: ReceiverState): void {
    this._state = s;
    this.onStateChange?.(s);
  }

  get state(): ReceiverState { return this._state; }

  async initialize(): Promise<void> {
    await BleClient.initialize({ androidNeverForLocation: true });
  }

  async startScan(): Promise<void> {
    this.setState('scanning');
    try {
      await BleClient.requestLEScan(
        { services: [GLOBOAIR_SERVICE_UUID], allowDuplicates: false },
        (result: ScanResult) => {
          const session: BroadcastSession = {
            device: result.device,
            name: result.localName ?? result.device.name ?? 'GloboAir',
            rssi: result.rssi ?? -100,
          };
          this.onSessionFound?.(session);
        }
      );
    } catch (err) {
      console.error('[BLEReceiver] scan error:', err);
      this.setState('error');
    }
  }

  async stopScan(): Promise<void> {
    try {
      await BleClient.stopLEScan();
    } catch { /* ignore */ }
    if (this._state === 'scanning') this.setState('idle');
  }

  async connect(session: BroadcastSession): Promise<void> {
    await this.stopScan();
    this.device = session.device;
    this.setState('connecting');

    try {
      await BleClient.connect(
        session.device.deviceId,
        (deviceId) => {
          console.log('[BLEReceiver] disconnected from', deviceId);
          this.setState('idle');
          this.reassembler.reset();
        }
      );

      await BleClient.startNotifications(
        session.device.deviceId,
        GLOBOAIR_SERVICE_UUID,
        AUDIO_CHARACTERISTIC_UUID,
        (value: DataView) => {
          try {
            const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            this.onRawPacket?.(); // contatore diagnostico

            // v0.3: primo byte = tipo pacchetto (0xA1=testo, 0xA0=audio)
            if (raw.length >= TEXT_FRAME_HEADER_SIZE && raw[0] === TEXT_PACKET_TYPE) {
              const tf = decodeTextFrame(raw);

              if (tf.langCode === LANG_BROADCAST) {
                // Testo originale — il receiver lo traduce (MyMemory o OpenAI a sue spese)
                this.framesReceived++;
                this.onText?.(tf.text, tf.isFinal, false);
              } else if (tf.langCode === langToCode(this.targetLang)) {
                // Testo già tradotto nella mia lingua dal broadcaster (OpenAI del broadcaster)
                this.framesReceived++;
                this.onText?.(tf.text, tf.isFinal, true /* isPreTranslated */);
              }
              // else: pacchetto per un'altra lingua → scarta silenziosamente
            } else {
              // v0.1 audio fallback (ADPCM)
              const chunk = decodeChunk(raw);
              this.reassembler.receive(chunk);
            }
          } catch (err) {
            console.warn('[BLEReceiver] decode error:', err);
          }
        }
      );

      this.setState('connected');
      console.log('[BLEReceiver] Connected and listening');
    } catch (err) {
      console.error('[BLEReceiver] connect error:', err);
      this.setState('error');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await BleClient.stopNotifications(
          this.device.deviceId,
          GLOBOAIR_SERVICE_UUID,
          AUDIO_CHARACTERISTIC_UUID
        );
        await BleClient.disconnect(this.device.deviceId);
      } catch { /* ignore */ }
      this.device = null;
    }
    this.reassembler.reset();
    this.setState('idle');
  }
}
