import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// Cross-origin isolation lets WASM use several threads (faster speech). Everything the app loads is same-origin,
// so these headers cost nothing. Production headers live in vercel.json.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// Dev only: Vite tags dynamic imports with "?import" and then refuses to serve files from /public that way.
// The ONNX runtime loads its WASM glue from /ort, so strip the tag and let it be served as a plain file.
const servePublicOrt = {
  name: 'serve-public-ort',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/ort/') || req.url?.startsWith('/piper/')) req.url = req.url.split('?')[0]
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), servePublicOrt],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
