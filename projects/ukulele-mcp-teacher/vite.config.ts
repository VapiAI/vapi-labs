import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/mcp': 'http://localhost:8787',
      '/vapi-tool-events': 'http://localhost:8787',
    },
  },
});
