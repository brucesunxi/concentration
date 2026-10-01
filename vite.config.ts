import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  root: resolve(import.meta.dirname, 'apps/family-web'),
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom/client', 'lucide-react', 'zod'] },
  server: {
    host: '127.0.0.1', port: 4180, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4181', '/media': 'http://127.0.0.1:4181', '/content-assets': 'http://127.0.0.1:4181' },
    fs: { allow: [import.meta.dirname] },
  },
  build: { outDir: resolve(import.meta.dirname, 'dist/web-candidate'), manifest: true, emptyOutDir: true, target: ['chrome111', 'safari16.4', 'firefox113'] },
});
