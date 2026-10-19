/**
 * Table unique des dépendances chargées jusqu'ici depuis un CDN.
 *
 * L'application doit tourner sans réseau : dans une webview Tauri, un service
 * worker ne s'enregistre pas, donc « mettre en cache à la première visite » ne
 * protège rien. Chaque URL ci-dessous est donc servie depuis `public/vendor/`,
 * téléchargée une fois par `tools/vendor-cdn.mjs` et mise en cache par
 * `public/service-worker.js` côté web.
 *
 * Cette table est la SEULE source : `tools/vendor-cdn.mjs` s'en sert pour
 * télécharger, `tools/split-legacy.mjs` pour réécrire le HTML et le module
 * historiques. Deux copies divergeraient — et une divergence ici ne se voit
 * qu'en production, sous forme d'un écran blanc sans réseau.
 */

/** Un fichier téléchargé tel quel. */
export const FILES = [
  { url: 'https://cdn.tailwindcss.com', file: 'vendor/tailwind.js' },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    file: 'vendor/pdf-lib.min.js',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    file: 'vendor/fontkit.umd.min.js',
  },
];

/**
 * pdf.js est livré en paquet npm : les cartes CMap et les polices standard sont
 * des centaines de fichiers, dont la liste ne peut pas être écrite à la main.
 * On extrait donc l'archive du registre, sans dépendance ni `npm install`.
 */
export const PDFJS = {
  name: 'pdfjs-dist',
  version: '4.9.155',
  tarball: 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.9.155.tgz',
  /** `chemin dans l'archive` → `chemin servi`. */
  entries: [
    { from: 'package/build/pdf.min.mjs', to: 'vendor/pdfjs/pdf.min.mjs' },
    { from: 'package/build/pdf.worker.min.mjs', to: 'vendor/pdfjs/pdf.worker.min.mjs' },
  ],
  /** Dossiers entiers recopiés. */
  dirs: [
    { from: 'package/cmaps/', to: 'vendor/pdfjs/cmaps/' },
    { from: 'package/standard_fonts/', to: 'vendor/pdfjs/standard_fonts/' },
  ],
};

/** Polices de l'interface (le sélecteur de polices Google reste en ligne). */
export const FONT_FAMILIES = [
  { family: 'Inter', axis: 'wght@300;400;500;600;700;800' },
  { family: 'Space Mono', axis: 'wght@400;700' },
  { family: 'IBM Plex Mono', axis: 'wght@400;500;600' },
];

export const FONTS_CSS = 'vendor/fonts/app.css';
export const FONTS_DIR = 'vendor/fonts/';

/**
 * Réécritures appliquées au HTML et au module d'origine.
 *
 * `from` doit être trouvé : une URL qui aurait changé côté CDN doit faire échouer
 * la migration bruyamment, pas laisser passer un chargement distant.
 *
 * `scope` dit où le motif vit — le `<head>` (balises <script>) ou le module
 * (imports et URL d'options pdf.js). Un motif cherché au mauvais endroit est une
 * erreur de programmation, pas une tolérance : `rewrite()` le signale.
 */
export const REWRITES = [
  { scope: 'head', from: 'https://cdn.tailwindcss.com', to: 'vendor/tailwind.js' },
  {
    scope: 'head',
    from: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    to: 'vendor/pdf-lib.min.js',
  },
  {
    scope: 'head',
    from: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    to: 'vendor/fontkit.umd.min.js',
  },
  {
    scope: 'module',
    from: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs',
    to: 'vendor/pdfjs/pdf.min.mjs',
  },
  {
    scope: 'module',
    from: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs',
    to: 'vendor/pdfjs/pdf.worker.min.mjs',
  },
  {
    scope: 'module',
    from: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/cmaps/',
    to: 'vendor/pdfjs/cmaps/',
  },
  {
    scope: 'module',
    from: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/standard_fonts/',
    to: 'vendor/pdfjs/standard_fonts/',
  },
];

/** Réécrit un texte et vérifie que chaque motif attendu y était. */
export function rewrite(text, where, scope = 'all') {
  let out = text;
  const missing = [];
  for (const { from, to, scope: own } of REWRITES) {
    if (scope !== 'all' && own !== scope) continue;
    if (!out.includes(from)) {
      // Un même motif peut avoir déjà été réécrit (module régénéré) : seul
      // l'absence des DEUX formes est une anomalie.
      if (!out.includes(to)) missing.push(from);
      continue;
    }
    out = out.split(from).join(to);
  }
  if (missing.length) {
    throw new Error(`${where} : motif(s) introuvable(s) —\n  ${missing.join('\n  ')}`);
  }
  return out;
}
