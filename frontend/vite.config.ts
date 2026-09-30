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
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // VITE_PROXY_TARGET: a backend on another port (e.g. the Studio preview on 3041).
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.VITE_PROXY_TARGET || 'http://localhost:3001').replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
});
