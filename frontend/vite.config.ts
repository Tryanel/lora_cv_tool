import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          antd: ['antd'],
          icons: ['lucide-react']
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/assets': 'http://127.0.0.1:8000',
      '/annotations': 'http://127.0.0.1:8000',
      '/annotation-jobs': 'http://127.0.0.1:8000',
      '/prompt-scenes': 'http://127.0.0.1:8000',
      '/prompt-versions': 'http://127.0.0.1:8000',
      '/datasets': 'http://127.0.0.1:8000',
      '/runs': 'http://127.0.0.1:8000',
      '/settings': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000'
    }
  }
});
