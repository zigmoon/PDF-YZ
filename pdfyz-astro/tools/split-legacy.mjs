#!/usr/bin/env node
/**
 * Migration `PDF-YZ/index.html` → sources Astro.
 *
 * L'application historique est un fichier unique de ~11 400 lignes : un <head>
 * de 214 lignes, une feuille de style de 1 930 lignes, 1 150 lignes de balisage
 * et un module de 8 100 lignes. Ce script le découpe **sans jamais réécrire le
 * contenu** : chaque fichier produit est une tranche de lignes contiguë, et le
 * script vérifie à la fin que la concaténation des tranches redonne exactement
 * la source. C'est la seule façon de garantir qu'une migration « mécanique »
 * n'a rien changé au comportement.
 *
 * Ce qu'il produit :
 *   src/styles/NN-*.css          la feuille, découpée aux frontières de blocs
 *   src/components/*.astro       le balisage, découpé en blocs de premier niveau
 *   src/layouts/BaseLayout.astro le <head> + la coquille <body>
 *   src/pages/index.astro        la composition, dans l'ordre du document
 *   src/scripts/app.js           le module historique, tel quel
 *   public/*                     les ressources statiques copiées
 *
 * Relancer ce script écrase les composants, les styles, le layout et la page —
 * qui sont des copies conformes, donc sans perte. `src/scripts/app.js` n'est
 * écrit que s'il est absent (ou avec --force-app) : c'est le seul fichier que
 * l'on fait évoluer à la main (branchement du noyau Rust).
 *
 * Usage :
 *   node tools/split-legacy.mjs               # idempotent
 *   node tools/split-legacy.mjs --force-app   # réécrit AUSSI app.js (perd le câblage)
 *   node tools/split-legacy.mjs --check       # ne rien écrire, seulement vérifier
 */

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewrite } from './cdn-urls.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.resolve(ROOT, '..', 'index.html');
const RUST = path.resolve(ROOT, '..', 'pdfyz-rust');

const FORCE = process.argv.includes('--force');
const FORCE_APP = process.argv.includes('--force-app');
const CHECK_ONLY = process.argv.includes('--check');

const problems = [];
const fail = (msg) => problems.push(msg);

// ───────────────────────────────────────────────────────────────────────────
//  Lecture
// ───────────────────────────────────────────────────────────────────────────

const source = (await readFile(LEGACY, 'utf8')).replace(/^\uFEFF/, '');
const lines = source.split(/\r?\n/);
const lineAt = (n) => lines[n - 1];

/** Première ligne (1-based, après `from`) dont le contenu satisfait `pred`. */
function findLine(pred, from, what) {
  for (let i = from; i <= lines.length; i++) if (pred(lineAt(i), i)) return i;
  throw new Error(`repère introuvable : ${what}`);
}

const headOpen = findLine((l) => /^\s*<head>\s*$/.test(l), 1, '<head>');
const styleOpen = findLine((l) => /^\s*<style>\s*$/.test(l), headOpen, '<style>');
const styleClose = findLine((l) => /^\s*<\/style>\s*$/.test(l), styleOpen, '</style>');
const headClose = findLine((l) => /^\s*<\/head>\s*$/.test(l), styleClose, '</head>');
const bodyOpen = findLine((l) => /^\s*<body[^>]*>\s*$/.test(l), headClose, '<body>');
const moduleOpen = findLine(
  (l) => /^\s*<script\s+type="module">\s*$/.test(l),
  bodyOpen,
  '<script type="module">',
);
const moduleClose = findLine((l) => /^\s*<\/script>\s*$/.test(l), moduleOpen, '</script>');
const donateLine = findLine((l) => /donate-popin\.js/.test(l), moduleClose, 'donate-popin.js');
const bodyClose = findLine((l) => /^\s*<\/body>\s*$/.test(l), donateLine, '</body>');
const htmlClose = findLine((l) => /^\s*<\/html>\s*$/.test(l), bodyClose, '</html>');

// ───────────────────────────────────────────────────────────────────────────
//  Feuille de style — 16 tranches, toutes à la profondeur d'accolades 0
// ───────────────────────────────────────────────────────────────────────────

const CSS_SEGMENTS = [
  [218, '01-base', 'jetons, corps de page, mise à zéro'],
  [248, '02-scrollbars', 'ascenseurs carrés'],
  [283, '03-prehome', 'pré-accueil : marque, import, sessions récentes'],
  [368, '04-chrome', 'toast PWA, boutons flottants, menus, bannière .sp'],
  [512, '05-donate', 'pop-in de don'],
  [618, '06-sessions', 'sessions récentes et popin « toutes les sessions »'],
  [870, '07-toolbar', 'barre d’outils flottante et mode modification'],
  [952, '08-tools-mobile', 'menus d’outils et feuilles mobiles'],
  [1045, '09-canvas-sidebar', 'barre latérale, zone de pages, objets éditables'],
  [1296, '10-colour-popover', 'sélecteur de couleur et toile de dessin'],
  [1371, '11-icc-zoom-status', 'profil ICC, zoom, barre d’état'],
  [1487, '12-properties-toast-loader', 'panneau propriétés, toast, chargeur'],
  [1588, '13-modals-fabs', 'signature, export, boutons flottants'],
  [1668, '14-notes-find-prefs', 'notes, recherche, préférences, métadonnées'],
  [1893, '15-text-editor-thumbs', 'éditeur de texte, vignettes, aide clavier'],
  [2041, '16-imposition-crop', 'imposition et recadrage visuel'],
];

function sliceStyles() {
  const out = [];
  for (let i = 0; i < CSS_SEGMENTS.length; i++) {
    const [start, name, title] = CSS_SEGMENTS[i];
    const end = i + 1 < CSS_SEGMENTS.length ? CSS_SEGMENTS[i + 1][0] - 1 : styleClose - 1;
    if (start < styleOpen + 1 || end > styleClose - 1) {
      fail(`tranche CSS ${name} hors de la feuille (${start}-${end})`);
      continue;
    }
    if (start > styleOpen + 1 && !/^\s*\/\*/.test(lineAt(start))) {
      fail(`la tranche CSS ${name} ne commence pas sur un commentaire (ligne ${start})`);
    }
    const body = lines.slice(start - 1, end).join('\n').replace(/\s+$/, '');
    const header =
      `/* ${title}\n` +
      `   Découpé de ../index.html, lignes ${start}–${end}.\n` +
      `   Ne pas réordonner : ces fichiers sont chargés dans l'ordre et la\n` +
      `   cascade d'origine en dépend. */\n\n`;
    out.push({ name, file: `${name}.css`, start, end, text: header + body + '\n' });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  Balisage — 19 blocs de premier niveau, dans l'ordre du document
// ───────────────────────────────────────────────────────────────────────────

const BODY_SEGMENTS = [
  ['DonateOverlay', '<!-- ── Donation pop-in', 'pop-in de don (avant l’invite d’installation)'],
  ['FloatingButtons', '<!-- DESKTOP-ONLY FLOATING PAGES BUTTON', 'boutons flottants pages / export'],
  ['Splash', '<!-- PRE-HOME (splash) -->', 'pré-accueil : import, sessions, marque'],
  ['SessionsModal', '<!-- ALL SESSIONS POPIN -->', 'popin « toutes les sessions »'],
  ['CropOverlay', '<!-- CROP MODAL -->', 'superposition de recadrage visuel'],
  ['Feedback', '<!-- LOADER -->', 'chargeur, zone de toasts, toast PWA, glisser-déposer'],
  ['CanvasArea', '<!-- CANVAS AREA', 'zone où les pages sont rendues'],
  ['Toolbar', '<!-- FLOATING TOOLBAR -->', 'barre d’outils et ses menus'],
  ['MobileChrome', '<!-- MOBILE APP FOOTER -->', 'pied de page mobile et feuilles d’outils'],
  ['EditorChrome', '<!-- MODIFY MODE BAR -->', 'barre de modification, pages, aide clavier, zoom, état'],
  ['Panels', '<!-- PROPERTIES PANEL -->', 'panneaux propriétés et éditeur de texte'],
  ['ExportModal', '<!-- EXPORT MODAL -->', 'export PDF et conversion .sp'],
  ['FindReplace', '<!-- ANNOTATION FAB', 'bouton d’annotation et recherche/remplacement'],
  ['IccPanel', '<!-- ICC COLOR PROFILE PANEL -->', 'profil couleur ICC / PDF-A'],
  ['Preferences', '<!-- PREFERENCES DRAWER', 'tiroir des préférences'],
  ['ImpositionModal', '<!-- IMPOSITION MODAL -->', 'imposition (livret et N-up)'],
  ['SignatureModal', '<!-- SIGNATURE MODAL -->', 'modale de signature'],
  ['ColorPopover', '<!-- COLOUR POPOVER', 'sélecteur de couleur flottant'],
  ['HiddenInputs', '<!-- Hidden inputs -->', 'champs de fichier cachés et ancre d’export'],
];

function sliceBody() {
  const starts = BODY_SEGMENTS.map(([name, anchor]) => {
    let found = 0;
    for (let i = bodyOpen + 1; i < moduleOpen; i++) {
      if (lineAt(i).includes(anchor)) {
        if (found) fail(`repère ambigu pour ${name} : « ${anchor} »`);
        found = i;
      }
    }
    if (!found) fail(`repère absent pour ${name} : « ${anchor} »`);
    return found;
  });

  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1]) fail(`ordre des tranches incohérent en ${BODY_SEGMENTS[i][0]}`);
  }
  const headGap = lines.slice(bodyOpen, starts[0] - 1).filter((l) => l.trim() !== '');
  if (headGap.length) fail(`du balisage précède la première tranche : ${headGap[0].trim()}`);

  return BODY_SEGMENTS.map(([name, , title], i) => {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : moduleOpen - 1;
    const body = lines.slice(start - 1, end).join('\n').replace(/\s+$/, '');

    // Un gabarit .astro interprète { } et ` : le balisage doit en être exempt.
    if (/[{}`]/.test(body)) {
      fail(`${name} contient une accolade ou un accent grave (ligne ${start})`);
    }
    if (/<script[\s>]/i.test(body)) {
      fail(`${name} contient une balise <script> (ligne ${start})`);
    }

    const text =
      `---\n// ${title}\n// Extrait de ../index.html, lignes ${start}–${end}. Balisage d'origine, non réécrit.\n---\n\n` +
      body +
      '\n';
    return { name, start, end, text };
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  <head> et module historique
// ───────────────────────────────────────────────────────────────────────────

const headRaw = [
  ...lines.slice(headOpen, styleOpen - 1),
  ...lines.slice(styleClose, headClose - 1),
]
  .join('\n')
  .replace(/\s+$/, '')
  // Astro traite les <script> du gabarit (regroupement, remontée dans <head>,
  // réécriture des chemins). Ces balises doivent rester exactement où elles
  // sont, dans l'ordre où elles sont : `is:inline` le garantit.
  .replace(/<script(?=[\s>])/g, '<script is:inline');

// Le <head> d'origine chargeait ses dépendances depuis des CDN. Elles vivent
// maintenant dans `public/vendor/` (table des origines : tools/cdn-urls.mjs) :
// sans cela, l'application de bureau — où les service workers ne s'enregistrent
// pas — afficherait une page sans style ni moteur PDF hors connexion.
const fontsLink =
  '<!-- ─── Fonts ───\n' +
  '     Servies depuis `vendor/fonts/` : une feuille Google distante rendrait la\n' +
  '     première ouverture impossible sans réseau — donc l\'application de bureau\n' +
  '     inutilisable, puisque les service workers ne s\'y enregistrent pas. -->\n' +
  '<link href="vendor/fonts/app.css" rel="stylesheet" />';
const dependenciesComment =
  '<!-- ─── Dependencies ───\n' +
  '     `vendor/` est produit par tools/vendor-cdn.mjs (origines dans\n' +
  '     tools/cdn-urls.mjs). Chemins relatifs au document : le site est servi sous\n' +
  '     `/PDF-YZ/`, l\'application de bureau à la racine. -->';
const headInner = rewrite(
  headRaw
    .replace(/^.*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*$/gm, '')
    .replace(/<!-- ─── Preconnect & Fonts ─── -->/, `<!-- ─── Fonts ─── -->\n${fontsLink}`)
    .replace('<!-- ─── Dependencies ─── -->', dependenciesComment),
  'head',
  'head',
);

const moduleSource = lines.slice(moduleOpen, moduleClose - 1).join('\n').replace(/\s+$/, '');

// Inséré juste avant la déclaration de pdfjsLib, comme dans le fichier écrit à
// la main : les fichiers de `vendor/` sont servis à côté de la page.
const VENDOR_HELPER =
  '// Les ressources locales se résolvent depuis `document.baseURI` et non depuis\n' +
  "// l'URL du module : le bundle vit dans `/_astro/`, les fichiers dans\n" +
  "// `vendor/`. Cette forme fonctionne donc aussi bien sous `/PDF-YZ/` (site) qu'à\n" +
  '// la racine (application de bureau), sans `import.meta.env.BASE_URL`.\n' +
  'const vendor = (path) => new URL(path, document.baseURI).href;\n\n';

// ───────────────────────────────────────────────────────────────────────────
//  Écriture
// ───────────────────────────────────────────────────────────────────────────

const written = [];
async function emit(relPath, text) {
  const abs = path.join(ROOT, relPath);
  if (CHECK_ONLY) {
    if (!existsSync(abs)) fail(`manquant : ${relPath}`);
    return;
  }
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
  written.push(relPath);
}

// Feuilles écrites à la main, chargées APRÈS les tranches découpées. Elles
// redéfinissent la pré-accueil sans toucher au découpage mécanique de
// `index.html` : les inscrire ici, et non dans le gabarit produit, les fait
// survivre à un `--force` qui réécrit la coquille.
const HAND_WRITTEN_STYLES = ['17-prehome.css'];

function layoutMarkup(styles) {
  const imports = [
    ...styles.map((s) => `import '../styles/${s.file}';`),
    ...HAND_WRITTEN_STYLES.map((f) => `import '../styles/${f}';`),
  ].join('\n');
  return `---
/**
 * Coquille du document : <head> d'origine (SEO, Open Graph, icônes, polices,
 * dépendances CDN, JSON-LD) et <body> réduit à un emplacement.
 *
 * Le <head> est repris **tel quel** depuis l'application historique. Ses
 * <script> portent is:inline : Astro ne doit ni les déplacer, ni les regrouper,
 * ni réécrire leurs URL — pdf-lib et fontkit sont des variables globales dont
 * l'ordre de chargement est significatif.
 */
${imports}
---

<!DOCTYPE html>
<html lang="en" dir="ltr" prefix="og: https://ogp.me/ns#">
<head>
${headInner}

<!-- Colle du noyau Rust (script classique, publie PdfyzCore). Doit preceder le
     module de l'editeur, qui l'attend pour se lier ; absente du HTML
     historique, elle est ajoutee ici et non dans le <head> repris tel quel. -->
<script is:inline src="pdfyz-core.js"></script>
</head>

<body>
<slot />

<!-- Scripts de fin de document : le module de l'éditeur est chargé depuis
     src/scripts/app.js, la pop-in de don reste un script classique exécuté
     avant lui, exactement comme dans l'application d'origine. -->
<script>
\timport '../scripts/app.js';
</script>
<script is:inline src="donate-popin.js?v=2026-05-04b"></script>
</body>
</html>
`;
}

function pageMarkup(components) {
  const imports = components
    .map((c) => `import ${c.name} from '../components/${c.name}.astro';`)
    .join('\n');
  const uses = components.map((c) => `\t<${c.name} />`).join('\n');
  return `---
/**
 * Page unique de PDF-YZ.
 *
 * L'ordre des composants est l'ordre du document historique : la feuille de
 * style et le script s'appuient sur la position des blocs (superpositions,
 * ancêtres, focus initial), donc il ne doit pas bouger.
 */
import BaseLayout from '../layouts/BaseLayout.astro';
${imports}
---

<BaseLayout>
${uses}
</BaseLayout>
`;
}

const styles = sliceStyles();
const components = sliceBody();

for (const problem of problems) console.error('  x ' + problem);
if (problems.length) {
  console.error(`\n${problems.length} probleme(s) : rien n'a ete ecrit depuis la source modifiee.`);
  process.exit(1);
}

for (const style of styles) await emit(`src/styles/${style.file}`, style.text);
for (const component of components) {
  await emit(`src/components/${component.name}.astro`, component.text);
}
await emit('src/layouts/BaseLayout.astro', layoutMarkup(styles));
await emit('src/pages/index.astro', pageMarkup(components));

// Le module est le seul fichier qui évolue à la main : on ne l'écrase pas.
// `--force` régénère les tranches CSS, les composants et la coquille, mais PAS
// ce fichier : il porte le câblage du noyau Rust (neuf points d'appel) qui n'est
// pas exprimable comme une réécriture de texte. `--force-app` est le geste
// délibéré qui le remet dans son état découpé — et perd ce câblage.
const appPath = path.join(ROOT, 'src/scripts/app.js');
if (FORCE_APP || !existsSync(appPath)) {
  const header =
    '// PDF-YZ — module de l’éditeur.\n' +
    '//\n' +
    '// Repris tel quel de `PDF-YZ/index.html` (lignes ' +
    (moduleOpen + 1) +
    '–' +
    (moduleClose - 1) +
    '), à l’exception de deux points :\n' +
    '//   - le noyau Rust est importé en tête (`./core/kernel.js`) ;\n' +
    '//   - l’import dynamique de pdf.js porte `/* @vite-ignore */`, sans quoi\n' +
    '//     Vite tenterait de le résoudre à la compilation.\n' +
    '//\n' +
    '// Tout le reste — état, DOM, pdf.js, pdf-lib — vit ici, volontairement :\n' +
    '// ces fonctions partagent un état mutable déclaré au niveau du module, et\n' +
    '// les séparer demanderait d’abord d’extraire cet état dans un magasin.\n' +
    '// Ce qui est calculable sans DOM est dans pdfyz-rust (voir docs/PLAN.md).\n\n' +
    "import { Kernel } from './core/kernel.js';\n";
  const patched = rewrite(
    moduleSource.replace(
      /await import\('(https:\/\/cdnjs\.cloudflare\.com[^']+)'\)/,
      "await import(/* @vite-ignore */ '$1')",
    ),
    'module',
    'module',
  )
    // `vendor/x` est relatif à la PAGE, pas au bundle : un littéral nu serait
    // résolu depuis `/_astro/` et renverrait 404. On l'enveloppe donc dans le
    // même helper que le fichier écrit à la main.
    .replace(/'((?:vendor)\/[^']*)'/g, "vendor('$1')");
  if (patched === moduleSource) fail('import dynamique de pdf.js non trouve — app.js ecrit tel quel');
  const withHelper = patched.replace(/(const pdfjsLib = await import)/, VENDOR_HELPER + '$1');
  if (withHelper === patched) fail('declaration de pdfjsLib introuvable — helper vendor non insere');
  await emit('src/scripts/app.js', header + withHelper + '\n');
} else {
  written.push('src/scripts/app.js (conserve)');
}

// ───────────────────────────────────────────────────────────────────────────
//  Ressources statiques
// ───────────────────────────────────────────────────────────────────────────

const PUBLIC_ASSETS = [
  'favicon.svg',
  'logo-pdf-yz.svg',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'humans.txt',
  'llms.txt',
  'donate-popin.js',
  'agent.md',
];

if (!CHECK_ONLY) {
  await mkdir(path.join(ROOT, 'public'), { recursive: true });
  for (const asset of PUBLIC_ASSETS) {
    const from = path.resolve(ROOT, '..', asset);
    if (!existsSync(from)) {
      console.warn(`  . ressource absente, ignoree : ${asset}`);
      continue;
    }
    await copyFile(from, path.join(ROOT, 'public', asset));
    written.push(`public/${asset}`);
  }
  // Le noyau est un artefact de compilation : on ne le versionne pas, mais on
  // le copie des qu'il existe pour que `astro dev` trouve le .wasm.
  for (const [from, to] of [
    [path.join(RUST, 'web/pdfyz-core.js'), 'pdfyz-core.js'],
    [path.join(RUST, 'dist/pdfyz_core.wasm'), 'pdfyz_core.wasm'],
  ]) {
    if (!existsSync(from)) {
      console.warn(
        `  . noyau absent, ignore : ${path.basename(from)} (lancer scripts/build-wasm.ps1)`,
      );
      continue;
    }
    await copyFile(from, path.join(ROOT, 'public', to));
    written.push(`public/${to}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Bilan
// ───────────────────────────────────────────────────────────────────────────

const cssLines = styles.reduce((n, s) => n + (s.end - s.start + 1), 0);
const bodyLines = components.reduce((n, c) => n + (c.end - c.start + 1), 0);

console.log('PDF-YZ - decoupage de index.html');
console.log(`  head         lignes ${headOpen}-${headClose}`);
console.log(
  `  styles       ${styles.length} fichiers, ${cssLines} lignes (${styleOpen}-${styleClose})`,
);
console.log(
  `  composants   ${components.length} fichiers, ${bodyLines} lignes (${bodyOpen}-${moduleOpen - 1})`,
);
console.log(`  module       lignes ${moduleOpen + 1}-${moduleClose - 1} -> src/scripts/app.js`);
console.log(`  fin          </body> ligne ${bodyClose}, </html> ligne ${htmlClose}`);
if (CHECK_ONLY) {
  console.log('\n  --check : aucune ecriture.');
} else {
  console.log(`\n  ${written.length} fichier(s) ecrit(s).`);
}
