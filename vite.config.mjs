import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fromRoot('./src'),
    },
  },
  define: {
    'process.env.BASE_URL': JSON.stringify('/'),
  },
  build: {
    outDir: 'dist',
    target: 'es2015',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.js'],
    exclude: ['tests/e2e/**'],
  },
});
