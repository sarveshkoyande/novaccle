import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-time only — in production the Express server serves client/dist
    // directly, so there's nothing to proxy (see Dockerfile).
    proxy: {
      '/api': {
        target: 'http://localhost:4300',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
