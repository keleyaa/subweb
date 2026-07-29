import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: '/',
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': fromRoot('./src'),
      layouts: fromRoot('./src/layouts'),
      assets: fromRoot('./src/assets'),
      components: fromRoot('./src/components'),
      network: fromRoot('./src/network'),
      views: fromRoot('./src/views'),
      utils: fromRoot('./src/utils'),
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
  },
});
