import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev, proxy /api to the backend so the web app can run on :5173
// while the server runs on :3000 without CORS friction.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
