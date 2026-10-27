import {getRequestListener} from '@hono/node-server';
import react from '@vitejs/plugin-react';
import {tsImport} from 'tsx/esm/api';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Runs the API (server/app.ts) inside the Vite dev server, so one command
// starts everything and API keys never reach the browser. Server changes
// need a dev server restart.
function api(): Plugin {
  return {
    name: 'repository-trainer-api',
    async configureServer(server) {
      // Loaded with tsx rather than through Vite, so the server's npm
      // dependencies run as plain Node modules.
      const {createApp} = await tsImport('./server/app.ts', import.meta.url) as typeof import('./server/app');
      const listener = getRequestListener(createApp().fetch);
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/')) {
          void listener(req, res);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  // Make .env.local values (ANTHROPIC_API_KEY, GITHUB_TOKEN) visible to the server code.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value;
  }

  return {plugins: process.env.VITEST ? [react()] : [react(), api()]};
});
