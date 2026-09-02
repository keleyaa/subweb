import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));
const localGatewayPort = process.env.LOCAL_SUBWEB_PORT ?? '18081';
const localGatewayPortNumber = Number(localGatewayPort);
if (
  !/^[0-9]{4,5}$/.test(localGatewayPort) ||
  !Number.isInteger(localGatewayPortNumber) ||
  localGatewayPortNumber < 1024 ||
  localGatewayPortNumber > 65535
) {
  throw new Error('LOCAL_SUBWEB_PORT must be an integer from 1024 to 65535');
}

export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: {
    proxy: {
      '/short-api': {
        target: `http://127.0.0.1:${localGatewayPort}`,
        changeOrigin: false,
        headers: {
          host: 'app.local.test',
          origin: 'https://app.local.test',
        },
        configure(proxy) {
          proxy.on('proxyReq', (request) => {
            request.removeHeader('authorization');
            request.removeHeader('proxy-authorization');
            request.removeHeader('cookie');
            request.removeHeader('forwarded');
            request.removeHeader('x-forwarded-for');
            request.removeHeader('x-forwarded-host');
            request.removeHeader('x-forwarded-proto');
            request.removeHeader('x-real-ip');
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
