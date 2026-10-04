import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Only this server-side configuration reads API_KEY. Never prefix it with VITE_.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const proxy = {
    '/api': {
      target: env.BACKEND_URL || 'http://127.0.0.1:8000',
      changeOrigin: true,
      headers: { 'X-API-Key': env.API_KEY || '' },
    },
  };
  return { server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy }, preview: { proxy } };
});
