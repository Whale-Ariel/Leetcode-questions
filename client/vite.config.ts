import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

function githubPagesSpa(): Plugin {
  return {
    name: 'github-pages-spa',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(rootDir, 'dist')
      const indexPath = path.join(dist, 'index.html')
      if (!fs.existsSync(indexPath)) return
      const restore = `<script>(function(){var r=sessionStorage.getItem('gh-pages-redirect');if(!r)return;sessionStorage.removeItem('gh-pages-redirect');if(r!==location.href)history.replaceState(null,'',r);})();</script>`
      const html = fs.readFileSync(indexPath, 'utf8').replace('<head>', `<head>${restore}`)
      fs.writeFileSync(indexPath, html)
      const base = (process.env.BASE_PATH || '/').replace(/\/?$/, '/')
      const notFound = `<!doctype html><html><head><meta charset="utf-8"><script>sessionStorage.setItem('gh-pages-redirect',location.href);location.replace(${JSON.stringify(base)});</script></head><body></body></html>`
      fs.writeFileSync(path.join(dist, '404.html'), notFound)
    },
  }
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss(), githubPagesSpa()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
