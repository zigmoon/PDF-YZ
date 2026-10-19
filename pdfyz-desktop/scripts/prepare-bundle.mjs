/**
 * Compose le dossier `frontend/` que Tauri embarque dans le binaire.
 *
 *   node scripts/prepare-bundle.mjs
 *
 * Trois étapes, dans cet ordre :
 *
 *   1. le noyau Rust en WebAssembly (`pdfyz-rust` → `pdfyz-astro/public/`) ;
 *   2. le build Astro avec `--base /` et une sortie séparée (`dist-desktop`),
 *      pour que l'application de bureau serve ses fichiers à la racine alors
 *      que le site vit sous `/PDF-YZ/` ;
 *   3. la copie de cette sortie dans `frontend/`, qui est le `frontendDist`
 *      déclaré dans `src-tauri/tauri.conf.json`.
 *
 * Pourquoi une copie plutôt qu'un `frontendDist` qui pointerait directement sur
 * `../pdfyz-astro/dist-desktop` : Tauri exige un chemin stable et déjà présent au
 * moment où il lit sa configuration, et un dossier de sortie Astro peut être
 * absent, partiel ou appartenir à une autre compilation. `frontend/` est donc un
 * produit, ignoré par git, refait à chaque build.
 *
 * Aucune dépendance : `node:child_process`, `node:fs`. Ce script est appelé par
 * `beforeBuildCommand`, donc il s'exécute pour `tauri build` comme pour
 * `tauri dev`, sur les trois systèmes — d'où l'absence de PowerShell.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const pdfyz = resolve(desktop, '..');
const astro = join(pdfyz, 'pdfyz-astro');
const rust = join(pdfyz, 'pdfyz-rust');
const publicDir = join(astro, 'public');
const frontend = join(desktop, 'frontend');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd, { optional = false } = {}) {
  const label = `${command} ${args.join(' ')}`;
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `code ${result.status}`;
    if (optional) {
      console.warn(`  ⚠ ${label} ignoré (${detail})`);
      return false;
    }
    throw new Error(`${label} a echoue : ${detail}`);
  }
  return true;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ── 1. Noyau WebAssembly ────────────────────────────────────────────────────
// Il est FACULTATIF : sans lui, l'application démarre et calcule en JavaScript
// (chaque appelant a son repli, et les deux sont tenus en parité par
// pdfyz-rust/scripts/validate-wasm.mjs). Un build de bureau sans cargo doit donc
// produire une application complète, pas une erreur.
console.log('1/3  noyau Rust');
const builtWasm = join(rust, 'target', 'wasm32-unknown-unknown', 'release', 'pdfyz_wasm.wasm');
const cargoOk = run(
  'cargo',
  ['build', '--release', '-p', 'pdfyz-wasm', '--target', 'wasm32-unknown-unknown'],
  rust,
  { optional: true },
);

if (cargoOk && (await exists(builtWasm))) {
  await cp(builtWasm, join(publicDir, 'pdfyz_core.wasm'));
  await cp(join(rust, 'web', 'pdfyz-core.js'), join(publicDir, 'pdfyz-core.js'));
  const { size } = await stat(join(publicDir, 'pdfyz_core.wasm'));
  console.log(`  pdfyz_core.wasm  ${(size / 1024).toFixed(1)} Ko`);
} else if (await exists(join(publicDir, 'pdfyz_core.wasm'))) {
  console.warn('  ⚠ cargo indisponible — le .wasm déjà présent est réutilisé');
} else {
  console.warn('  ⚠ aucun noyau : l’application utilisera le repli JavaScript');
}

// ── 2. Build Astro ──────────────────────────────────────────────────────────
console.log('\n2/3  build Astro (base /)');
run(npm, ['run', 'vendor'], astro);
run(npm, ['run', 'build:desktop'], astro);

// ── 3. Copie dans frontend/ ─────────────────────────────────────────────────
console.log('\n3/3  frontend/');
const distDesktop = join(astro, 'dist-desktop');
if (!(await exists(join(distDesktop, 'index.html')))) {
  throw new Error(`build Astro incomplet : ${join(distDesktop, 'index.html')} absent`);
}
await rm(frontend, { recursive: true, force: true });
await mkdir(frontend, { recursive: true });
await cp(distDesktop, frontend, { recursive: true });

// Contrôles de sortie : ce sont les trois erreurs qui donneraient une fenêtre
// blanche ou un éditeur muet, et elles ne se voient qu'à l'exécution.
const html = await readFile(join(frontend, 'index.html'), 'utf8');
const checks = [
  ['aucune ressource distante', !/https:\/\/(cdn|fonts\.googleapis)/.test(html)],
  ['kernel vendor/ présent', html.includes('vendor/tailwind.js')],
  ['noyau Rust embarqué', await exists(join(frontend, 'pdfyz_core.wasm'))],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
}
if (failed) throw new Error(`${failed} controle(s) de sortie en echec`);

console.log('\nfrontend/ pret.');
