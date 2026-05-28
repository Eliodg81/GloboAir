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
