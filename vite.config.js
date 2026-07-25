import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { translateWithFallback } from './api/translateProviders.js'

function translateDevProxy(env) {
  return {
    name: 'signara-translate-dev',
    configureServer(server) {
      server.middlewares.use('/api/translate', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Método no permitido' }))
          return
        }

        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', async () => {
          try {
            const body = raw ? JSON.parse(raw) : {}
            const q = String(body.q || '').trim()
            const target = String(body.target || '').trim()
            const source = String(body.source || 'es').trim() || 'es'
            if (!q || !target) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Se requieren "q" y "target"' }))
              return
            }
            if (target === source) {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ translated: q, target, source, provider: 'none' }))
              return
            }
            const { translated, provider } = await translateWithFallback(q, source, target, {
              googleKey: env.GOOGLE_TRANSLATE_API_KEY || '',
              myMemoryEmail: env.MYMEMORY_EMAIL || '',
              myMemoryKey: env.MYMEMORY_API_KEY || '',
            })
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ translated, target, source, provider }))
          } catch (err) {
            console.error('[dev /api/translate]', err)
            const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              error: err?.message || 'No se pudo traducir',
            }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), translateDevProxy(env)],
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/api/pose': {
          target: 'https://us-central1-sign-mt.cloudfunctions.net',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/pose/, '/spoken_text_to_signed_pose'),
        },
      },
    },
  }
})
