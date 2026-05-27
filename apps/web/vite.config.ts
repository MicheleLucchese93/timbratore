import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const API_TARGET = env.VITE_DEV_API_PROXY || 'http://localhost:4000';
  const AUTH_TARGET = env.VITE_DEV_AUTH_PROXY || 'https://auth-sonoqui.xdevapp.it';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(process.env.PORT ?? 5173),
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
