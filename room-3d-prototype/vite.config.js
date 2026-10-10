import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: { input: { main: 'index.html', assets: 'asset-preview.html' } },
  },
  server: {
    proxy: {
      '/api/room-object': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
    },
  },
})
