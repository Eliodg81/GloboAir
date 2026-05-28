import { BLEPeripheral } from '../ble/BLEBroadcaster';

/**
 * AudioStreamCapture — cattura microfono via plugin nativo (AudioRecord su Android)
 *
 * Usa il plugin BLEPeripheralPlugin nativo invece di getUserMedia/Web Audio API
 * per evitare i problemi di accesso audio nel WebView di Capacitor.
 *
 * Output: callback con chunk PCM 8kHz 8-bit ogni ~85ms
 */
export class AudioStreamCapture {
  private listener: { remove: () => void } | null = null;
  public isCapturing = false;

  async start(onPCM: (samples: Uint8Array) => void): Promise<void> {
    // Richiedi permesso microfono
    try {
      const { granted } = await BLEPeripheral.requestMicPermission();
      if (!granted) throw new Error('Permesso microfono negato');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('negato')) throw new Error(msg);
      // se il metodo non esiste (web) procedi comunque
    }

    // Ascolta i chunk audio dal plugin nativo
    this.listener = await BLEPeripheral.addListener('audioChunk', ({ data }) => {
      if (!this.isCapturing) return;
      // Decodifica base64 → Uint8Array PCM
      const binary = atob(data);
      const pcm8 = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        pcm8[i] = binary.charCodeAt(i);
      }
      onPCM(pcm8);
    });

    await BLEPeripheral.startAudioCapture();
    this.isCapturing = true;
  }

  stop(): void {
    this.isCapturing = false;
    this.listener?.remove();
    this.listener = null;
    BLEPeripheral.stopAudioCapture().catch(() => {});
  }
}
