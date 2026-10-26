import { roomsAliases } from './tooling/aliases';
import { boardUiResolver } from './tooling/boardui-resolver';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const referenceRoot = process.env.ROOMS_REFERENCE_ROOT;
const referenceAssets = {
  name: 'rooms-development-reference-assets',
  apply: 'serve' as const,
  configureServer(server: import('vite').ViteDevServer) {
    if (!referenceRoot) return;
    server.middlewares.use(
      '/__reference/06_handoff/examples/weekend-list.pdf',
      async (_req, res) => {
        try {
          res.setHeader('Content-Type', 'application/pdf');
          res.end(await readFile(path.join(referenceRoot, '06_handoff/examples/weekend-list.pdf')));
        } catch {
          res.statusCode = 404;
          res.end('Reference example not found');
        }
      },
    );
    server.middlewares.use('/__reference/01_brand', async (req, res, next) => {
      const filename = (req.url || '').split('?')[0].slice(1);
      if (
        !/^(avatar-(deniz|ece|can|zeynep|mert)|community-bizim-oda|cinema-still)\.svg$/.test(
          filename,
        )
      )
        return next();
      try {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(await readFile(path.join(referenceRoot, '01_brand', filename)));
      } catch {
        res.statusCode = 404;
        res.end('Reference asset not found');
      }
    });
  },
};
export default defineConfig({
  worker: { format: 'es' },
  root: 'apps/desktop',
  base: './',
  // Tailwind only serves BoardUI: apps/desktop/src/boardui/foundations/globals.css imports no preflight
  // and scans only the BoardUI and Studio folders, so existing screens keep their own CSS.
  plugins: [boardUiResolver(), react(), tailwindcss(), referenceAssets],
  resolve: { alias: roomsAliases },
  server: { port: 5173, strictPort: true },
  // Source maps stay off: shipped builds must not carry the (private) BoardUI Pro source.
  build: { outDir: '../../dist', emptyOutDir: true, sourcemap: false },
});
