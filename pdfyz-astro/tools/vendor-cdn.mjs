/**
 * Télécharge les dépendances CDN dans `public/vendor/`.
 *
 *   node tools/vendor-cdn.mjs            (ne retélécharge que ce qui manque)
 *   node tools/vendor-cdn.mjs --force    (tout reprendre)
 *
 * Pourquoi ce script existe : l'application doit fonctionner sans réseau, y
 * compris dans une webview de bureau où les service workers ne s'enregistrent
 * pas. Les fichiers produits ici sont des ARTEFACTS — ils ne sont pas versionnés
 * (`public/vendor/` est ignoré) mais reconstruits à l'identique, et un
 * `manifest.json` enregistre l'URL et l'empreinte SHA-256 de chacun. Une
 * dépendance mise à jour se voit donc dans le diff du manifeste, pas dans une
 * différence invisible entre deux builds.
 *
 * Aucune dépendance : `node:https`, `node:zlib` et un lecteur tar minimal. Toute
 * la politique du projet est là — un `npm install` de plus serait une surface
 * d'attaque de plus pour un besoin qui tient en deux cents lignes.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { FILES, FONT_FAMILIES, FONTS_CSS, FONTS_DIR, PDFJS } from './cdn-urls.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const force = process.argv.includes('--force');

/** Navigateur annoncé à Google Fonts : sans lui, on reçoit du TTF, pas du WOFF2. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let downloaded = 0;
let reused = 0;
const manifest = {};

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Écrit `buf` dans `public/<rel>` et enregistre son empreinte. */
async function emit(rel, buf, origin) {
  const abs = join(publicDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  manifest[rel] = { origin, bytes: buf.length, sha256: sha256(buf) };
  return buf;
}

/** Le fichier est-il déjà là avec la bonne empreinte ? */
let previousCache = null;
async function previousManifest() {
  if (previousCache) return previousCache;
  try {
    previousCache = JSON.parse(await readFile(join(publicDir, 'vendor/manifest.json'), 'utf8'));
  } catch {
    previousCache = {};
  }
  return previousCache;
}

async function alreadyThere(rel) {
  if (force) return false;
  try {
    const buf = await readFile(join(publicDir, rel));
    const previous = await previousManifest();
    return previous[rel] && previous[rel].sha256 === sha256(buf);
  } catch {
    return false;
  }
}

/** Réutilise une entrée déjà produite : même empreinte, donc même contenu. */
async function reuse(rel) {
  manifest[rel] = (await previousManifest())[rel];
  reused++;
}

async function fetchFile({ url, file }) {
  if (await alreadyThere(file)) {
    manifest[file] = JSON.parse(await readFile(join(publicDir, 'vendor/manifest.json'), 'utf8'))[file];
    reused++;
    return;
  }
  const buf = await download(url);
  await emit(file, buf, url);
  downloaded++;
  console.log(`  ${file.padEnd(34)} ${(buf.length / 1024).toFixed(1)} Ko`);
}

// ── Lecteur tar minimal (USTAR + en-têtes pax et « long name » de GNU) ───────
function readTar(buffer) {
  const files = new Map();
  let offset = 0;
  let nextName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const sizeField = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
    const size = sizeField ? parseInt(sizeField, 8) : 0;
    const flag = String.fromCharCode(header[156] || 48);
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (flag === 'x' || flag === 'g') {
      // En-tête pax : « <longueur> path=<nom>\n » parmi d'autres clés.
      const text = body.toString('utf8');
      const match = text.match(/\d+ path=([^\n]+)\n/);
      if (match) nextName = match[1];
      continue;
    }
    if (flag === 'L') {
      nextName = body.toString('utf8').replace(/\0.*$/, '');
      continue;
    }
    if (flag === '5') continue; // dossier
    const path = nextName || name;
    nextName = null;
    files.set(path, body);
  }
  return files;
}

// ── 1. Fichiers uniques ─────────────────────────────────────────────────────
console.log('CDN → public/vendor/');
console.log('\nBibliothèques');
for (const entry of FILES) await fetchFile(entry);

// ── 2. pdf.js (archive npm : cartes CMap et polices standard) ───────────────
console.log(`\npdf.js ${PDFJS.version}`);

// L'archive entière est téléchargée une seule fois par build neuf. Si tous les
// fichiers attendus sont déjà sur disque avec la bonne empreinte, on ne
// télécharge rien : `npm run build` en boucle ne doit pas coûter 1,5 Mo de
// réseau à chaque fois.
const pdfjsTargets = [
  ...PDFJS.entries.map((e) => e.to),
  ...PDFJS.dirs.map((d) => `${d.to}*`),
];
const pdfjsPresent =
  !force &&
  (await Promise.all(pdfjsTargets.filter((t) => !t.endsWith('*')).map((t) => alreadyThere(t)))).every(
    Boolean,
  ) &&
  (await alreadyThere(`${PDFJS.dirs[0].to}Adobe-Japan1-UCS2.bcmap`));

if (pdfjsPresent) {
  const previous = await previousManifest();
  for (const [rel, entry] of Object.entries(previous)) {
    if (rel.startsWith('vendor/pdfjs/')) {
      manifest[rel] = entry;
      reused++;
    }
  }
  console.log(`  vendor/pdfjs/                      deja present, aucun telechargement`);
} else {
  const tarGz = await download(PDFJS.tarball);
  const archive = readTar(gunzipSync(tarGz));

  for (const { from, to } of PDFJS.entries) {
    const body = archive.get(from);
    if (!body) throw new Error(`archive pdf.js : ${from} absent`);
    await emit(to, body, `${PDFJS.tarball}#${from}`);
    console.log(`  ${to.padEnd(34)} ${(body.length / 1024).toFixed(1)} Ko`);
    downloaded++;
  }
  for (const { from, to } of PDFJS.dirs) {
    const names = [...archive.keys()].filter((n) => n.startsWith(from) && !n.endsWith('/'));
    if (!names.length) throw new Error(`archive pdf.js : ${from} vide`);
    let total = 0;
    for (const name of names) {
      const body = archive.get(name);
      await emit(to + name.slice(from.length), body, `${PDFJS.tarball}#${name}`);
      total += body.length;
    }
    console.log(`  ${to.padEnd(34)} ${names.length} fichier(s), ${(total / 1024).toFixed(0)} Ko`);
    downloaded++;
  }
}

// ── 3. Polices de l'interface ────────────────────────────────────────────────
// On concatène les feuilles Google en UN fichier et on réécrit chaque URL
// `fonts.gstatic.com` vers un fichier local. Les URL restent relatives au
// dossier `fonts/`, comme la feuille qui les référence : aucune ne dépend donc
// de l'endroit où le site est déployé.
console.log('\nPolices');
const cssParts = [];
let fontFiles = 0;
const seenFontUrls = new Map();

// Même logique de réutilisation : la feuille déjà produite référence des
// fichiers locaux ; si tous sont là, rien à télécharger. Google Fonts renvoie
// sinon des URL différentes à chaque appel (sous-ensembles), ce qui ferait
// grossir `vendor/fonts/` à chaque build.
let fontsAlreadyThere = false;
if (!force && (await alreadyThere(FONTS_CSS))) {
  const current = await readFile(join(publicDir, FONTS_CSS), 'utf8');
  const referenced = [...current.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  fontsAlreadyThere =
    referenced.length > 0 &&
    (await Promise.all(referenced.map((rel) => alreadyThere(FONTS_DIR + rel)))).every(Boolean);
}

if (fontsAlreadyThere) {
  const previous = await previousManifest();
  for (const [rel, entry] of Object.entries(previous)) {
    if (rel.startsWith(FONTS_DIR)) {
      manifest[rel] = entry;
      reused++;
    }
  }
  console.log(`  ${FONTS_DIR.padEnd(34)} deja present, aucun telechargement`);
} else {
  for (const { family, axis } of FONT_FAMILIES) {
    const url =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}` +
      `${axis ? `:${axis}` : ''}&display=swap`;
    const css = (await download(url)).toString('utf8');
    const rewritten = await rewriteFontUrls(css, family);
    cssParts.push(`/* ${family} — ${url} */\n${rewritten}`);
  }
  await emit(FONTS_CSS, Buffer.from(cssParts.join('\n'), 'utf8'), 'fonts.googleapis.com (3 familles)');
  console.log(`  ${FONTS_CSS.padEnd(34)} ${fontFiles} fichier(s) de police`);
}

async function rewriteFontUrls(css, family) {
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
  let out = css;
  for (const url of urls) {
    let local = seenFontUrls.get(url);
    if (!local) {
      const slug = `${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${url.split('/').pop()}`;
      const body = await download(url);
      await emit(FONTS_DIR + slug, body, url);
      local = slug;
      seenFontUrls.set(url, local);
      fontFiles++;
      downloaded++;
    }
    out = out.split(url).join(local);
  }
  return out;
}

// ── 4. Manifeste ────────────────────────────────────────────────────────────
await emit(
  'vendor/manifest.json',
  Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  'généré par tools/vendor-cdn.mjs',
);

const totalBytes = Object.values(manifest).reduce((n, entry) => n + entry.bytes, 0);
console.log(
  `\n${downloaded} telechargement(s), ${reused} deja present(s) — ${(totalBytes / 1024 / 1024).toFixed(2)} Mo dans public/vendor/`,
);
