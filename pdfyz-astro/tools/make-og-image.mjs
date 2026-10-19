/**
 * Fabrique l'image de partage (Open Graph / Twitter) : 1200 × 630.
 *
 *   node tools/make-og-image.mjs
 *
 * Pourquoi ce fichier existe : la page déclare `twitter:card =
 * summary_large_image`, un format paysage 1,91:1. Y mettre une icône carrée de
 * 512 px oblige les réseaux à la recadrer — ils rognent le haut et le bas, et
 * l'aperçu devient illisible. Une image dessinée pour ce format est la seule
 * qui rende correctement.
 *
 * Le dessin est en SVG, rastérisé par sharp : le fichier produit est donc
 * reproductible, et la marque vient de `favicon.svg`, seule source de vérité —
 * aucune copie du logotype à maintenir ici.
 *
 * Vérification incluse : à la fin, la boîte d'encre est mesurée. Si le texte
 * touchait un bord, ou si la marque débordait, le script échoue au lieu de
 * produire une image subtilement fausse que personne ne remarquerait.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const publicDir = join(root, 'public');

const W = 1200;
const H = 630;

// ── Marque ────────────────────────────────────────────────────────────────
// `favicon.svg` est un carré de 512 unités, sans fond. On n'en garde que le
// contenu, inséré dans un `<svg>` imbriqué : librsvg (via sharp) le place et
// l'échelle exactement comme un élément image, sans transformation à recalculer.
const markSource = readFileSync(join(root, '..', 'favicon.svg'), 'utf8');
const markInner = markSource
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim();
if (!markInner.includes('<path')) {
  throw new Error('favicon.svg : aucun tracé trouvé');
}

const MARK = 214;
const MARK_X = 170;
const MARK_Y = Math.round((H - MARK) / 2);

// ── Composition ───────────────────────────────────────────────────────────
// Le fond est celui de la coque en thème nuit (#0b0b0e) : l'aperçu ressemble à
// l'application, pas à une carte de visite.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.62">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fade" cx="0.5" cy="0.5" r="0.72">
      <stop offset="0%" stop-color="#0b0b0e" stop-opacity="0"/>
      <stop offset="70%" stop-color="#0b0b0e" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#0b0b0e" stop-opacity="1"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="#0b0b0e"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <svg x="${MARK_X}" y="${MARK_Y}" width="${MARK}" height="${MARK}" viewBox="0 0 512 512">${markInner}</svg>

  <path d="M448 ${MARK_Y} V ${MARK_Y + MARK}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>

  <g font-family="Inter, Segoe UI, Helvetica Neue, Arial, sans-serif">
    <text x="494" y="286" font-size="74" font-weight="800" letter-spacing="6" fill="#ffffff">PDF-YZ</text>
    <rect x="496" y="316" width="64" height="2" fill="#ffffff" fill-opacity="0.4"/>
    <text x="494" y="372" font-size="33" font-weight="500" fill="#d2d2da">Free online PDF editor</text>
    <text x="494" y="414" font-size="21" fill="#8e8e9a">Edit · annotate · impose · export — 100 % offline</text>
  </g>

  <text x="${MARK_X}" y="566" font-family="Inter, Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="19" letter-spacing="1.2" fill="#5f5f6b">app.zigmoon.com/PDF-YZ</text>
</svg>
`;

// Densité 72 = 1 unité SVG pour 1 pixel. Toute autre valeur doublerait ou
// réduirait le rendu (144 donnait 2400×1260), et l'image de partage doit faire
// exactement 1200×630.
const png = await sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();

// ── Contrôles ─────────────────────────────────────────────────────────────
const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let x0 = info.width;
let y0 = info.height;
let x1 = -1;
let y1 = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    // On ne compte que l'encre CLAIRE : le fond est presque noir, donc les
    // pixels sombres ne disent rien de la mise en page.
    const i = (y * info.width + x) * 4;
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (data[i + 3] > 8 && l > 60) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}

const margins = { gauche: x0, droite: info.width - 1 - x1, haut: y0, bas: info.height - 1 - y1 };
if (info.width !== W || info.height !== H) throw new Error(`dimensions ${info.width}x${info.height} au lieu de ${W}x${H}`);
if (Math.min(margins.gauche, margins.droite, margins.haut, margins.bas) < 8) {
  throw new Error(`l'encre touche un bord : ${JSON.stringify(margins)}`);
}

writeFileSync(join(publicDir, 'og-image.png'), png);

console.log(`og-image.png  ${W}x${H}  ${(png.length / 1024).toFixed(1)} Ko`);
console.log(`  encre  x ${x0}..${x1}  y ${y0}..${y1}`);
console.log(`  marges G ${margins.gauche}  D ${margins.droite}  H ${margins.haut}  B ${margins.bas}`);
console.log(`  ratio  ${(W / H).toFixed(3)} (attendu ~1,91 pour summary_large_image)`);
