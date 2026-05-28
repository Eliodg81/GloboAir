import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.globoup.globoair',
  appName: 'GloboAir',
  webDir: 'dist',
  plugins: {
    // BLE plugin configuration
    BluetoothLe: {
      displayStrings: {
        scanning: 'Ricerca sessioni GloboAir...',
        cancel: 'Annulla',
        availableDevices: 'Sessioni disponibili',
        noDeviceFound: 'Nessuna sessione trovata'
      }
    }
  },
  ios: {
    contentInset: 'always'
  }
};

export default config;
