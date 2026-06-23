import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Partner dev defaults to the LOCAL backend so building/testing the reseller
  // app never touches the production database. Override with VITE_DEV_API_PROXY.
  const API_TARGET = env.VITE_DEV_API_PROXY || 'http://localhost:4000';
  const AUTH_TARGET = env.VITE_DEV_AUTH_PROXY || 'http://localhost:4000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(process.env.PORT ?? 5175),
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
          secure: true,
        },
        '/auth': {
          target: AUTH_TARGET,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/auth/, ''),
        },
      },
    },
  };
});
