// Vite for the «الطقم الثابت» harnesses (zz-fixed-*.html) — the «now» shots of the real page and
// the design sample after them. NEVER COMMIT (apps/web/zz-* is in .git/info/exclude). The API base is
// relative, and each harness answers /api/v1/** in the page itself: nothing reaches a server.
import { defineConfig } from 'vite';
import process from 'node:process';
import react from '@vitejs/plugin-react';

process.env.VITE_API_BASE_URL = '/api/v1';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['zz-fixed-*.html'] },
  server: { port: 5316, strictPort: true, host: '127.0.0.1' },
});
