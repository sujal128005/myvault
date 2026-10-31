import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { WEB_CSP } from './vite.shared';

/** Inject the strict CSP only into production builds (the dev server needs HMR). */
function cspPlugin(): Plugin {
  return {
    name: 'myvault-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 2000,
  },
  preview: { host: '127.0.0.1' },
  server: { host: '127.0.0.1' },
});
