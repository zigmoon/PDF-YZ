#!/usr/bin/env node
/**
 * Construit le module WebAssembly du noyau Rust — version multiplateforme.
 *
 *   node scripts/build-wasm.mjs [--debug]
 *
 * `build-wasm.ps1` reste le raccourci Windows ; ce script-ci est ce que la CI
 * appelle, parce qu'il tourne aussi sous Linux et macOS. Les deux font la même
 * chose, dans le même ordre :
 *
 *   1. `cargo build --release -p pdfyz-wasm --target wasm32-unknown-unknown` ;
 *   2. copie vers `dist/pdfyz_core.wasm` (nom stable, c'est l'artefact) ;
 *   3. copie du .wasm et de la colle `web/pdfyz-core.js` dans
 *      `../pdfyz-astro/public/` si l'application est là ;
 *   4. `node scripts/validate-wasm.mjs` : 206 vérifications, dont la parité
 *      avec l'implémentation JavaScript. Un module qui ne passe pas ici ne doit
 *      pas être livré.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const debug = process.argv.includes('--debug');
const profile = debug ? 'debug' : 'release';

function run(command, args, cwd = root) {
  console.log(`▸ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} a echoue (code ${result.status})`);
}

console.log(`-- cargo build (${profile}, wasm32-unknown-unknown)`);
run('cargo', [
  'build',
  '-p',
  'pdfyz-wasm',
  '--target',
  'wasm32-unknown-unknown',
  ...(debug ? [] : ['--release']),
]);

const built = join(root, 'target', 'wasm32-unknown-unknown', profile, 'pdfyz_wasm.wasm');
const { size } = await stat(built);

const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
const final = join(dist, 'pdfyz_core.wasm');
await cp(built, final);
console.log(`OK : ${final} (${(size / 1024).toFixed(1)} Ko)`);

const webDir = join(root, '..', 'pdfyz-astro', 'public');
try {
  await stat(webDir);
  await cp(final, join(webDir, 'pdfyz_core.wasm'));
  await cp(join(root, 'web', 'pdfyz-core.js'), join(webDir, 'pdfyz-core.js'));
  console.log('OK : copie dans pdfyz-astro/public/ (wasm + colle)');
} catch {
  console.log('-- pdfyz-astro/public absent : copie web ignoree');
}

console.log('-- node scripts/validate-wasm.mjs');
run('node', [join(root, 'scripts', 'validate-wasm.mjs')]);
console.log('OK : noyau wasm construit et valide');
