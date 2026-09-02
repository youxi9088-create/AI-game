import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fnVite } from '@fn/vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), fnVite()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        paint: resolve(rootDir, 'paint.html'),
        numberWorkshop: resolve(rootDir, 'number-workshop.html'),
      },
    },
  },
})
