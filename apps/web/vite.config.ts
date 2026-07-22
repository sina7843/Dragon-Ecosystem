import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * The browser always calls the API on a same-origin `/api` path. Locally Vite
 * proxies it; in containers nginx proxies it to `api:3000`. Nothing hardcodes
 * an API origin into the bundle.
 */
const apiTarget = process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000';
// The API also serves SEO + media at the site root; proxy them locally so the dev/preview
// origin matches the container topology (nginx forwards the same paths to the API).
const proxy = {
  '/api': { target: apiTarget, changeOrigin: true },
  '/robots.txt': { target: apiTarget, changeOrigin: true },
  '/sitemap.xml': { target: apiTarget, changeOrigin: true },
  '/media': { target: apiTarget, changeOrigin: true }
};

// Bind explicitly to IPv4: on Windows `localhost` can resolve to ::1 only,
// which makes 127.0.0.1 health probes and proxies fail.
const HOST = '127.0.0.1';

export default defineConfig({
  plugins: [vue()],
  server: { host: HOST, port: 5173, proxy },
  preview: { host: HOST, port: 4173, proxy },
  build: { outDir: 'dist', sourcemap: false }
});
