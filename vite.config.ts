import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { geminiProxy } from './server/gemini-proxy';
import { partsApi } from './server/parts-api';

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const proxy = geminiProxy(env);
  return {
    plugins: [react(), {
      name: 'spill-api',
      configureServer(server) {
        server.middlewares.use(proxy);
        server.middlewares.use(partsApi());
      },
      configurePreviewServer(server) {
        server.middlewares.use(proxy);
        server.middlewares.use(partsApi());
      },
    }],
    server: { host: '127.0.0.1', port: 5180 },
    preview: { host: '127.0.0.1', port: 5180 },
  };
});
