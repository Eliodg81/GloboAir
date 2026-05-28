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
        // Nomi fissi senza hash — così i file in git non cambiano ad ogni build
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        manualChunks: {
          'react-vendor':  ['react', 'react-dom'],
          'lucide':        ['lucide-react'],
          'capacitor-ble': ['@capacitor-community/bluetooth-le'],
          'capacitor-core':['@capacitor/core'],
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
