/**
 * BLEPeripheralWeb — stub per sviluppo in browser (no BLE reale)
 * Simula le risposte del plugin nativo per testare la UI
 */
export class BLEPeripheralWeb {
  async initialize(): Promise<void> {
    console.log('[BLEPeripheralWeb] initialize (stub)');
  }
  async startAdvertising(options: { serviceUuid: string; localName: string }): Promise<void> {
    console.log('[BLEPeripheralWeb] startAdvertising', options.localName);
  }
  async stopAdvertising(): Promise<void> {
    console.log('[BLEPeripheralWeb] stopAdvertising');
  }
  async sendNotification(options: { value: string }): Promise<void> {
    // In web mode: simula ricezione locale per test
    (window as any).__globoAirTestFrame?.(options.value);
  }
  async getConnectedCentralsCount(): Promise<{ count: number }> {
    return { count: 0 };
  }
  async addListener(event: string, cb: (data: unknown) => void): Promise<{ remove: () => void }> {
    console.log('[BLEPeripheralWeb] addListener:', event);
    return { remove: () => {} };
  }
}
