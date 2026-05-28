import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separa React dal codice app
          'react-vendor': ['react', 'react-dom'],
          // Separa le icone Lucide (sono pesanti)
          'lucide': ['lucide-react'],
          // Separa il layer BLE di Capacitor
          'capacitor-ble': ['@capacitor-community/bluetooth-le'],
          // Separa il core Capacitor
          'capacitor-core': ['@capacitor/core'],
        },
      },
    },
  },
  // Needed for AudioWorklet
  optimizeDeps: {
    exclude: [],
  },
  headers: {
    // Required for SharedArrayBuffer (AudioWorklet cross-origin isolation)
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
});
