import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin for the browser, so the backend needs no CORS.
    proxy: {
      '/auth': 'http://localhost:8080',
      '/api': 'http://localhost:8080',
      // No changeOrigin: the backend checks the browser's Origin (http://localhost:5173).
      '/ws': { target: 'http://localhost:8080', ws: true },
    },
  },
})
