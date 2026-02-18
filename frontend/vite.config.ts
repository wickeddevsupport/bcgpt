import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // Proxy API and ops calls to the OpenClaw gateway (default dev port 10001)
      '/api': {
        target: 'http://localhost:10001',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://localhost:10001',
        changeOrigin: true,
      },
      '/ops-ui': {
        target: 'http://localhost:10001',
        changeOrigin: true,
      },
    },
  },
})
