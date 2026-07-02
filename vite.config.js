import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
})
