// Exécute un binaire wasm32-wasip1 du workspace avec Node (WASI), sans linker
// natif. Sert de lanceur à `cargo test --target wasm32-wasip1`, et accessoirement
// à exécuter un exemple compilé pour wasm32-wasip1.
//
// Usage : node scripts/run-wasi.mjs <chemin-du-.wasm> [args...]

import { readFile, readdir } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const [wasmPath, ...args] = process.argv.slice(2);
if (!wasmPath) {
  console.error('usage: node scripts/run-wasi.mjs <fichier.wasm> [args...]');
  process.exit(2);
}

// Le dossier courant est exposé au module, pour qu'il puisse écrire ses sorties.
const preopen = process.cwd();

const wasi = new WASI({
  version: 'preview1',
  args: [wasmPath, ...args],
  env: {},
  preopens: { '.': preopen, '/': preopen },
});

const wasm = await WebAssembly.compile(await readFile(wasmPath));
const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
const code = wasi.start(instance);

void readdir;
process.exit(code);
