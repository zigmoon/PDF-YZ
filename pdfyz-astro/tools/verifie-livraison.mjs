/**
 * Contrôle de livraison — à lancer AVANT de fabriquer l'archive FTP.
 *
 *   node tools/verifie-livraison.mjs [dossier]
 *
 * Le dossier par défaut est `dist/`. Le script ne compile rien : il relit ce qui
 * va partir sur le serveur et cherche les erreurs qui ne se voient pas à
 * l'écran — un fichier oublié, une URL morte dans le sitemap, une icône
 * déclarée dans le manifeste mais absente du disque, un service worker qui
 * précache un fichier inexistant, une ressource distante qui rendrait
 * l'application dépendante du réseau.
 *
 * Chaque test affiche une ligne. Le code de sortie vaut 1 si un seul échoue :
 * c'est ce qui empêche de produire une archive subtilement incomplète.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || 'dist';

if (!existsSync(join(root, 'index.html'))) {
  console.error(`x ${root}/index.html est absent — rien à vérifier.`);
  process.exit(1);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const failures = [];
const passed = [];

function check(label, ok, detail = '') {
  (ok ? passed : failures).push(detail ? `${label} — ${detail}` : label);
}

/** Liste récursive, chemins relatifs au dossier contrôlé. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const files = walk('');
const fileSet = new Set(files);

// ── 1. Fichiers obligatoires ───────────────────────────────────────────────
// Cette liste est le contrat de livraison : si l'un de ces fichiers manque, le
// site est dégradé d'une manière qui ne se voit pas tout de suite.
const REQUIS = [
  'index.html',
  'manifest.webmanifest',
  'service-worker.js',
  'favicon.svg',
  'logo-pdf-yz.svg',
  'og-image.png',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'humans.txt',
  '404.html',
  '.htaccess',
  'pdfyz-core.js',
  'pdfyz_core.wasm',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'vendor/tailwind.js',
  'vendor/pdf-lib.min.js',
  'vendor/fontkit.umd.min.js',
  'vendor/pdfjs/pdf.min.mjs',
  'vendor/pdfjs/pdf.worker.min.mjs',
  'vendor/fonts/app.css',
];
const manquants = REQUIS.filter((f) => !fileSet.has(f));
check('fichiers obligatoires', manquants.length === 0, manquants.join(', '));

// ── 2. Rien d'interne ne doit partir ───────────────────────────────────────
// `agent.md` est la documentation de travail du dépôt. Sa présence sur le
// serveur en ferait une seconde page indexable, décrivant la structure interne.
const INTERDITS = ['agent.md', 'DEPLOIEMENT.txt', 'README.md', 'LICENSE', 'NOTICE.md'];
const fuites = INTERDITS.filter((f) => fileSet.has(f));
check('aucun fichier de travail', fuites.length === 0, fuites.join(', '));

const parasites = files.filter((f) => /(^|\/)(\.DS_Store|Thumbs\.db|node_modules|\.git)/.test(f));
check('aucun parasite', parasites.length === 0, parasites.slice(0, 5).join(', '));

// ── 3. Référencement ──────────────────────────────────────────────────────
const meta = (re) => (html.match(re) || [])[1] || '';
const title = meta(/<title>([\s\S]*?)<\/title>/);
check('title', title.length >= 15 && title.length <= 65, `${title.length} car.`);
const desc = meta(/<meta name="description" content="([^"]*)"/);
check('meta description', desc.length >= 70 && desc.length <= 320, `${desc.length} car.`);
const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
check('<h1> unique', h1s.length === 1, `${h1s.length} trouvé(s)`);
const canonical = meta(/<link rel="canonical" href="([^"]*)"/);
check('canonical', canonical === 'https://app.zigmoon.com/PDF-YZ/', canonical);

const ogImage = meta(/<meta property="og:image" content="([^"]*)"/);
const ogW = meta(/<meta property="og:image:width" content="([^"]*)"/);
const ogH = meta(/<meta property="og:image:height" content="([^"]*)"/);
check('og:image', ogImage.endsWith('/og-image.png'), ogImage);
check('og:image 1,91:1', ogW === '1200' && ogH === '630', `${ogW}x${ogH}`);
check('og:image sur le disque', fileSet.has('og-image.png'));

for (const tag of ['og:title', 'og:description', 'og:url', 'og:type', 'og:locale']) {
  check(tag, html.includes(`property="${tag}"`));
}
for (const tag of ['twitter:card', 'twitter:image', 'twitter:title']) {
  check(tag, html.includes(`name="${tag}"`));
}

// Le JSON-LD est le seul bloc du document que les moteurs analysent
// strictement : une virgule de trop et tout le référencement enrichi tombe.
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let ldTypes = [];
if (!ld) check('JSON-LD', false, 'absent');
else {
  try {
    const parsed = JSON.parse(ld[1]);
    ldTypes = (parsed['@graph'] || [parsed]).map((n) => n['@type']);
    check('JSON-LD analysable', true, ldTypes.join(', '));
    check('JSON-LD FAQPage', ldTypes.includes('FAQPage'));
    check('JSON-LD WebApplication', ldTypes.includes('WebApplication'));
  } catch (e) {
    check('JSON-LD analysable', false, e.message);
  }
}

// ── 4. Sitemap ────────────────────────────────────────────────────────────
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const images = [...sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1]);
const BASE = 'https://app.zigmoon.com/PDF-YZ/';
const urlsMortes = [...locs, ...images]
  .filter((u) => u.startsWith(BASE) && u !== BASE)
  .filter((u) => !fileSet.has(u.slice(BASE.length)));
check('sitemap — URL locales existantes', urlsMortes.length === 0, urlsMortes.join(', '));
check('sitemap — lastmod', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap));

// ── 5. Manifeste ──────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
const badIcons = manifest.icons
  .map((i) => i.src.replace('/PDF-YZ/', ''))
  .filter((p) => !fileSet.has(p));
check('manifeste — icônes présentes', badIcons.length === 0, badIcons.join(', '));
check(
  'manifeste — maskable',
  manifest.icons.some((i) => i.purpose === 'maskable'),
  manifest.icons.map((i) => `${i.sizes}/${i.purpose}`).join(' '),
);
check('manifeste — scope', manifest.scope === '/PDF-YZ/', manifest.scope);

// ── 6. Service worker ─────────────────────────────────────────────────────
// Un fichier précaché manquant ne casse pas l'installation : le worker l'ignore
// en silence. L'utilisateur, lui, découvre le trou hors connexion.
const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');
const precache = [...sw.matchAll(/`\$\{BASE\}([^`]*)`/g)]
  .map((m) => m[1])
  .filter((p) => !p.includes('${') && !p.startsWith('?') && p !== '__shared__');
const swManquants = precache.filter((p) => !fileSet.has(p));
check('service worker — précache', swManquants.length === 0, swManquants.join(', '));
const cacheName = (sw.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || '';
check('service worker — version de cache', /^pdfyz-v\d+/.test(cacheName), cacheName);

// ── 7. Aucune dépendance distante ─────────────────────────────────────────
// Distinction essentielle : un `<a href>` vers un autre site est une
// NAVIGATION, voulue et sans effet sur le fonctionnement. Une `<script src>`,
// un `<link>` ou une `url()` vers l'extérieur est une DÉPENDANCE : si elle
// manque, l'application est dégradée. Seules les secondes comptent ici.
const chargements = [
  ...html.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/<link[^>]*\shref="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/<img[^>]*\ssrc="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/@import\s+(?:url\()?["'](https?:\/\/[^"')]+)/g),
  ...html.matchAll(/url\((https?:\/\/[^)]+)\)/g),
]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('https://app.zigmoon.com'));
check('aucune ressource distante', chargements.length === 0, chargements.slice(0, 4).join(', '));

// Le bundle JS est le seul endroit où une dépendance réseau peut se cacher sans
// qu'on la voie dans le HTML. On y cherche les appels de chargement, pas les
// identifiants : les URL de namespaces XML (purl.org, ns.adobe.com, w3.org) ne
// sont jamais ouvertes, se sont des noms.
const bundle = files.filter((f) => f.startsWith('_astro/') && f.endsWith('.js'));
const reseau = [];
for (const f of bundle) {
  const js = readFileSync(join(root, f), 'utf8');
  for (const m of js.matchAll(/https?:\/\/(?!www\.w3\.org|purl\.org|ns\.adobe\.com|www\.aiim\.org|www\.color\.org)[a-z0-9.\-]+[^\s"'`)]*/gi)) {
    reseau.push(`${f}: ${m[0].slice(0, 70)}`);
  }
}
// Ce qui reste est attendu et documenté : le sélecteur de polices du panneau
// texte propose des familles Google, téléchargées à la demande pour être
// EMBARQUÉES dans le PDF exporté. L'application fonctionne sans, et le message
// d'échec est explicite. Tout le reste serait une régression.
const attendu = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u);
const inattendus = reseau.filter((u) => !attendu(u));
check('bundle — aucun appel réseau inattendu', inattendus.length === 0, inattendus.slice(0, 3).join(' | '));
const gf = reseau.filter((u) => attendu(u));
if (gf.length) console.log(`  note  ${gf.length} référence(s) à Google Fonts : optionnelles, à la demande, échec géré.`);

// ── 8. Types de fichiers réellement servis ────────────────────────────────
const htaccess = readFileSync(join(root, '.htaccess'), 'utf8');
check('.htaccess — wasm', htaccess.includes('application/wasm'));
check('.htaccess — cache revalidé', htaccess.includes('no-cache, must-revalidate'));
// L'ordre compte : `no-cache` doit être écrit après `immutable`, sinon il perd.
check(
  '.htaccess — ordre du cache',
  htaccess.lastIndexOf('must-revalidate') > htaccess.lastIndexOf('immutable'),
);

// `Options -Indexes` doit être à l'intérieur d'un <IfModule> : refusé par un
// hébergement restrictif, il renvoie une 500 sur tout le site. On suit donc la
// profondeur des blocs au lieu de chercher la chaîne — sinon la règle correcte,
// simplement indentée, serait signalée à tort.
let profondeur = 0;
const optionsNues = [];
for (const ligne of htaccess.split(/\r?\n/)) {
  const l = ligne.trim();
  if (l.startsWith('#')) continue;
  if (/^<IfModule/.test(l)) profondeur++;
  else if (/^<\/IfModule>/.test(l)) profondeur = Math.max(0, profondeur - 1);
  else if (/^Options\s/.test(l) && profondeur === 0) optionsNues.push(l);
}
check('.htaccess — Options toujours sous IfModule', optionsNues.length === 0, optionsNues.join(', '));
check('.htaccess — blocs équilibrés', (htaccess.match(/<IfModule/g) || []).length === (htaccess.match(/<\/IfModule>/g) || []).length);

// ── 9. Poids ──────────────────────────────────────────────────────────────
const total = files.reduce((n, f) => n + statSync(join(root, f)).size, 0);
const wasm = fileSet.has('pdfyz_core.wasm') ? statSync(join(root, 'pdfyz_core.wasm')).size : 0;
check('poids total', total < 9 * 1024 * 1024, `${(total / 1024 / 1024).toFixed(2)} Mo`);
check('noyau wasm', wasm > 50_000 && wasm < 400_000, `${(wasm / 1024).toFixed(1)} Ko`);

// ── Bilan ─────────────────────────────────────────────────────────────────
console.log(`\nContrôle de livraison — ${root}`);
for (const p of passed) console.log(`  ok   ${p}`);
for (const f of failures) console.log(`  ECHEC ${f}`);
console.log(`\n${passed.length} ok, ${failures.length} échec(s), ${files.length} fichiers, ${(total / 1024 / 1024).toFixed(2)} Mo`);

if (failures.length) process.exit(1);
