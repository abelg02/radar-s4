import { defineConfig } from 'vite';

// En GitHub Pages la web vive en /radar-s4/
export default defineConfig({
  base: process.env.BASE ?? '/radar-s4/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
