import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));
const localMyUrlsPort = process.env.LOCAL_MYURLS_PORT ?? '18082';
const localMyUrlsPortNumber = Number(localMyUrlsPort);
if (
  !/^[0-9]{4,5}$/.test(localMyUrlsPort) ||
  !Number.isInteger(localMyUrlsPortNumber) ||
  localMyUrlsPortNumber < 1024 ||
  localMyUrlsPortNumber > 65535
) {
  throw new Error('LOCAL_MYURLS_PORT must be an integer from 1024 to 65535');
}

export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: {
    proxy: {
      '/short-api': {
        target: `http://127.0.0.1:${localMyUrlsPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/short-api/u, '/api'),
        configure(proxy) {
          proxy.on('proxyReq', (request) => {
            request.removeHeader('authorization');
            request.removeHeader('cookie');
            request.removeHeader('origin');
          });
        },
      },
    },
  },
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
