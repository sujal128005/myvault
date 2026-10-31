#!/usr/bin/env node
// Builds the Chrome extension into dist/extension and (optionally) zips it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const run = (args) => execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), ...args], { stdio: 'inherit' });
run(['build', '--config', 'vite.ext.config.ts']);
run(['build', '--config', 'vite.bg.config.ts']);

const out = resolve('dist/extension');
for (const f of ['manifest.json', 'background.js', 'popup.html', 'vault.html', 'offscreen.html', 'icons/icon-128.png']) {
  if (!existsSync(resolve(out, f))) {
    console.error(`Extension build is missing ${f}`);
    process.exit(1);
  }
}
const bg = readFileSync(resolve(out, 'background.js'), 'utf8');
if (/\bimport\s*\(/.test(bg)) {
  console.error('background.js must not contain dynamic import()');
  process.exit(1);
}
console.log(`\n✔ Extension built: ${out}\n  Load it via chrome://extensions → Developer mode → Load unpacked.`);
