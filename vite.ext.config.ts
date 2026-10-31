import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { EXTENSION_CSP } from './vite.shared';

const root = resolve(__dirname, 'src/extension');
const outDir = resolve(__dirname, 'dist/extension');

/** Write manifest.json (with the strict CSP) and icons into the build output. */
function manifestPlugin(): Plugin {
  return {
    name: 'myvault-manifest',
    apply: 'build',
    closeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
      const manifest = readFileSync(resolve(root, 'manifest.json'), 'utf8').replace('__CSP__', EXTENSION_CSP);
      const json = JSON.parse(manifest) as { version: string };
      json.version = pkg.version;
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(json, null, 2));
      mkdirSync(resolve(outDir, 'icons'), { recursive: true });
      for (const s of [16, 32, 48, 128]) copyFileSync(resolve(__dirname, `public/icons/icon-${s}.png`), resolve(outDir, `icons/icon-${s}.png`));
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  publicDir: false,
  plugins: [react(), manifestPlugin()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        vault: resolve(root, 'vault.html'),
        offscreen: resolve(root, 'offscreen.html'),
      },
    },
  },
});
