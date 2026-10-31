import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** The MV3 service worker must be a single self-contained file (no dynamic imports). */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist/extension'),
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/extension/background.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
