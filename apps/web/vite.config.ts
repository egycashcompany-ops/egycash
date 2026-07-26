import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Subpath deployments (e.g. https://egycash.com.eg/ecms): VITE_BASE_PATH sets the asset
// base and — via import.meta.env.BASE_URL — the router basename. Root ('/') by default.
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', 'VITE_').VITE_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
}));
