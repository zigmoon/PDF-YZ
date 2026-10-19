// PDF-YZ — module de l’éditeur.
//
// Repris tel quel de `PDF-YZ/index.html` (lignes 3302–11425), à l’exception de deux points :
//   - le noyau Rust est importé en tête (`./core/kernel.js`) ;
//   - l’import dynamique de pdf.js porte `/* @vite-ignore */`, sans quoi
//     Vite tenterait de le résoudre à la compilation.
//
// Tout le reste — état, DOM, pdf.js, pdf-lib — vit ici, volontairement :
// ces fonctions partagent un état mutable déclaré au niveau du module, et
// les séparer demanderait d’abord d’extraire cet état dans un magasin.
// Ce qui est calculable sans DOM est dans pdfyz-rust (voir docs/PLAN.md).

import { Kernel } from './core/kernel.js';
// ════════════════════════════════════════════════════════════
// PDF-YZ — Ergonomic PDF Editor
// ════════════════════════════════════════════════════════════

// Les ressources locales se résolvent depuis `document.baseURI` et non depuis
// l'URL du module : le bundle vit dans `/_astro/`, les fichiers dans
// `vendor/`. Cette forme fonctionne donc aussi bien sous `/PDF-YZ/` (site) qu'à
// la racine (application de bureau), sans `import.meta.env.BASE_URL`.
const vendor = (path) => new URL(path, document.baseURI).href;

const pdfjsLib = await import(/* @vite-ignore */ vendor('vendor/pdfjs/pdf.min.mjs'));
pdfjsLib.GlobalWorkerOptions.workerSrc = vendor('vendor/pdfjs/pdf.worker.min.mjs');
const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString } = PDFLib;

// ─── Noyau Rust (WebAssembly) ───
// Chargé une fois, avant tout calcul : ordre d'imposition, emplacements N-up,
// traits de coupe, conversions de couleur, bornes de tracés, signatures de
// doublons, plages de pages. `Kernel.load()` ne lève jamais : si le .wasm est
// absent, `Kernel.ready` reste faux et chaque appelant retombe sur son
// implémentation JavaScript. Les deux sont tenues en parité par
// `pdfyz-rust/scripts/validate-wasm.mjs`, donc le résultat ne change pas —
// seul le chemin d'exécution diffère.
const KERNEL_BACKEND = await Kernel.load();
console.info(`[PDF-YZ] noyau ${Kernel.version} : ${KERNEL_BACKEND}`);

const $ = id => document.getElementById(id);
const toast = (msg) => {
    const zone = $('toastZone');
    // Never let a missing toast zone break the caller (e.g. abort a finished export).
    if (!zone) { console.warn('[toast]', msg); return; }
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    zone.appendChild(t); setTimeout(() => t.remove(), 3000);
};

// ─── Font Management ───
// Cache: fontKey → { bytes: ArrayBuffer, cssFamily: string, displayName: string }
const fontCache = new Map();

// Standard fonts (pdf-lib built-in) — no bytes needed
const STANDARD_FONTS = ['Helvetica', 'Times-Roman', 'Courier'];

// ─── Comprehensive Font Detector ───
// PDF fonts have names like "BCDEEE+Arial-BoldMT", "TimesNewRomanPSMT", "ABCDEF+Calibri"
// This maps them to the closest Google Font (or standard) for accurate editing.

// Exhaustive mapping: normalized PDF font base name → Google Font key
const FONT_MAP = {
    // ── Sans-Serif ──
    'arial': 'gf:Arimo', 'arialmt': 'gf:Arimo', 'arialmtpro': 'gf:Arimo',
    'helvetica': 'Helvetica', 'helveticaneue': 'gf:Inter', 'helveticaneuelt': 'gf:Inter',
    'calibri': 'gf:Carlito', 'calibrilight': 'gf:Carlito',
    'verdana': 'gf:Tinos', 'tahoma': 'gf:Arimo',
    'segoeui': 'gf:Noto Sans', 'segoeuisemilight': 'gf:Noto Sans',
    'trebuchetms': 'gf:Fira Sans', 'franklingothic': 'gf:Libre Franklin',
    'centurygothic': 'gf:Raleway', 'avantgarde': 'gf:Raleway',
    'futura': 'gf:Nunito Sans', 'futurapt': 'gf:Nunito Sans', 'futuralt': 'gf:Nunito Sans',
    'gill': 'gf:Lato', 'gillsans': 'gf:Lato', 'gillsansmt': 'gf:Lato',
    'optima': 'gf:Noto Sans',
    'lucida': 'gf:Lucida Sans', 'lucidasans': 'gf:PT Sans', 'lucidagrande': 'gf:PT Sans',
    'myriad': 'gf:Source Sans 3', 'myriadpro': 'gf:Source Sans 3',
    'frutiger': 'gf:Istok Web', 'frutigerltnewsroman': 'gf:Istok Web',
    'univers': 'gf:Inter', 'universcondensed': 'gf:Inter',
    'gotham': 'gf:Montserrat', 'gothamrounded': 'gf:Nunito',
    'proximanova': 'gf:Montserrat', 'proxima': 'gf:Montserrat',
    'avenir': 'gf:Nunito', 'avenirlt': 'gf:Nunito', 'avenirnext': 'gf:Nunito',
    'brandon': 'gf:Raleway', 'brandongrotesque': 'gf:Raleway',
    'din': 'gf:DM Sans', 'dinnext': 'gf:DM Sans', 'dinpro': 'gf:DM Sans',
    'akkurat': 'gf:Inter', 'aktiv': 'gf:Inter', 'aktivgrotesk': 'gf:Inter',
    'circular': 'gf:Poppins', 'campton': 'gf:Poppins',
    'graphik': 'gf:Inter', 'neuemontreal': 'gf:Inter',
    'acumin': 'gf:Source Sans 3', 'acuminpro': 'gf:Source Sans 3',
    'candara': 'gf:Catamaran', 'corbel': 'gf:Catamaran',
    'franklin': 'gf:Libre Franklin', 'itcfranklin': 'gf:Libre Franklin',
    'opensans': 'gf:Open Sans', 'sourcesanspro': 'gf:Source Sans 3', 'sourcesans3': 'gf:Source Sans 3',
    'roboto': 'gf:Roboto', 'noto': 'gf:Noto Sans', 'notosans': 'gf:Noto Sans',
    'lato': 'gf:Lato', 'poppins': 'gf:Poppins', 'inter': 'gf:Inter',
    'montserrat': 'gf:Montserrat', 'overpass': 'gf:Overpass',
    'barlow': 'gf:Barlow', 'karla': 'gf:Karla', 'manrope': 'gf:Manrope',
    'josefinsans': 'gf:Josefin Sans', 'cabin': 'gf:Cabin', 'asap': 'gf:Asap',
    'firasans': 'gf:Fira Sans', 'worksans': 'gf:Work Sans', 'mulish': 'gf:Mulish',
    'rubik': 'gf:Rubik', 'exo': 'gf:Exo 2', 'dmsans': 'gf:DM Sans',
    'quicksand': 'gf:Quicksand', 'comfortaa': 'gf:Comfortaa',
    'ubuntu': 'gf:Ubuntu', 'oxygen': 'gf:Oxygen',
    'hind': 'gf:Hind', 'signika': 'gf:Signika',
    'titilliumweb': 'gf:Titillium Web', 'mavenpro': 'gf:Maven Pro',
    'ibmplexsans': 'gf:IBM Plex Sans', 'ibmplexserif': 'gf:IBM Plex Serif',
    'ibmplexsanscondensed': 'gf:IBM Plex Sans Condensed',
    'bebasneue': 'gf:Bebas Neue', 'oswald': 'gf:Oswald',
    'spacegrotesk': 'gf:Space Grotesk', 'archivo': 'gf:Archivo', 'jost': 'gf:Jost',
    'outfit': 'gf:Outfit', 'figtree': 'gf:Figtree', 'sora': 'gf:Sora',
    'robotocondensed': 'gf:Roboto Condensed', 'robotoflex': 'gf:Roboto Flex',
    'notosansjp': 'gf:Noto Sans JP', 'notoserifjp': 'gf:Noto Serif JP',
    'ptsans': 'gf:PT Sans', 'sourceserifpro': 'gf:Source Serif 4',
    'cormorantgaramond': 'gf:Cormorant Garamond', 'librebodoni': 'gf:Libre Bodoni',
    'carlito': 'gf:Carlito', 'caladea': 'gf:Caladea', 'arimo': 'gf:Arimo', 'tinos': 'gf:Tinos',

    // ── Serif ──
    'times': 'Times-Roman', 'timesnewroman': 'gf:Tinos', 'timesnewromanps': 'gf:Tinos', 'timesnewromanpsmt': 'gf:Tinos',
    'georgia': 'gf:Tinos', 'cambria': 'gf:Caladea', 'cambriamath': 'gf:Caladea',
    'garamond': 'gf:EB Garamond', 'adobegaramond': 'gf:EB Garamond', 'garamondpremr': 'gf:EB Garamond', 'itcgaramond': 'gf:EB Garamond',
    'palatino': 'gf:Lora', 'palatinolinotype': 'gf:Lora', 'bookantiqua': 'gf:Lora',
    'baskerville': 'gf:Libre Baskerville', 'baskervilleold': 'gf:Libre Baskerville',
    'bodoni': 'gf:Libre Bodoni', 'bodonimoda': 'gf:Bodoni Moda',
    'caslon': 'gf:Libre Caslon Text', 'bigcaslon': 'gf:Libre Caslon Display',
    'didot': 'gf:GFS Didot',
    'century': 'gf:Lora', 'centuryschoolbook': 'gf:Lora', 'newcenturyschoolbook': 'gf:Lora',
    'minion': 'gf:Crimson Text', 'minionpro': 'gf:Crimson Text',
    'sabon': 'gf:Crimson Pro', 'bembo': 'gf:Cormorant Garamond',
    'utopia': 'gf:Merriweather', 'charter': 'gf:Merriweather',
    'cochin': 'gf:Cormorant', 'goudy': 'gf:Sorts Mill Goudy',
    'bookman': 'gf:Bookman', 'bookmanold': 'gf:Bookman',
    'bitstream': 'gf:Noto Serif',
    'notoserif': 'gf:Noto Serif', 'playfairdisplay': 'gf:Playfair Display',
    'merriweather': 'gf:Merriweather', 'lora': 'gf:Lora',
    'ptserif': 'gf:PT Serif', 'robotoslab': 'gf:Roboto Slab',
    'alegreya': 'gf:Alegreya', 'vollkorn': 'gf:Vollkorn',
    'spectral': 'gf:Spectral', 'prata': 'gf:Prata',

    // ── Monospace ──
    'courier': 'Courier', 'couriernew': 'gf:Courier Prime', 'couriernewpsmt': 'gf:Courier Prime',
    'consolas': 'gf:Roboto Mono', 'menlo': 'gf:Roboto Mono',
    'monaco': 'gf:Fira Code', 'sourcecodepro': 'gf:Source Code Pro',
    'lucidaconsole': 'gf:Roboto Mono', 'dejavusansmono': 'gf:Roboto Mono',
    'andalemono': 'gf:Roboto Mono', 'robotomono': 'gf:Roboto Mono',
    'firacode': 'gf:Fira Code', 'firamono': 'gf:Fira Mono',
    'jetbrainsmono': 'gf:JetBrains Mono', 'inconsolata': 'gf:Inconsolata',
    'ibmplexmono': 'gf:IBM Plex Mono', 'ubuntumono': 'gf:Ubuntu Mono',
    'spacemono': 'gf:Space Mono', 'anonymouspro': 'gf:Anonymous Pro',

    // ── Display / Script ──
    'impact': 'gf:Oswald', 'copperplate': 'gf:Cinzel',
    'comicsans': 'gf:Comic Neue', 'comicsansms': 'gf:Comic Neue',
    'papyrus': 'gf:Amatic SC', 'brushscript': 'gf:Dancing Script',
    'lucidahandwriting': 'gf:Dancing Script', 'segoeprint': 'gf:Kalam',
    'zapfino': 'gf:Great Vibes', 'snellroundhand': 'gf:Great Vibes',
};

// Extract the real system font name from a PDF font identifier
// "BCDEEE+Arial-BoldMT" → "Arial"
// "TimesNewRomanPSMT" → "Times New Roman"
// "Calibri-Bold" → "Calibri"
function extractSystemFont(rawFontName) {
    if (!rawFontName) return null;
    // Strip subset prefix: "BCDEEE+Arial-BoldMT" → "Arial-BoldMT"
    let name = rawFontName.replace(/^[A-Z]{6}\+/, '');
    // Remove weight/style/encoding suffixes
    name = name
        .replace(/[-,](Extra)?Light(Italic)?$/i, '')
        .replace(/[-,](Extra|Semi|Demi|Ultra)?Bold(Italic|Oblique)?$/i, '')
        .replace(/[-,](Medium|Regular|Book|Roman|Normal)(Italic|Oblique)?$/i, '')
        .replace(/[-,]?Italic$/i, '')
        .replace(/[-,]?Oblique$/i, '')
        .replace(/[-,]?Condensed$/i, '')
        .replace(/[-,]?Narrow$/i, '')
        .replace(/[-,]?(Black|Heavy|Thin|Hairline)$/i, '')
        .replace(/PSMT$/i, '')
        .replace(/PS$/i, '')
        .replace(/MT$/i, '')
        .replace(/LT$/i, '')
        .replace(/Std$/i, '')
        .replace(/Pro$/i, '');
    // Insert spaces before uppercase letters: "TimesNewRoman" → "Times New Roman"
    name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Clean remaining dashes
    name = name.replace(/^[-_]+|[-_]+$/g, '').trim();
    if (!name || name.length < 2) return null;
    return name;
}

// Clean a PDF font name to a normalized lookup key
function normalizeFontName(raw) {
    if (!raw) return '';
    // Strip subset prefix: "BCDEEE+Arial-BoldMT" → "Arial-BoldMT"
    let name = raw.replace(/^[A-Z]{6}\+/, '');
    // Remove weight/style suffixes for base lookup
    let base = name
        .replace(/[-,]?(Extra)?Light(Italic)?$/i, '')
        .replace(/[-,]?(Extra|Semi|Demi|Ultra)?Bold(Italic|Oblique)?$/i, '')
        .replace(/[-,]?(Medium|Regular|Book|Roman|Normal)(Italic|Oblique)?$/i, '')
        .replace(/[-,]?Italic$/i, '')
        .replace(/[-,]?Oblique$/i, '')
        .replace(/[-,]?Condensed$/i, '')
        .replace(/[-,]?Narrow$/i, '')
        .replace(/[-,]?(Black|Heavy|Thin|Hairline)$/i, '')
        .replace(/MT$/, '')
        .replace(/PS$/, '')
        .replace(/PSMT$/i, '')
        .replace(/LT$/, '')
        .replace(/Std$/i, '')
        .replace(/Pro$/i, '')
        .replace(/\d+$/, '')  // Strip trailing numbers (e.g. "Helvetica1", "Arial3")
        .replace(/[-_\s]/g, '')
        .toLowerCase();
    return base;
}

// Extract weight hints from original font name
function detectWeight(fontName) {
    const n = (fontName || '').toLowerCase();
    if (/(^|[^a-z])(extra|ultra)[\s-]?bold|(^|[^a-z])(black|heavy)/.test(n)) return 900;
    if (/(^|[^a-z])(semi|demi)[\s-]?bold/.test(n)) return 600;
    if (/(^|[^a-z])bold/.test(n)) return 700;
    if (/(^|[^a-z])medium/.test(n)) return 500;
    if (/(^|[^a-z])(light|thin|hairline)/.test(n)) return 300;
    return 400;
}

function detectItalic(fontName) {
    return /italic|oblique/i.test(fontName || '');
}

// Main font detection: returns { font, originalFont, systemFont, weight, italic }
function detectFont(fontName, fontFamily) {
    const original = fontName || fontFamily || 'Unknown';
    const weight = detectWeight(original);
    const italic = detectItalic(original);
    const systemFont = extractSystemFont(fontName) || extractSystemFont(fontFamily);

    // Try direct normalized lookup
    const base = normalizeFontName(fontName);
    if (base && FONT_MAP[base]) {
        return { font: FONT_MAP[base], originalFont: original, systemFont, weight, italic };
    }

    // Try fontFamily too
    const ffBase = normalizeFontName(fontFamily);
    if (ffBase && FONT_MAP[ffBase]) {
        return { font: FONT_MAP[ffBase], originalFont: original, systemFont, weight, italic };
    }

    // Try Combined for partial matches (strip more aggressively)
    const combined = (base + ' ' + ffBase).trim();

    // Partial matching: check if any key is contained in the normalized name
    for (const [key, value] of Object.entries(FONT_MAP)) {
        if (key.length >= 4 && combined.includes(key)) {
            return { font: value, originalFont: original, systemFont, weight, italic };
        }
    }

    // Fallback classification by family style
    const n = ((fontName || '') + ' ' + (fontFamily || '')).toLowerCase();
    if (/mono|console|typewriter|fixed/i.test(n)) return { font: 'Courier', originalFont: original, systemFont, weight, italic };
    if (/serif/i.test(n) && !/sans/i.test(n)) return { font: 'Times-Roman', originalFont: original, systemFont, weight, italic };
    if (/sans|gothic|grotesk|grotesque/i.test(n)) return { font: 'Helvetica', originalFont: original, systemFont, weight, italic };

    // Default fallback
    return { font: 'Helvetica', originalFont: original, systemFont, weight, italic };
}

// Load a Google Font by name → store bytes in cache (all weight variants)
async function loadGoogleFont(name) {
    const key = 'gf:' + name;
    if (fontCache.has(key)) return fontCache.get(key);

    $('teFontLoading').classList.add('visible');
    try {
        const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,900;1,400;1,700&display=swap`;
        const cssResp = await fetch(cssUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 Chrome/120' }
        });
        const css = await cssResp.text();

        // Parse all @font-face blocks to register each weight/style variant
        const cssFamily = 'gf-' + name.replace(/\s+/g, '-');
        const blocks = css.split(/(?=@font-face)/);
        let mainBytes = null;
        const weightBytes = {};
        for (const block of blocks) {
            const urlMatch = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.(?:ttf|woff2))\)/);
            if (!urlMatch) continue;
            const wMatch = block.match(/font-weight:\s*(\d+)/);
            const sMatch = block.match(/font-style:\s*(\w+)/);
            const w = wMatch ? wMatch[1] : '400';
            const s = sMatch ? sMatch[1] : 'normal';
            try {
                const resp = await fetch(urlMatch[1]);
                const bytes = await resp.arrayBuffer();
                const face = new FontFace(cssFamily, bytes, { weight: w, style: s });
                await face.load();
                document.fonts.add(face);
                if (w === '400' && s === 'normal' && !mainBytes) mainBytes = bytes;
                weightBytes[w + (s === 'italic' ? 'i' : '')] = bytes;
            } catch {}
        }
        if (!mainBytes) mainBytes = Object.values(weightBytes)[0];
        if (!mainBytes) throw new Error('No font file loaded');

        const entry = { bytes: mainBytes, weightBytes, cssFamily, displayName: name };
        fontCache.set(key, entry);
        return entry;
    } catch (e) {
        console.warn('Google Font load failed:', name, e);
        toast('Font unavailable: ' + name);
        return null;
    } finally {
        $('teFontLoading').classList.remove('visible');
    }
}

// pdf-lib cannot embed a custom font unless a fontkit instance is registered ON
// THAT DOCUMENT. Forgetting this makes embedFont(bytes) throw, and the exporter
// fell back to Helvetica — silently destroying the document's typography.
function registerFontkitOnDoc(doc) {
    try {
        if (!doc || typeof doc.registerFontkit !== 'function') return false;
        if (window.fontkit) { doc.registerFontkit(window.fontkit); return true; }
        console.warn('fontkit missing — custom fonts cannot be embedded');
        return false;
    } catch (e) { console.warn('registerFontkit failed:', e); return false; }
}

// Load a custom font file → store bytes in cache
async function loadCustomFont(file) {
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const key = 'custom:' + name;
    if (fontCache.has(key)) return { key, entry: fontCache.get(key) };

    const bytes = await file.arrayBuffer();
    const cssFamily = 'custom-' + name.replace(/\s+/g, '-');
    const face = new FontFace(cssFamily, bytes);
    await face.load();
    document.fonts.add(face);

    const entry = { bytes, cssFamily, displayName: name };
    fontCache.set(key, entry);

    // Add to the custom optgroup
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = name;
    $('teFontCustom').appendChild(opt);

    return { key, entry };
}

// Get CSS font-family for a font key — includes system font as primary fallback
function getCSSFamily(fontKey, systemFont) {
    const parts = [];
    // System font first (exact match if installed)
    if (systemFont) parts.push('"' + systemFont + '"');

    if (!fontKey) { parts.push('Helvetica', 'sans-serif'); return parts.join(', '); }
    if (STANDARD_FONTS.includes(fontKey)) {
        const generic = fontKey === 'Times-Roman' ? 'serif' : fontKey === 'Courier' ? 'monospace' : 'sans-serif';
        parts.push(fontKey, generic); return parts.join(', ');
    }
    const cached = fontCache.get(fontKey);
    if (cached) { parts.push('"' + cached.cssFamily + '"', 'sans-serif'); return parts.join(', '); }
    // Google Font not loaded yet — reference the DETERMINISTIC family name that
    // loadGoogleFont() will register (gf-<slug>) so the text switches to the real
    // webfont as soon as it finishes loading, without rewriting inline styles.
    if (fontKey.startsWith('gf:')) {
        const name = fontKey.slice(3);
        const slug = 'gf-' + name.replace(/\s+/g, '-');
        parts.push('"' + slug + '"', '"' + name + '"', 'sans-serif');
        return parts.join(', ');
    }
    parts.push('Helvetica', 'sans-serif');
    return parts.join(', ');
}

// ─── Font matching: substitutes offered when the closest match is unavailable ───
// Every entry here already exists in the panel's <select> (no download needed).
const FONT_SUBSTITUTES = {
    serif:   ['Times-Roman', 'gf:Playfair Display', 'gf:Lora'],
    sans:    ['Helvetica', 'gf:Inter', 'gf:Open Sans', 'gf:Roboto'],
    mono:    ['Courier', 'gf:Roboto Mono'],
    display: ['gf:Oswald', 'gf:Montserrat', 'gf:Poppins'],
};
function _fontClassOf(name) {
    const n = (name || '').toLowerCase();
    if (/mono|courier|consol|menlo|monaco|typewriter|\bcode\b|inconsolata/.test(n)) return 'mono';
    if (/script|hand|brush|zapfino|snell|great ?vibes|dancing|comic/.test(n)) return 'display';
    if (/impact|bebas|oswald|poster|antique/.test(n)) return 'display';
    if (/arial|helvetica|grotesk|grotesque|gothic|gotham|futura|avenir|\bdin\b|roboto|inter|poppins|montserrat|lato|calibri|verdana|tahoma|open ?sans|franklin|myriad|frutiger|univers|gill|optima|proxima|brandon|akkurat|graphik|acumin|candara|corbel|karla|manrope|ubuntu|rubik|worksans|mulish|barlow|cabin|asap|hind|oxygen|quicksand/.test(n)) return 'sans';
    if (/times|georgia|garamond|bodoni|didot|caslon|minion|bookman|book ?antiqua|palatino|baskerville|century|merriweather|lora|crimson|cochin|goudy|serif|roman|playfair|prata|spectral|vollkorn|alegreya/.test(n)) return 'serif';
    return 'sans';
}
// Update the inline status chip shown next to "Original font:"
function _teFontMatch(msg, kind) {
    const el = $('teFontMatch');
    if (!el) return;
    el.textContent = msg ? ' ' + msg : '';
    el.className = 'te-font-match' + (kind ? ' ' + kind : '');
}

// Ensure a font option exists in the font <select>
function ensureFontInSelect(key, displayName) {
    const sel = $('teFont');
    for (const opt of sel.options) { if (opt.value === key) return; }
    // Add to the Google Fonts optgroup
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = displayName;
    $('teFontGoogle').appendChild(opt);
}

// ─── State ───
const S = {
    pdfDoc: null, pdfJs: null, bytes: null, fileName: 'document.pdf',
    zoom: 1, tool: 'select', pages: [], // {canvas, editLayer, drawLayer, elements:[], paths:[]}
    selected: null, selectedDOM: null,
    undoStack: [], redoStack: [],
    dirty: false, autoTimer: null,
    drawColor: '#ef4444', drawWidth: 3, highlightColor: '#facc15',
    sigColor: '#111827',
};

// ─── Preferences (declared EARLY so no function can hit a TDZ before init) ───
const prefs = {
    dpi: 150, imgQuality: 0.8,
    standard: 'default', compress: 'light', pageSize: 'keep',
    title: '', author: '',
    // Flatten really rasterises the export now (it used to be inert). Default OFF:
    // a normal export must stay vector/editable-text.
    flatten: false, embedFonts: true, autoSave: true,
    // Default OFF: keep the PDF in pure vector/text/object mode on open.
    // When ON, genuine raster images are detected and become replaceable overlays.
    detectImages: false,
    watermark: '', wmOpacity: 0.1,
    cropMarks: false, cropLength: 8, cropOffset: 6,
};
// Load saved prefs
try { Object.assign(prefs, JSON.parse(localStorage.getItem('pdfz-prefs') || '{}')); } catch {}
// v26 migration: “Flatten” was a no-op that defaulted to ON, so anyone who saved
// that inert `true` would suddenly get rasterised exports. Reset it once.
if (!localStorage.getItem('pdfz-flatten-migrated')) {
    prefs.flatten = false;
    // Persist FIRST: if writing prefs failed we must let the migration run again next
    // time, otherwise the stale `flatten: true` would come back and rasterise exports.
    try { savePrefs(); } catch (_) {}
    try { localStorage.setItem('pdfz-flatten-migrated', '1'); } catch (_) {}
}
function savePrefs() { localStorage.setItem('pdfz-prefs', JSON.stringify(prefs)); }

// ─── Colour popover (tool colour + selected object colour) ───
// One small palette, reused everywhere so the colour can be changed without
// hunting for a hidden input: it opens when a drawing tool is picked and when
// an object that owns a colour is selected.
const COLOR_PRESETS = [
    '#111827', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#0ea5e9',
    '#6366f1', '#a855f7', '#ec4899', '#78716c', '#000000',
];
let _colorPickHandler = null;
let _colorOutsideHandler = null;
// Widget-like position: remembered across openings (and reloads) so the palette
// stays where the user parked it instead of jumping back to the centre.
let _colorPopPos = null;
try {
    const saved = JSON.parse(localStorage.getItem('pdfz-colorpop-pos') || 'null');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) _colorPopPos = saved;
} catch (_) {}

function _saveColorPopPos(left, top) {
    _colorPopPos = { left, top };
    try { localStorage.setItem('pdfz-colorpop-pos', JSON.stringify(_colorPopPos)); } catch (_) {}
}

function _clampColorPop(pop, left, top) {
    const w = pop.offsetWidth || 240, h = pop.offsetHeight || 140;
    const maxL = Math.max(6, window.innerWidth - w - 6);
    const maxT = Math.max(6, window.innerHeight - h - 6);
    return {
        left: Math.max(6, Math.min(maxL, left)),
        top: Math.max(6, Math.min(maxT, top)),
    };
}

function _applyColorPopPos() {
    const pop = $('colorPop');
    if (!pop || !_colorPopPos) return;
    const { left, top } = _clampColorPop(pop, _colorPopPos.left, _colorPopPos.top);
    pop.classList.add('positioned');
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
}

function openColorPop({ title, value, onPick }) {
    const pop = $('colorPop');
    if (!pop) return;
    _colorPickHandler = typeof onPick === 'function' ? onPick : null;
    $('colorPopTitle').textContent = title || 'Couleur';
    const current = String(value || '#000000').toLowerCase();
    const input = $('colorPopInput');
    if (input) input.value = /^#[0-9a-f]{6}$/.test(current) ? current : '#000000';
    const wrap = $('colorPopSwatches');
    wrap.innerHTML = '';
    COLOR_PRESETS.forEach(hex => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color-swatch' + (hex.toLowerCase() === current ? ' active' : '');
        b.style.background = hex;
        b.dataset.color = hex;
        b.title = hex;
        b.setAttribute('aria-label', hex);
        b.addEventListener('click', () => pickColor(hex));
        wrap.appendChild(b);
    });
    // Restore the last parked position (measured after it becomes visible).
    if (_colorPopPos) {
        pop.classList.add('positioned');
        pop.style.left = _colorPopPos.left + 'px';
        pop.style.top = _colorPopPos.top + 'px';
    }
    pop.classList.add('visible');
    if (_colorPopPos) requestAnimationFrame(() => _applyColorPopPos());
    if (!_colorOutsideHandler) {
        _colorOutsideHandler = e => {
            if ($('colorPop').contains(e.target)) return;
            if (e.target.closest?.('.tool-btn[data-tool], .color-pop, #sigModal')) return;
            closeColorPop();
        };
        // Deferred: the mousedown that selected the object (or clicked the tool)
        // is still propagating — adding the listener later avoids self-closing.
        setTimeout(() => document.addEventListener('mousedown', _colorOutsideHandler, true), 0);
    }
}

// Drag the palette by its header (it is a floating widget, not a fixed popup).
(function _initColorPopDrag() {
    const pop = $('colorPop');
    const head = $('colorPopHead');
    if (!pop || !head) return;
    let drag = null;
    head.addEventListener('pointerdown', e => {
        if (e.target.closest('.color-pop-close')) return;
        e.preventDefault();
        e.stopPropagation();
        const r = pop.getBoundingClientRect();
        pop.classList.add('positioned', 'dragging');
        pop.style.left = r.left + 'px';
        pop.style.top = r.top + 'px';
        drag = { startX: e.clientX, startY: e.clientY, left: r.left, top: r.top };
        try { head.setPointerCapture(e.pointerId); } catch (_) {}
    });
    head.addEventListener('pointermove', e => {
        if (!drag) return;
        e.preventDefault();
        const pos = _clampColorPop(pop, drag.left + e.clientX - drag.startX, drag.top + e.clientY - drag.startY);
        pop.style.left = pos.left + 'px';
        pop.style.top = pos.top + 'px';
    });
    const end = e => {
        if (!drag) return;
        drag = null;
        pop.classList.remove('dragging');
        try { if (head.hasPointerCapture?.(e.pointerId)) head.releasePointerCapture(e.pointerId); } catch (_) {}
        _saveColorPopPos(parseFloat(pop.style.left) || 0, parseFloat(pop.style.top) || 0);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => { if (pop.classList.contains('visible')) _applyColorPopPos(); });
})();

function pickColor(hex) {
    const pop = $('colorPop');
    pop?.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color.toLowerCase() === String(hex).toLowerCase());
    });
    const input = $('colorPopInput');
    if (input) input.value = hex;
    if (_colorPickHandler) {
        try { _colorPickHandler(hex); } catch (err) { console.warn('Colour apply failed:', err); }
    }
}

function closeColorPop() {
    $('colorPop')?.classList.remove('visible');
    _colorPickHandler = null;
    if (_colorOutsideHandler) {
        document.removeEventListener('mousedown', _colorOutsideHandler, true);
        _colorOutsideHandler = null;
    }
}

function openColorPopForTool(tool) {
    if (tool === 'draw') {
        openColorPop({ title: 'Couleur du dessin', value: S.drawColor, onPick: hex => { S.drawColor = hex; } });
    } else if (tool === 'highlight') {
        openColorPop({ title: 'Couleur du surlignage', value: S.highlightColor, onPick: hex => { S.highlightColor = hex; } });
    } else if (tool === 'signature') {
        openColorPop({ title: 'Couleur de la signature', value: S.sigColor, onPick: hex => setSigColor(hex) });
    }
}

function objectColor(el) {
    if (!el) return '#000000';
    if (el.type === 'note') return el.noteBg || '#fff9c4';
    if (el.type === 'stroke') return el.path?.color || el.color || '#000000';
    // For a vector object the colour that will actually change is the fill when the
    // shape is filled, the outline otherwise.
    if (el.type === 'pdf-graphic') {
        return el.filled ? (el.fillColor || el.color || '#000000')
            : (el.strokeColor || el.color || '#000000');
    }
    return el.color || '#000000';
}

function openColorPopForSelection(el) {
    if (!el) return;
    const supports = el.type === 'note' || el.type === 'pdf-graphic' || el.type === 'stroke'
        || el.type === 'signature' || (el.type === 'text' && !el.extracted);
    if (!supports) return;
    openColorPop({
        title: el.type === 'signature' ? 'Couleur de la signature' : 'Couleur de l’objet',
        value: objectColor(el),
        onPick: hex => colorizeElement(el, hex),
    });
}

function _domForElement(el) {
    if (!el) return null;
    if (S.selected === el && S.selectedDOM) return S.selectedDOM;
    const layer = S.pages[el.page]?.editLayer;
    if (!layer) return null;
    return layer.querySelector(`[data-id="${el.id}"]`)
        || layer.querySelector(`[data-stroke-id="${el.id}"]`);
}

function shadeHex(hex, amount) {
    // Le noyau renvoie undefined sur une couleur illisible : le repli ci-dessous
    // rend alors la valeur d'origine, comme avant.
    const shaded = Kernel.shadeHex(hex, amount);
    if (shaded) return shaded;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const t = amount < 0 ? v * (1 + amount) : v + (255 - v) * amount;
        return Math.max(0, Math.min(255, Math.round(t)));
    });
    return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}

// Tint a bitmap only when it really has transparency (a drawn/PNG signature).
// A JPEG or a scan with a white background would become a plain coloured
// rectangle, so it is left untouched with an explicit message instead.
async function tintSignature(el, hex) {
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = el.src;
        });
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth || img.width;
        cv.height = img.naturalHeight || img.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let hasAlpha = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 250) { hasAlpha = true; break; }
        }
        if (!hasAlpha) { toast('Signature sans transparence'); return; }
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = hex;
        ctx.fillRect(0, 0, cv.width, cv.height);
        el.src = cv.toDataURL('image/png');
        el._recolored = true;
        const imgEl = _domForElement(el)?.querySelector('img');
        if (imgEl) imgEl.src = el.src;
        markDirty();
    } catch (err) {
        console.warn('Signature recolour failed:', err);
    }
}

function colorizeElement(el, hex) {
    if (!el) return;
    if (el.type === 'text') {
        el.color = hex;
        syncTextToDOM(el);
        syncNativePreview(el);
    } else if (el.type === 'note') {
        el.noteBg = hex;
        el.noteHeader = shadeHex(hex, -0.14);
        const dom = _domForElement(el);
        if (dom) {
            dom.style.background = hex;
            const header = dom.querySelector('.el-note-header');
            if (header) header.style.background = el.noteHeader;
        }
    } else if (el.type === 'pdf-graphic') {
        // Recolour only the channel the object really paints: a filled shape with an
        // outline keeps its outline, and a two-tone logo never goes monochrome just
        // because one colour was picked.
        if (el.filled) el.fillColor = hex;
        if (el.stroked && !el.filled) el.strokeColor = hex;
        if (!el.filled && !el.stroked) { el.fillColor = hex; el.strokeColor = hex; }
        el.color = hex;
        const dom = _domForElement(el);
        applyGraphicPreviewStyle(dom, el);
        dom?.classList.toggle('modified', el.color !== el.originalColor || el._moved);
        syncNativePreview(el);
    } else if (el.type === 'stroke') {
        el.path.color = hex;
        el.color = hex;
        redrawPaths(S.pages[el.page]);
    } else if (el.type === 'signature') {
        el.color = hex;
        void tintSignature(el, hex);
    }
    if ($('propColor') && S.selected === el) $('propColor').value = hex;
    markDirty();
}

function setSigColor(hex) {
    S.sigColor = hex;
    const input = $('sigColor');
    if (input) input.value = hex;
    $('sigSwatches')?.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color.toLowerCase() === String(hex).toLowerCase());
    });
}

$('colorPopClose').onclick = () => closeColorPop();
$('colorPopInput').addEventListener('change', e => pickColor(e.target.value));

// Render scale factor used everywhere. Capped so zooming way in doesn't blow up
// memory on large documents (was `zoom * 1.5` unbounded → 4.5x at 300% zoom).
// On large documents we also cap the base scale to keep first paint fast.
function RENDER_SCALE() {
    const base = Math.min(S.zoom * 1.5, 2.5);
    if (S.pdfJs && S.pdfJs.numPages > 40) {
        // Big docs: render at a lower base scale to keep memory/time bounded.
        return Math.max(0.8, Math.min(base, 1.1));
    }
    return base;
}
// Convenience used by text extraction / element math
const _renderS = () => RENDER_SCALE();

// ─── Show/Hide ───
// Single source of truth for the pre-home loading state: while a document is
// being loaded the import zone is swapped for the progress card and the
// previous-sessions pane is frozen (it used to stay clickable mid-load).
function _setSplashBusy(on, msg) {
    const sp = $('splash');
    if (sp) sp.classList.toggle('splash-busy', !!on);
    const sl = $('splashLoading');
    if (sl) sl.classList.toggle('visible', !!on);
    if (on && msg) {
        const m = $('splashLoadMsg');
        if (m) m.textContent = msg;
    }
}
const showLoader = m => {
    $('loaderMsg').textContent = m;
    // reset to indeterminate visual when shown without progress driver
    const lp = $('loaderProgress'); const lb = $('loaderProgressBar'); const lpct = $('loaderPct');
    if (lp) { lp.classList.add('visible', 'indeterminate'); lp.setAttribute('aria-valuenow', '0'); }
    if (lb) lb.style.width = '';
    if (lpct) { lpct.classList.remove('visible'); lpct.textContent = ''; }
    $('loader').classList.add('visible');
    // Also show on splash if still visible (indeterminate while we don't have phase info)
    if (!$('splash').classList.contains('hidden')) {
        _setSplashBusy(true, m);
        $('splashProgress').classList.add('indeterminate');
        $('splashProgressBar').style.width = '';
        $('splashLoadPct').textContent = '';
    }
};
const hideLoader = () => {
    $('loader').classList.remove('visible');
    // reset loader internal bar so the next showLoader starts fresh
    const lp = $('loaderProgress'); const lb = $('loaderProgressBar'); const lpct = $('loaderPct');
    if (lp) { lp.classList.add('indeterminate'); lp.classList.remove('visible'); }
    if (lb) lb.style.width = '0%';
    if (lpct) { lpct.classList.remove('visible'); lpct.textContent = '0%'; }
    if ($('splashLoading')) {
        _setSplashBusy(false);
        $('splashProgress').classList.add('indeterminate');
        $('splashProgressBar').style.width = '0%';
        $('splashLoadPct').textContent = '0%';
        $('splashLoadMsg').textContent = 'Loading PDF…';
    }
};

// ─── Splash 0-100% progress driver ───
let _isOpening = false;
let _lastPct = 0;
function beginSplashProgress(msg) {
    _lastPct = 0;
    if (!$('splashLoading')) return;
    _setSplashBusy(true, msg || 'Loading PDF…');
    $('splashProgress').classList.remove('indeterminate');
    $('splashProgressBar').style.width = '0%';
    $('splashLoadPct').textContent = '0%';
    $('splashLoadMsg').textContent = msg || 'Loading PDF…';
    $('splashProgress').setAttribute('aria-valuenow', '0');
}
function setSplashProgress(pct, msg) {
    pct = Math.max(0, Math.min(100, pct));
    if (pct < _lastPct) pct = _lastPct;
    _lastPct = pct;
    const bar = $('splashProgressBar');
    if (bar) bar.style.width = pct.toFixed(1) + '%';
    const lbl = $('splashLoadPct');
    if (lbl) lbl.textContent = Math.round(pct) + '%';
    if (msg) {
        const m = $('splashLoadMsg');
        if (m) m.textContent = msg;
    }
    const pr = $('splashProgress');
    if (pr) pr.setAttribute('aria-valuenow', String(Math.round(pct)));
}
function endSplashProgress() {
    if (!$('splashLoading')) return;
    _setSplashBusy(false);
    $('splashProgress').classList.add('indeterminate');
    $('splashProgressBar').style.width = '0%';
    $('splashLoadPct').textContent = '0%';
    $('splashLoadMsg').textContent = 'Loading PDF…';
}

// ─── Loader-overlay 0-100% progress driver (in-app loader card) ───
let _lastLoaderPct = 0;
function beginLoaderProgress(msg) {
    _lastLoaderPct = 0;
    $('loaderMsg').textContent = msg || 'Working…';
    const lp = $('loaderProgress'); const lb = $('loaderProgressBar'); const lpct = $('loaderPct');
    if (lp) { lp.classList.add('visible'); lp.classList.remove('indeterminate'); lp.setAttribute('aria-valuenow', '0'); }
    if (lb) lb.style.width = '0%';
    if (lpct) { lpct.classList.add('visible'); lpct.textContent = '0%'; }
    $('loader').classList.add('visible');
}
function setLoaderProgress(pct, msg) {
    pct = Math.max(0, Math.min(100, pct));
    if (pct < _lastLoaderPct) pct = _lastLoaderPct;
    _lastLoaderPct = pct;
    const lb = $('loaderProgressBar'); if (lb) lb.style.width = pct.toFixed(1) + '%';
    const lpct = $('loaderPct'); if (lpct) lpct.textContent = Math.round(pct) + '%';
    if (msg) $('loaderMsg').textContent = msg;
    const lp = $('loaderProgress'); if (lp) lp.setAttribute('aria-valuenow', String(Math.round(pct)));
}
function endLoaderProgress() {
    hideLoader();
}

// Yield to the browser so the progress bar can repaint between heavy steps.
// requestAnimationFrame doesn't fire when the page is backgrounded, which would
// stall the whole load — fall back to a microtask in that case.
const _uiYield = () => new Promise(r => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    try { requestAnimationFrame(() => fin()); } catch (_) { fin(); }
    setTimeout(fin, 200); // safety net if rAF never fires (background tab)
});

let _statusHideTimer = null;
const showUI = () => {
    $('splash').classList.add('hidden');
    document.body.classList.add('pdf-loaded');
    $('toolbar').classList.add('visible');
    $('zoomGroup').classList.add('visible');
    $('btnFind').classList.add('visible');
    $('btnAnnot').classList.add('visible');
    updateDocSize();
    // Show status bar permanently
    $('statusBar').classList.add('visible');
    $('statusBar').classList.remove('fade-out');
};



// ─── Tool Selection ───
function setTool(tool) {
    // Changing tool (or picking the same one again) abandons an untyped text block.
    if (S._provisionalEl) discardProvisionalText(S._provisionalEl);
    S.tool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    // Toggle draw layers
    $('btnAnnot').classList.toggle('active', tool === 'note');
    S.pages.forEach(p => {
        const drawActive = tool === 'draw' || tool === 'highlight' || tool === 'eraser';
        p.drawLayer.classList.toggle('active', drawActive);
        p.drawLayer.classList.toggle('eraser-mode', tool === 'eraser');
        p.editLayer.classList.toggle('text-mode', tool === 'text');
        p.editLayer.classList.toggle('note-mode', tool === 'note');
    });
    if (tool !== 'select') deselect();
    if (tool === 'draw' || tool === 'highlight' || tool === 'signature') openColorPopForTool(tool);
    else closeColorPop();
    syncMobileFooterState();
}
document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.addEventListener('click', () => {
        const t = b.dataset.tool;
        // Switching to another tool exits modify mode (auto-saves the page).
        if (S.editMode) setEditMode(false, { silent: true });
        // Close the annotations dropdown after picking any tool
        const dd = document.getElementById('annotDrop');
        if (dd && dd.contains(b)) dd.classList.remove('open');
        if (t === 'image') { $('fileImg').dataset.mode = 'add'; $('fileImg').click(); syncMobileFooterState(); return; }
        if (t === 'signature') { openSigModal(); syncMobileFooterState(); return; }
        setTool(t);
    });
});

// ─── Toolbar dropdowns (annotations + “more tools”) ───
(function _wireToolDropdowns() {
    function wire(ddId, btnId) {
        const dd = document.getElementById(ddId);
        const btn = document.getElementById(btnId);
        if (!dd || !btn) return;
        const close = () => { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = !dd.classList.contains('open');
            // Only one dropdown open at a time.
            document.querySelectorAll('.tool-dropdown.open').forEach(o => { if (o !== dd) o.classList.remove('open'); });
            if ($('propsPanel')) $('propsPanel').classList.remove('visible');
            if ($('frPanel')?.classList.contains('visible')) closeFindReplace();
            dd.classList.toggle('open', willOpen);
            btn.setAttribute('aria-expanded', String(willOpen));
        });
        // Picking an entry closes the menu.
        dd.querySelectorAll('.tool-dropdown-menu button').forEach(item => item.addEventListener('click', close));
        document.addEventListener('mousedown', (e) => { if (!dd.contains(e.target)) close(); });
    }
    wire('annotDrop', 'btnAnnotDrop');
    wire('moreDrop', 'btnMore');
})();

// ─── Mobile footer and bottom sheets ───
let mobileSheetOpener = null;
let mobileSheetTouchY = null;

function syncMobileFooterState() {
    const pages = document.getElementById('mobilePages');
    const find = document.getElementById('mobileFind');
    const modify = document.getElementById('mobileModify');
    const add = document.getElementById('mobileAdd');
    if (pages) pages.classList.toggle('active', $('sidebar').classList.contains('open'));
    if (find) find.classList.toggle('active', $('frPanel').classList.contains('visible'));
    if (modify) {
        modify.classList.toggle('active', !!S.editMode);
        modify.setAttribute('aria-pressed', String(!!S.editMode));
    }
    if (add) add.classList.toggle('active', ['text','image','note','draw','highlight','signature'].includes(S.tool));
}

function closeMobileSheet({ restoreFocus = true } = {}) {
    const layer = document.getElementById('mobileSheetLayer');
    if (!layer || !layer.classList.contains('visible')) return;
    layer.classList.remove('visible');
    layer.setAttribute('aria-hidden', 'true');
    layer.querySelectorAll('.mobile-sheet').forEach(sheet => sheet.classList.remove('active'));
    document.body.classList.remove('mobile-sheet-open');
    $('mobileAdd').setAttribute('aria-expanded', 'false');
    $('mobileMore').setAttribute('aria-expanded', 'false');
    if (restoreFocus && mobileSheetOpener) mobileSheetOpener.focus();
    mobileSheetOpener = null;
}

function openMobileSheet(name, opener) {
    const layer = $('mobileSheetLayer');
    const sheet = name === 'add' ? $('mobileAddSheet') : $('mobileMoreSheet');
    mobileSheetOpener = opener;
    layer.querySelectorAll('.mobile-sheet').forEach(item => item.classList.toggle('active', item === sheet));
    layer.classList.add('visible');
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mobile-sheet-open');
    $('mobileAdd').setAttribute('aria-expanded', String(name === 'add'));
    $('mobileMore').setAttribute('aria-expanded', String(name === 'more'));
    if (name === 'more') {
        $('mobileUndo').disabled = $('btnUndo').disabled;
        $('mobileRedo').disabled = $('btnRedo').disabled;
    }
    setTimeout(() => sheet.querySelector('.mobile-tool-action:not(:disabled), .mobile-sheet-close')?.focus(), 30);
}

$('mobilePages').onclick = () => { closeMobileSheet({ restoreFocus: false }); $('btnPages').click(); syncMobileFooterState(); };
$('mobileFind').onclick = () => {
    closeMobileSheet({ restoreFocus: false });
    if ($('frPanel').classList.contains('visible')) closeFindReplace(); else openFindReplace();
    syncMobileFooterState();
};
$('mobileModify').onclick = () => { closeMobileSheet({ restoreFocus: false }); $('btnModify').click(); syncMobileFooterState(); };
$('mobileAdd').onclick = event => openMobileSheet('add', event.currentTarget);
$('mobileMore').onclick = event => openMobileSheet('more', event.currentTarget);

document.querySelectorAll('.mobile-sheet-close').forEach(button => button.onclick = () => closeMobileSheet());
$('mobileSheetLayer').addEventListener('mousedown', event => {
    if (event.target === $('mobileSheetLayer')) closeMobileSheet();
});
$('mobileSheetLayer').addEventListener('touchstart', event => {
    mobileSheetTouchY = event.touches[0]?.clientY ?? null;
}, { passive: true });
$('mobileSheetLayer').addEventListener('touchend', event => {
    const endY = event.changedTouches[0]?.clientY;
    if (mobileSheetTouchY !== null && endY - mobileSheetTouchY > 60) closeMobileSheet();
    mobileSheetTouchY = null;
}, { passive: true });

document.querySelectorAll('[data-mobile-tool]').forEach(button => {
    button.onclick = () => {
        const tool = button.dataset.mobileTool;
        closeMobileSheet({ restoreFocus: false });
        if (tool === 'note') $('btnAnnot').click();
        else document.querySelector(`.toolbar-container [data-tool="${tool}"]`)?.click();
        syncMobileFooterState();
    };
});

document.querySelectorAll('[data-mobile-proxy]').forEach(button => {
    button.onclick = () => {
        const target = document.getElementById(button.dataset.mobileProxy);
        closeMobileSheet({ restoreFocus: false });
        if (target && !target.disabled) target.click();
        syncMobileFooterState();
    };
});

// ─── PDF Metadata ───
function collectPDFMeta(doc, pdfJsDoc, name, fileSize) {
    const fmt = v => v instanceof Date ? v.toLocaleString() : (v || '—');
    const m = {
        fileName: name,
        fileSize: fileSize,
        pages: doc.getPageCount(),
        title: fmt(doc.getTitle()),
        author: fmt(doc.getAuthor()),
        subject: fmt(doc.getSubject()),
        keywords: fmt(doc.getKeywords()),
        creator: fmt(doc.getCreator()),
        producer: fmt(doc.getProducer()),
        creationDate: fmt(doc.getCreationDate()),
        modDate: fmt(doc.getModificationDate())
    };
    // page dimensions from first page
    try {
        const p = doc.getPage(0);
        const { width, height } = p.getSize();
        const wMM = (width / 72 * 25.4).toFixed(1);
        const hMM = (height / 72 * 25.4).toFixed(1);
        m.dimensions = `${wMM} × ${hMM} mm (${width.toFixed(0)} × ${height.toFixed(0)} pt)`;
    } catch(_) { m.dimensions = '—'; }
    return m;
}

function renderMetaCards() {
    const list = $('pdfMetaList');
    if (!S.pdfMetas || !S.pdfMetas.length) {
        list.innerHTML = '<div class="pdf-meta-empty">No PDF loaded</div>';
        return;
    }
    const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(2) + ' MB';
    const rows = [
        ['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'],
        ['Keywords', 'keywords'], ['Creator', 'creator'], ['Producer', 'producer'],
        ['Created', 'creationDate'], ['Modified', 'modDate'],
        ['Pages', 'pages'], ['Dimensions', 'dimensions']
    ];
    list.innerHTML = S.pdfMetas.map((m, i) => {
        const badge = S.pdfMetas.length > 1 ? `<span class="meta-badge">#${i + 1}</span>` : '';
        const rowsHtml = rows.map(([label, key]) =>
            `<div class="pdf-meta-row"><span class="meta-label">${label}</span><span class="meta-value">${key === 'pages' ? m[key] : (m[key] || '—')}</span></div>`
        ).join('');
        return `<div class="pdf-meta-card">
            <div class="pdf-meta-card-title">${badge}${m.fileName} <span class="meta-label" style="margin-left:auto">${fmtSize(m.fileSize)}</span></div>
            ${rowsHtml}
        </div>`;
    }).join('');
}

// ─── Open PDF ───
async function openPDF(buf, name = 'document.pdf') {
    if (_isOpening) { toast('Already loading a PDF…'); return; }
    _isOpening = true;
    const onSplash = !$('splash').classList.contains('hidden');
    // Unified progress driver: drives splash bar when on splash, loader bar otherwise.
    const begin = (msg) => onSplash ? beginSplashProgress(msg) : beginLoaderProgress(msg);
    const setP  = (pct, msg) => onSplash ? setSplashProgress(pct, msg) : setLoaderProgress(pct, msg);
    const end   = () => onSplash ? endSplashProgress() : endLoaderProgress();

    begin('Reading PDF…');
    setP(2, 'Reading PDF…');
    try {
        S.bytes = new Uint8Array(buf);
        S.fileName = name;
        // Register the session immediately: the pre-home list must already show it
        // if the tab is closed before the (slower) render pass finishes.
        _upsertSession({ fileName: name, timestamp: Date.now() });
        await _uiYield();

        // Phase 1: pdf-lib parse (2 → 12%)
        setP(6, 'Parsing PDF structure…');
        S.pdfDoc = await PDFDocument.load(S.bytes, { ignoreEncryption: true });
        setP(12, 'PDF structure parsed');
        await _uiYield();

        // Phase 2: pdf.js engine load (12 → 28%) with native progress
        setP(14, 'Loading PDF engine…');
        const loadingTask = pdfjsLib.getDocument({
            data: S.bytes.slice(),
            cMapUrl: vendor('vendor/pdfjs/cmaps/'),
            cMapPacked: true,
            standardFontDataUrl: vendor('vendor/pdfjs/standard_fonts/'),
        });
        loadingTask.onProgress = (p) => {
            if (p && p.total) {
                const pct = 14 + Math.min(14, (p.loaded / p.total) * 14);
                setP(pct, `Loading PDF engine… ${Math.round(p.loaded / p.total * 100)}%`);
            }
        };
        S.pdfJs = await loadingTask.promise;
        setP(30, 'Reading metadata…');
        S.pdfMetas = [collectPDFMeta(S.pdfDoc, S.pdfJs, name, S.bytes.length)];
        await _uiYield();

        // Phase 3: render all pages (30 → 88%)
        // Sub-progress: done can be fractional (e.g. 3.4/100).
        // Reveal the UI as soon as the page skeleton is in place, then rasterise in
        // the background — huge perceived-speed win on large documents.
        let revealed = false;
        await renderAllPages(
            (done, total, label) => {
                const pct = 30 + (total ? (done / total) : 0) * 58;
                setP(pct, label || `Rendering page ${Math.ceil(done)}/${total}…`);
            },
            async () => {
                if (revealed) return;
                revealed = true;
                showUI();
                updateStatus();
                renderMetaCards();
            }
        );

        // Phase 4: thumbnails (88 → 99%)
        setP(89, 'Building thumbnails…');
        await buildThumbs((done, total) => {
            const pct = 89 + (total ? (done / total) : 0) * 10;
            setP(pct, `Thumbnail ${done}/${total}…`);
        });

        setP(100, 'Ready');
        resetHistory();
        autoSave();
        // Force the PDF bytes to be stored right after a fresh open/rebuild
        _pdfCacheHash = ''; savePdfBytes();
        end();
        toast('PDF loaded');
        return true;
    } catch(e) {
        end();
        toast('Error: ' + (e && e.message ? e.message : e));
        console.error('openPDF failed:', e);
        return false;
    } finally {
        _isOpening = false;
    }
}

// ─── Append PDF pages to current document ───
async function appendPDF(buf, name) {
    if (_isOpening) { toast('Already loading a PDF…'); return; }
    _isOpening = true;
    beginLoaderProgress('Reading PDF…');
    setLoaderProgress(2, 'Reading PDF…');
    try {
        const newBytes = new Uint8Array(buf);
        await _uiYield();
        setLoaderProgress(8, 'Parsing PDF…');
        const newDoc = await PDFDocument.load(newBytes, { ignoreEncryption: true });
        const indices = newDoc.getPageIndices();
        setLoaderProgress(15, `Copying ${indices.length} page${indices.length>1?'s':''}…`);
        const copiedPages = await S.pdfDoc.copyPages(newDoc, indices);
        for (const page of copiedPages) S.pdfDoc.addPage(page);
        if (!S.pdfMetas) S.pdfMetas = [];
        S.pdfMetas.push(collectPDFMeta(newDoc, null, name, newBytes.length));
        setLoaderProgress(22, 'Re-rendering document…');
        await rebuild({ progressFrom: 22, progressTo: 99 });
        renderMetaCards();
        setLoaderProgress(100, 'Done');
        endLoaderProgress();
        toast(`${indices.length} pages added from ${name}`);
    } catch(e) {
        endLoaderProgress();
        toast('Error: ' + (e && e.message ? e.message : e));
        console.error('appendPDF failed:', e);
    } finally {
        _isOpening = false;
    }
}

// ─── Render ALL pages into the scroll area ───
let _renderGen = 0; // guards against interleaved async renders (fixes page overlap)
let _renderBusy = false;   // true while a full render pass is in flight
let _pendingZoom = null;   // zoom requested during a render — applied when idle
// `onStructureReady` fires as soon as the full DOM skeleton (pages in order) is in
// place, letting callers reveal the UI before rasterisation finishes.
async function renderAllPages(onProgress, onStructureReady) {
    const gen = ++_renderGen;
    _renderBusy = true;
    const area = $('canvasArea');
    const _oldPages = S.pages;
    area.innerHTML = '';

    const total = S.pdfJs.numPages;
    const _s = RENDER_SCALE();
    // Pre-size the pages array so callers can rely on stable indices during the render.
    S.pages = new Array(total).fill(null);

    // Phase A — create the full DOM structure in page order (wraps + empty canvases +
    // layers + interaction handlers). This guarantees correct vertical ordering even
    // while pages are being rasterised in the background.
    const pageHandles = [];
    for (let i = 1; i <= total; i++) {
        const page = await S.pdfJs.getPage(i);
        const vp = page.getViewport({ scale: _s });
        const vt = vp.transform;

        // Wrapper
        const wrap = document.createElement('div');
        wrap.className = 'page-canvas-wrap';
        wrap.dataset.page = i;
        wrap.style.width = vp.width + 'px';
        wrap.style.height = vp.height + 'px';

        // PDF canvas
        const cv = document.createElement('canvas');
        cv.width = vp.width; cv.height = vp.height;

        // Edit layer (for text/image overlays)
        const editLayer = document.createElement('div');
        editLayer.className = 'edit-layer';
        editLayer.dataset.page = i;

        // Draw layer (for freehand)
        const drawLayer = document.createElement('canvas');
        drawLayer.className = 'draw-layer';
        drawLayer.width = vp.width; drawLayer.height = vp.height;
        drawLayer.dataset.page = i;

        wrap.appendChild(cv);
        wrap.appendChild(editLayer);
        wrap.appendChild(drawLayer);
        area.appendChild(wrap);

        const pageData = { canvas: cv, editLayer, drawLayer, elements: [], paths: [], width: vp.width, height: vp.height, vt };
        S.pages[i - 1] = pageData;

        // Click on edit layer -> add text, find nearest text, or deselect
        editLayer.addEventListener('mousedown', (e) => {
            // With the Text/Note tool, a click on a PDF object overlay (background
            // rectangle, image, annotation…) must still place the new element:
            // requiring a "pure" edit-layer click made text-on-background impossible.
            const objectOverlay = e.target.closest?.('.el-pdf-graphic, .el-pdf-img, .el-stroke');
            const placing = S.tool === 'text' || S.tool === 'note';
            if (e.target !== editLayer && !(objectOverlay && placing)) return;
            const r = editLayer.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            if (S.tool === 'text') { addText(i - 1, mx, my); return; }
            if (S.tool === 'note') { addNote(i - 1, mx, my); return; }
            let hitEl = null, hitDom = null;
            for (const el of pageData.elements) {
                if (!el.extracted || el._deleted) continue;
                const ew = el.width || 100, eh = el.height || el.fontSize * 1.4;
                if (mx >= el.x - 4 && mx <= el.x + ew + 4 && my >= el.y - 4 && my <= el.y + eh + 4) {
                    hitEl = el;
                    hitDom = editLayer.querySelector(`[data-id="${el.id}"]`);
                    break;
                }
            }
            if (hitEl && hitDom) {
                e.stopPropagation();
                e.preventDefault();
                if (S.selected !== hitEl) {
                    if (S.selectedDOM) S.selectedDOM.classList.remove('selected');
                    endInlineEdit();
                    if (S.editingText) closeTextPanel();
                    S.selected = hitEl; S.selectedDOM = hitDom;
                    hitDom.classList.add('selected');
                    $('propsPanel').classList.remove('visible');
                }
                selectEl(hitEl, hitDom);
                if (!S.editMode) openTextPanel(hitEl);
            } else if (S.tool === 'select') { deselect(); }
        });
        // Also deselect on click on the canvas itself (below edit layer)
        wrap.addEventListener('mousedown', (e) => {
            if (e.target === cv && S.tool === 'select') deselect();
        });

        // Draw events
        setupDrawEvents(drawLayer, pageData);

        pageHandles.push({ page, vp, vt, pageData, wrap, cv, editLayer, drawLayer });
        if (typeof onProgress === 'function') {
            try { onProgress(i, total, `Structure ${i}/${total}`); } catch (_) {}
        }
        await _uiYield();
    }

    // Structure is ready — let the caller reveal the UI now.
    if (typeof onStructureReady === 'function') {
        try { onStructureReady(total); } catch (_) {}
    }

    // Phase B — rasterise + extract text/images in bounded concurrency. DOM order is
    // already fixed; we only fill canvas + overlays, so completion order doesn't matter.
    const CONCURRENCY = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    const idxs = Array.from({ length: total }, (_, k) => k);
    async function raster(idx) {
        const h = pageHandles[idx];
        const i = idx + 1;
        if (!h) return;
        const { page, vp, vt, pageData, cv, editLayer, drawLayer } = h;
        if (gen !== _renderGen) return;
        const ctx = cv.getContext('2d');
        if (typeof onProgress === 'function') onProgress(i - 0.95, total, `Rendering page ${i}/${total}\u2026`);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (gen !== _renderGen) return;
        if (typeof onProgress === 'function') onProgress(i - 0.60, total, `Page ${i}/${total} rendered`);

        // Restore elements or extract text from PDF
        if (Array.isArray(S._savedElements?.[i]) && S._savedElements[i].length > 0) {
            const oldW = _oldPages[i-1]?.width || vp.width;
            const oldH = _oldPages[i-1]?.height || vp.height;
            const rX = vp.width / oldW, rY = vp.height / oldH;
            pageData.elements = S._savedElements[i];
            pageData.elements.forEach(el => {
                if (el.type === 'pdf-graphic') {
                    // Re-project the vector path at the new render scale / page origin.
                    invalidateGraphicView(el);
                    const subs = graphicViewSubpaths(el);
                    const bb = subpathsBounds(subs);
                    if (!bb) return;
                    el.x = bb.x; el.y = bb.y;
                    el.width = Math.max(6, bb.w); el.height = Math.max(6, bb.h);
                    el.screenLineWidth = Math.max(1, (el.pdfLineWidth || 1) * _renderS());
                    el.originalViewX = el.x - ((el.dxPdf || 0) * vt[0] + (el.dyPdf || 0) * vt[2]);
                    el.originalViewY = el.y - ((el.dxPdf || 0) * vt[1] + (el.dyPdf || 0) * vt[3]);
                } else if (el.extracted && el.pdfX !== undefined) {
                    // Apply any move delta recorded in modify mode so the block keeps
                    // its dragged position after a zoom / rebuild.
                    const ddx = el.dxPdf || 0, ddy = el.dyPdf || 0;
                    const cx = vt[0]*(el.pdfX + ddx) + vt[2]*(el.pdfY + ddy) + vt[4];
                    const cy = vt[1]*(el.pdfX + ddx) + vt[3]*(el.pdfY + ddy) + vt[5];
                    const _s2 = _renderS();
                    el.x = cx; el.y = cy - el.pdfFontSize * _s2;
                    el.fontSize = el.pdfFontSize * _s2;
                    if (el.pdfWidth) el.width = el.pdfWidth * _s2 + 6;
                } else if (rX !== 1 || rY !== 1) {
                    el.x *= rX; el.y *= rY;
                    if (el.fontSize) el.fontSize *= rY;
                    if (el.width) el.width *= rX;
                    if (el.height) el.height *= rY;
                }
                if (!el._deleted) placeElement(el, editLayer);
                else syncNativePreview(el);
            });
            if (typeof onProgress === 'function') onProgress(i, total, `Page ${i}/${total} restored`);
        } else {
            // Extract text (35% of page slice)
            await extractPageText(page, vp, i - 1, editLayer, pageData,
                typeof onProgress === 'function'
                    ? (sd, st) => onProgress(i - 0.60 + (st ? (sd / st) * 0.35 : 0), total, `Page ${i}/${total} \u2014 text ${sd}/${st}`)
                    : null);
            // Extract simple vector graphics on every imported page so lines and
            // rectangles become selectable in Modify mode.
            await extractPageGraphics(page, vp, i - 1, editLayer, pageData);
            // Raster images are existing PDF objects too: expose genuine images
            // automatically so Modify mode never depends on a hidden preference.
            await extractPageImages(page, vp, i - 1, editLayer, pageData,
                typeof onProgress === 'function'
                    ? (sd, st) => onProgress(i - 0.25 + (st ? (sd / st) * 0.25 : 0), total, `Page ${i}/${total} \u2014 images ${sd}/${st}`)
                    : null);
        }
        if (S._savedPaths && S._savedPaths[i]) {
            // Strokes live in screen coordinates: rescale them so drawings stay
            // aligned after a zoom or a rebuild (the canvas size just changed).
            const oldW = _oldPages[i - 1]?.width || vp.width;
            const oldH = _oldPages[i - 1]?.height || vp.height;
            const rX = oldW ? vp.width / oldW : 1;
            const rY = oldH ? vp.height / oldH : 1;
            pageData.paths = S._savedPaths[i].map(p => ({
                ...p,
                points: (p.points || []).map(pt => ({ x: pt.x * rX, y: pt.y * rY })),
                width: Math.max(1, (p.width || 2) * ((rX + rY) / 2)),
            }));
            redrawPaths(pageData);
        }
        if (gen !== _renderGen) return;
        if (typeof onProgress === 'function') {
            try { onProgress(i, total, `Page ${i}/${total} ready`); } catch (_) {}
        }
        await _uiYield();
    }

    // Process pages with bounded concurrency (in index order)
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
        while (cursor < total && gen === _renderGen) {
            const cur = cursor++;
            await raster(cur);
        }
    }));
    if (gen === _renderGen) {
        delete S._savedElements;
        delete S._savedPaths;
    }
    _renderBusy = false;
    // Apply a zoom requested while we were busy (coalesced, once, on the live pass).
    if (_pendingZoom != null && gen === _renderGen) {
        const z = _pendingZoom; _pendingZoom = null;
        setZoom(z);
    }
}

// ─── Place element in DOM ───
// ─── Vector object helpers (extracted PDF graphics) ───
const SVG_NS = 'http://www.w3.org/2000/svg';

// Every legacy element (line/rect from earlier saved sessions) and every current
// 'path' element is normalised to a list of subpaths expressed in PDF points.
function graphicPdfSubpaths(el) {
    if (Array.isArray(el.pdfSubpaths) && el.pdfSubpaths.length) return el.pdfSubpaths;
    const pts = el.pdfPoints;
    if (!Array.isArray(pts) || pts.length < 2) return [];
    if (el.graphicKind === 'rect' && pts.length >= 4) return [[pts[0], pts[1], pts[2], pts[3], pts[0]]];
    return [pts];
}

function subpathsToView(subpaths, vt, dx = 0, dy = 0) {
    return subpaths.map(sp => sp.map(p => ({
        x: vt[0] * (p.x + dx) + vt[2] * (p.y + dy) + vt[4],
        y: vt[1] * (p.x + dx) + vt[3] * (p.y + dy) + vt[5],
    })));
}

function subpathsBounds(subpaths) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
    for (const sp of subpaths) for (const p of sp) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        n++;
    }
    if (!n || !Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// SVG path data for a set of subpaths, relative to (ox, oy).
function subpathsToPathData(subpaths, ox = 0, oy = 0) {
    return subpaths.map(sp => {
        if (!sp || sp.length < 2) return '';
        return sp.map((p, i) => `${i ? 'L' : 'M'}${(p.x - ox).toFixed(2)} ${(p.y - oy).toFixed(2)}`).join(' ');
    }).filter(Boolean).join(' ');
}

// View-space subpaths of an element. `original: true` ignores the PDF-space move
// delta — that is the position of the object baked into the page raster, which is
// what the erase mask has to cover.
function graphicViewSubpaths(el, original = false) {
    const cacheKey = original ? '_origViewSubpaths' : '_viewSubpaths';
    if (el[cacheKey]) return el[cacheKey];
    const pageData = S.pages[el.page];
    const vt = pageData?.vt;
    if (!vt) return [];
    const subs = subpathsToView(graphicPdfSubpaths(el), vt,
        original ? 0 : (el.dxPdf || 0), original ? 0 : (el.dyPdf || 0));
    Object.defineProperty(el, cacheKey, { value: subs, writable: true, configurable: true, enumerable: false });
    return subs;
}

function invalidateGraphicView(el) {
    try { delete el._viewSubpaths; delete el._origViewSubpaths; } catch (_) {}
}

// Re-project the vector preview after the object moved or was resized. The path
// data is relative to the element box, so a stale cache paints the shape at the
// wrong place (the object looked like it jumped or vanished while being dragged).
function refreshGraphicGeometry(el, dom) {
    if (!dom || el.type !== 'pdf-graphic') return;
    invalidateGraphicView(el);
    const subs = graphicViewSubpaths(el);
    const bb = subpathsBounds(subs);
    if (!bb) return;
    el.width = Math.max(6, bb.w);
    el.height = Math.max(6, bb.h);
    dom.style.width = el.width + 'px';
    dom.style.height = el.height + 'px';
    const svg = dom.querySelector('svg');
    if (svg) svg.setAttribute('viewBox', `0 0 ${Math.max(el.width, 1)} ${Math.max(el.height, 1)}`);
    const d = subpathsToPathData(subs, el.x, el.y);
    dom.querySelectorAll('path').forEach(p => p.setAttribute('d', d));
}

function applyGraphicPreviewStyle(dom, el) {
    const preview = dom?.querySelector('svg .el-pdf-graphic-preview');
    if (!preview) return;
    // Fill and stroke can differ (a shape filled yellow with a brown outline).
    preview.setAttribute('fill', el.filled ? (el.fillColor || el.color) : 'none');
    preview.setAttribute('stroke', el.stroked ? (el.strokeColor || el.color) : 'none');
    preview.setAttribute('stroke-width', String(Math.max(1, el.screenLineWidth || 1)));
}

function clearNativePreviewMasks(el) {
    const layer = S.pages[el.page]?.editLayer;
    if (!layer) return;
    layer.querySelectorAll(`.native-preview-mask[data-native-id="${el.id}"]`).forEach(mask => mask.remove());
}

function syncNativePreview(el) {
    if (!el?.extracted) return;
    const pageData = S.pages[el.page];
    const layer = pageData?.editLayer;
    if (!layer) return;
    clearNativePreviewMasks(el);
    const changed = el._deleted || el._moved || el._resized || el.replacedSrc
        || el.content !== el.originalContent || el.color !== el.originalColor;
    if (!changed) { _refreshMaskedOverlaps(pageData); return; }

    const addMask = (left, top, width, height, color = el.bgColor || '#ffffff') => {
        const mask = document.createElement('div');
        mask.className = 'native-preview-mask';
        mask.dataset.nativeId = el.id;
        mask.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(1, width)}px;height:${Math.max(1, height)}px;background:${color};`;
        layer.insertBefore(mask, layer.firstChild);
        return mask;
    };

    if (el.type === 'text') {
        const vt = pageData.vt;
        const scale = _renderS();
        const lines = el.pdfLines?.length ? el.pdfLines : [{
            pdfX: el.pdfX, pdfY: el.pdfY, pdfFontSize: el.pdfFontSize, pdfWidth: el.pdfWidth,
        }];
        lines.forEach(line => {
            const x = vt[0] * line.pdfX + vt[2] * line.pdfY + vt[4];
            const baseline = vt[1] * line.pdfX + vt[3] * line.pdfY + vt[5];
            const fontSize = line.pdfFontSize * scale;
            addMask(x - fontSize * 0.15, baseline - fontSize * 1.15,
                (line.pdfWidth || el.pdfWidth || 100) * scale + fontSize * 0.45,
                fontSize * 1.55);
        });
    } else if (el.type === 'pdf-image') {
        addMask(el.originalViewX, el.originalViewY, el.originalViewWidth, el.originalViewHeight, '#ffffff');
    } else if (el.type === 'pdf-graphic') {
        const subs = graphicViewSubpaths(el, true);
        const bb = subpathsBounds(subs);
        if (!bb) return;
        const width = Math.max(1, bb.w), height = Math.max(1, bb.h);
        const mask = addMask(bb.x, bb.y, width, height, 'transparent');
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.cssText = 'width:100%;height:100%;overflow:visible;';
        const shape = document.createElementNS(SVG_NS, 'path');
        shape.setAttribute('d', subpathsToPathData(subs, bb.x, bb.y));
        shape.setAttribute('fill', el.filled ? (el.bgColor || '#ffffff') : 'none');
        shape.setAttribute('stroke', el.stroked ? (el.bgColor || '#ffffff') : 'none');
        shape.setAttribute('stroke-width', String(Math.max(2, (el.screenLineWidth || 1) + 2)));
        shape.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(shape); mask.appendChild(svg);
    }
    _refreshMaskedOverlaps(pageData);
}

// A mask is a flat colour painted over the original object, so it also paints over
// everything that was drawn ON TOP of that object in the page raster (a logo made
// of several paths, a rule, a picture). Those objects must be re-drawn as vectors
// above the mask, otherwise touching a background makes its content vanish.
function _refreshMaskedOverlaps(pageData) {
    const layer = pageData?.editLayer;
    if (!layer) return;
    const rects = [];
    layer.querySelectorAll('.native-preview-mask').forEach(mask => {
        const w = parseFloat(mask.style.width) || 0;
        const h = parseFloat(mask.style.height) || 0;
        if (w <= 0 || h <= 0) return;
        rects.push({
            x: parseFloat(mask.style.left) || 0,
            y: parseFloat(mask.style.top) || 0,
            w, h,
        });
    });
    const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const el of pageData.elements || []) {
        if (!el.extracted || (el.type !== 'pdf-graphic' && el.type !== 'pdf-image')) continue;
        const dom = layer.querySelector(`[data-id="${el.id}"]`);
        if (!dom) continue;
        const box = {
            x: el.originalViewX != null ? el.originalViewX : el.x,
            y: el.originalViewY != null ? el.originalViewY : el.y,
            w: el.width || 0, h: el.height || 0,
        };
        const covered = !el._deleted && rects.some(r => hits(box, r));
        dom.classList.toggle('under-mask', covered);
    }
}

function placeElement(el, layer) {
    const dom = document.createElement('div');
    dom.dataset.id = el.id;

    if (el.type === 'text') {
        dom.className = 'el-text';
        const textSpan = document.createElement('span');
        textSpan.className = 'el-text-content';
        textSpan.textContent = el.content || '\u00A0';
        dom.appendChild(textSpan);
        dom.style.cssText = `left:${el.x}px;top:${el.y}px;font-size:${el.fontSize}px;color:${el.color};font-family:${getCSSFamily(el.font, el.systemFont)};font-weight:${el.weight||( el.bold?700:400)};font-style:${el.italic?'italic':'normal'};text-align:${el.align||'left'};`;
        if (el.width) dom.style.width = el.width + 'px';
        if (el.height && el.extracted) dom.style.minHeight = el.height + 'px';

        // Resize handles — only for user-added (non-extracted) elements. Extracted
        // text is a transparent hit-area matched to the PDF: handles there only add
        // visual noise / can overlap adjacent blocks.
        if (!el.extracted) addResizeHandles(dom, el);

        // Click handler — works in ALL tool modes for extracted text
        dom.addEventListener('mousedown', (e) => {
            // Extracted text: single click selects + shows formatting panel,
            // double click enters inline editing (Acrobat-like).
            if (el.extracted) {
                // If already inline-editing this element, ignore (textarea is active)
                if (dom.classList.contains('inline-edit')) { e.stopPropagation(); return; }
                e.stopPropagation();
                e.preventDefault();
                if (S.selected !== el) {
                    if (S.selectedDOM) S.selectedDOM.classList.remove('selected');
                    endInlineEdit();
                    if (S.editingText) closeTextPanel();
                    S.selected = el; S.selectedDOM = dom;
                    dom.classList.add('selected');
                    $('propsPanel').classList.remove('visible');
                }
                if (S.editMode) {
                    // Modify mode: drag the whole block (5px threshold so a plain
                    // click selects it without opening the text editor).
                    selectEl(el, dom);
                    const sx = e.clientX, sy = e.clientY;
                    let moved = false;
                    const pageData = S.pages[el.page];
                    const onMove = ev => {
                        const dx = ev.clientX - sx, dy = ev.clientY - sy;
                        if (!moved && Math.abs(dx) + Math.abs(dy) > 5) moved = true;
                        if (moved) {
                            el.x += ev.clientX - (el._lastX || sx);
                            el.y += ev.clientY - (el._lastY || sy);
                            dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
                        }
                        el._lastX = ev.clientX; el._lastY = ev.clientY;
                    };
                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        delete el._lastX; delete el._lastY;
                        if (moved) {
                            // Persist the new position into PDF coordinates so the
                            // export keeps it (and the block survives a zoom/rebuild).
                            recomputeExtractedPosition(el, pageData);
                            dom.classList.add('modified');
                            syncNativePreview(el);
                            markDirty();
                        }
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                    return;
                }
                if (!S.editMode) {
                    // Normal mode: ONE click opens the panel and edits the block in
                    // place. A double click used to be required — which is exactly
                    // why editing felt undiscoverable. The edit itself starts in the
                    // `click` listener below (after mouseup) so the browser's focus
                    // handling cannot steal focus from the inline editor.
                    openTextPanel(el);
                    dom._wantEdit = true;
                }
                return;
            }
            if (S.tool !== 'text' && S.tool !== 'select') return;
            e.stopPropagation();
            selectEl(el, dom);
            if (S.tool === 'text') {
                openTextPanel(el);
                dom._wantEdit = true;   // text tool: clicking an existing block edits it
                return;
            }
            // Select mode on non-extracted text: drag-with-threshold, click = open panel
            const sx = e.clientX, sy = e.clientY;
            let moved = false;
            const onMove = ev => {
                const dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (!moved && Math.abs(dx) + Math.abs(dy) > 5) moved = true;
                if (moved) {
                    el.x += ev.clientX - (el._lastX || sx);
                    el.y += ev.clientY - (el._lastY || sy);
                    dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
                }
                el._lastX = ev.clientX; el._lastY = ev.clientY;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                delete el._lastX; delete el._lastY;
                if (!moved) {
                    if (!S.editMode) {
                        openTextPanel(el);
                        dom._wantEdit = true;   // plain click = edit in place
                    }
                } else markDirty();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // ── ONE click on a text block = edit it in place (normal mode) ──
        // The click paths above only set `_wantEdit`; the edit starts here, on
        // `click` (i.e. after `mouseup`) so nothing later steals the focus.
        dom.addEventListener('click', (e) => {
            if (!dom._wantEdit) return;
            dom._wantEdit = false;
            if (S.editMode || S.selected !== el) return;
            if (dom.classList.contains('inline-edit')) return;
            e.stopPropagation();
            startInlineEdit(el, dom);
        });

        // Double click = same thing; kept as a fallback and for the "Modify" mode.
        dom.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            dom._wantEdit = false;
            if (S.editMode) {
                selectEl(el, dom);
                openTextPanel(el);
                return;
            }
            selectEl(el, dom);
            openTextPanel(el);
            if (el.extracted && !dom.classList.contains('inline-edit')) startInlineEdit(el, dom);
        });

        // Extracted text overlay styling
        if (el.extracted) {
            dom.classList.add('extracted');
            dom.title = 'Click to edit this text';
            if (el.content !== el.originalContent || el.color !== el.originalColor || el._moved) {
                dom.classList.add('modified');
            }
        }

    } else if (el.type === 'image' || el.type === 'signature' || el.type === 'pdf-image') {
        dom.className = el.type === 'signature' ? 'el-sig' : 'el-img';
        if (el.type === 'pdf-image') dom.classList.add('el-pdf-img');
        dom.style.cssText = `left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;`;
        const img = document.createElement('img'); img.src = el.src; dom.appendChild(img);
        if (el.opacity != null) img.style.opacity = el.opacity / 100;

        addResizeHandles(dom, el);

        dom.addEventListener('pointerdown', (e) => {
            // Select mode (the default!) must be able to grab an inserted image.
            // The old guard returned early unless Modify mode was active, which is
            // why an imported image could not be moved at all.
            if (!(S.tool === 'select' || S.editMode)) return;
            e.stopPropagation();
            selectEl(el, dom);
            startDrag(e, el, dom);
        });
        if (el._moved || el._resized || el.replacedSrc) dom.classList.add('replaced');

        // Double-click on an image/object: make sure it's selected and the action
        // panel (with Delete / Replace) is visible. Moving is already done by drag.
        dom.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();
            selectEl(el, dom);
        });

    } else if (el.type === 'pdf-graphic') {
        dom.className = 'el-pdf-graphic';
        if (el._moved || el.color !== el.originalColor) dom.classList.add('modified');
        const outer = subpathsBounds(graphicViewSubpaths(el));
        if (outer) {
            // The DOM box follows the real geometry (also after a legacy line/rect load).
            el.width = Math.max(6, outer.w);
            el.height = Math.max(6, outer.h);
        }
        dom.style.cssText = `left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;`;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${Math.max(el.width, 1)} ${Math.max(el.height, 1)}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
        const d = subpathsToPathData(graphicViewSubpaths(el), el.x, el.y);
        const shape = document.createElementNS(SVG_NS, 'path');
        shape.classList.add('el-pdf-graphic-preview');
        shape.setAttribute('d', d);
        shape.setAttribute('stroke-linecap', 'round');
        shape.setAttribute('stroke-linejoin', 'round');
        // Invisible fat copy of the same path: that is what receives the clicks, so
        // a thin rule stays clickable and a diagonal outline does not block its box.
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.classList.add('graphic-hit');
        hit.setAttribute('d', d);
        hit.setAttribute('stroke-width', String(Math.max(14, (el.screenLineWidth || 1) * 3)));
        hit.setAttribute('stroke-linecap', 'round');
        hit.setAttribute('stroke-linejoin', 'round');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('fill', 'none');
        hit.setAttribute('pointer-events', el.filled ? 'all' : 'stroke');
        svg.appendChild(shape); svg.appendChild(hit);
        dom.appendChild(svg);
        applyGraphicPreviewStyle(dom, el);
        dom.title = 'Objet du PDF — cliquez pour sélectionner';
        dom.addEventListener('pointerdown', (e) => {
            if (!(S.tool === 'select' || S.editMode)) return;
            e.stopPropagation();
            e.preventDefault();
            selectEl(el, dom);
            const startX = e.clientX, startY = e.clientY;
            const originX = el.x, originY = el.y;
            let moved = false;
            try { dom.setPointerCapture(e.pointerId); } catch (_) {}
            const onPointerMove = event => {
                const dx = event.clientX - startX, dy = event.clientY - startY;
                if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
                if (!moved) return;
                el.x = originX + dx;
                el.y = originY + dy;
                dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
            };
            const onPointerUp = event => {
                dom.removeEventListener('pointermove', onPointerMove);
                dom.removeEventListener('pointerup', onPointerUp);
                dom.removeEventListener('pointercancel', onPointerUp);
                if (dom.hasPointerCapture?.(event.pointerId)) dom.releasePointerCapture(event.pointerId);
                if (!moved) return;
                recomputeGraphicPosition(el, S.pages[el.page]);
                refreshGraphicGeometry(el, dom);
                dom.classList.toggle('modified', el._moved || el.color !== el.originalColor);
                syncNativePreview(el);
                markDirty();
            };
            dom.addEventListener('pointermove', onPointerMove);
            dom.addEventListener('pointerup', onPointerUp);
            dom.addEventListener('pointercancel', onPointerUp);
        });
        dom.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            selectEl(el, dom);
        });

    } else if (el.type === 'note') {
        dom.className = 'el-note';
        dom.style.cssText = `left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;background:${el.noteBg};`;
        const header = document.createElement('div');
        header.className = 'el-note-header';
        header.style.background = el.noteHeader;
        header.textContent = 'note';
        dom.appendChild(header);
        const body = document.createElement('div');
        body.className = 'el-note-body';
        const ta = document.createElement('textarea');
        ta.value = el.content || '';
        ta.placeholder = 'Write a note…';
        ta.addEventListener('input', () => { el.content = ta.value; markDirty(); });
        ta.addEventListener('mousedown', e => e.stopPropagation());
        ta.addEventListener('pointerdown', e => e.stopPropagation());
        body.appendChild(ta);
        dom.appendChild(body);

        addResizeHandles(dom, el);

        // Drag from header
        header.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            selectEl(el, dom);
            startDrag(e, el, dom);
        });
        // Click body to select
        dom.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            selectEl(el, dom);
        });
        // Double-click a note: select + show the properties panel
        dom.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();
            selectEl(el, dom);
        });
    }

    layer.appendChild(dom);
    _insertInModelOrder(layer, dom, el);
    syncNativePreview(el);
    return dom;
}

// Re-place an element WITHOUT changing its stacking position. Appending was enough
// for the first paint (the model order is the PDF paint order) but every later
// re-place used to move the node to the end of the layer, so a background ended up
// drawn above the logo and the text it used to sit under.
function _insertInModelOrder(layer, dom, el) {
    const list = S.pages[el.page]?.elements;
    if (!Array.isArray(list)) return;
    const idx = list.indexOf(el);
    if (idx < 0) return;
    for (let i = idx + 1; i < list.length; i++) {
        const next = list[i];
        if (!next || next.id === el.id) continue;
        const node = layer.querySelector(`[data-id="${next.id}"]`);
        if (node && node.parentElement === layer && node !== dom) {
            layer.insertBefore(dom, node);
            return;
        }
    }
}

function addResizeHandles(dom, el) {
    ['se','sw','ne','nw'].forEach(pos => {
        const h = document.createElement('div');
        h.className = `resize-h ${pos}`;
        h.addEventListener('pointerdown', e => { e.stopPropagation(); startResize(e, el, dom, pos); });
        dom.appendChild(h);
    });
}

// ─── Select / Deselect ───
function selectEl(el, dom) {
    deselect();
    S.selected = el; S.selectedDOM = dom;
    dom.classList.add('selected');
    const pp = $('propsPanel');
    const isText = el.type === 'text';
    const isImage = el.type === 'image' || el.type === 'pdf-image';
    const isNote = el.type === 'note';
    const isSignature = el.type === 'signature';
    const isGraphic = el.type === 'pdf-graphic';
    const isStroke = el.type === 'stroke';
    $('propsTitle').textContent = isText ? 'Bloc texte' : isImage ? 'Bloc image' : isGraphic ? 'Objet graphique' : isStroke ? 'Annotation' : isNote ? 'Note' : isSignature ? 'Signature' : 'Élément';
    $('propsContext').textContent = isText
        ? 'Changez le texte ou sa couleur, déplacez ou supprimez le bloc.'
        : isImage ? 'Déplacez, redimensionnez, remplacez ou supprimez l’image.'
        : isGraphic ? 'Déplacez, recolorez ou supprimez cet objet graphique.'
        : isStroke ? 'Déplacez, redimensionnez, recolorez ou supprimez cette annotation.'
        : 'Déplacez, redimensionnez ou supprimez cet élément.';
    $('propFontRow').style.display = 'none';
    $('propSizeRow').style.display = 'none';
    $('propFormatRow').style.display = 'none';
    $('propColorRow').style.display = (isText || isNote || isGraphic || isStroke || isSignature) ? '' : 'none';
    $('propColor').value = isNote ? (el.noteBg || '#fff9c4') : objectColor(el);
    $('propEditText').style.display = isText ? '' : 'none';
    $('propReplace').style.display = isImage ? '' : 'none';
    pp.classList.toggle('visible', S.editMode || isImage || isNote || isGraphic || isStroke || isSignature);
    openColorPopForSelection(el);
}
function deselect() {
    if (S.selectedDOM) S.selectedDOM.classList.remove('selected');
    S.selected = null; S.selectedDOM = null;
    $('propsPanel').classList.remove('visible');
    closeColorPop();
    endInlineEdit();
    closeTextPanel();
}

// ─── Drag ───
function startDrag(e, el, dom) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = el.x, oy = el.y;
    const strokePoints = el.type === 'stroke'
        ? el.path.points.map(pt => ({ x: pt.x, y: pt.y }))
        : null;
    const onMove = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (strokePoints) {
            el.path.points = strokePoints.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
            redrawPaths(S.pages[el.page]);
            return;
        }
        el.x = ox + dx; el.y = oy + dy;
        dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (el.type === 'stroke') { markDirty(); return; }
        if (el.type === 'pdf-graphic') {
            recomputeGraphicPosition(el, S.pages[el.page]);
            refreshGraphicGeometry(el, dom);
        }
        if (el.type === 'pdf-image') recomputePdfImageGeometry(el, S.pages[el.page]);
        if (el.extracted) {
            dom.classList.toggle('modified', !!el._moved || el.color !== el.originalColor);
            if (el.type === 'pdf-image') dom.classList.add('replaced');
            syncNativePreview(el);
        }
        markDirty();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

// ─── Resize ───
function startResize(e, el, dom, pos) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ow = el.width || dom.offsetWidth, oh = el.height || dom.offsetHeight, ox = el.x, oy = el.y;
    // Images, signatures and freehand strokes keep their proportions by default so
    // a drawn shape can never be distorted: the corner handles scale uniformly.
    // Hold Shift to resize freely.
    const keepRatio = el.type === 'image' || el.type === 'signature'
        || el.type === 'pdf-image' || el.type === 'stroke';
    // A stroke is not a box: resizing it rescales its points instead.
    const strokeBase = el.type === 'stroke' ? {
        bbox: { x: ox, y: oy, w: ow, h: oh },
        points: el.path.points.map(pt => ({ x: pt.x, y: pt.y })),
        width: el.path.width || 2,
    } : null;
    const onMove = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        // A stroke bbox can be much smaller than an element box — clamp it to a few
        // pixels so a short highlight can still be shrunk instead of snapping to 30px.
        const minW = el.type === 'stroke' ? 6 : 30;
        const minH = el.type === 'stroke' ? 6 : 16;
        let nw = ow, nh = oh, nx = ox, ny = oy;
        if (pos.includes('e')) nw = Math.max(minW, ow + dx);
        if (pos.includes('w')) { nw = Math.max(minW, ow - dx); nx = ox + dx; }
        if (pos.includes('s')) nh = Math.max(minH, oh + dy);
        if (pos.includes('n')) { nh = Math.max(minH, oh - dy); ny = oy + dy; }
        if (keepRatio && !ev.shiftKey && ow > 0 && oh > 0) {
            // Uniform scale driven by the axis the user dragged the most (in pixels,
            // not in %: a 4 px-tall highlight would otherwise explode vertically).
            const scaleX = nw / ow, scaleY = nh / oh;
            const scale = Math.max(0.05, Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY);
            nw = Math.max(minW, ow * scale);
            nh = Math.max(minH, oh * scale);
            nx = pos.includes('w') ? ox + (ow - nw) : ox;
            ny = pos.includes('n') ? oy + (oh - nh) : oy;
        }
        el.width = nw; el.height = nh; el.x = nx; el.y = ny;
        if (strokeBase) {
            const scaleX = nw / strokeBase.bbox.w, scaleY = nh / strokeBase.bbox.h;
            el.path.points = strokeBase.points.map(pt => ({
                x: nx + (pt.x - strokeBase.bbox.x) * scaleX,
                y: ny + (pt.y - strokeBase.bbox.y) * scaleY,
            }));
            el.path.width = Math.max(1, strokeBase.width * Math.min(scaleX, scaleY));
            redrawPaths(S.pages[el.page]);
            return;
        }
        dom.style.width = nw + 'px'; dom.style.height = nh + 'px';
        dom.style.left = nx + 'px'; dom.style.top = ny + 'px';
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (el.type === 'pdf-image') recomputePdfImageGeometry(el, S.pages[el.page]);
        if (el.extracted) {
            dom.classList.add('replaced');
            syncNativePreview(el);
        }
        markDirty();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

// ─── Add Text ───
// A block placed by the Text tool is PROVISIONAL until the user types into it:
// it is shown (so the insertion point is visible) but it is NOT part of the
// document yet. Consequences: clicking around with the Text tool can never leave
// empty blocks behind, never fills the undo history and never fires a toast.
function addText(pageIdx, x, y) {
    // One click = at most one block: drop the previous untyped one first.
    if (S._provisionalEl) discardProvisionalText(S._provisionalEl);
    const el = {
        id: crypto.randomUUID().slice(0, 8),
        type: 'text', x, y, content: '',
        font: 'Helvetica', fontSize: 16, color: '#000000',
        bold: false, italic: false, page: pageIdx,
        width: 200,
        _provisional: true,
    };
    S._provisionalEl = el;
    const dom = placeElement(el, S.pages[pageIdx].editLayer);
    dom.classList.add('new-text-pulse');
    selectEl(el, dom);
    openTextPanel(el);
    // No pushUndo() here on purpose — see commitProvisionalText().
}

// ─── Add Note (annotation) ───
const NOTE_COLORS = [
    { name: 'Yellow', bg: '#fff9c4', header: '#ffee58' },
    { name: 'Blue',   bg: '#bbdefb', header: '#64b5f6' },
    { name: 'Green',  bg: '#c8e6c9', header: '#81c784' },
    { name: 'Pink',   bg: '#f8bbd0', header: '#f06292' },
    { name: 'Orange', bg: '#ffe0b2', header: '#ffb74d' },
];
function addNote(pageIdx, x, y) {
    const nc = NOTE_COLORS[0];
    const el = {
        id: crypto.randomUUID().slice(0, 8),
        type: 'note', x, y, page: pageIdx,
        width: 180, height: 120,
        content: '',
        noteBg: nc.bg, noteHeader: nc.header, noteColorIdx: 0,
    };
    S.pages[pageIdx].elements.push(el);
    const dom = placeElement(el, S.pages[pageIdx].editLayer);
    selectEl(el, dom);
    // Focus the textarea inside
    const ta = dom.querySelector('textarea');
    if (ta) ta.focus();
    pushUndo({ type: 'add', el, pageIdx });
}

// ─── Add Image ───
function addImage(pageIdx, src, nw, nh) {
    const scale = Math.min(250 / nw, 250 / nh, 1);
    const w = Math.round(nw * scale), h = Math.round(nh * scale);
    if (pageIdx == null) pageIdx = (typeof getCurrentPageIndex === 'function' ? getCurrentPageIndex() : 0);
    if (!S.pages[pageIdx]) pageIdx = 0;
    const pd = S.pages[pageIdx];
    const x = pd ? Math.max(20, Math.round((pd.width - w) / 2)) : 50;
    const el = {
        id: crypto.randomUUID().slice(0, 8),
        type: 'image', x, y: 50,
        width: w, height: h,
        src, opacity: 100, page: pageIdx,
    };
    S.pages[pageIdx].elements.push(el);
    const dom = placeElement(el, S.pages[pageIdx].editLayer);
    // Leave the insert mode: the user must be able to grab the image immediately.
    if (!S.editMode) setTool('select');
    selectEl(el, dom);
    pushUndo({ type: 'add', el, pageIdx });
    toast('Image added');
}

// ─── Add Signature ───
function addSignature(src) {
    let pageIdx = (typeof getCurrentPageIndex === 'function' ? getCurrentPageIndex() : 0);
    if (!S.pages[pageIdx]) pageIdx = 0;
    const pd = S.pages[pageIdx];
    const w = 160, h = 60;
    const x = pd ? Math.max(20, Math.round((pd.width - w) / 2)) : 80;
    const y = pd ? Math.max(20, Math.round(pd.height - h - 60)) : 100;
    const el = {
        id: crypto.randomUUID().slice(0, 8),
        type: 'signature', x, y,
        width: w, height: h, src, page: pageIdx,
        color: S.sigColor,
    };
    S.pages[pageIdx].elements.push(el);
    const dom = placeElement(el, S.pages[pageIdx].editLayer);
    if (!S.editMode) setTool('select');
    selectEl(el, dom);
    pushUndo({ type: 'add', el, pageIdx });
    toast('Signature added');
}

// ─── Drawing ───
function setupDrawEvents(canvas, pageData) {
    const ctx = canvas.getContext('2d');
    let drawing = false, pts = [], activePointer = null;

    const localPt = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', e => {
        // Eraser mode: find and remove the clicked path
        if (S.tool === 'eraser') {
            const m = localPt(e);
            const hitIdx = pageData.paths.findIndex(p => {
                return p.points.some(pt => Math.abs(pt.x - m.x) < 12 && Math.abs(pt.y - m.y) < 12);
            });
            if (hitIdx >= 0) {
                pageData.paths.splice(hitIdx, 1);
                redrawPaths(pageData);
                markDirty();
                toast('Stroke removed');
            }
            return;
        }
        if (S.tool !== 'draw' && S.tool !== 'highlight') return;
        e.preventDefault();
        drawing = true;
        activePointer = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        pts = [localPt(e)];
    });
    canvas.addEventListener('pointermove', e => {
        if (!drawing) return;
        e.preventDefault();
        const isHighlight = S.tool === 'highlight';
        const strokeColor = isHighlight ? S.highlightColor : S.drawColor;
        const strokeWidth = isHighlight ? 18 : S.drawWidth;
        const strokeAlpha = isHighlight ? 0.3 : 1;
        const p = localPt(e);
        // Shift = one perfectly straight stroke, snapped to the dominant axis
        // (horizontal or vertical) measured from the stroke origin.
        if (e.shiftKey && pts.length) {
            const origin = pts[0];
            const dx = p.x - origin.x, dy = p.y - origin.y;
            const end = Math.abs(dx) >= Math.abs(dy)
                ? { x: p.x, y: origin.y }
                : { x: origin.x, y: p.y };
            pts = [origin, end];
            redrawPaths(pageData);           // clears whatever was drawn unconstrained
            ctx.beginPath();
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.globalAlpha = strokeAlpha;
            ctx.moveTo(origin.x, origin.y); ctx.lineTo(end.x, end.y); ctx.stroke();
            ctx.globalAlpha = 1;
            return;
        }
        pts.push(p);
        ctx.beginPath();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.globalAlpha = strokeAlpha;
        const prev = pts[pts.length - 2];
        ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = 1;
    });
    const endDraw = () => {
        if (!drawing) return;
        drawing = false;
        if (activePointer !== null) {
            try { canvas.releasePointerCapture(activePointer); } catch (_) {}
            activePointer = null;
        }
        if (pts.length > 1) {
            pageData.paths.push({
                id: crypto.randomUUID().slice(0, 8),
                points: [...pts],
                color: S.tool === 'highlight' ? S.highlightColor : S.drawColor,
                width: S.tool === 'highlight' ? 18 : S.drawWidth,
                alpha: S.tool === 'highlight' ? 0.3 : 1,
            });
            // Rebuild the canvas + expose the new stroke as a selectable object.
            redrawPaths(pageData);
            markDirty();
        }
        pts = [];
    };
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
}

function redrawPaths(pageData) {
    const ctx = pageData.drawLayer.getContext('2d');
    ctx.clearRect(0, 0, pageData.drawLayer.width, pageData.drawLayer.height);
    pageData.paths.forEach(p => {
        ctx.beginPath(); ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
        ctx.globalAlpha = p.alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        p.points.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
        ctx.stroke(); ctx.globalAlpha = 1;
    });
    syncStrokeOverlays(pageData);
}

// ─── Freehand / highlight strokes as selectable objects ───
// The strokes stay painted on the canvas (that is what the export reads), but a
// transparent hit-area is laid over each one so it can be selected, moved,
// resized, recoloured and deleted like any other element.
function _pathBounds(path) {
    const pts = path && path.points ? path.points : [];
    if (pts.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of pts) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    const pad = Math.max(2, (path.width || 2) / 2);
    return {
        x: minX - pad, y: minY - pad,
        w: Math.max(2, maxX - minX + pad * 2),
        h: Math.max(2, maxY - minY + pad * 2),
    };
}

function syncStrokeOverlays(pageData) {
    if (!pageData || !pageData.editLayer) return;
    const layer = pageData.editLayer;
    const pageIdx = S.pages.indexOf(pageData);
    const seen = new Set();
    (pageData.paths || []).forEach(path => {
        if (!path.id) path.id = crypto.randomUUID().slice(0, 8);
        const b = _pathBounds(path);
        if (!b) return;
        seen.add(path.id);
        let dom = layer.querySelector(`.el-stroke[data-stroke-id="${path.id}"]`);
        if (!dom) {
            dom = document.createElement('div');
            dom.className = 'el-stroke';
            dom.dataset.strokeId = path.id;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            hit.classList.add('stroke-hit');
            hit.setAttribute('fill', 'none');
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-linecap', 'round');
            hit.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(hit);
            dom.appendChild(svg);
            dom._strokeEl = {
                type: 'stroke', id: path.id, page: pageIdx, path,
                color: path.color, x: b.x, y: b.y, width: b.w, height: b.h,
            };
            dom.addEventListener('pointerdown', e => {
                if (!(S.tool === 'select' || S.editMode)) return;
                const strokeEl = dom._strokeEl;
                if (!strokeEl) return;
                e.stopPropagation();
                e.preventDefault();
                selectEl(strokeEl, dom);
                startDrag(e, strokeEl, dom);
            });
            addResizeHandles(dom, dom._strokeEl);
            layer.appendChild(dom);
        }
        const strokeEl = dom._strokeEl;
        Object.assign(strokeEl, {
            page: pageIdx, path, color: path.color,
            x: b.x, y: b.y, width: b.w, height: b.h,
        });
        dom.classList.toggle('selected', S.selected === strokeEl);
        dom.style.left = b.x + 'px'; dom.style.top = b.y + 'px';
        dom.style.width = b.w + 'px'; dom.style.height = b.h + 'px';
        const svg = dom.querySelector('svg');
        if (svg) svg.setAttribute('viewBox', `0 0 ${b.w} ${b.h}`);
        const hit = dom.querySelector('.stroke-hit');
        if (hit) {
            hit.setAttribute('points', path.points.map(pt => `${pt.x - b.x},${pt.y - b.y}`).join(' '));
            // Generous hit width: a 2 px stroke is otherwise impossible to grab.
            hit.setAttribute('stroke-width', String(Math.max(14, (path.width || 2) * 3)));
        }
    });
    layer.querySelectorAll('.el-stroke').forEach(node => {
        if (!seen.has(node.dataset.strokeId)) node.remove();
    });
    // The selected stroke was just erased/deleted from the paths array.
    if (S.selected && S.selected.type === 'stroke' && !seen.has(S.selected.id)) deselect();
}

// ─── Sample text color from rendered canvas ───
// For performance we read the page pixels ONCE per page (getImageData is expensive)
// and reuse that buffer for all per-item color sampling. To keep memory bounded we
// only keep ONE active pixel buffer at a time (pages are sampled sequentially).
const _pixelCache = new WeakMap();
let _activePixelCanvas = null;
// Read page pixels at a REDUCED resolution for color sampling. Text colors only
// need an approximate read (black/white/tinted), so sampling a downscaled version
// is dramatically faster + lighter than reading a full A4 canvas (~18MB).
const PIXEL_SAMPLE_W = 320;
function _getPixels(canvas) {
    if (_activePixelCanvas !== canvas) {
        _pixelCache.delete(_activePixelCanvas);
        _activePixelCanvas = canvas;
    }
    let e = _pixelCache.get(canvas);
    if (!e || e.srcW !== canvas.width || e.srcH !== canvas.height) {
        let data = null;
        const w = canvas.width, h = canvas.height;
        const scale = Math.min(1, PIXEL_SAMPLE_W / w);
        const sw = Math.max(1, Math.round(w * scale));
        const sh = Math.max(1, Math.round(h * scale));
        try {
            const tmp = document.createElement('canvas');
            tmp.width = sw; tmp.height = sh;
            const tctx = tmp.getContext('2d', { willReadFrequently: true });
            tctx.drawImage(canvas, 0, 0, sw, sh);
            data = tctx.getImageData(0, 0, sw, sh);
        } catch (_) {}
        e = { srcW: w, srcH: h, w: sw, h: sh, scale, img: data };
        _pixelCache.set(canvas, e);
    }
    return e;
}
function _pxAt(e, x, y) {
    if (!e.img) return null;
    const sx = Math.round(x * e.scale), sy = Math.round(y * e.scale);
    x = Math.max(0, Math.min(e.w - 1, sx));
    y = Math.max(0, Math.min(e.h - 1, sy));
    const i = (y * e.w + x) * 4;
    return [e.img.data[i], e.img.data[i + 1], e.img.data[i + 2], e.img.data[i + 3]];
}
function sampleBgColor(canvas, x, y, fontSize) {
    try {
        const e = _getPixels(canvas);
        // Sample pixels ABOVE the text area to get page background
        const sx = Math.round(x + fontSize * 0.5);
        const sy = Math.round(y) - 3;
        let bestR = 255, bestG = 255, bestB = 255, bestLum = 0;
        for (let dx = 0; dx < 5; dx++) {
            const px = _pxAt(e, sx + dx, sy);
            if (!px || px[3] < 128) continue;
            const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
            if (lum > bestLum) { bestR = px[0]; bestG = px[1]; bestB = px[2]; bestLum = lum; }
        }
        return '#' + [bestR, bestG, bestB].map(c => c.toString(16).padStart(2, '0')).join('');
    } catch { return '#ffffff'; }
}

// Background colour AROUND a vector object. Sampling its centre returned the
// object's own colour, so an erased object was repainted in its own colour and
// looked impossible to delete.
function sampleSurroundColor(canvas, x, y, w, h) {
    try {
        const e = _getPixels(canvas);
        const off = Math.max(4, Math.min(12, Math.min(w, h) * 0.35 + 4));
        const probes = [
            [x - off, y - off], [x + w + off, y - off],
            [x - off, y + h + off], [x + w + off, y + h + off],
            [x + w / 2, y - off], [x + w / 2, y + h + off],
            [x - off, y + h / 2], [x + w + off, y + h / 2],
        ];
        const counts = new Map();
        for (const [px, py] of probes) {
            const c = _pxAt(e, px, py);
            if (!c || c[3] < 128) continue;
            const hex = '#' + [c[0], c[1], c[2]].map(v => v.toString(16).padStart(2, '0')).join('');
            counts.set(hex, (counts.get(hex) || 0) + 1);
        }
        if (!counts.size) return '#ffffff';
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    } catch { return '#ffffff'; }
}

function sampleTextColor(canvas, x, y, fontSize) {
    try {
        const e = _getPixels(canvas);
        // Sample a few pixels near the text baseline for a reliable read
        const sx = Math.round(x + fontSize * 0.3);
        const sy = Math.round(y + fontSize * 0.65);
        // Pick the darkest non-white pixel (text is typically darker than background)
        let bestR = 255, bestG = 255, bestB = 255, bestLum = 999;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const px = _pxAt(e, sx + dx, sy + dy);
                if (!px || px[3] < 128) continue;
                const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
                if (lum < bestLum) { bestR = px[0]; bestG = px[1]; bestB = px[2]; bestLum = lum; }
            }
        }
        // If all sampled pixels are very light (white bg), default to black
        if (bestLum > 240) return '#000000';
        return '#' + [bestR, bestG, bestB].map(c => c.toString(16).padStart(2, '0')).join('');
    } catch { return '#000000'; }
}

// ─── Extract simple vector objects from imported PDF pages ───
// pdf.js consolidates path commands into constructPath. We intentionally expose
// only isolated straight lines and axis-aligned rectangles: arbitrary compound
// paths often represent glyphs, clipping masks or entire illustrations.
async function extractPageGraphics(pdfJsPage, viewport, pageIdx, editLayer, pageData) {
    try {
        const operatorList = await pdfJsPage.getOperatorList();
        const OPS = pdfjsLib.OPS;
        const vt = viewport.transform;
        let ctm = [1, 0, 0, 1, 0, 0];
        let lineWidth = 1;
        let strokeColor = '#000000';
        let fillColor = '#000000';
        const stateStack = [];
        const MAX_GRAPHICS = 600;

        const multiply = (a, b) => [
            a[0]*b[0] + a[2]*b[1], a[1]*b[0] + a[3]*b[1],
            a[0]*b[2] + a[2]*b[3], a[1]*b[2] + a[3]*b[3],
            a[0]*b[4] + a[2]*b[5] + a[4], a[1]*b[4] + a[3]*b[5] + a[5],
        ];
        const transformPoint = (m, x, y) => ({
            x: m[0]*x + m[2]*y + m[4],
            y: m[1]*x + m[3]*y + m[5],
        });
        const toHex = values => {
            const channels = Array.from(values).slice(0, 3).map(value => {
                const numeric = Number(value) || 0;
                return Math.max(0, Math.min(255, Math.round(numeric <= 1 ? numeric * 255 : numeric)));
            });
            return '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('');
        };
        const grayHex = value => toHex([value, value, value]);
        const cmykHex = values => {
            const [c, m, y, k] = Array.from(values).map(value => Math.max(0, Math.min(1, Number(value) || 0)));
            return toHex([(1-c)*(1-k), (1-m)*(1-k), (1-y)*(1-k)]);
        };
        const painting = new Map([
            [OPS.stroke, { stroked: true, filled: false }],
            [OPS.closeStroke, { stroked: true, filled: false }],
            [OPS.fill, { stroked: false, filled: true }],
            [OPS.eoFill, { stroked: false, filled: true }],
            [OPS.fillStroke, { stroked: true, filled: true }],
            [OPS.eoFillStroke, { stroked: true, filled: true }],
            [OPS.closeFillStroke, { stroked: true, filled: true }],
            [OPS.closeEOFillStroke, { stroked: true, filled: true }],
        ]);

        // ── Path capture ──
        // pdf.js hands us one `constructPath` operator per painted path, with every
        // subpath in it. We now keep them ALL (lines, rectangles, polylines and
        // flattened beziers) instead of only isolated straight lines: block
        // outlines, dashed frames and rules drawn as thin filled rectangles used to
        // be invisible to the selection layer.
        let subpaths = [];
        const flattenCubic = (from, c1, c2, to, steps = 10) => {
            const out = [];
            for (let i = 1; i <= steps; i++) {
                const t = i / steps, u = 1 - t;
                out.push({
                    x: u*u*u*from.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*to.x,
                    y: u*u*u*from.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*to.y,
                });
            }
            return out;
        };

        // Painted a path: turn the captured subpaths into one selectable object.
        const flushPath = paint => {
            const raw = subpaths;
            subpaths = [];
            if (!raw.length) return;
            const count = pageData.elements.filter(el => el.type === 'pdf-graphic').length;
            if (count >= MAX_GRAPHICS) return;

            const pdfSubpaths = [];
            const viewSubpaths = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const sp of raw) {
                if (!sp.points || sp.points.length < 2) continue;
                if (sp.points.length > 4000) continue;
                const pdfPts = sp.points.map(pt => transformPoint(ctm, pt.x, pt.y));
                const viewPts = pdfPts.map(pt => transformPoint(vt, pt.x, pt.y));
                for (const p of viewPts) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                }
                pdfSubpaths.push(pdfPts);
                viewSubpaths.push(viewPts);
            }
            if (!pdfSubpaths.length || !Number.isFinite(minX)) return;

            const rawW = maxX - minX, rawH = maxY - minY;
            // Ignore the full-page background/clip fill and invisible specks, but keep
            // long-and-thin rules (often < 1 px tall) and one-point ticks are dropped.
            if ((rawW * rawH) / Math.max(1, viewport.width * viewport.height) > 0.90) return;
            const thinRule = (rawH <= 8 && rawW >= 24) || (rawW <= 8 && rawH >= 24);
            if (rawW < 3 && rawH < 3) return;
            if (!thinRule && (rawW < 4 || rawH < 4)) return;
            if (paint.stroked && !paint.filled && Math.hypot(rawW, rawH) < 8) return;

            const fillHex = fillColor;
            const strokeHex = strokeColor;
            const color = paint.stroked ? strokeHex : fillHex;
            // Some PDFs paint the same object twice (shadow pass, duplicated content).
            // Without this the user had to delete stacked copies one by one.
            // The signature itself is computed by the Rust core (pdfyz-model) so the
            // de-duplication rule lives in one place; the JavaScript form below is
            // the reference it is parity-checked against.
            const sig = Kernel.graphicSignature({
                stroked: paint.stroked, filled: paint.filled, color,
                lineWidth, minX, minY, width: rawW, height: rawH,
                subpaths: pdfSubpaths.length, firstLength: pdfSubpaths[0].length,
            }) || [
                paint.stroked ? 's' : '', paint.filled ? 'f' : '', color,
                Math.round(lineWidth * 10),
                Math.round(minX), Math.round(minY), Math.round(rawW), Math.round(rawH),
                pdfSubpaths.length, pdfSubpaths[0].length,
            ].join('|');
            if (!pageData._graphicSigs) pageData._graphicSigs = new Set();
            if (pageData._graphicSigs.has(sig)) return;
            pageData._graphicSigs.add(sig);

            const el = {
                id: crypto.randomUUID().slice(0, 8), type: 'pdf-graphic', extracted: true,
                graphicKind: 'path',
                x: minX, y: minY,
                width: Math.max(6, rawW), height: Math.max(6, rawH),
                originalViewX: minX, originalViewY: minY,
                pdfSubpaths, pdfLineWidth: lineWidth,
                screenLineWidth: Math.max(1, lineWidth * _renderS()),
                stroked: paint.stroked, filled: paint.filled,
                color, originalColor: color,
                fillColor: fillHex, strokeColor: strokeHex,
                // Sampled AROUND the object: sampling its centre returned the object's
                // own colour, so "delete" repainted it in its own colour and the object
                // looked impossible to remove.
                bgColor: sampleSurroundColor(pageData.canvas, minX, minY, rawW, rawH),
                page: pageIdx,
                _sig: sig,
            };
            pageData.elements.push(el);
            placeElement(el, editLayer);
        };

        for (let index = 0; index < operatorList.fnArray.length; index++) {
            const fn = operatorList.fnArray[index];
            const args = operatorList.argsArray[index] || [];
            if (fn === OPS.save) {
                stateStack.push({ ctm: ctm.slice(), lineWidth, strokeColor, fillColor });
            } else if (fn === OPS.restore) {
                const state = stateStack.pop();
                if (state) ({ ctm, lineWidth, strokeColor, fillColor } = state);
            } else if (fn === OPS.transform) {
                ctm = multiply(ctm, args);
            } else if (fn === OPS.setLineWidth) {
                lineWidth = Math.max(0.1, Number(args[0]) || 1);
            } else if (fn === OPS.setStrokeRGBColor) {
                strokeColor = toHex(args);
            } else if (fn === OPS.setFillRGBColor) {
                fillColor = toHex(args);
            } else if (fn === OPS.setStrokeGray) {
                strokeColor = grayHex(args[0]);
            } else if (fn === OPS.setFillGray) {
                fillColor = grayHex(args[0]);
            } else if (fn === OPS.setStrokeCMYKColor) {
                strokeColor = cmykHex(args);
            } else if (fn === OPS.setFillCMYKColor) {
                fillColor = cmykHex(args);
            } else if (fn === OPS.constructPath) {
                subpaths = [];
                const commands = args[0] || [];
                const coordinates = args[1] || [];
                let cursor = 0;
                let current = null;
                const startSubpath = pt => {
                    current = { points: [pt], closed: false };
                    subpaths.push(current);
                };
                const addPoint = pt => {
                    if (!current) { startSubpath(pt); return; }
                    const last = current.points[current.points.length - 1];
                    if (last && Math.abs(last.x - pt.x) < 0.001 && Math.abs(last.y - pt.y) < 0.001) return;
                    current.points.push(pt);
                };
                for (const command of commands) {
                    if (command === OPS.moveTo) {
                        startSubpath({ x: coordinates[cursor++], y: coordinates[cursor++] });
                    } else if (command === OPS.lineTo) {
                        addPoint({ x: coordinates[cursor++], y: coordinates[cursor++] });
                    } else if (command === OPS.rectangle) {
                        const x = coordinates[cursor++], y = coordinates[cursor++];
                        const w = coordinates[cursor++], h = coordinates[cursor++];
                        subpaths.push({
                            points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }],
                            closed: true,
                        });
                        current = null;
                    } else if (command === OPS.closePath) {
                        if (current && current.points.length > 2) {
                            const first = current.points[0];
                            addPoint({ x: first.x, y: first.y });
                            current.closed = true;
                        }
                        current = null;
                    } else if (command === OPS.curveTo) {
                        const c1 = { x: coordinates[cursor++], y: coordinates[cursor++] };
                        const c2 = { x: coordinates[cursor++], y: coordinates[cursor++] };
                        const to = { x: coordinates[cursor++], y: coordinates[cursor++] };
                        if (current) {
                            const from = current.points[current.points.length - 1];
                            flattenCubic(from, c1, c2, to).forEach(addPoint);
                        }
                    } else if (command === OPS.curveTo2 || command === OPS.curveTo3) {
                        // curveTo2(control2, end): the first control point is the current point
                        // curveTo3(control1, end): the second control point repeats the end point
                        const a = { x: coordinates[cursor++], y: coordinates[cursor++] };
                        const b = { x: coordinates[cursor++], y: coordinates[cursor++] };
                        if (current) {
                            const from = current.points[current.points.length - 1];
                            const c1 = command === OPS.curveTo2 ? from : a;
                            const c2 = command === OPS.curveTo2 ? a : b;
                            flattenCubic(from, c1, c2, b).forEach(addPoint);
                        }
                    }
                }
            } else if (painting.has(fn)) {
                flushPath(painting.get(fn));
            } else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
                subpaths = [];
            }
        }
    } catch (error) {
        console.warn('Graphic extraction failed:', error);
    }
}

// ─── Extract embedded images from PDF page ───
// We deliberately skip stencil / mask XObjects (1-bit SMask data used to render
// vector text & shapes) and keep only genuine raster images above a minimum size,
// so that the PDF keeps its vector / text / object mode and no zone is transcribed
// into a raster clone.
async function extractPageImages(pdfJsPage, viewport, pageIdx, editLayer, pageData, onSubProgress) {
    try {
        const ops = await pdfJsPage.getOperatorList();
        const OPS = pdfjsLib.OPS;
        const vt = viewport.transform;
        // Track current transform matrix (CTM) stack
        let ctm = [1, 0, 0, 1, 0, 0];
        const ctmStack = [];
        const MIN_IMG_SIZE = 20; // ignore tiny decorative images
        const MIN_IMG_AREA = 60 * 60; // ignore very small raster spots

        function multiplyMatrix(a, b) {
            return [
                a[0]*b[0] + a[2]*b[1], a[1]*b[0] + a[3]*b[1],
                a[0]*b[2] + a[2]*b[3], a[1]*b[2] + a[3]*b[3],
                a[0]*b[4] + a[2]*b[5] + a[4], a[1]*b[4] + a[3]*b[5] + a[5]
            ];
        }

        const opCount = ops.fnArray.length;
        let imgCount = 0;
        for (let i = 0; i < opCount; i++) {
            const fn = ops.fnArray[i];
            const args = ops.argsArray[i];
            if (fn === OPS.save) { ctmStack.push(ctm.slice()); continue; }
            if (fn === OPS.restore) { ctm = ctmStack.pop() || [1,0,0,1,0,0]; continue; }
            if (fn === OPS.transform) { ctm = multiplyMatrix(ctm, args); continue; }
            if (fn === OPS.paintImageXObject || fn === OPS.paintJpegImageXObject) {
                // ctm maps the unit square [0,0]-[1,1] to page space
                const w = Math.sqrt(ctm[0]*ctm[0] + ctm[1]*ctm[1]);
                const h = Math.sqrt(ctm[2]*ctm[2] + ctm[3]*ctm[3]);
                if (w < MIN_IMG_SIZE || h < MIN_IMG_SIZE) continue; // skip tiny images
                if (w * h < MIN_IMG_AREA) continue;                  // skip tiny spots
                // PDF origin bottom-left: image at (ctm[4], ctm[5]) is bottom-left corner
                const pdfX = ctm[4], pdfY = ctm[5] + h; // top-left in PDF coords
                // Convert to viewport coordinates
                const vx = vt[0]*pdfX + vt[2]*pdfY + vt[4];
                const vy = vt[1]*pdfX + vt[3]*pdfY + vt[5];
                const vw = w * Math.abs(vt[0]); // scale width
                const vh = h * Math.abs(vt[3]); // scale height
                if (vw < MIN_IMG_SIZE || vh < MIN_IMG_SIZE) continue;

                // Extract image data from the canvas at this position
                const canvas = pageData.canvas;
                const sx = Math.max(0, Math.round(vx));
                const sy = Math.max(0, Math.round(vy));
                const sw = Math.min(Math.round(vw), canvas.width - sx);
                const sh = Math.min(Math.round(vh), canvas.height - sy);
                let thumbSrc = '';
                try {
                    const tmpC = document.createElement('canvas');
                    tmpC.width = sw; tmpC.height = sh;
                    tmpC.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                    thumbSrc = tmpC.toDataURL('image/png');
                } catch(_) {}

                const el = {
                    id: crypto.randomUUID().slice(0, 8),
                    type: 'pdf-image',
                    extracted: true,
                    x: vx, y: vy, width: vw, height: vh,
                    src: thumbSrc,
                    pdfImgName: args[0],
                    pdfX: ctm[4], pdfY: ctm[5], pdfW: w, pdfH: h,
                    originalViewX: vx, originalViewY: vy,
                    originalViewWidth: vw, originalViewHeight: vh,
                    opacity: 100, page: pageIdx,
                };
                pageData.elements.push(el);
                placeElement(el, editLayer);
                imgCount++;
                if (imgCount % 4 === 0) {
                    if (typeof onSubProgress === 'function') {
                        try { onSubProgress(i + 1, opCount); } catch (_) {}
                    }
                    await _uiYield();
                }
            }
        }
        if (typeof onSubProgress === 'function') {
            try { onSubProgress(opCount, opCount); } catch (_) {}
        }
    } catch(e) { console.warn('Image extraction failed:', e); }
}

// ─── Extract text from PDF pages for editing ───
async function extractPageText(pdfJsPage, viewport, pageIdx, editLayer, pageData, onSubProgress) {
    try {
        const textContent = await pdfJsPage.getTextContent();
        const styles = textContent.styles || {};
        const vt = viewport.transform;
        const _s = _renderS();

        // 1. Parse all text items
        const items = [];
        const fontsToLoad = new Set(); // track Google Fonts we need to preload
        const rawItems = textContent.items;
        const totalItems = rawItems.length;
        for (let ii = 0; ii < rawItems.length; ii++) {
            const item = rawItems[ii];
            if (!item.str || !item.str.trim()) continue;
            const t = item.transform;
            const pdfX = t[4], pdfY = t[5];
            const pdfFontSize = Math.sqrt(t[2]*t[2] + t[3]*t[3]) || Math.abs(t[0]) || 12;
            const cx = vt[0]*pdfX + vt[2]*pdfY + vt[4];
            const cy = vt[1]*pdfX + vt[3]*pdfY + vt[5];
            const fontSize = pdfFontSize * _s;
            const style = styles[item.fontName] || {};
            // pdf.js hands us an INTERNAL font id (e.g. "g_d0_f1"); the real
            // PostScript name ("IBMPlexSans-SemiBold-1659") lives in commonObjs.
            // Without this the app can NEVER match the document's typography.
            let realFontName = '';
            try {
                const fo = pdfJsPage.commonObjs && pdfJsPage.commonObjs.get
                    ? pdfJsPage.commonObjs.get(item.fontName) : null;
                if (fo && fo.name) realFontName = String(fo.name).replace(/-\d+$/, '');
            } catch (_) {}
            if (!realFontName && style.fontFamily
                && !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(style.fontFamily)) {
                realFontName = style.fontFamily;
            }
            const detected = detectFont(realFontName || item.fontName, realFontName ? null : style.fontFamily);
            // Track Google Fonts for preloading
            if (detected.font.startsWith('gf:')) fontsToLoad.add(detected.font.slice(3));
            items.push({
                str: item.str, x: cx, y: cy - fontSize,
                fontSize, width: item.width * _s,
                pdfX, pdfY, pdfFontSize,
                font: detected.font, originalFont: detected.originalFont,
                systemFont: detected.systemFont,
                bold: detected.weight >= 600,
                italic: detected.italic,
                weight: detected.weight,
                color: sampleTextColor(pageData.canvas, cx, cy - fontSize, fontSize),
                bgColor: sampleBgColor(pageData.canvas, cx, cy - fontSize, fontSize),
            });
            // Yield + report progress every 80 items so the splash bar can repaint
            // (sampleTextColor/sampleBgColor read pixels and are the bottleneck on big pages).
            if (totalItems > 200 && (ii % 80) === 79) {
                if (typeof onSubProgress === 'function') {
                    try { onSubProgress(ii + 1, totalItems); } catch (_) {}
                }
                await _uiYield();
            }
        }
        if (typeof onSubProgress === 'function') {
            try { onSubProgress(totalItems, totalItems); } catch (_) {}
        }
        if (!items.length) return;

        // 2. Group into lines (same Y position)
        items.sort((a, b) => a.y - b.y);
        const rawLines = [];
        let curLine = null;
        for (const it of items) {
            if (!curLine || Math.abs(it.y - curLine.y) > it.fontSize * 0.5) {
                curLine = { items: [it], y: it.y, fontSize: it.fontSize };
                rawLines.push(curLine);
            } else {
                curLine.items.push(it);
            }
        }

        // Split lines at large horizontal gaps (prevents table cells / header+page# from merging)
        const lines = [];
        for (const rl of rawLines) {
            rl.items.sort((a, b) => a.x - b.x);
            let seg = [rl.items[0]];
            for (let j = 1; j < rl.items.length; j++) {
                const prev = rl.items[j - 1];
                const cur = rl.items[j];
                const gap = cur.x - (prev.x + prev.width);
                if (gap > cur.fontSize * 3) {
                    lines.push({ items: seg, y: rl.y, fontSize: rl.fontSize });
                    seg = [cur];
                } else {
                    seg.push(cur);
                }
            }
            lines.push({ items: seg, y: rl.y, fontSize: rl.fontSize });
        }

        // Build line data
        for (const line of lines) {
            line.items.sort((a, b) => a.x - b.x);
            let text = '';
            for (let j = 0; j < line.items.length; j++) {
                if (j > 0) {
                    const gap = line.items[j].x - (line.items[j-1].x + line.items[j-1].width);
                    if (gap > line.items[j].fontSize * 0.15) text += ' ';
                }
                text += line.items[j].str;
            }
            line.text = text;
            const first = line.items[0], last = line.items[line.items.length - 1];
            line.x = first.x;
            line.width = (last.x + last.width) - first.x;
            line.pdfX = first.pdfX;
            line.pdfY = first.pdfY;
            line.pdfFontSize = first.pdfFontSize;
            line.pdfWidth = (last.pdfX + (last.width / _s)) - first.pdfX;
            line.font = first.font;
            line.originalFont = first.originalFont;
            line.systemFont = first.systemFont;
            line.bold = first.bold;
            line.italic = first.italic;
            line.color = first.color;
            line.bgColor = first.bgColor;
            line.weight = first.weight;
        }

        // 3. Group lines into paragraphs
        // Lines belong to the same paragraph if:
        //   - Similar font size (within 15%)
        //   - Similar left alignment (within 2× fontSize)
        //   - Line spacing is normal (gap < 1.8× fontSize)
        const paragraphs = [];
        let curPara = null;
        for (const line of lines) {
            if (!line.text.trim()) continue;
            if (!curPara) {
                curPara = { lines: [line] };
                paragraphs.push(curPara);
                continue;
            }
            const prevLine = curPara.lines[curPara.lines.length - 1];
            const sameSize = Math.abs(line.fontSize - prevLine.fontSize) / prevLine.fontSize < 0.12;
            const sameAlign = Math.abs(line.x - prevLine.x) < prevLine.fontSize * 0.6;
            // Tight line spacing: lines of the same paragraph sit immediately below
            // each other. A larger gap (e.g. a blank line or paragraph break) splits.
            const lineGap = line.y - prevLine.y;
            const tightSpacing = lineGap < prevLine.fontSize * 1.6 && lineGap > 0;
            const sameFont = line.font === prevLine.font;
            const widthRatio = Math.min(line.width, prevLine.width) / Math.max(line.width, prevLine.width);
            const similarWidth = widthRatio > 0.4;

            if (sameSize && sameAlign && tightSpacing && sameFont && similarWidth) {
                curPara.lines.push(line);
            } else {
                curPara = { lines: [line] };
                paragraphs.push(curPara);
            }
        }

        // 4. Create one element per paragraph
        for (const para of paragraphs) {
            const pLines = para.lines;
            const first = pLines[0];
            const text = pLines.map(l => l.text).join('\n');
            if (!text.trim()) continue;
            const maxW = Math.max(...pLines.map(l => l.width));
            const lastLine = pLines[pLines.length - 1];
            // Tight height: line span + one line-height of the last line. Keeps
            // hit-areas snug so adjacent blocks don't overlap for selection.
            const totalH = (lastLine.y - first.y) + lastLine.fontSize * 1.15;

            // Store per-line PDF coordinates for precise export
            const pdfLines = pLines.map(l => ({
                pdfX: l.pdfX, pdfY: l.pdfY,
                pdfFontSize: l.pdfFontSize, pdfWidth: l.pdfWidth,
                text: l.text,
            }));

            const el = {
                id: crypto.randomUUID().slice(0, 8),
                type: 'text', extracted: true,
                originalContent: text, content: text,
                x: first.x, y: first.y,
                width: maxW + 4,
                height: totalH,
                fontSize: first.fontSize,
                font: first.font, originalFont: first.originalFont,
                systemFont: first.systemFont,
                color: first.color || '#000000',
                originalColor: first.color || '#000000',
                bgColor: first.bgColor || '#ffffff',
                bold: first.bold, italic: first.italic,
                weight: first.weight,
                page: pageIdx,
                pdfX: first.pdfX, pdfY: first.pdfY,
                pdfFontSize: first.pdfFontSize,
                pdfWidth: Math.max(...pLines.map(l => l.pdfWidth)),
                pdfLines: pdfLines,
            };
            pageData.elements.push(el);
            placeElement(el, editLayer);
        }
        // Preload detected Google Fonts in background (for editing readiness)
        if (fontsToLoad.size) {
            for (const name of fontsToLoad) {
                loadGoogleFont(name).then(entry => {
                    if (entry) ensureFontInSelect('gf:' + name, name);
                }).catch(() => {});
            }
        }
        // Brief flash to show editable areas, then fade
        setTimeout(() => {
            editLayer.querySelectorAll('.el-text.extracted').forEach(d => d.classList.add('text-reveal'));
            setTimeout(() => {
                editLayer.querySelectorAll('.el-text.extracted.text-reveal').forEach(d => {
                    d.classList.remove('text-reveal');
                });
            }, 100);
        }, 300);
    } catch(e) { console.warn('Text extraction failed:', e); }
}
// ─── Undo/Redo (snapshot-based, covers every edit) ───
// Instead of a bespoke action per mutation (which silently missed deletes, moves,
// resizes, drawing, text edits…), we snapshot the editable state and diff it.
// Heavy binary fields (data-URL `src`) are shared by reference between snapshots.
function _cloneEl(el) {
    const c = {};
    for (const k in el) c[k] = el[k];
    if (Array.isArray(el.pdfLines)) c.pdfLines = el.pdfLines.map(l => ({ ...l }));
    return c;
}
function _snapshotPages() {
    return S.pages.map(p => p ? {
        elements: p.elements.map(_cloneEl),
        paths: p.paths.map(pa => ({ ...pa, points: (pa.points || []).map(pt => ({ ...pt })) })),
    } : null);
}
// Cheap change signature. Long strings (base64 images) are represented by their
// length only, so we never stringify megabytes on every keystroke.
function _stateSig() {
    try {
        return JSON.stringify(
            S.pages.map(p => p ? { e: p.elements, p: p.paths } : null),
            (k, v) => {
                // Vector geometry is immutable per element (only x/y/color/deleted
                // change) and can hold hundreds of points — keep the signature cheap.
                if (k === 'pdfSubpaths' || k === 'pdfPoints') return '#';
                return (typeof v === 'string' && v.length > 96) ? ('#' + v.length) : v;
            }
        );
    } catch (_) { return null; }
}
const HISTORY_MAX = 40;
let _histTimer = null;
S._histSnap = null;
S._histSig = null;

function _updateUndoButtons() {
    const hasUndo = !!(S.undoStack && S.undoStack.length);
    const hasRedo = !!(S.redoStack && S.redoStack.length);
    if ($('btnUndo')) $('btnUndo').disabled = !hasUndo;
    if ($('btnRedo')) $('btnRedo').disabled = !hasRedo;
    if ($('mobileUndo')) $('mobileUndo').disabled = !hasUndo;
    if ($('mobileRedo')) $('mobileRedo').disabled = !hasRedo;
}

// Baseline: called after a document is (re)loaded so the freshly extracted
// elements are NOT undoable, and the stacks start empty.
function resetHistory() {
    S.undoStack = []; S.redoStack = [];
    S._histSnap = _snapshotPages();
    S._histSig = _stateSig();
    clearTimeout(_histTimer); _histTimer = null;
    _updateUndoButtons();
}

// Capture a new history entry if the editable state actually changed.
function commitHistory() {
    if (S._restoringHistory || !S.pages || !S.pages.length) return;
    if (S._histSnap === null) { resetHistory(); return; }
    const sig = _stateSig();
    if (sig === null || sig === S._histSig) return;
    S.undoStack.push(S._histSnap);
    if (S.undoStack.length > HISTORY_MAX) S.undoStack.shift();
    S._histSnap = _snapshotPages();
    S._histSig = sig;
    S.redoStack = [];
    _updateUndoButtons();
}
function _scheduleHistory() {
    if (S._restoringHistory) return;
    clearTimeout(_histTimer);
    _histTimer = setTimeout(() => { _histTimer = null; commitHistory(); }, 350);
}
function _flushHistory() {
    if (_histTimer) { clearTimeout(_histTimer); _histTimer = null; commitHistory(); }
}

// Kept for backward-compatibility with existing call sites: an edit just happened.
function pushUndo() { commitHistory(); }

function _applySnapshot(snap) {
    if (!snap) return;
    S._restoringHistory = true;
    try {
        snap.forEach((st, i) => {
            const pd = S.pages[i];
            if (!pd || !st) return;
            pd.elements = st.elements.map(_cloneEl);
            pd.paths = st.paths.map(pa => ({ ...pa, points: (pa.points || []).map(pt => ({ ...pt })) }));
            pd.editLayer.innerHTML = '';
            pd.elements.forEach(el => { if (!el._deleted) placeElement(el, pd.editLayer); });
            redrawPaths(pd);
        });
    } finally {
        S._restoringHistory = false;
    }
    deselect();
}

$('btnUndo').onclick = () => {
    _flushHistory();
    if (!S.undoStack.length) return;
    const cur = _snapshotPages();
    const prev = S.undoStack.pop();
    _applySnapshot(prev);
    S.redoStack.push(cur);
    S._histSnap = _snapshotPages();
    S._histSig = _stateSig();
    _updateUndoButtons();
    markDirty();
};
$('btnRedo').onclick = () => {
    if (!S.redoStack.length) return;
    const cur = _snapshotPages();
    const next = S.redoStack.pop();
    _applySnapshot(next);
    S.undoStack.push(cur);
    S._histSnap = _snapshotPages();
    S._histSig = _stateSig();
    _updateUndoButtons();
    markDirty();
};
_updateUndoButtons();

// ─── Delete ───
function deleteSelected() {
    if (!S.selected) return;
    const el = S.selected;
    if (el.type === 'stroke') {
        const pd = S.pages[el.page];
        const idx = pd?.paths ? pd.paths.indexOf(el.path) : -1;
        if (idx >= 0) pd.paths.splice(idx, 1);
        if (S.selectedDOM) S.selectedDOM.remove();
        if (pd) redrawPaths(pd);
        deselect(); markDirty(); return;
    }
    if (el.extracted || el.type === 'pdf-image' || el.type === 'pdf-graphic') {
        el.content = '';
        el._deleted = true;
        syncNativePreview(el);
        if (S.selectedDOM) S.selectedDOM.remove();
        deselect(); markDirty(); return;
    }
    const elems = S.pages[el.page].elements;
    const idx = elems.findIndex(e => e.id === el.id);
    if (idx >= 0) elems.splice(idx, 1);
    if (S.selectedDOM) S.selectedDOM.remove();
    deselect();
    markDirty();
}
$('propDelete').onclick = deleteSelected;
$('propMove').onclick = () => {
    if (!S.selectedDOM) return;
    S.selectedDOM.classList.add('selected');
    toast('Drag the block to move it');
};
$('propEditText').onclick = () => {
    if (!S.selected || S.selected.type !== 'text') return;
    openTextPanel(S.selected);
};

// ─── Properties bindings ───
$('propFont').onchange = () => {};
$('propSize').oninput = () => {};
$('propColor').oninput = () => {
    if (!S.selected) return;
    colorizeElement(S.selected, $('propColor').value);
};
$('propBold').onclick = () => {};
$('propItalic').onclick = () => {};

// ─── Text Editor Panel ───
S.editingText = null;

function syncTextToDOM(el) {
    const dom = S.pages[el.page]?.editLayer.querySelector(`[data-id="${el.id}"]`);
    if (!dom) return;
    const span = dom.querySelector('.el-text-content');
    // Only update textContent when NOT actively inline-editing (avoids cursor jump)
    if (span && !dom.classList.contains('inline-edit')) {
        span.textContent = el.content || '\u00A0';
    }
    dom.style.fontSize = el.fontSize + 'px';
    dom.style.color = el.color;
    dom.style.fontFamily = getCSSFamily(el.font, el.systemFont);
    dom.style.fontWeight = el.weight || (el.bold ? 700 : 400);
    dom.style.fontStyle = el.italic ? 'italic' : 'normal';
    dom.style.textAlign = el.align || 'left';
    if (el.extracted) {
        const isModified = el.content !== el.originalContent || el.color !== el.originalColor || el._moved;
        if (isModified) {
            dom.classList.add('modified');
            if (span) {
                span.style.background = el.bgColor || '#ffffff';
                span.style.color = el.color || '#000000';
            }
        } else {
            dom.classList.remove('modified');
            if (span) {
                span.style.background = '';
                span.style.color = '';
            }
        }
        syncNativePreview(el);
    }
    // Update preview if panel is open for this element
    if (S.editingText === el) {
        const prev = $('teFontPreview');
        prev.style.fontFamily = getCSSFamily(el.font, el.systemFont);
        prev.style.fontWeight = el.weight || (el.bold ? 700 : 400);
        prev.style.fontStyle = el.italic ? 'italic' : 'normal';
    }
    // Sync floating textarea style if inline editing this element
    if (S._inlineEditTA && S._inlineEditEl === el) {
        const ta = S._inlineEditTA;
        ta.style.fontSize = el.fontSize + 'px';
        ta.style.fontFamily = getCSSFamily(el.font, el.systemFont);
        ta.style.fontWeight = el.weight || (el.bold ? 700 : 400);
        ta.style.fontStyle = el.italic ? 'italic' : 'normal';
        ta.style.color = el.color;
        ta.style.background = el.bgColor || '#ffffff';
        ta.style.textAlign = el.align || 'left';
    }
}

// Start inline editing on extracted text — floating textarea overlay (Adobe-style)
function startInlineEdit(el, dom) {
    // End any previous inline edit
    endInlineEdit();

    // Hide the original text overlay
    dom.classList.add('inline-edit');

    // Create a floating textarea positioned exactly over the element
    const layer = dom.parentElement; // edit-layer
    const ta = document.createElement('textarea');
    ta.className = 'pdfz-inline-textarea';
    ta.value = el.content || '';
    // Position textarea to align with extracted text (account for .el-text padding: 1px)
    ta.style.left = (el.x - 1) + 'px';
    ta.style.top = (el.y - 1) + 'px';
    // Width: match DOM element width, constrain to page edge
    const domW = dom.offsetWidth || el.width || 120;
    const layerW = layer.offsetWidth || layer.clientWidth || 800;
    const maxW = layerW - el.x + 4;
    ta.style.width = Math.min(Math.max(domW + 8, 80), maxW) + 'px';
    ta.style.minHeight = Math.max((el.height || el.fontSize * 1.5) + 6, 24) + 'px';
    ta.style.fontSize = el.fontSize + 'px';
    ta.style.fontFamily = getCSSFamily(el.font, el.systemFont);
    ta.style.fontWeight = el.weight || (el.bold ? 700 : 400);
    ta.style.fontStyle = el.italic ? 'italic' : 'normal';
    ta.style.color = el.color || '#000000';
    ta.style.textAlign = el.align || 'left';
    // Blend with the page instead of flashing an opaque white box: text sitting
    // on a coloured background used to look erased the moment you clicked it.
    ta.style.background = el.bgColor || '#ffffff';
    layer.appendChild(ta);

    // Focus with a tiny delay to ensure paint is complete
    requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    });

    // Auto-resize height as user types (skipped once user manually resizes)
    const autoResize = () => {
        if (ta._userResized) return;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    };
    requestAnimationFrame(autoResize);

    // Detect manual resize via the bottom-right native grip.
    // Once the user drags it, stop auto-shrinking and persist their dimensions.
    ta._userResized = false;
    ta.addEventListener('mousedown', (ev) => {
        const r = ta.getBoundingClientRect();
        // Native resize handle is the bottom-right ~16x16 corner.
        if (ev.clientX >= r.right - 18 && ev.clientY >= r.bottom - 18) {
            ta._userResized = true;
        }
    });

    // Input handler — sync changes
    ta._inputHandler = () => {
        el.content = ta.value;
        if (el.extracted) {
            if (el.content !== el.originalContent) dom.classList.add('modified');
            else dom.classList.remove('modified');
            syncNativePreview(el);
        }
        // Sync the panel textarea mirror
        if (S.editingText === el) $('teTextarea').value = el.content;
        autoResize();
        // An empty content is never kept (endInlineEdit drops the block), so it must
        // not become a history step — otherwise one Ctrl+Z would only restore
        // an empty box instead of the original text.
        if (String(el.content || '').trim()) commitProvisionalText(el);
    };
    ta.addEventListener('input', ta._inputHandler);

    // Keyboard handling
    ta._keyHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            endInlineEdit();
            closeTextPanel();
        }
        // Prevent global shortcuts from firing while typing
        e.stopPropagation();
    };
    ta.addEventListener('keydown', ta._keyHandler);

    // Prevent clicks on textarea from bubbling to editLayer
    ta.addEventListener('mousedown', (e) => e.stopPropagation());

    // Store refs
    S._inlineEditDOM = dom;
    S._inlineEditTA = ta;
    S._inlineEditEl = el;
}

function endInlineEdit() {
    if (!S._inlineEditDOM) return;
    const dom = S._inlineEditDOM;
    const ta = S._inlineEditTA;
    const el = S._inlineEditEl;

    // Save final content from textarea
    if (ta && el) {
        el.content = ta.value;
        // Persist user-resized dimensions back to the element so the
        // text block keeps the new (larger) bounding box after editing.
        if (ta._userResized) {
            // Compensate the +8 width / +6 minHeight pad applied at startInlineEdit
            const newW = Math.max(20, ta.offsetWidth - 8);
            const newH = Math.max(el.fontSize || 12, ta.offsetHeight - 6);
            el.width = newW;
            el.height = newH;
            dom.style.width = newW + 'px';
            if (el.extracted) dom.style.minHeight = newH + 'px';
            else dom.style.height = newH + 'px';
        }
        // Update the span text
        const span = dom.querySelector('.el-text-content');
        if (span) span.textContent = el.content || '\u00A0';
        // Typed into a just-placed block → it becomes a real document element.
        if (String(el.content || '').trim()) commitProvisionalText(el);
        if (el.extracted) {
            const isModified = el.content !== el.originalContent;
            if (isModified) {
                dom.classList.add('modified');
                // Set span to cover original PDF text with page background + original text color
                if (span) {
                    span.style.background = el.bgColor || '#ffffff';
                    span.style.color = el.color || '#000000';
                }
            } else {
                dom.classList.remove('modified');
                // Revert span to transparent (original PDF text shows through)
                if (span) {
                    span.style.background = '';
                    span.style.color = '';
                }
            }
        }
    }

    // Remove the floating textarea
    if (ta) {
        if (ta._inputHandler) ta.removeEventListener('input', ta._inputHandler);
        if (ta._keyHandler) ta.removeEventListener('keydown', ta._keyHandler);
        ta.remove();
    }

    // Show the original element again
    dom.classList.remove('inline-edit');
    S._inlineEditDOM = null;
    S._inlineEditTA = null;
    S._inlineEditEl = null;

    // An emptied block must not stay behind as an invisible, clickable box.
    if (el && !String(el.content || '').trim()) dropEmptiedBlock(el);
}

function openTextPanel(el) {
    document.querySelectorAll('.el-text.panel-active').forEach(d => d.classList.remove('panel-active'));
    S.editingText = el;
    const panel = $('textEditPanel');
    $('teTextarea').value = el.content || '';

    // Show/hide inline hint vs textarea based on extracted status.
    // Inline editing is triggered by double-click on the page (startInlineEdit),
    // so we don't auto-start it here anymore.
    if (el.extracted) {
        $('teInlineHint').style.display = 'block';
        $('teTextarea').style.display = 'none';
    } else {
        $('teInlineHint').style.display = 'none';
        $('teTextarea').style.display = '';
    }

    // Show original font info + closest-match status for extracted text
    const origBadge = $('teOriginalFont');
    if (el.extracted && el.originalFont) {
        origBadge.textContent = '';
        const lab = document.createElement('span');
        lab.textContent = 'Font: ';
        const strong = document.createElement('strong');
        strong.textContent = el.originalFont;
        const match = document.createElement('span');
        match.id = 'teFontMatch';
        match.className = 'te-font-match';
        origBadge.append(lab, strong, match);
        origBadge.classList.add('visible');
    } else {
        origBadge.textContent = '';
        origBadge.classList.remove('visible');
    }

    // Ensure the font key has an option in the <select> (Google Fonts included)
    const fontSelect = $('teFont');
    let fontKey = el.font || 'Helvetica';
    if (fontKey.startsWith('gf:')) {
        ensureFontInSelect(fontKey, fontKey.slice(3));
    } else if (fontKey.startsWith('custom:') && ![...fontSelect.options].some(o => o.value === fontKey)) {
        const opt = document.createElement('option');
        opt.value = fontKey;
        opt.textContent = fontCache.get(fontKey)?.displayName || fontKey.replace('custom:', '');
        $('teFontCustom').appendChild(opt);
    }
    if (![...fontSelect.options].some(o => o.value === fontKey)) fontKey = 'Helvetica';
    fontSelect.value = fontKey;

    $('teSize').value = Math.round(el.fontSize || 16);
    $('teColor').value = el.color || '#000000';
    $('teBold').classList.toggle('active', !!el.bold);
    $('teItalic').classList.toggle('active', !!el.italic);
    ['Left','Center','Right'].forEach(a => $('teAlign'+a).classList.toggle('active', (el.align||'left') === a.toLowerCase()));

    // Update preview
    const prev = $('teFontPreview');
    prev.style.fontFamily = getCSSFamily(fontKey, el?.systemFont);
    prev.style.fontWeight = el.weight || (el.bold ? 700 : 400);
    prev.style.fontStyle = el.italic ? 'italic' : 'normal';

    // Google Fonts: fetch the closest match, report it, or propose a substitute
    if (fontKey.startsWith('gf:')) {
        const gfName = fontKey.slice(3);
        _teFontMatch('⏳ ' + gfName + '…', 'pending');
        loadGoogleFont(gfName).then(entry => {
            if (S.editingText !== el) return;               // panel moved to another element
            if (entry) {
                _teFontMatch('✓ ' + entry.displayName, 'ok');
            } else {
                const cls = _fontClassOf(el.originalFont || gfName);
                const sub = (FONT_SUBSTITUTES[cls] || FONT_SUBSTITUTES.sans)[0];
                el.font = sub;
                if (sub.startsWith('gf:')) ensureFontInSelect(sub, sub.slice(3));
                fontSelect.value = sub;
                _teFontMatch('⚠ substitute: ' + sub, 'warn');
            }
            syncTextToDOM(el);
            prev.style.fontFamily = getCSSFamily(el.font, el.systemFont);
        });
    } else {
        _teFontMatch(el.extracted ? '· approximate match' : '', 'ok');
    }

    // Position the floating toolbar near the selected element
    positionTextPanel(el);

    panel.classList.add('open');
    const dom = S.pages[el.page]?.editLayer.querySelector(`[data-id="${el.id}"]`);
    if (dom && !el.extracted) {
        dom.classList.add('panel-active');
    }
    // Focus textarea only for non-extracted text
    if (!el.extracted) {
        $('teTextarea').focus();
        requestAnimationFrame(() => $('teTextarea').focus());
    }
}

// Position the floating text toolbar above/below the selected element (Figma-style).
function positionTextPanel(el) {
    const panel = $('textEditPanel');
    if (!panel) return;
    const dom = S.pages[el.page]?.editLayer.querySelector(`[data-id="${el.id}"]`);
    if (!dom) {
        // fallback: top-center
        panel.style.left = '50%';
        panel.style.top = '64px';
        panel.style.transform = 'translateX(-50%)';
        return;
    }
    const r = dom.getBoundingClientRect();
    const pw = panel.offsetWidth || 360;
    const ph = panel.offsetHeight || 200;
    const margin = 12;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(window.innerWidth - pw - margin, left));
    // Place above the element if there's room, otherwise below.
    let top = r.top - ph - margin;
    if (top < 60) top = r.bottom + margin;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.transform = 'none';
}

// Blocks dropped because their text was emptied. A WeakSet (not an element flag)
// so an undo — which re-clones the element — cannot carry the marker along.
const _emptiedDropped = new WeakSet();

// The user actually typed something into a provisional block → it becomes a real
// element of the document (and only now does it enter the history / the export).
function commitProvisionalText(el) {
    if (!el || !el._provisional) return false;
    el._provisional = false;
    if (S._provisionalEl === el) S._provisionalEl = null;
    const pd = S.pages[el.page];
    if (pd && !pd.elements.includes(el)) pd.elements.push(el);
    markDirty();
    return true;
}

// The user clicked elsewhere without typing → throw the provisional block away,
// silently: no toast, no history step, nothing exported.
function discardProvisionalText(el) {
    if (!el || !el._provisional) return;
    el._provisional = false;
    if (S._provisionalEl === el) S._provisionalEl = null;
    // Mark it before endInlineEdit()/dropEmptiedBlock() can see it.
    _emptiedDropped.add(el);
    if (S._inlineEditEl === el) { try { endInlineEdit(); } catch (_) {} }
    const dom = document.querySelector(`.el-text[data-id="${el.id}"]`);
    if (dom) dom.remove();
    if (S.selected === el) { S.selected = null; S.selectedDOM = null; }
    if (S.editingText === el) {
        S.editingText = null;
        $('textEditPanel').classList.remove('open');
    }
}

function dropEmptiedBlock(el) {
    if (!el || _emptiedDropped.has(el)) return;
    // Provisional block (Text tool, nothing typed): nothing ever happened.
    if (el._provisional) { discardProvisionalText(el); return; }
    if (el.extracted) {
        if (el._deleted) return;
        el.content = '';
        el._deleted = true;
        try { syncNativePreview(el); } catch (_) {}
    } else {
        const arr = S.pages[el.page] && S.pages[el.page].elements;
        const i = arr ? arr.findIndex(x => x.id === el.id) : -1;
        if (i < 0) return;
        arr.splice(i, 1);
    }
    _emptiedDropped.add(el);
    const dom = document.querySelector(`.el-text[data-id="${el.id}"]`);
    if (dom) dom.remove();
    if (S.selected === el) deselect();
    markDirty();
    if (el.extracted) toast('Empty block removed · Ctrl+Z to undo');
}

function closeTextPanel() {
    document.querySelectorAll('.el-text.panel-active').forEach(d => d.classList.remove('panel-active'));
    endInlineEdit();
    // Read the content AFTER endInlineEdit: the in-place editor commits there too.
    const emptied = (S.editingText && !String(S.editingText.content || '').trim()) ? S.editingText : null;
    $('textEditPanel').classList.remove('open');
    S.editingText = null;
    if (emptied) dropEmptiedBlock(emptied);
}

// Text panel bindings
$('teTextarea').addEventListener('input', () => {
    if (!S.editingText) return;
    S.editingText.content = $('teTextarea').value;
    syncTextToDOM(S.editingText);
    // Also update floating textarea if active
    if (S._inlineEditTA && S._inlineEditEl === S.editingText) {
        S._inlineEditTA.value = S.editingText.content || '';
    }
    // First real character → the block stops being provisional.
    // See above: an empty value is not a state we keep, so don't record it.
    if (String(S.editingText.content || '').trim()) commitProvisionalText(S.editingText);
});
$('teFont').onchange = async () => {
    if (!S.editingText) return;
    const key = $('teFont').value;
    S.editingText.font = key;
    // Load Google Font if needed
    if (key.startsWith('gf:')) {
        const entry = await loadGoogleFont(key.slice(3));
        if (!entry) {
            S.editingText.font = 'Helvetica';
            $('teFont').value = 'Helvetica';
        }
    }
    syncTextToDOM(S.editingText);
    markDirty();
};
$('teSize').oninput = () => {
    if (!S.editingText) return;
    const newCss = +$('teSize').value;
    const old = S.editingText.fontSize || newCss;
    const ratio = old > 0 ? (newCss / old) : 1;
    S.editingText.fontSize = newCss;
    // Keep pdfFontSize in sync so size change survives rebuild/zoom AND exports correctly
    if (S.editingText.pdfFontSize) S.editingText.pdfFontSize *= ratio;
    syncTextToDOM(S.editingText);
    markDirty();
};
$('teColor').oninput = () => {
    if (!S.editingText) return;
    S.editingText.color = $('teColor').value;
    syncTextToDOM(S.editingText);
    markDirty();
};
$('teBold').onclick = () => {
    if (!S.editingText) return;
    S.editingText.bold = !S.editingText.bold;
    S.editingText.weight = S.editingText.bold ? 700 : 400;
    $('teBold').classList.toggle('active', S.editingText.bold);
    syncTextToDOM(S.editingText);
    markDirty();
};
$('teItalic').onclick = () => {
    if (!S.editingText) return;
    S.editingText.italic = !S.editingText.italic;
    $('teItalic').classList.toggle('active', S.editingText.italic);
    syncTextToDOM(S.editingText);
    markDirty();
};
$('teDelete').onclick = deleteSelected;
$('teDone').onclick = () => closeTextPanel();
$('teClose').onclick = () => closeTextPanel();

// Alignment bindings
['Left','Center','Right'].forEach(a => {
    $('teAlign'+a).onclick = () => {
        if (!S.editingText) return;
        S.editingText.align = a.toLowerCase();
        ['Left','Center','Right'].forEach(b => $('teAlign'+b).classList.toggle('active', b === a));
        syncTextToDOM(S.editingText);
        markDirty();
    };
});

// Font upload
$('teUploadFont').onclick = () => $('fontFileInput').click();
$('fontFileInput').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const { key, entry } = await loadCustomFont(file);
        toast('Font loaded: ' + entry.displayName);
        if (S.editingText) {
            S.editingText.font = key;
            $('teFont').value = key;
            syncTextToDOM(S.editingText);
            markDirty();
        }
    } catch (err) {
        console.warn('Custom font load failed:', err);
        toast('Failed to load font');
    }
    e.target.value = '';
};

// ─── Page operations ───
(function _wirePagesToggle() {
    const togglePages = () => {
        const open = $('sidebar').classList.toggle('open');
        const fixed = document.getElementById('btnPagesFixed');
        if (fixed) fixed.classList.toggle('is-on', open);
        syncMobileFooterState();
    };
    $('btnPages').onclick = togglePages;
    const fixed = document.getElementById('btnPagesFixed');
    if (fixed) fixed.addEventListener('click', togglePages);
})();
$('sidebarClose').onclick = () => { $('sidebar').classList.remove('open'); syncMobileFooterState(); };

// ─── Modify mode ───
S.editMode = false;
const _modifyBar = () => document.getElementById('modifyBar');

function setEditMode(on, { silent = false } = {}) {
    on = !!on;
    if (S.editMode === on && !silent) return;
    S.editMode = on;
    document.body.classList.toggle('edit-mode', on);
    const btn = document.getElementById('btnModify');
    if (btn) {
        btn.classList.toggle('modify-active', on);
        btn.setAttribute('aria-pressed', String(on));
    }
    const bar = _modifyBar();
    if (bar) bar.classList.toggle('visible', on);
    syncMobileFooterState();

    if (on) {
        // Modification is a permission mode. Select is forced so empty-page clicks
        // never create content and every selected block uses the same inspector.
        setTool('select');
        deselect();
    } else {
        // Closing the permission commits all element changes to the saved session.
        try { endInlineEdit(); } catch (_) {}
        try { closeTextPanel(); } catch (_) {}
        deselect();
        markDirty();
        autoSave();
        if (!silent) toast('Modifications enregistrées');
    }
}
$('btnModify').onclick = () => setEditMode(!S.editMode);
$('btnModifyDone').onclick = () => { setEditMode(false); $('sidebar').classList.remove('open'); };

// ─── Helpers: recompute PDF-space coordinates after an element is moved ───
// PDF text is stored in PDF points with origin bottom-left (pdfX/pdfY). When the user
// drags an extracted text block we translate the on-screen delta back into PDF space.
// The ORIGINAL pdfX/pdfY/pdfLines are kept untouched (they locate the baked-in PDF
// text that must be masked on export); a PDF-space delta (dxPdf/dyPdf) records where
// the block now sits so the export draws it there and rebuilds keep it in place.
function pageViewportTransform(pageData) {
    return (pageData && pageData.vt) || null;
}
function recomputeExtractedPosition(el, pageData) {
    const vt = pageViewportTransform(pageData);
    if (!vt || el.pdfX === undefined || !pageData) return;
    // Build the inverse of the viewport affine matrix [a b c d e f] (page→screen).
    const a = vt[0], b = vt[1], c = vt[2], d = vt[3], e = vt[4], f = vt[5];
    const det = a * d - b * c;
    if (!det) return;
    const inv = [
        d / det, -b / det, -c / det, a / det,
        (c * f - d * e) / det, (b * e - a * f) / det,
    ];
    const _s = _renderS();
    // Baseline in screen space: block top + original font height. Convert back to PDF.
    const sxBase = el.x, syBase = el.y + (el.pdfFontSize * _s);
    const pdfBaseX = inv[0] * sxBase + inv[2] * syBase + inv[4];
    const pdfBaseY = inv[1] * sxBase + inv[3] * syBase + inv[5];
    // Delta relative to the ORIGINAL pdfX/pdfY (kept for masking the original text).
    el.dxPdf = pdfBaseX - el.pdfX;
    el.dyPdf = pdfBaseY - el.pdfY;
    el._moved = true;
}

function recomputeGraphicPosition(el, pageData) {
    const vt = pageViewportTransform(pageData);
    if (!vt || el.originalViewX === undefined) return;
    const a = vt[0], b = vt[1], c = vt[2], d = vt[3];
    const det = a * d - b * c;
    if (!det) return;
    const screenDx = el.x - el.originalViewX;
    const screenDy = el.y - el.originalViewY;
    el.dxPdf = (d * screenDx - c * screenDy) / det;
    el.dyPdf = (-b * screenDx + a * screenDy) / det;
    el._moved = Math.abs(el.dxPdf) > 0.001 || Math.abs(el.dyPdf) > 0.001;
}

function recomputePdfImageGeometry(el, pageData) {
    const vt = pageViewportTransform(pageData);
    if (!vt) return;
    const [a, b, c, d, e, f] = vt;
    const det = a * d - b * c;
    if (!det) return;
    const toPdf = (screenX, screenY) => ({
        x: (d * screenX - c * screenY + c * f - d * e) / det,
        y: (-b * screenX + a * screenY + b * e - a * f) / det,
    });
    const corners = [
        toPdf(el.x, el.y), toPdf(el.x + el.width, el.y),
        toPdf(el.x + el.width, el.y + el.height), toPdf(el.x, el.y + el.height),
    ];
    const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
    el.targetPdfX = Math.min(...xs); el.targetPdfY = Math.min(...ys);
    el.targetPdfW = Math.max(...xs) - el.targetPdfX;
    el.targetPdfH = Math.max(...ys) - el.targetPdfY;
    el._moved = Math.abs(el.targetPdfX - el.pdfX) > 0.01 || Math.abs(el.targetPdfY - el.pdfY) > 0.01;
    el._resized = Math.abs(el.targetPdfW - el.pdfW) > 0.01 || Math.abs(el.targetPdfH - el.pdfH) > 0.01;
}

$('btnNewDoc').onclick = () => {
    if (S.dirty && !confirm('Unsaved document. Continue?')) return;
    // Reset state
    S.pdfDoc = null; S.pdfJs = null; S.bytes = null;
    S.fileName = 'document.pdf'; S.pages = [];
    S.selected = null; S.selectedDOM = null;
    S.undoStack = []; S.redoStack = [];
    S._histSnap = null; S._histSig = null;
    _updateUndoButtons();
    S.dirty = false; S.pdfMetas = null;
    setEditMode(false, { silent: true });
    delete S._savedElements; delete S._savedPaths;
    if (S.autoTimer) { clearTimeout(S.autoTimer); S.autoTimer = null; }
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
    if (_pdfSaveTimer) { clearTimeout(_pdfSaveTimer); _pdfSaveTimer = null; }
    // Clear canvas area and thumbs
    $('canvasArea').innerHTML = '';
    if ($('pageList')) $('pageList').innerHTML = '';
    // Hide UI, show splash
    $('toolbar').classList.remove('visible');
    $('zoomGroup').classList.remove('visible');
    $('btnFind').classList.remove('visible');
    $('btnAnnot').classList.remove('visible');
    $('statusBar').classList.remove('visible');
    $('sidebar').classList.remove('open');
    $('propsPanel').classList.remove('visible');
    $('prefsPanel')?.classList.remove('open');
    closeMobileSheet({ restoreFocus: false });
    document.body.classList.remove('pdf-loaded', 'pdf-search-open', 'mobile-sheet-open');
    // Close all panels/modals that may be open
    $('textEditPanel').classList.remove('open');
    $('iccPanel').classList.remove('visible');
    $('frPanel').classList.remove('visible');
    $('exportModal').classList.remove('visible');
    $('sigModal').classList.remove('visible');
    $('cropOverlay').classList.remove('visible');
    $('prefsPanel').classList.remove('open');
    $('loader').classList.remove('visible');
    // Reset splash to initial state
    _setSplashBusy(false);
    $('splash').classList.remove('hidden');
    if (typeof window.__refreshSplashSessions === 'function') {
        try { window.__refreshSplashSessions(); } catch (_) {}
    }
    // Reset meta cards
    if ($('pdfMetaList')) $('pdfMetaList').innerHTML = '<div class="pdf-meta-empty">No PDF loaded</div>';
};

$('btnAddPage').onclick = async () => {
    if (!S.pdfDoc) { await createBlank(); return; }
    S.pdfDoc.addPage([612, 792]);
    await rebuild();
    toast('Page added');
};

async function rebuild(opts) {
    // opts.progressFrom / opts.progressTo: when the caller already drives the loader bar,
    // map our internal phases into that slice. When omitted we drive the loader ourselves.
    const driveSelf = !opts || typeof opts.progressFrom !== 'number';
    const fromPct = driveSelf ? 0 : opts.progressFrom;
    const toPct   = driveSelf ? 100 : opts.progressTo;
    const span    = Math.max(1, toPct - fromPct);
    const setP = (localPct, msg) => {
        const pct = fromPct + (Math.max(0, Math.min(100, localPct)) / 100) * span;
        setLoaderProgress(pct, msg);
    };
    if (driveSelf) beginLoaderProgress('Updating…');
    setP(2, 'Saving current state…');
    // Save in-progress elements
    const savedEl = {}; const savedPaths = {};
    S.pages.forEach((p, i) => {
        savedEl[i + 1] = p.elements;
        savedPaths[i + 1] = p.paths;
    });
    setP(6, 'Re-encoding PDF…');
    const bytes = await S.pdfDoc.save();
    S.bytes = bytes;
    setP(12, 'Loading PDF engine…');
    S.pdfJs = await pdfjsLib.getDocument({
        data: bytes.slice(),
        cMapUrl: vendor('vendor/pdfjs/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: vendor('vendor/pdfjs/standard_fonts/'),
    }).promise;
    S._savedElements = savedEl; S._savedPaths = savedPaths;
    await renderAllPages((done, total, label) => {
        const local = 18 + (total ? (done / total) : 0) * 70; // 18 → 88
        setP(local, label || `Rendering page ${Math.ceil(done)}/${total}…`);
    });
    setP(89, 'Building thumbnails…');
    await buildThumbs((done, total) => {
        const local = 89 + (total ? (done / total) : 0) * 10; // 89 → 99
        setP(local, `Thumbnail ${done}/${total}…`);
    });
    setP(100, 'Done');
    updateStatus();
    updateDocSize();
    if (driveSelf) endLoaderProgress();
    resetHistory();
    markDirty();
}

// ─── Thumbs with page actions & drag-reorder ───
async function buildThumbs(onProgress) {
    const list = $('pageList'); list.innerHTML = '';
    const total = S.pdfJs.numPages;
    // Reuse the already-rendered full-page canvases (S.pages[i].canvas) and draw a
    // small preview from them instead of re-rendering every page with pdf.js.
    // This is dramatically faster/more memory-friendly on large documents (64+ pages)
    // and guarantees the rail preview appears for every page.
    const THUMB_W = 236; // target thumbnail width (px) — large previews in the rail
    for (let i = 1; i <= total; i++) {
        let cv;
        const pageData = S.pages[i - 1];
        try {
            if (pageData && pageData.canvas && pageData.canvas.width > 0) {
                // Downscale the already-rendered page canvas into the thumb
                const src = pageData.canvas;
                const ratio = Math.min(1, THUMB_W / src.width);
                const tw = Math.max(1, Math.round(src.width * ratio));
                const th = Math.max(1, Math.round(src.height * ratio));
                cv = document.createElement('canvas');
                cv.width = tw; cv.height = th;
                cv.getContext('2d').drawImage(src, 0, 0, tw, th);
            } else {
                throw new Error('no page canvas');
            }
        } catch (_) {
            // Fallback: render the page directly with pdf.js at small scale
            const page = await S.pdfJs.getPage(i);
            const vp = page.getViewport({ scale: 0.35 });
            cv = document.createElement('canvas');
            cv.width = vp.width; cv.height = vp.height;
            await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        }

        const div = document.createElement('div');
        div.className = 'page-thumb' + (i === 1 ? ' active' : '');
        div.dataset.page = i;
        div.draggable = true;

        const num = document.createElement('div'); num.className = 'page-num'; num.textContent = i;

        // Page actions overlay
        const actions = document.createElement('div');
        actions.className = 'page-thumb-actions';
        // Prevent the draggable parent thumb from swallowing click on action buttons
        actions.addEventListener('mousedown', e => e.stopPropagation());
        actions.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
        // Rotate
        const btnRot = document.createElement('button'); btnRot.title = 'Rotate 90°'; btnRot.type = 'button'; btnRot.draggable = false;
        btnRot.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
        btnRot.onclick = (e) => { e.stopPropagation(); rotatePage(i - 1); };
        // Duplicate
        const btnDup = document.createElement('button'); btnDup.title = 'Duplicate'; btnDup.type = 'button'; btnDup.draggable = false;
        btnDup.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        btnDup.onclick = (e) => { e.stopPropagation(); duplicatePage(i - 1); };
        // Delete
        const btnDel = document.createElement('button'); btnDel.title = 'Delete page'; btnDel.type = 'button'; btnDel.draggable = false;
        btnDel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        btnDel.onclick = (e) => { e.stopPropagation(); deletePage(i - 1); };

        actions.appendChild(btnRot);
        actions.appendChild(btnDup);
        if (total > 1) actions.appendChild(btnDel);

        div.appendChild(cv); div.appendChild(num); div.appendChild(actions);

        // Drag-reorder
        div.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', String(i));
            e.dataTransfer.effectAllowed = 'move';
            div.classList.add('dragging');
        });
        div.addEventListener('dragend', () => div.classList.remove('dragging'));
        div.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = div.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            div.classList.toggle('drag-over-top', e.clientY < mid);
            div.classList.toggle('drag-over-bottom', e.clientY >= mid);
        });
        div.addEventListener('dragleave', () => {
            div.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        div.addEventListener('drop', async e => {
            e.preventDefault();
            div.classList.remove('drag-over-top', 'drag-over-bottom');
            const from = parseInt(e.dataTransfer.getData('text/plain')) - 1;
            const rect = div.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            let to = i - 1;
            if (e.clientY >= mid) to = i; // insert after
            else to = i - 1; // insert before
            if (from === to || from === to - 1) return;
            await movePage(from, to);
        });

        div.onclick = () => scrollToPage(i);
        list.appendChild(div);
        if (typeof onProgress === 'function') {
            try { onProgress(i, total); } catch (_) {}
        }
        if (i % 4 === 0) await _uiYield();
    }
}

// ─── Page management ───
async function rotatePage(idx) {
    const page = S.pdfDoc.getPage(idx);
    const cur = page.getRotation().angle || 0;
    page.setRotation(degrees((cur + 90) % 360));
    // Local fast-path: rotate just this page's canvas + elements in place
    // (no full re-serialize + re-render of every page).
    const pd = S.pages[idx];
    if (pd && pd.canvas) {
        const { width, height } = pd.canvas;
        const rot = document.createElement('canvas');
        rot.width = height; rot.height = width;
        const rctx = rot.getContext('2d');
        rctx.translate(height / 2, width / 2);
        rctx.rotate(Math.PI / 2);
        rctx.drawImage(pd.canvas, -width / 2, -height / 2);
        pd.canvas.width = height; pd.canvas.height = width;
        pd.canvas.getContext('2d').drawImage(rot, 0, 0);
        // Rotate element positions (swap x/y within new bounds)
        const newW = height, newH = width;
        (pd.elements || []).forEach(el => {
            const nx = el.y;
            const ny = newH - el.x - (el.height || el.fontSize || 20);
            el.x = nx; el.y = ny;
            if (el.width !== undefined && el.height !== undefined) { const t = el.width; el.width = el.height; el.height = t; }
            const dom = pd.editLayer.querySelector(`[data-id="${el.id}"]`);
            if (dom) {
                dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
                if (el.width !== undefined) dom.style.width = el.width + 'px';
                if (el.height !== undefined) dom.style.height = el.height + 'px';
            }
        });
        pd.width = newW; pd.height = newH;
        if (pd.drawLayer) { pd.drawLayer.width = newW; pd.drawLayer.height = newH; }
        // Update the page wrap + canvas CSS size so the layout reflects the rotation
        const wrap = pd.editLayer?.parentElement;
        if (wrap) {
            wrap.style.width = newW + 'px';
            wrap.style.height = newH + 'px';
        }
        // Refresh the thumbnail from the rotated canvas
        const thumb = document.querySelector(`#pageList .page-thumb[data-page="${idx + 1}"] canvas`);
        if (thumb) {
            const ratio = Math.min(1, 236 / newW);
            thumb.width = Math.max(1, Math.round(newW * ratio));
            thumb.height = Math.max(1, Math.round(newH * ratio));
            thumb.getContext('2d').drawImage(pd.canvas, 0, 0, thumb.width, thumb.height);
        }
        markDirty();
        toast('Page rotated');
        return;
    }
    await rebuild();
    toast('Page rotated');
}

async function duplicatePage(idx) {
    const [copied] = await S.pdfDoc.copyPages(S.pdfDoc, [idx]);
    S.pdfDoc.insertPage(idx + 1, copied);
    await rebuild();
    toast('Page duplicated');
}

async function deletePage(idx) {
    if (S.pdfDoc.getPageCount() <= 1) { toast('Cannot delete last page'); return; }
    S.pdfDoc.removePage(idx);
    // Also remove saved elements for this page
    S.pages.splice(idx, 1);
    await rebuild();
    toast('Page deleted');
}

async function movePage(fromIdx, toIdx) {
    // pdf-lib doesn't have a movePage, so we copy+remove+insert
    const [copied] = await S.pdfDoc.copyPages(S.pdfDoc, [fromIdx]);
    S.pdfDoc.removePage(fromIdx);
    const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
    S.pdfDoc.insertPage(insertAt, copied);
    await rebuild();
    toast('Page moved');
}

// ─── Visual Crop (Photoshop-style) ───
const PT_TO_MM = 25.4 / 72;
const MM_TO_PT = 72 / 25.4;

const CROP = { pageW: 0, pageH: 0, canvasRect: null, scale: 1, x: 0, y: 0, w: 0, h: 0, dragging: null, startX: 0, startY: 0, origX: 0, origY: 0, origW: 0, origH: 0 };

function getCurrentPageIndex() {
    const wraps = $('canvasArea').querySelectorAll('.page-canvas-wrap');
    let idx = 0;
    const scrollY = $('canvasArea').scrollTop + $('canvasArea').clientHeight / 3;
    for (let i = 0; i < wraps.length; i++) {
        if (wraps[i].offsetTop + wraps[i].offsetHeight / 2 > scrollY) { idx = i; break; }
    }
    return idx;
}

async function openCropOverlay() {
    if (!S.pdfDoc) { toast('Open a PDF first'); return; }
    const idx = getCurrentPageIndex();
    const pdfPage = await S.pdfJs.getPage(idx + 1);
    const vp = pdfPage.getViewport({ scale: 1 });
    CROP.pageW = vp.width;
    CROP.pageH = vp.height;

    // Render preview into crop canvas
    const maxW = window.innerWidth * 0.85, maxH = (window.innerHeight - 100) * 0.85;
    CROP.scale = Math.min(maxW / vp.width, maxH / vp.height, 2);
    const cv = $('cropCanvas');
    cv.width = Math.round(vp.width * CROP.scale);
    cv.height = Math.round(vp.height * CROP.scale);
    const ctx = cv.getContext('2d');
    await pdfPage.render({ canvasContext: ctx, viewport: pdfPage.getViewport({ scale: CROP.scale }) }).promise;

    // Init crop region = full page
    CROP.x = 0; CROP.y = 0; CROP.w = cv.width; CROP.h = cv.height;

    // Show overlay first so getBoundingClientRect works, then position region
    $('cropOverlay').classList.add('visible');
    requestAnimationFrame(() => syncCropRegion());
}

function syncCropRegion() {
    const cv = $('cropCanvas');
    const r = $('cropRegion');
    // Clamp
    CROP.x = Math.max(0, Math.min(CROP.x, cv.width - 20));
    CROP.y = Math.max(0, Math.min(CROP.y, cv.height - 20));
    CROP.w = Math.max(20, Math.min(CROP.w, cv.width - CROP.x));
    CROP.h = Math.max(20, Math.min(CROP.h, cv.height - CROP.y));

    // Position the crop region relative to canvas
    const cvRect = cv.getBoundingClientRect();
    const wrapRect = $('cropCanvasWrap').getBoundingClientRect();
    const offX = cvRect.left - wrapRect.left;
    const offY = cvRect.top - wrapRect.top;
    r.style.left = (offX + CROP.x) + 'px';
    r.style.top = (offY + CROP.y) + 'px';
    r.style.width = CROP.w + 'px';
    r.style.height = CROP.h + 'px';

    // Dimensions in mm
    const sc = CROP.scale;
    const cropWmm = (CROP.w / sc * PT_TO_MM).toFixed(1);
    const cropHmm = (CROP.h / sc * PT_TO_MM).toFixed(1);
    const pageWmm = (CROP.pageW * PT_TO_MM).toFixed(1);
    const pageHmm = (CROP.pageH * PT_TO_MM).toFixed(1);
    $('cropInfo').textContent = `${cropWmm} × ${cropHmm} mm`;
    $('cropDims').textContent = `Page : ${pageWmm} × ${pageHmm} mm → Crop : ${cropWmm} × ${cropHmm} mm`;
}

// Drag logic
$('cropCanvasWrap').addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.crop-handle');
    const region = e.target.closest('.crop-region');
    if (!handle && !region) return;
    e.preventDefault();
    CROP.startX = e.clientX;
    CROP.startY = e.clientY;
    CROP.origX = CROP.x; CROP.origY = CROP.y;
    CROP.origW = CROP.w; CROP.origH = CROP.h;
    CROP.dragging = handle ? handle.dataset.dir : 'move';

    const onMove = (ev) => {
        const dx = ev.clientX - CROP.startX;
        const dy = ev.clientY - CROP.startY;
        const cv = $('cropCanvas');
        const d = CROP.dragging;

        if (d === 'move') {
            CROP.x = Math.max(0, Math.min(CROP.origX + dx, cv.width - CROP.origW));
            CROP.y = Math.max(0, Math.min(CROP.origY + dy, cv.height - CROP.origH));
        } else {
            let nx = CROP.origX, ny = CROP.origY, nw = CROP.origW, nh = CROP.origH;
            if (d.includes('l')) { nx = CROP.origX + dx; nw = CROP.origW - dx; }
            if (d.includes('r') || d === 'mr') { nw = CROP.origW + dx; }
            if (d.includes('t') || d === 'tm') { ny = CROP.origY + dy; nh = CROP.origH - dy; }
            if (d.includes('b') || d === 'bm') { nh = CROP.origH + dy; }
            // Enforce min size and bounds
            if (nw < 20) { if (d.includes('l')) nx = CROP.origX + CROP.origW - 20; nw = 20; }
            if (nh < 20) { if (d.includes('t')) ny = CROP.origY + CROP.origH - 20; nh = 20; }
            if (nx < 0) { nw += nx; nx = 0; }
            if (ny < 0) { nh += ny; ny = 0; }
            if (nx + nw > cv.width) nw = cv.width - nx;
            if (ny + nh > cv.height) nh = cv.height - ny;
            CROP.x = nx; CROP.y = ny; CROP.w = nw; CROP.h = nh;
        }
        syncCropRegion();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

// Reposition on window resize (debounced re-fit for Safari + desktop resize)
let _resizeTimer;
window.addEventListener('resize', () => {
    if ($('cropOverlay').classList.contains('visible')) syncCropRegion();
    if (!S.pdfDoc) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
        if (_isOpening || _renderBusy) return;   // don't race the initial render
        const p = S.pdfDoc.getPage(0);
        const w = p.getSize().width;
        const avail = $('canvasArea').clientWidth - 60;
        setZoom(avail / (w * 1.5));
    }, 300);
});

$('cropCancel').onclick = () => $('cropOverlay').classList.remove('visible');

$('cropApply').onclick = async () => {
    const sc = CROP.scale;
    // Convert pixel crop coords back to PDF points
    const leftPt = CROP.x / sc;
    const topPt = CROP.y / sc;
    const cropWPt = CROP.w / sc;
    const cropHPt = CROP.h / sc;
    const rightPt = CROP.pageW - leftPt - cropWPt;
    const bottomPt = CROP.pageH - topPt - cropHPt;

    if (leftPt < 0.5 && rightPt < 0.5 && topPt < 0.5 && bottomPt < 0.5) {
        toast('No crop region'); return;
    }

    $('cropOverlay').classList.remove('visible');
    showLoader('Recadrage…');

    try {
        const scope = document.querySelector('input[name="cropScope"]:checked').value;
        const total = S.pdfDoc.getPageCount();
        let indices;
        if (scope === 'current') {
            indices = [getCurrentPageIndex()];
        } else {
            indices = Array.from({ length: total }, (_, i) => i);
        }

        for (const idx of indices) {
            const page = S.pdfDoc.getPage(idx);
            const { width, height } = page.getSize();
            // Scale crop proportionally if page has different dimensions
            const sx = width / CROP.pageW, sy = height / CROP.pageH;
            const l = leftPt * sx, b = bottomPt * sy;
            const w = cropWPt * sx, h = cropHPt * sy;
            if (w <= 0 || h <= 0) continue;
            // pdf-lib: setCropBox(x, y, width, height) — NOT (x1, y1, x2, y2).
            page.setCropBox(l, b, w, h);
            page.setMediaBox(l, b, w, h);
        }

        await rebuild();
        hideLoader();
        toast(`${indices.length} page${indices.length > 1 ? 's' : ''} cropped`);
    } catch (e) { hideLoader(); toast('Erreur crop : ' + e.message); console.error(e); }
};

$('btnCropToolbar').onclick = () => openCropOverlay();

function scrollToPage(n) {
    const wrap = $('canvasArea').querySelectorAll('.page-canvas-wrap')[n - 1];
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('sidebar').classList.remove('open');
}

function getPageFormat() {
    if (!S.pdfDoc) return '';
    const page = S.pdfDoc.getPage(0);
    const { width, height } = page.getSize();
    const w = Math.round(width), h = Math.round(height);
    const formats = [
        { name: 'A0', w: 2384, h: 3370 }, { name: 'A1', w: 1684, h: 2384 },
        { name: 'A2', w: 1191, h: 1684 }, { name: 'A3', w: 842, h: 1191 },
        { name: 'A4', w: 595, h: 842 },   { name: 'A5', w: 420, h: 595 },
        { name: 'A6', w: 298, h: 420 },
        { name: 'Letter', w: 612, h: 792 }, { name: 'Legal', w: 612, h: 1008 },
        { name: 'Tabloid', w: 792, h: 1224 },
    ];
    const tol = 4;
    for (const f of formats) {
        if ((Math.abs(w - f.w) <= tol && Math.abs(h - f.h) <= tol) ||
            (Math.abs(w - f.h) <= tol && Math.abs(h - f.w) <= tol)) {
            const orient = w > h ? ' Landscape' : ' Portrait';
            return f.name + orient;
        }
    }
    const wMM = (width * 25.4 / 72).toFixed(0);
    const hMM = (height * 25.4 / 72).toFixed(0);
    return wMM + ' × ' + hMM + ' mm';
}

function updateStatus() {
    const total = S.pdfDoc ? S.pdfDoc.getPageCount() : 0;
    $('statusText').textContent = `${total} page${total > 1 ? 's' : ''}`;
    $('statusFormat').textContent = getPageFormat();
    updateDocSize();
    $('statusBar').classList.add('visible');
    $('statusBar').classList.remove('fade-out');
}

// ─── Document size display (mm) ───
function updateDocSize() {
    if (!S.pdfDoc) { $('statusSize').textContent = ''; return; }
    const page = S.pdfDoc.getPage(0);
    const { width, height } = page.getSize();
    const wMM = (width * 25.4 / 72).toFixed(1);
    const hMM = (height * 25.4 / 72).toFixed(1);
    $('statusSize').textContent = wMM + ' × ' + hMM + ' mm';
}

// ─── Zoom ───
function setZoom(z) {
    S.zoom = Math.max(0.3, Math.min(3, z));
    $('zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
    // Never start a second full render while one is running (opening a PDF + an
    // automatic fit-on-resize used to overlap and leave the pages blank).
    if (_isOpening || _renderBusy) { _pendingZoom = S.zoom; return; }
    // Save elements before re-render
    const savedEl = {}; const savedPaths = {};
    S.pages.forEach((p, idx) => {
        savedEl[idx + 1] = p.elements;
        savedPaths[idx + 1] = p.paths;
    });
    S._savedElements = savedEl;
    S._savedPaths = savedPaths;
    // Run as a task so the zoom label repaints; the render generation guard
    // inside renderAllPages() prevents overlapping/interleaved pages.
    void (async () => {
        await renderAllPages();
        await buildThumbs();
    })();
}
$('btnZoomIn').onclick = () => setZoom(S.zoom + 0.15);
$('btnZoomOut').onclick = () => setZoom(S.zoom - 0.15);
$('btnZoomFit').onclick = () => {
    if (!S.pdfDoc) return;
    const p = S.pdfDoc.getPage(0);
    const w = p.getSize().width;
    const avail = $('canvasArea').clientWidth - 60;
    setZoom(avail / (w * 1.5));
};

// ─── Mark dirty + auto-save ───
let _pdfCacheHash = '';        // md5-ish marker of the bytes already stored
let _autoSaveTimer = null;     // debounced element save
let _pdfSaveTimer = null;      // infrequent full-PDF save
function markDirty() {
    S.dirty = true; $('saveDot').classList.add('dirty');
    if (typeof _scheduleHistory === 'function') _scheduleHistory();
    clearTimeout(_autoSaveTimer);
    clearTimeout(_pdfSaveTimer);
    if (prefs.autoSave) {
        // Elements: save quickly (2s) — cheap JSON.
        _autoSaveTimer = setTimeout(saveElementsMeta, 2000);
        // Full PDF bytes: only every 20s, and only if the underlying PDF changed.
        _pdfSaveTimer = setTimeout(savePdfBytes, 20000);
    }
}

// ─── Multi-session history ───
// The lightweight index lives in localStorage; the payload (PDF bytes + edit
// layer) of every session lives in IndexedDB. localStorage only has room for a
// single PDF, which is why every listed session except the last one used to be a
// dead end on the pre-home screen.
const MAX_SESSIONS = 12;
const SESSION_DB = 'pdfyz-sessions';
const SESSION_STORE = 'docs';
const SESSION_TTL = 7 * 86400000;

function _sessionId(name) {
    return Kernel.sessionId(String(name || 'document.pdf'))
        || 'doc:' + String(name || 'document.pdf').trim().toLowerCase();
}

let _idbPromise = null;
function _idbOpen() {
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(SESSION_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SESSION_STORE)) {
                db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
    return _idbPromise;
}
async function _idbPut(rec) {
    if (!rec || !rec.id) return false;
    try {
        const db = await _idbOpen();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(SESSION_STORE, 'readwrite');
            tx.objectStore(SESSION_STORE).put(rec);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        return true;
    } catch (e) {
        console.warn('Session store write failed:', e);
        return false;
    }
}
async function _idbGet(id) {
    if (!id) return null;
    try {
        const db = await _idbOpen();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(SESSION_STORE, 'readonly');
            const req = tx.objectStore(SESSION_STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) { return null; }
}
async function _idbDelete(id) {
    if (!id) return false;
    try {
        const db = await _idbOpen();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(SESSION_STORE, 'readwrite');
            tx.objectStore(SESSION_STORE).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
        return true;
    } catch (e) { return false; }
}

// Which sessions actually have a stored payload. Scanned once at boot with a key
// cursor (never loads the blobs). This is what makes the "Ready" / "No PDF" badge
// on the pre-home truthful instead of guessing from the single localStorage slot.
let _sessionsWithBytes = new Set();
let _sessionsScanDone = false;
let _sessionsScanP = null;
function _scanSessionBytes() {
    if (_sessionsScanP) return _sessionsScanP;
    _sessionsScanP = (async () => {
        const ids = new Set();
        try {
            const db = await _idbOpen();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(SESSION_STORE, 'readonly');
                const req = tx.objectStore(SESSION_STORE).openCursor();
                req.onsuccess = () => {
                    const cur = req.result;
                    if (!cur) { resolve(); return; }
                    if (cur.value && cur.value.bytes) ids.add(cur.key);
                    cur.continue();
                };
                req.onerror = () => reject(req.error);
            });
        } catch (_) {}
        _sessionsWithBytes = ids;
        _sessionsScanDone = true;
        return ids;
    })();
    return _sessionsScanP;
}

function _readSessions() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem('pdfz-sessions') || '[]'); } catch (_) { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    // Normalise ids: entries written by older versions used "<name>_<timestamp>",
    // which made the same document appear twice on the pre-home list.
    const byName = new Map();
    for (const s of raw) {
        if (!s || !s.fileName) continue;
        const id = _sessionId(s.fileName);
        const entry = {
            id,
            fileName: s.fileName,
            size: s.size || 0,
            pages: s.pages || 0,
            timestamp: s.timestamp || 0,
        };
        const prev = byName.get(id);
        // Keep the freshest copy, preferring one that knows its payload size.
        if (!prev || entry.timestamp > prev.timestamp
            || (entry.timestamp === prev.timestamp && !prev.size && entry.size)) {
            byName.set(id, entry);
        }
    }
    return [...byName.values()];
}
function _writeSessions(list) {
    // `hasPdf` is never persisted: availability is scanned from IndexedDB, so a
    // stale flag can no longer advertise a payload that was never written.
    const clean = (Array.isArray(list) ? list : []).map(s => ({
        id: s.id,
        fileName: s.fileName,
        timestamp: s.timestamp || 0,
        pages: s.pages || 0,
        size: s.size || 0,
    }));
    try { localStorage.setItem('pdfz-sessions', JSON.stringify(clean)); } catch (_) {}
}
// Upsert the current session into the history (one entry per document name).
// `size` is preserved when the caller has no fresh value: it used to be reset to
// 0 on every autosave, wiping the size shown on the splash.
function _upsertSession(meta) {
    if (!meta || !meta.fileName) return;
    const list = _readSessions();
    const id = _sessionId(meta.fileName);
    const prev = list.find(s => s.id === id) || null;
    const entry = {
        id,
        fileName: meta.fileName,
        timestamp: meta.timestamp || Date.now(),
        pages: meta.pages || (prev ? prev.pages : 0),
        size: meta.size || (prev ? prev.size : 0),
    };
    const rest = list.filter(s => s.id !== id);
    rest.unshift(entry);
    if (rest.length > MAX_SESSIONS) {
        rest.slice(MAX_SESSIONS).forEach(s => { _idbDelete(s.id); });
        rest.length = MAX_SESSIONS;
    }
    _writeSessions(rest);
}
function _markSessionHasPdf(id, size) {
    if (!id) return;
    _sessionsWithBytes.add(id);
    const list = _readSessions();
    const entry = list.find(s => s.id === id);
    if (entry && size && entry.size !== size) {
        entry.size = size;
        _writeSessions(list);
    }
    if (typeof window.__refreshSplashSessions === 'function'
        && !$('splash').classList.contains('hidden')) {
        try { window.__refreshSplashSessions(); } catch (_) {}
    }
}

// Debounced payload flush: `bytes` is only passed when the underlying PDF changed.
let _sessionFlushTimer = null;
let _sessionFlushPending = null;
function _scheduleSessionFlush(meta, bytes) {
    if (!meta || !meta.fileName) return;
    _sessionFlushPending = { meta, bytes: bytes || null };
    if (_sessionFlushTimer) return;
    _sessionFlushTimer = setTimeout(() => {
        _sessionFlushTimer = null;
        const p = _sessionFlushPending;
        _sessionFlushPending = null;
        if (p) _flushSession(p.meta, p.bytes);
    }, 900);
}
async function _flushSession(meta, bytes) {
    if (!meta || !meta.fileName) return;
    const id = _sessionId(meta.fileName);
    let payload = bytes || null;
    let size = bytes ? bytes.length : 0;
    if (!payload) {
        // Keep the bytes already stored, only refresh the edit layer.
        const prev = await _idbGet(id);
        if (!prev || !prev.bytes) return; // nothing to attach the edit layer to yet
        payload = prev.bytes;
        size = prev.size || prev.bytes.byteLength || prev.bytes.length || 0;
    }
    const ok = await _idbPut({
        id,
        fileName: meta.fileName,
        timestamp: Date.now(),
        pages: meta.pages || 0,
        elements: meta.elements || {},
        paths: meta.paths || {},
        bytes: payload,
        size,
    });
    if (ok) _markSessionHasPdf(id, size);
}

// Drop expired / over-quota sessions and their stored payloads.
async function _pruneSessions() {
    const now = Date.now();
    const list = _readSessions();
    const keep = [];
    for (const s of list) {
        if (now - (s.timestamp || 0) > SESSION_TTL) { _idbDelete(s.id); continue; }
        keep.push(s);
    }
    if (keep.length > MAX_SESSIONS) {
        keep.slice(MAX_SESSIONS).forEach(s => { _idbDelete(s.id); });
        keep.length = MAX_SESSIONS;
    }
    // Always rewrite: this also migrates legacy ids to the current scheme.
    _writeSessions(keep);
}

function _buildSessionMeta() {
    const meta = {
        fileName: S.fileName,
        elements: {}, paths: {},
        timestamp: Date.now(),
        pages: S.pages ? S.pages.length : 0,
    };
    if (S.pages) S.pages.forEach((p, i) => { meta.elements[i + 1] = p.elements; meta.paths[i + 1] = p.paths; });
    return meta;
}
function _base64ToBytes(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    const CH = 0x8000;
    for (let i = 0; i < len; i += CH) {
        const end = Math.min(i + CH, len);
        for (let j = i; j < end; j++) bytes[j] = bin.charCodeAt(j);
    }
    return bytes;
}

// Store just the element/path metadata (cheap, frequent)
// A full localStorage used to fail SILENTLY: the user kept editing, believing the
// session was saved, and lost everything on reload. Warn once, re-arm on success.
let _saveFailNotified = false;
function _notifySaveFailure(e) {
    console.warn('Auto-save failed:', e);
    if (_saveFailNotified) return;
    _saveFailNotified = true;
    toast('Sauvegarde automatique impossible (stockage plein ?) — exportez votre PDF pour ne rien perdre');
}
function saveElementsMeta() {
    if (!S.pdfDoc) return;
    try {
        const meta = _buildSessionMeta();
        localStorage.setItem('pdfz-meta', JSON.stringify(meta));
        _upsertSession({
            fileName: S.fileName,
            timestamp: meta.timestamp,
            pages: meta.pages,
        });
        // Refresh the edit layer of this session in the store (bytes untouched).
        _scheduleSessionFlush(meta, null);
        // Keep the splash list in sync while it is still on screen.
        if (typeof window.__refreshSplashSessions === 'function'
            && !$('splash').classList.contains('hidden')) {
            try { window.__refreshSplashSessions(); } catch (_) {}
        }
        S.dirty = false;
        $('saveDot').classList.remove('dirty');
        _saveFailNotified = false;
    } catch(e) { _notifySaveFailure(e); }
}
// Store the raw PDF bytes — only when the document structure actually changed.
function savePdfBytes() {
    if (!S.pdfDoc) return;
    try {
        if (!S.bytes || S.bytes.length >= 10 * 1024 * 1024) return;
        // Skip if the PDF bytes haven't changed since the last store.
        let h = 0;
        const CH = 0x8000;
        for (let i = 0; i < S.bytes.length; i += CH) {
            const end = Math.min(i + CH, S.bytes.length);
            for (let j = i; j < end; j++) h = ((h << 5) - h + S.bytes[j]) | 0;
        }
        const hkey = S.bytes.length + ':' + h;
        if (hkey === _pdfCacheHash) return; // unchanged → skip the heavy base64
        _pdfCacheHash = hkey;
        // chunked binary→base64 to avoid "Maximum call stack size exceeded"
        let bin = '';
        for (let i = 0; i < S.bytes.length; i += CH) {
            bin += String.fromCharCode.apply(
                null,
                S.bytes.subarray(i, Math.min(i + CH, S.bytes.length))
            );
        }
        localStorage.setItem('pdfz-pdf', btoa(bin));
        // Update session history size
        const list = _readSessions();
        const id = _sessionId(S.fileName);
        const idx = list.findIndex(s => s.id === id);
        if (idx >= 0) {
            list[idx].size = S.bytes.length;
            list[idx].timestamp = Date.now();
            _writeSessions(list);
        } else {
            _upsertSession({ fileName: S.fileName, pages: S.pages.length, size: S.bytes.length });
        }
        // Persist the real payload so this session can be resumed later.
        _scheduleSessionFlush(_buildSessionMeta(), S.bytes);
        _saveFailNotified = false;
    } catch(e) { _notifySaveFailure(e); }
}
function autoSave() { saveElementsMeta(); savePdfBytes(); }

// Persist the freshest edit layer when the tab is hidden or closed, so a reload
// resumes exactly where the user left off instead of losing the last 20 seconds.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !S.pdfDoc) return;
    if (_sessionFlushTimer) { clearTimeout(_sessionFlushTimer); _sessionFlushTimer = null; }
    _flushSession(_buildSessionMeta(), S.bytes || null);
});

// ─── Restore ───
// Resume any listed session: the bytes + edit layer come from IndexedDB, with a
// fallback to the legacy localStorage slot for documents saved by older versions.
async function restoreSession(id) {
    if (_isOpening) { toast('Already loading a PDF…'); return false; }
    const entry = _readSessions().find(s => s.id === id) || null;
    const fileName = entry ? entry.fileName : null;
    let rec = id ? await _idbGet(id) : null;
    if ((!rec || !rec.bytes) && fileName) {
        try {
            const legacyMeta = JSON.parse(localStorage.getItem('pdfz-meta') || 'null');
            const b64 = localStorage.getItem('pdfz-pdf');
            if (b64 && legacyMeta && legacyMeta.fileName === fileName) {
                rec = {
                    fileName,
                    elements: legacyMeta.elements,
                    paths: legacyMeta.paths,
                    bytes: _base64ToBytes(b64),
                };
            }
        } catch (_) {}
    }
    if (!rec || !rec.bytes) return false;
    S._savedElements = rec.elements || {};
    S._savedPaths = rec.paths || {};
    const ok = await openPDF(rec.bytes, rec.fileName || fileName || 'document.pdf');
    if (!ok) { delete S._savedElements; delete S._savedPaths; }
    return ok;
}

async function restore() {
    try {
        const data = JSON.parse(localStorage.getItem('pdfz-meta') || 'null');
        if (!data || !data.fileName) return false;
        const ok = await restoreSession(_sessionId(data.fileName));
        if (ok) toast('Session restored');
        return ok;
    } catch(e) { console.warn('Restore fail:', e); return false; }
}

// ─── Export PDF ───

// Metadata + date normalisation, applied to the document we are about to write
// (and applied again after a flatten rebuild, which produces a new document).
function applyExportMetadata(doc) {
    if (prefs.title) doc.setTitle(prefs.title);
    if (prefs.author) doc.setAuthor(prefs.author);
    doc.setProducer('PDF-YZ by Zigmoon');
    doc.setCreationDate(new Date());
    doc.setModificationDate(new Date());
    // pdf-lib writes “D:YYYYMMDDHHmmSSZ”. Strict validators (pdfcpu --mode=strict)
    // expect the UTC offset spelled out, so normalise both Info dates.
    try {
        const p2 = (n, l = 2) => String(n).padStart(l, '0');
        const d = new Date();
        const offMin = -d.getTimezoneOffset();
        const dateStr = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`
            + `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
            + `${offMin < 0 ? '-' : '+'}${p2(Math.floor(Math.abs(offMin) / 60))}'${p2(Math.abs(offMin) % 60)}'`;
        const infoRef = doc.context.trailerInfo && doc.context.trailerInfo.Info;
        const infoDict = infoRef ? doc.context.lookup(infoRef) : null;
        if (infoDict && typeof infoDict.set === 'function') {
            infoDict.set(PDFName.of('CreationDate'), PDFString.of(dateStr));
            infoDict.set(PDFName.of('ModDate'), PDFString.of(dateStr));
        }
    } catch (_) {}
    if (prefs.standard === 'pdfa') {
        doc.setSubject('PDF/A archival document');
        doc.setKeywords(['PDF/A']);
    }
}

// Embed the font a text block needs, degrading to a standard font when the original
// cannot be embedded. `bump` counts the substitutions so the export can warn once.
async function _exportFontFor(doc, el, isPdfa, bump) {
    const fontKey = el.font || 'Helvetica';
    try {
        if (!prefs.embedFonts && !isPdfa) {
            // “Embed fonts” off: fall back to a standard PDF font. The glyphs will
            // not match the original design, but the file stays light and every
            // viewer can render it.
            const std = fontKey === 'Times-Roman' ? 'TimesRoman'
                : fontKey === 'Courier' ? 'Courier' : 'Helvetica';
            return await doc.embedFont(StandardFonts[std] || StandardFonts.Helvetica);
        }
        if (fontKey.startsWith('gf:') || fontKey.startsWith('custom:')) {
            // Embed custom/Google font bytes (prefer the weight-specific variant)
            let entry = fontCache.get(fontKey);
            if (!entry && fontKey.startsWith('gf:')) entry = await loadGoogleFont(fontKey.slice(3));
            if (entry) {
                const w = String(el.weight || (el.bold ? 700 : 400));
                const wKey = w + (el.italic ? 'i' : '');
                const bytes = entry.weightBytes?.[wKey] || entry.weightBytes?.[w] || entry.bytes;
                if (bytes) return await doc.embedFont(bytes, { subset: false });
            }
            bump();
            return await doc.embedFont(StandardFonts.Helvetica);
        }
        const fn = fontKey === 'Times-Roman' ? 'TimesRoman' : (fontKey || 'Helvetica');
        return await doc.embedFont(StandardFonts[fn] || StandardFonts.Helvetica);
    } catch (e) {
        bump();
        console.warn('Font embed failed, using Helvetica:', fontKey, e && e.message);
        return await doc.embedFont(StandardFonts.Helvetica);
    }
}

// PDF-space bounding box of an extracted vector object (for mask intersection).
function _graphicPdfBox(el) {
    const subs = graphicPdfSubpaths(el);
    if (!subs.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sp of subs) for (const p of sp) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function _pdfBoxOfElement(el) {
    if (el.type === 'pdf-graphic') return _graphicPdfBox(el);
    if (el.type === 'text' && el.pdfX !== undefined) {
        const fs = el.pdfFontSize || 10;
        const w = (el.pdfWidth || 100);
        return { x: el.pdfX, y: el.pdfY - fs * 0.35, w, h: fs * 1.5 };
    }
    if (el.type === 'pdf-image' && el.pdfX !== undefined) {
        return { x: el.pdfX, y: el.pdfY, w: el.pdfW || 0, h: el.pdfH || 0 };
    }
    return null;
}
const _boxesHit = (a, b) => !!a && !!b && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0
    && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ── Raster handling for the export (DPI · Image quality · Compression) ──
// The export writes vector content, so these three settings can only act on the
// raster images carried by the document: the pictures and signatures the user
// placed. The source PDF's own pictures are never touched.
let _rasterStats = { resampled: 0, recompressed: 0, bytes: 0 };

function _loadImageEl(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = src;
    });
}
function _dataUrlBytes(dataUrl) {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return bytes;
}
async function _rasterBytes(src) {
    if (/^data:/i.test(src)) return _dataUrlBytes(src);
    return new Uint8Array(await (await fetch(src)).arrayBuffer());
}

// Returns { dataUrl, mime, changed }. Compression “none” leaves everything as-is.
// “Light” only resamples pictures that are clearly oversized for the chosen DPI;
// “Aggressive” always brings them down to that DPI and re-encodes JPEG sources.
async function optimizeRasterForExport(src, placedWidthPt, placedHeightPt) {
    const png = /^data:image\/png/i.test(src) || /\.png(\?|$)/i.test(src);
    const passthrough = { dataUrl: src, mime: png ? 'image/png' : 'image/jpeg', changed: false };
    if (prefs.compress === 'none') return passthrough;
    if (/^data:image\/svg/i.test(src) || /\.svg(\?|$)/i.test(src)) return passthrough;
    let img;
    try { img = await _loadImageEl(src); } catch (_) { return passthrough; }
    const natW = img.naturalWidth || img.width || 0;
    const natH = img.naturalHeight || img.height || 0;
    if (!natW || !natH) return passthrough;
    const dpi = Math.max(36, Math.min(1200, +prefs.dpi || 150));
    const targetW = Math.max(1, Math.round(((placedWidthPt || 72) / 72) * dpi));
    const targetH = Math.max(1, Math.round(((placedHeightPt || 72) / 72) * dpi));
    const over = Math.max(natW / targetW, natH / targetH);
    const aggressive = prefs.compress === 'heavy';
    const resample = aggressive ? over > 1.02 : over > 1.25;
    const recompress = aggressive && !png;          // never turn a PNG into a JPEG
    if (!resample && !recompress) return passthrough;
    const w = resample ? Math.max(1, Math.round(natW / over)) : natW;
    const h = resample ? Math.max(1, Math.round(natH / over)) : natH;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const q = Math.max(0.4, Math.min(1, +prefs.imgQuality || 0.8));
    const outUrl = png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', q);
    if (outUrl.length >= src.length) return passthrough;   // never make the file bigger
    _rasterStats.bytes += Math.max(0, src.length - outUrl.length);
    if (resample) _rasterStats.resampled++;
    else _rasterStats.recompressed++;
    return { dataUrl: outUrl, mime: png ? 'image/png' : 'image/jpeg', changed: true };
}

// Rebuild the finished document as one image per page. Nothing stays editable and
// — unlike a normal export — the original text is no longer present in the file.
async function flattenDocumentToImages(doc) {
    const bytes = await doc.save();
    const src = await pdfjsLib.getDocument({
        data: bytes.slice(),
        cMapUrl: vendor('vendor/pdfjs/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: vendor('vendor/pdfjs/standard_fonts/'),
    }).promise;
    const out = await PDFDocument.create();
    registerFontkitOnDoc(out);
    const dpi = Math.max(36, Math.min(600, +prefs.dpi || 150));
    const scale = dpi / 72;
    const useJpeg = prefs.compress === 'heavy';
    const q = Math.max(0.4, Math.min(1, +prefs.imgQuality || 0.8));
    for (let i = 1; i <= src.numPages; i++) {
        if (typeof setLoaderProgress === 'function') {
            try { setLoaderProgress(72 + (i / src.numPages) * 22, `Flattening page ${i}/${src.numPages}…`); } catch (_) {}
        }
        const pg = await src.getPage(i);
        const pt = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale });
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(vp.width));
        cv.height = Math.max(1, Math.round(vp.height));
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        const url = useJpeg ? cv.toDataURL('image/jpeg', q) : cv.toDataURL('image/png');
        const imgBytes = _dataUrlBytes(url);
        const embedded = useJpeg ? await out.embedJpg(imgBytes) : await out.embedPng(imgBytes);
        const page = out.addPage([pt.width, pt.height]);
        page.drawImage(embedded, { x: 0, y: 0, width: pt.width, height: pt.height });
        cv.width = cv.height = 0;   // release the bitmap
        await _uiYield();
    }
    return out;
}

async function exportPDF() {
    if (!S.pdfDoc) return;
    // Commit any pending inline text edit so el.content is up-to-date and
    // user-resized dimensions are persisted before we serialize the PDF.
    try { endInlineEdit(); } catch (_) {}
    showLoader('Exporting PDF…');
    try {
        let doc = await PDFDocument.load(await S.pdfDoc.save());
        registerFontkitOnDoc(doc);
        let _fontSubs = 0;   // text blocks whose original font could not be embedded
        _rasterStats = { resampled: 0, recompressed: 0, bytes: 0 };
        // PDF/A forbids non-embedded fonts: the "Embed fonts" preference is ignored
        // (otherwise we would advertise PDF/A in the XMP and ship Helvetica Type1).
        const isPdfa = prefs.standard === 'pdfa';

        applyExportMetadata(doc);

        for (let i = 0; i < doc.getPageCount(); i++) {
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            // Resize pages if preference set
            if (prefs.pageSize !== 'keep') {
                const sizes = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
                const [tw, th] = sizes[prefs.pageSize] || [width, height];
                page.setSize(tw, th);
            }

            const pw = S.pages[i]?.width || 1; const ph = S.pages[i]?.height || 1;
            const sx = page.getSize().width / pw, sy = page.getSize().height / ph;

            const elems = S.pages[i]?.elements || [];
            // Regions this page's export will paint with a flat erase mask. Anything
            // that sat ABOVE such a region has to be redrawn afterwards, otherwise
            // moving a background deletes the logo and the text drawn on it.
            const inkMasks = [];
            for (const el of elems) {
                if (el.type === 'pdf-graphic' && !el._deleted
                    && (el._moved || el.color !== el.originalColor)) {
                    const box = _graphicPdfBox(el);
                    if (box) inkMasks.push(box);
                }
            }
            const coveredByMask = el => inkMasks.length > 0
                && inkMasks.some(m => _boxesHit(_pdfBoxOfElement(el), m));
            for (const el of elems) {
                if (el.type === 'text') {
                    const untouched = el.extracted && el.content === el.originalContent
                        && (el.color === el.originalColor) && !el._moved && !el._deleted;
                    if (untouched) continue;
                    if (el.content.trim() || el.extracted) {
                        const font = await _exportFontFor(doc, el, isPdfa, () => { _fontSubs++; });
                        const c = hex2rgb(el.color);
                        if (el.extracted && el.pdfX !== undefined) {
                            // Use original PDF coordinates for precise placement.
                            const fs = el.pdfFontSize;
                            const lines = el.content.split('\n');
                            const pLines = el.pdfLines || [];
                            // When the block was dragged in modify mode, mask the ORIGINAL
                            // (baked-in) location and render the text at the NEW one.
                            // If the block was deleted after a move, mask BOTH locations.
                            const dx = el.dxPdf || 0, dy = el.dyPdf || 0;
                            const moved = !!(el._moved && (dx || dy));
                            const deleted = !!el._deleted;
                            // Mask colour: prefer the sampled page background so edited text
                            // blends with the page instead of sitting on a pure-white box.
                            const maskRgb = hex2rgb(el.bgColor || '#ffffff');
                            const baseLines = pLines.length
                                ? pLines
                                : [{ pdfX: el.pdfX, pdfY: el.pdfY, pdfFontSize: el.pdfFontSize, pdfWidth: el.pdfWidth }];
                            const lastBase = baseLines[baseLines.length - 1];
                            const maskCount = Math.max(baseLines.length, lines.length);
                            // Mask passes: original position always; + moved position if moved.
                            const maskOffsets = moved ? [[0, 0], [dx, dy]] : [[0, 0]];
                            for (const [mox, moy] of maskOffsets) {
                                for (let mi = 0; mi < maskCount; mi++) {
                                    const bl = baseLines[mi];
                                    const newLine = lines[mi] || '';
                                    let mx, my, mh, origW;
                                    if (bl) {
                                        // Generous padding so glyph side-bearings + descenders
                                        // are fully covered (was leaving residues on the right).
                                        const blFs = bl.pdfFontSize;
                                        mx = bl.pdfX - blFs * 0.15;
                                        my = bl.pdfY - blFs * 0.40;
                                        mh = blFs * 1.55;
                                        origW = (bl.pdfWidth || 100) * 1.10 + blFs * 0.30;
                                    } else {
                                        // Extra typed line: extend downward at new fs from last original line
                                        const offset = (mi - baseLines.length + 1);
                                        mx = lastBase.pdfX - fs * 0.15;
                                        my = lastBase.pdfY - lastBase.pdfFontSize * 0.40 - offset * fs * 1.4;
                                        mh = fs * 1.55;
                                        origW = (lastBase.pdfWidth || 100) * 1.10 + fs * 0.30;
                                    }
                                    let newW = 0;
                                    if (newLine) {
                                        try { newW = font.widthOfTextAtSize(newLine, fs); } catch {}
                                    }
                                    page.drawRectangle({
                                        x: mx + mox,
                                        y: my + moy,
                                        width: Math.max(origW, newW + fs * 0.5) + 2,
                                        height: mh,
                                        color: rgb(maskRgb.r / 255, maskRgb.g / 255, maskRgb.b / 255),
                                    });
                                }
                            }
                            // Now draw the new text on top of the mask (skipped when deleted).
                            if (!deleted) {
                                // If the block was moved, draw at the NEW position.
                                lines.forEach((line, li) => {
                                    if (!line.trim()) return;
                                    const pl = pLines[li];
                                    let lx = pl ? pl.pdfX : (lastBase.pdfX);
                                    let ly = pl
                                        ? pl.pdfY
                                        : (lastBase.pdfY - (li - pLines.length + 1) * fs * 1.3);
                                    if (moved) { lx += dx; ly += dy; }
                                    page.drawText(line, {
                                        x: lx,
                                        y: ly,
                                        size: fs, font,
                                        color: rgb(c.r / 255, c.g / 255, c.b / 255),
                                    });
                                });
                            }
                        } else {
                            const fs = el.fontSize * sx;
                            el.content.split('\n').forEach((line, li) => {
                                let lx = el.x * sx;
                                if (el.align === 'center' || el.align === 'right') {
                                    const lw = font.widthOfTextAtSize(line, fs);
                                    const boxW = (el.width || 200) * sx;
                                    if (el.align === 'center') lx += (boxW - lw) / 2;
                                    else lx += boxW - lw;
                                }
                                page.drawText(line, {
                                    x: lx,
                                    y: page.getSize().height - (el.y * sy) - fs - (li * fs * 1.3),
                                    size: fs, font,
                                    color: rgb(c.r / 255, c.g / 255, c.b / 255),
                                });
                            });
                        }
                    }
                } else if ((el.type === 'image' || el.type === 'signature') && el.src) {
                    try {
                        // DPI cap + optional re-encoding (see optimizeRasterForExport)
                        const opt = await optimizeRasterForExport(el.src, el.width * sx, el.height * sy);
                        const buf = await _rasterBytes(opt.dataUrl);
                        const img = opt.mime === 'image/png'
                            ? await doc.embedPng(buf) : await doc.embedJpg(buf);
                        page.drawImage(img, {
                            x: el.x * sx,
                            y: page.getSize().height - (el.y * sy) - (el.height * sy),
                            width: el.width * sx, height: el.height * sy,
                        });
                    } catch(err) { console.warn('Image embed fail:', err); }
                } else if (el.type === 'pdf-image') {
                    if (!el.replacedSrc && !el._moved && !el._resized && !el._deleted) continue;
                    try {
                        // Cover the original baked-in image before moving, replacing
                        // or deleting it. Genuine images are extracted as PNG previews.
                        page.drawRectangle({
                            x: el.pdfX - 0.5, y: el.pdfY - 0.5,
                            width: el.pdfW + 1, height: el.pdfH + 1,
                            color: rgb(1, 1, 1),
                        });
                        if (!el._deleted) {
                            const source = el.replacedSrc || el.src;
                            const resp = await fetch(source);
                            const buf = await resp.arrayBuffer();
                            const img = source.includes('png') || source.startsWith('data:image/png')
                                ? await doc.embedPng(buf) : await doc.embedJpg(buf);
                            page.drawImage(img, {
                                x: el.targetPdfX ?? el.pdfX,
                                y: el.targetPdfY ?? el.pdfY,
                                width: el.targetPdfW ?? el.pdfW,
                                height: el.targetPdfH ?? el.pdfH,
                            });
                        }
                    } catch(err) { console.warn('PDF image modification failed:', err); }
                } else if (el.type === 'pdf-graphic') {
                    const subs = graphicPdfSubpaths(el);
                    if (!subs.length) continue;
                    if (!el._moved && !el._deleted && el.color === el.originalColor) continue;
                    const dx = el.dxPdf || 0, dy = el.dyPdf || 0;
                    const pageH = page.getSize().height;
                    // drawSvgPath() flips the SVG y axis, so the path is built in SVG
                    // space (y down) and anchored at (0, pageHeight).
                    const toSvg = (offsetX, offsetY) => subs.map(sp => {
                        if (!sp || sp.length < 2) return '';
                        const pts = sp.map(p =>
                            `${(p.x + offsetX).toFixed(2)} ${(pageH - (p.y + offsetY)).toFixed(2)}`);
                        return 'M' + pts[0] + ' L' + pts.slice(1).join(' ');
                    }).filter(Boolean).join(' ');
                    const mask = hex2rgb(el.bgColor || '#ffffff');
                    const color = hex2rgb(el.strokeColor || el.color || '#000000');
                    const fillColorRgb = hex2rgb(el.fillColor || el.color || '#000000');
                    const maskColor = rgb(mask.r / 255, mask.g / 255, mask.b / 255);
                    const pdfColor = rgb(color.r / 255, color.g / 255, color.b / 255);
                    const pdfFill = rgb(fillColorRgb.r / 255, fillColorRgb.g / 255, fillColorRgb.b / 255);
                    const maskPath = toSvg(0, 0);
                    try {
                        // Erase the object baked into the page raster, then redraw it
                        // (or leave the hole when the user deleted it).
                        if (el.filled) {
                            page.drawSvgPath(maskPath, { x: 0, y: pageH, color: maskColor });
                        } else {
                            page.drawSvgPath(maskPath, {
                                x: 0, y: pageH, borderColor: maskColor,
                                borderWidth: Math.max(1, (el.pdfLineWidth || 1) + 2),
                            });
                        }
                        if (!el._deleted) {
                            page.drawSvgPath(toSvg(dx, dy), {
                                x: 0, y: pageH,
                                color: el.filled ? pdfFill : undefined,
                                borderColor: el.stroked ? pdfColor : undefined,
                                borderWidth: el.stroked ? Math.max(0.2, el.pdfLineWidth || 1) : undefined,
                            });
                        }
                    } catch (err) { console.warn('Graphic path draw failed:', err); }
                } else if (el.type === 'note' && el.content && el.content.trim()) {
                    // Embed note as colored rectangle + text
                    const nc = hex2rgb(el.noteBg || '#fff9c4');
                    const nw = el.width * sx, nh = el.height * sy;
                    const nx = el.x * sx;
                    const ny = page.getSize().height - (el.y * sy) - nh;
                    page.drawRectangle({
                        x: nx, y: ny, width: nw, height: nh,
                        color: rgb(nc.r / 255, nc.g / 255, nc.b / 255),
                        borderColor: rgb(0.6, 0.6, 0.6),
                        borderWidth: 0.5,
                    });
                    // Draw header bar
                    const hc = hex2rgb(el.noteHeader || '#ffee58');
                    const hh = 14 * sy;
                    page.drawRectangle({
                        x: nx, y: ny + nh - hh, width: nw, height: hh,
                        color: rgb(hc.r / 255, hc.g / 255, hc.b / 255),
                    });
                    // Draw note text
                    try {
                        const noteFont = await doc.embedFont(StandardFonts.Helvetica);
                        const fs = 10 * Math.min(sx, sy);
                        const lines = el.content.split('\n');
                        lines.forEach((line, li) => {
                            if (!line) return;
                            page.drawText(line, {
                                x: nx + 6 * sx,
                                y: ny + nh - hh - (fs * 1.4) - (li * fs * 1.4),
                                size: fs, font: noteFont,
                                color: rgb(0.15, 0.15, 0.15),
                            });
                        });
                    } catch(err) { console.warn('Note text embed fail:', err); }
                }
            }
            // ── Objects that sat ABOVE a mask are redrawn on top of it ──
            // A mask is a flat colour: without this pass, moving a background would
            // erase the logo paths and the text drawn over it in the exported file.
            if (inkMasks.length) {
                for (const el of elems) {
                    if (el._deleted || !el.extracted) continue;
                    if (el._moved || el.color !== el.originalColor) continue; // already redrawn
                    if (!coveredByMask(el)) continue;
                    try {
                        if (el.type === 'text' && el.pdfX !== undefined && (el.content || '').trim()) {
                            const font = await _exportFontFor(doc, el, isPdfa, () => { _fontSubs++; });
                            const c = hex2rgb(el.color);
                            const pLines = el.pdfLines || [];
                            const base = pLines.length
                                ? pLines
                                : [{ pdfX: el.pdfX, pdfY: el.pdfY, pdfFontSize: el.pdfFontSize }];
                            el.content.split('\n').forEach((line, li) => {
                                if (!line.trim()) return;
                                const pl = pLines[li];
                                const lx = pl ? pl.pdfX : base[0].pdfX;
                                const ly = pl ? pl.pdfY
                                    : base[0].pdfY - (li - pLines.length + 1) * (el.pdfFontSize || 10) * 1.3;
                                page.drawText(line, {
                                    x: lx, y: ly,
                                    size: el.pdfFontSize || 10, font,
                                    color: rgb(c.r / 255, c.g / 255, c.b / 255),
                                });
                            });
                        } else if (el.type === 'pdf-graphic') {
                            const subs = graphicPdfSubpaths(el);
                            if (!subs.length) continue;
                            const pageH = page.getSize().height;
                            const d = subs.map(sp => {
                                if (!sp || sp.length < 2) return '';
                                const pts = sp.map(p => `${p.x.toFixed(2)} ${(pageH - p.y).toFixed(2)}`);
                                return 'M' + pts[0] + ' L' + pts.slice(1).join(' ');
                            }).filter(Boolean).join(' ');
                            const fill = hex2rgb(el.fillColor || el.color || '#000000');
                            const stroke = hex2rgb(el.strokeColor || el.color || '#000000');
                            page.drawSvgPath(d, {
                                x: 0, y: pageH,
                                color: el.filled ? rgb(fill.r / 255, fill.g / 255, fill.b / 255) : undefined,
                                borderColor: el.stroked ? rgb(stroke.r / 255, stroke.g / 255, stroke.b / 255) : undefined,
                                borderWidth: el.stroked ? Math.max(0.2, el.pdfLineWidth || 1) : undefined,
                            });
                        }
                    } catch (err) { console.warn('Mask redraw failed:', err); }
                }
            }
            // Draw paths
            const paths = S.pages[i]?.paths || [];
            for (const p of paths) {
                if (p.points.length < 2) continue;
                const c = hex2rgb(p.color);
                for (let j = 1; j < p.points.length; j++) {
                    page.drawLine({
                        start: { x: p.points[j-1].x * sx, y: page.getSize().height - p.points[j-1].y * sy },
                        end: { x: p.points[j].x * sx, y: page.getSize().height - p.points[j].y * sy },
                        thickness: p.width * sx,
                        color: rgb(c.r/255, c.g/255, c.b/255),
                        opacity: p.alpha,
                    });
                }
            }
            // Crop marks
            if (prefs.cropMarks) {
                const cmLen = prefs.cropLength || 8;
                const cmOff = prefs.cropOffset || 6;
                const cmW = 0.5;
                const cmColor = rgb(0, 0, 0);
                // Top-left
                page.drawLine({ start: { x: -cmOff - cmLen, y: height }, end: { x: -cmOff, y: height }, thickness: cmW, color: cmColor });
                page.drawLine({ start: { x: 0, y: height + cmOff }, end: { x: 0, y: height + cmOff + cmLen }, thickness: cmW, color: cmColor });
                // Top-right
                page.drawLine({ start: { x: width + cmOff, y: height }, end: { x: width + cmOff + cmLen, y: height }, thickness: cmW, color: cmColor });
                page.drawLine({ start: { x: width, y: height + cmOff }, end: { x: width, y: height + cmOff + cmLen }, thickness: cmW, color: cmColor });
                // Bottom-left
                page.drawLine({ start: { x: -cmOff - cmLen, y: 0 }, end: { x: -cmOff, y: 0 }, thickness: cmW, color: cmColor });
                page.drawLine({ start: { x: 0, y: -cmOff }, end: { x: 0, y: -cmOff - cmLen }, thickness: cmW, color: cmColor });
                // Bottom-right
                page.drawLine({ start: { x: width + cmOff, y: 0 }, end: { x: width + cmOff + cmLen, y: 0 }, thickness: cmW, color: cmColor });
                page.drawLine({ start: { x: width, y: -cmOff }, end: { x: width, y: -cmOff - cmLen }, thickness: cmW, color: cmColor });
                // Expand MediaBox to show marks outside trim area
                const extra = cmOff + cmLen + 4;
                page.setMediaBox(-extra, -extra, width + extra * 2, height + extra * 2);
                page.setTrimBox(0, 0, width, height);
                page.setBleedBox(-3, -3, width + 6, height + 6);
            }
            // Watermark
            if (prefs.watermark.trim()) {
                const wmFont = await doc.embedFont(StandardFonts.HelveticaBold);
                const wmSize = Math.min(width, height) * 0.08;
                const wmText = prefs.watermark.trim();
                const tw = wmFont.widthOfTextAtSize(wmText, wmSize);
                page.drawText(wmText, {
                    x: width / 2 - tw / 2,
                    y: height / 2 - wmSize / 2,
                    size: wmSize,
                    font: wmFont,
                    color: rgb(0.5, 0.5, 0.5),
                    opacity: prefs.wmOpacity,
                    rotate: degrees(45),
                });
            }
        }

        // ─── Flatten: rebuild the document as page images ───
        if (prefs.flatten) {
            try { setLoaderProgress(70, 'Flattening pages…'); } catch (_) {}
            doc = await flattenDocumentToImages(doc);
            applyExportMetadata(doc);   // a rebuilt document loses its metadata
        }

        // ─── ICC profile / PDF-A OutputIntent ───
        // PDF/A requires an OutputIntent carrying an embedded ICC profile, even when
        // the user selected none → fall back to the generated sRGB profile.
        let iccToEmbed = (S.iccProfile && S.iccProfile.bytes) ? S.iccProfile : null;
        if (isPdfa && !iccToEmbed) {
            try {
                const bytes = generateICCProfile('srgb');
                if (bytes) iccToEmbed = { id: 'srgb', name: ICC_PROFILES.srgb.name, space: 'RGB', bytes };
            } catch (_) {}
        }
        if (iccToEmbed) {
            try {
                embedICCProfile(doc, iccToEmbed, isPdfa ? 'GTS_PDFA1' : 'GTS_PDFX');
            } catch (iccErr) { console.warn('ICC embed failed:', iccErr); }
        }
        if (isPdfa) {
            try {
                applyPdfaMetadata(doc, {
                    title: prefs.title || doc.getTitle() || S.fileName || '',
                    author: prefs.author || doc.getAuthor() || '',
                    producer: 'PDF-YZ by Zigmoon',
                });
            } catch (xmpErr) { console.warn('PDF/A metadata failed:', xmpErr); }
        }

        // Build filename with standard suffix
        let exportName = S.fileName;
        if (prefs.standard === 'pdfa' && !exportName.includes('_PDFA')) {
            exportName = exportName.replace('.pdf', '_PDFA.pdf');
        } else if (prefs.standard === 'print' && !exportName.includes('_PRINT')) {
            exportName = exportName.replace('.pdf', '_PRINT.pdf');
        }

        const out = await doc.save();
        const blob = new Blob([out], { type: 'application/pdf' });
        const a = document.createElement('a');
        const dlUrl = URL.createObjectURL(blob);
        a.href = dlUrl;
        a.download = exportName;
        a.click();
        // Revoking synchronously can abort the save of a large file: the browser may
        // not have started reading the blob yet. Give it a moment.
        setTimeout(() => { try { URL.revokeObjectURL(dlUrl); } catch (_) {} }, 4000);
        hideLoader();
        toast(`PDF exported · ${prefs.standard === 'pdfa' ? 'PDF/A' : prefs.standard === 'print' ? 'Print-ready' : 'Standard'} · ${prefs.dpi} DPI`);
        if (_fontSubs > 0) {
            toast(`${_fontSubs} block${_fontSubs > 1 ? 's' : ''}: original font not embeddable, substitute used`);
        }
        if (isPdfa && !prefs.embedFonts) toast('PDF/A: fonts embedded (required)');
    } catch(e) { hideLoader(); toast('Export error: ' + e.message); console.error(e); }
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF → .sp (SuperPrint) conversion
// ---------------------------------------------------------------------------
// Verified against superprint/app/JS/main.js:
//   • _spValidateProjectFile (L92681) only requires { _sp.format, document.format.{w,h},
//     pages[].objects } — everything else is optional and gets a default.
//   • mmToPx = mm * 72 / 25.4 (L13381) ⇒ Fabric coordinates are PDF POINTS.
//     A PDF page therefore maps 1:1; only the Y axis flips (PDF counts up, Fabric down).
//   • loadProjectSP (L92924) accepts a string OR an already-parsed object.
//   • resources.customFonts = [{ name, data: dataURL }] carries real fonts.
// ═══════════════════════════════════════════════════════════════════════════
const SP = { dpi: 150, format: 'png', mode: 'image-text', embedFonts: true, bleed: 0, textBlocks: 0, busy: false };

// Editable text blocks captured from the source PDF.
function spTextBlocksOf(pageData) {
    if (!pageData || !Array.isArray(pageData.elements)) return [];
    return pageData.elements.filter(el =>
        el && el.extracted && !el._deleted && el.type === 'text' &&
        typeof el.content === 'string' && el.content.trim() &&
        el.pdfX !== undefined && el.pdfY !== undefined && !el._virtHidden);
}

// Our internal font key → the family name SuperPrint knows.
function spFabricFamily(fontKey) {
    if (!fontKey) return 'Helvetica';
    if (fontKey.startsWith('gf:')) return fontKey.slice(3);
    if (fontKey.startsWith('custom:')) return fontKey.slice(7);
    if (fontKey === 'Times-Roman') return 'Times New Roman';
    if (fontKey === 'Courier') return 'Courier New';
    return fontKey;
}

// Width the text will REALLY occupy once SuperPrint redraws it with the substituted
// family, in PDF points. `el.pdfWidth` only describes the ORIGINAL glyphs: when the
// original is a condensed face (e.g. the Bebas-like « SUPERPRINT.cc » wordmark of the
// press kit) and its substitute is wider, the redrawn text no longer fits the
// textbox/mask we derived from pdfWidth → Fabric wraps it and it spills over the
// neighbouring artwork (the logo then looks duplicated). The fonts must be loaded
// before measuring, hence the preload pass in convertToSP().
const _spMeasureCv = document.createElement('canvas');
function measureSpTextWidth(text, fs, family, weight, style) {
    try {
        const ctx = _spMeasureCv.getContext('2d');
        ctx.font = `${style || 'normal'} ${weight || 'normal'} ${fs}px "${family}", sans-serif`;
        let w = 0;
        for (const line of String(text).split('\n')) {
            const m = ctx.measureText(line).width;
            if (m > w) w = m;
        }
        return w;
    } catch (_) { return 0; }
}

// Can we mask the original glyphs baked in the page image without leaving a
// visible patch? Only when the area around the block is a FLAT colour.
function spProbeBackground(canvas, el) {
    try {
        const e = _getPixels(canvas);
        const bx = el.x, by = el.y;
        const bw = Math.max(6, el.width || 60);
        const bh = Math.max(6, (el.fontSize || 12) * 1.35);
        const cols = [];
        const N = 7;
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const pts = [[bx + bw * t, by - 3], [bx + bw * t, by + bh + 3],
                         [bx - 3, by + bh * t], [bx + bw + 3, by + bh * t]];
            for (const [px, py] of pts) {
                const c = _pxAt(e, px, py);
                if (c && c[3] > 128) cols.push(c);
            }
        }
        if (cols.length < 8) return { flat: false };
        const median = k => { const a = cols.map(c => c[k]).sort((p, q) => p - q); return a[a.length >> 1]; };
        const m = [median(0), median(1), median(2)];
        let close = 0;
        for (const c of cols) {
            if (Math.abs(c[0] - m[0]) <= 14 && Math.abs(c[1] - m[1]) <= 14 && Math.abs(c[2] - m[2]) <= 14) close++;
        }
        const ratio = close / cols.length;
        return { flat: ratio >= 0.88, color: '#' + m.map(v => v.toString(16).padStart(2, '0')).join(''), ratio };
    } catch (_) { return { flat: false }; }
}

function _abToBase64(ab) {
    const bytes = new Uint8Array(ab);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}
function _fontMime(ab) {
    try {
        const b = new Uint8Array(ab, 0, 4);
        const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
        if (tag === 'wOF2') return 'font/woff2';
        if (tag === 'wOFF') return 'font/woff';
        if (tag === 'OTTO') return 'font/otf';
    } catch (_) {}
    return 'font/ttf';
}

function openSpModal() {
    if (!S.pdfDoc || !S.pdfJs) { toast('Ouvrez d\'abord un PDF'); return; }
    // While the render/extraction pass is running the text blocks are not known yet,
    // and a text PDF would wrongly look like a scanned one.
    if (_renderBusy) { toast('Document en cours d\'analyse — patientez un instant'); return; }
    const count = S.pdfDoc.getPageCount();
    const size = S.pdfDoc.getPage(0).getSize();
    const wmm = size.width * 25.4 / 72, hmm = size.height * 25.4 / 72;
    $('spFileInfo').textContent = `${S.fileName} · ${count} page${count > 1 ? 's' : ''} · ${wmm.toFixed(0)} × ${hmm.toFixed(0)} mm`;
    let blocks = 0;
    for (let i = 0; i < count; i++) blocks += spTextBlocksOf(S.pages[i]).length;
    SP.textBlocks = blocks;
    // A scanned PDF has no text layer: force the image-only mode.
    const textBox = $('spChoiceText'), textRadio = textBox.querySelector('input');
    const imgRadio = $('spChoiceImage').querySelector('input');
    if (blocks === 0) {
        textBox.classList.add('disabled');
        textRadio.disabled = true;
        textRadio.checked = false;
        imgRadio.checked = true;
        SP.mode = 'image';
    } else {
        textBox.classList.remove('disabled');
        textRadio.disabled = false;
        if (SP.mode === 'image') imgRadio.checked = true; else textRadio.checked = true;
    }
    syncSpChoices();
    updateSpSummary();
    $('spProgress').classList.remove('on');
    $('spProgressBar').style.width = '0%';
    $('spGo').disabled = false;
    $('spCancel').disabled = false;
    $('spModal').classList.add('visible');
    // Keep keyboard navigation inside the dialog (it is aria-modal).
    setTimeout(() => { try { $('spModal').querySelector('.export-box').focus(); } catch (_) {} }, 30);
}
function closeSpModal() {
    if (SP.busy) return;
    $('spModal').classList.remove('visible');
}
function syncSpChoices() {
    $('spChoiceText').classList.toggle('active', SP.mode === 'image-text');
    $('spChoiceImage').classList.toggle('active', SP.mode === 'image');
}
function updateSpSummary() {
    const count = S.pdfDoc ? S.pdfDoc.getPageCount() : 0;
    const scale = SP.dpi / 72;
    let px = 0;
    for (let i = 0; i < count; i++) {
        const p = S.pdfDoc.getPage(i).getSize();
        px += (p.width * scale) * (p.height * scale);
    }
    const perPx = SP.format === 'png' ? 0.34 : 0.11;
    const bytes = px * perPx * 1.34;            // base64 adds ~34%
    const mb = bytes / 1048576;
    const sizeTxt = mb >= 1 ? `≈ ${mb.toFixed(1)} Mo` : `≈ ${Math.max(1, Math.round(mb * 1024))} Ko`;
    const parts = [`${count} page${count > 1 ? 's' : ''}`];
    if (SP.mode === 'image-text') parts.push(`${SP.textBlocks || 0} bloc${(SP.textBlocks || 0) > 1 ? 's' : ''} de texte`);
    parts.push(sizeTxt);
    if (mb > 40) parts.push('<strong style="color:#b45309">volumineux : essayez 96 dpi ou JPEG</strong>');
    $('spSummary').innerHTML = parts.join(' · ');
}

async function convertToSP() {
    if (SP.busy || !S.pdfJs || !S.pdfDoc) return;
    SP.busy = true;
    const goBtn = $('spGo'), cancelBtn = $('spCancel');
    goBtn.disabled = true; cancelBtn.disabled = true;
    $('spProgress').classList.add('on');
    const setP = (pct, label) => {
        $('spProgressBar').style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
        if (label) $('spProgressLabel').textContent = label;
    };
    try {
        const count = S.pdfDoc.getPageCount();
        const scale = SP.dpi / 72;
        const pages = [];
        const fontsUsed = new Set();
        const fontKeys = new Set();
        const customFonts = [];
        const embedded = new Set();
        let convertedBlocks = 0, rasterBlocks = 0, totalObjects = 0;
        let pageWmm = 210, pageHmm = 297;

        // Load the fonts we are about to measure/redraw, so measureSpTextWidth() and
        // the embedded customFonts are based on the real metrics.
        if (SP.mode === 'image-text') {
            const need = new Set();
            S.pages.forEach(pd => spTextBlocksOf(pd).forEach(el => {
                if (el.font && el.font.startsWith('gf:')) need.add(el.font.slice(3));
            }));
            for (const name of need) {
                setP(0, `Police ${name}…`);
                await _uiYield();
                try { await loadGoogleFont(name); } catch (_) {}
            }
        }

        for (let i = 0; i < count; i++) {
            setP((i / count) * 100, `Page ${i + 1}/${count} — rendu…`);
            await _uiYield();
            const pg = await S.pdfJs.getPage(i + 1);
            const vp1 = pg.getViewport({ scale: 1 });
            const ptW = vp1.width, ptH = vp1.height;     // viewport at scale 1 = points
            if (i === 0) { pageWmm = ptW * 25.4 / 72; pageHmm = ptH * 25.4 / 72; }
            const vp = pg.getViewport({ scale });
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(vp.width));
            cv.height = Math.max(1, Math.round(vp.height));
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cv.width, cv.height);
            await pg.render({ canvasContext: ctx, viewport: vp }).promise;
            const dataUrl = SP.format === 'png'
                ? cv.toDataURL('image/png')
                : cv.toDataURL('image/jpeg', 0.88);

            const objects = [{
                type: 'image', version: '5.3.0', originX: 'left', originY: 'top',
                left: 0, top: 0, width: cv.width, height: cv.height,
                scaleX: ptW / cv.width, scaleY: ptH / cv.height,
                angle: 0, opacity: 1, flipX: false, flipY: false, crossOrigin: 'anonymous',
                selectable: true, evented: true, src: dataUrl,
            }];

            if (SP.mode === 'image-text') {
                const pd = S.pages[i];
                for (const el of spTextBlocksOf(pd)) {
                    const probe = spProbeBackground(pd.canvas, el);
                    if (!probe.flat) { rasterBlocks++; continue; }   // photo/gradient: keep as raster
                    const fs = el.pdfFontSize || 12;
                    const lines = String(el.content).split('\n').length;
                    const origW = Math.max(20, (el.pdfWidth || 100) * 1.10);
                    const family = spFabricFamily(el.font);
                    const fWeight = (el.weight >= 600) ? 'bold' : 'normal';
                    const fStyle = el.italic ? 'italic' : 'normal';
                    const measured = measureSpTextWidth(el.content, fs, family, fWeight, fStyle);
                    const boxW = Math.max(origW, measured + fs * 0.2);
                    // Keep the ORIGINAL footprint: a wider substitute gets condensed
                    // (Fabric scales around originX/originY = left/top, so the text
                    // stays exactly where the original was and never wraps).
                    const scaleX = measured > origW * 1.04 ? Math.max(0.5, origW / boxW) : 1;
                    const boxH = fs * 1.16 * lines;
                    const maskH = Math.max(boxH, fs * 1.34 * lines) + 2;
                    const top = ptH - el.pdfY - fs * 0.80;           // baseline → box top, Y flipped
                    fontKeys.add(el.font);
                    fontsUsed.add(family);
                    // 1) mask the original glyphs, 2) draw the editable text on top
                    objects.push({
                        type: 'rect', version: '5.3.0', originX: 'left', originY: 'top',
                        left: el.pdfX - 1.5, top: top - 1, width: origW + 3, height: maskH,
                        fill: probe.color, stroke: null, strokeWidth: 0,
                        scaleX: 1, scaleY: 1, angle: 0, opacity: 1,
                        selectable: true, evented: true,
                    });
                    objects.push({
                        type: 'textbox', version: '5.3.0', originX: 'left', originY: 'top',
                        left: el.pdfX, top, width: boxW, height: boxH,
                        text: el.content, fontSize: fs, fontFamily: family,
                        fontWeight: fWeight, fontStyle: fStyle,
                        fill: el.color || '#000000', textAlign: 'left',
                        lineHeight: 1.16, charSpacing: 0, underline: false, linethrough: false,
                        scaleX, scaleY: 1, angle: 0, opacity: 1,
                        selectable: true, evented: true,
                    });
                    convertedBlocks++;
                }
            }
            totalObjects += objects.length;
            cv.width = cv.height = 0;   // release the bitmap
            pages.push({ index: i, label: `Page ${i + 1}`, masterId: null, objects });
            setP(((i + 1) / count) * 100, `Page ${i + 1}/${count} — ok`);
            await _uiYield();
        }

        // Embed the fonts we actually used (SuperPrint re-registers them on open).
        if (SP.embedFonts) {
            let fi = 0;
            for (const key of fontKeys) {
                if (!key || !key.startsWith('gf:') || embedded.has(key)) continue;
                fi++;
                setP(100, `Police ${fi} — ${key.slice(3)}…`);
                await _uiYield();
                let entry = fontCache.get(key);
                if (!entry) { try { entry = await loadGoogleFont(key.slice(3)); } catch (_) { entry = null; } }
                if (!entry || !entry.bytes) continue;
                embedded.add(key);
                try {
                    customFonts.push({
                        name: key.slice(3),
                        data: `data:${_fontMime(entry.bytes)};base64,${_abToBase64(entry.bytes)}`,
                    });
                } catch (_) {}
            }
        }

        const now = new Date().toISOString();
        const bleedMm = Math.max(0, Number(SP.bleed) || 0);
        const title = (S.fileName || 'document.pdf').replace(/\.pdf$/i, '');
        const spObj = {
            _sp: {
                format: 'SuperPrint Document', version: '1.0.0',
                engine: 'Fabric.js 5.3.0', created: now, modified: now, generator: 'PDF-YZ',
            },
            meta: {
                title, author: '', description: 'Converti depuis un PDF par PDF-YZ', tags: [],
                stats: { pages: pages.length, objects: totalObjects, textBlocks: convertedBlocks, images: pages.length, shapes: 0, totalObjects },
            },
            document: {
                format: {
                    width: +pageWmm.toFixed(3), height: +pageHmm.toFixed(3),
                    unit: 'mm', orientation: pageWmm > pageHmm ? 'landscape' : 'portrait',
                },
                margin: 0,
                margins: { top: 0, bottom: 0, inner: 0, outer: 0, left: 0, right: 0 },
                bleed: bleedMm, viewMode: 'single', colorMode: 'rgb',
                styles: { typography: [], swatches: [] },
            },
            resources: { fonts: [...fontsUsed], colors: [], spotInks: {}, customFonts },
            textLinks: {},
            guides: [],
            masters: { templates: {}, assignments: {} },
            numbering: {
                enabled: false, startAt: 1, position: 'bottom-center', fontFamily: 'Open Sans',
                fontSize: 10, fontColor: '#333333', prefix: '', suffix: '', style: 'decimal',
                marginBottom: 15, marginSide: 20,
            },
            numberingOverrides: {},
            pages,
        };

        const json = JSON.stringify(spObj);
        const fileName = title + '.sp';
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);

        setP(100, 'Terminé');
        $('spModal').classList.remove('visible');
        SP.busy = false;
        goBtn.disabled = false; cancelBtn.disabled = false;
        showSpDone(fileName, json.length, convertedBlocks, rasterBlocks, embedded.size);
    } catch (e) {
        console.error('SP conversion failed:', e);
        SP.busy = false;
        goBtn.disabled = false; cancelBtn.disabled = false;
        $('spProgress').classList.remove('on');
        toast('Conversion impossible : ' + (e && e.message ? e.message : e));
    }
}

let _spDoneTimer = null;
function showSpDone(fileName, bytes, converted, raster, fonts) {
    const mb = bytes / 1048576;
    const sizeTxt = mb >= 1 ? `${mb.toFixed(1)} Mo` : `${Math.max(1, Math.round(mb * 1024))} Ko`;
    const bits = [];
    if (converted) bits.push(`${converted} bloc${converted > 1 ? 's' : ''} éditable${converted > 1 ? 's' : ''}`);
    if (raster) bits.push(`${raster} laissé${raster > 1 ? 's' : ''} en image`);
    if (fonts) bits.push(`${fonts} police${fonts > 1 ? 's' : ''} embarquée${fonts > 1 ? 's' : ''}`);
    $('spDoneText').innerHTML =
        `✓ <em>${fileName}</em> téléchargé (${sizeTxt})` +
        (bits.length ? `<br><span style="opacity:0.7">${bits.join(' · ')}</span>` : '') +
        `<br><span style="opacity:0.6">Glissez le fichier dans la fenêtre SuperPrint pour l'ouvrir.</span>`;
    $('spDone').classList.add('visible');
    clearTimeout(_spDoneTimer);
    _spDoneTimer = setTimeout(() => $('spDone').classList.remove('visible'), 25000);
}

// ── .sp: wiring ──
if ($('btnConvertSp')) $('btnConvertSp').onclick = () => openSpModal();
if ($('spCancel')) $('spCancel').onclick = closeSpModal;
if ($('spGo')) $('spGo').onclick = convertToSP;
if ($('spDoneClose')) $('spDoneClose').onclick = () => $('spDone').classList.remove('visible');
if ($('spDpi')) $('spDpi').onchange = e => { SP.dpi = Number(e.target.value) || 150; updateSpSummary(); };
if ($('spFormat')) $('spFormat').onchange = e => { SP.format = e.target.value === 'jpg' ? 'jpg' : 'png'; updateSpSummary(); };
if ($('spBleed')) $('spBleed').oninput = e => { SP.bleed = Math.max(0, Number(e.target.value) || 0); };
if ($('spEmbedFonts')) $('spEmbedFonts').onchange = e => { SP.embedFonts = !!e.target.checked; };
document.querySelectorAll('#spModal input[name="spMode"]').forEach(r => {
    r.onchange = () => { if (!r.checked) return; SP.mode = r.value; syncSpChoices(); updateSpSummary(); };
});
$('spChoiceText')?.addEventListener('click', e => {
    if (e.target.tagName === 'INPUT') return;
    const r = $('spChoiceText').querySelector('input');
    if (r && !r.disabled) { r.checked = true; r.dispatchEvent(new Event('change')); }
});
$('spChoiceImage')?.addEventListener('click', e => {
    if (e.target.tagName === 'INPUT') return;
    const r = $('spChoiceImage').querySelector('input');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
});
$('spModal')?.addEventListener('mousedown', e => { if (e.target === $('spModal')) closeSpModal(); });
function hex2rgb(h) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : { r:0, g:0, b:0 };
}

// ─── ICC Profile Management ───
S.iccProfile = null; // { id, name, space, bytes: Uint8Array }
try {
    const savedICC = localStorage.getItem('pdfz-icc-id');
    if (savedICC) S.iccProfile = { id: savedICC, name: '', space: '', bytes: null, pending: true };
} catch {}

const ICC_PROFILES = {
    // CMYK — FOGRA / ISO
    fogra39:     { name: 'FOGRA39 (ISO Coated v2)',       space: 'CMYK', components: 4 },
    fogra47:     { name: 'FOGRA47 (Uncoated)',            space: 'CMYK', components: 4 },
    fogra51:     { name: 'FOGRA51 (PSO Coated v3)',       space: 'CMYK', components: 4 },
    fogra52:     { name: 'FOGRA52 (PSO Uncoated v3)',     space: 'CMYK', components: 4 },
    swop:        { name: 'US Web Coated (SWOP) v2',       space: 'CMYK', components: 4 },
    gracol:      { name: 'GRACoL 2006 Coated',            space: 'CMYK', components: 4 },
    japancolor:  { name: 'Japan Color 2001 Coated',       space: 'CMYK', components: 4 },
    // RGB
    srgb:        { name: 'sRGB IEC61966-2.1',             space: 'RGB',  components: 3 },
    adobergb:    { name: 'Adobe RGB (1998)',               space: 'RGB',  components: 3 },
    displayp3:   { name: 'Display P3',                    space: 'RGB',  components: 3 },
    // Gray
    dotgain20:   { name: 'Dot Gain 20%',                  space: 'Gray', components: 1 },
    grayD50:     { name: 'Gray Gamma 2.2 (D50)',          space: 'Gray', components: 1 },
};

// Minimal valid ICC profile generator (sRGB-based for RGB, CMYK placeholder, Gray placeholder)
// These are compact but valid ICC v2/v4 structures
function generateICCProfile(id) {
    const info = ICC_PROFILES[id];
    if (!info) return null;
    // Generate a minimal valid ICC profile
    return buildMinimalICC(id, info);
}

function buildMinimalICC(id, info) {
    // ICC profile header is 128 bytes + tag table + tag data
    // We build a minimal but standards-compliant ICC profile
    const profileDesc = info.name;
    const space = info.space;
    const n = info.components;

    // Profile description tag data (ASCII)
    const descBytes = new TextEncoder().encode(profileDesc);
    const descTagData = new Uint8Array(12 + descBytes.length + 1);
    // 'desc' type signature
    descTagData.set([0x64, 0x65, 0x73, 0x63], 0); // 'desc'
    descTagData.set([0, 0, 0, 0], 4); // reserved
    // ASCII count (big-endian 4 bytes)
    const ascLen = descBytes.length + 1;
    descTagData[8] = (ascLen >> 24) & 0xff;
    descTagData[9] = (ascLen >> 16) & 0xff;
    descTagData[10] = (ascLen >> 8) & 0xff;
    descTagData[11] = ascLen & 0xff;
    descTagData.set(descBytes, 12);

    // Copyright tag
    const copyrightStr = 'Public Domain';
    const copyrightBytes = new TextEncoder().encode(copyrightStr);
    const cprtTagData = new Uint8Array(8 + copyrightBytes.length + 1);
    cprtTagData.set([0x74, 0x65, 0x78, 0x74], 0); // 'text'
    cprtTagData.set([0, 0, 0, 0], 4);
    cprtTagData.set(copyrightBytes, 8);

    // White point tag (D50: X=0.9505, Y=1.0, Z=1.0890)
    // s15Fixed16: multiply by 65536
    const wtptData = new Uint8Array(20);
    wtptData.set([0x58, 0x59, 0x5A, 0x20], 0); // 'XYZ '
    wtptData.set([0, 0, 0, 0], 4);
    const writeS15F16 = (arr, off, val) => {
        const v = Math.round(val * 65536);
        arr[off] = (v >> 24) & 0xff;
        arr[off+1] = (v >> 16) & 0xff;
        arr[off+2] = (v >> 8) & 0xff;
        arr[off+3] = v & 0xff;
    };
    writeS15F16(wtptData, 8, 0.9505);
    writeS15F16(wtptData, 12, 1.0);
    writeS15F16(wtptData, 16, 1.089);

    // Color space specific tags
    let colorSpaceSig, pcsSpace;
    let extraTags = [];
    if (space === 'RGB') {
        colorSpaceSig = [0x52, 0x47, 0x42, 0x20]; // 'RGB '
        pcsSpace = [0x58, 0x59, 0x5A, 0x20]; // 'XYZ '
        // rTRC, gTRC, bTRC — gamma 2.2 curve
        const trcData = new Uint8Array(12);
        trcData.set([0x63, 0x75, 0x72, 0x76], 0); // 'curv'
        trcData.set([0, 0, 0, 0], 4);
        trcData[8] = 0; trcData[9] = 0; trcData[10] = 0; trcData[11] = 1; // count=1
        // Single gamma: 2.2 as u8Fixed8: 2.2 * 256 = 563 = 0x0233
        const gamma22 = id === 'displayp3' ? 563 : (id === 'adobergb' ? 567 : 563);
        const trcFull = new Uint8Array(14);
        trcFull.set(trcData.subarray(0, 12), 0);
        trcFull[12] = (gamma22 >> 8) & 0xff;
        trcFull[13] = gamma22 & 0xff;

        // Primaries (XYZ values for sRGB / AdobeRGB / P3)
        const primaries = {
            srgb: { r: [0.4360747, 0.2225045, 0.0139322], g: [0.3850649, 0.7168786, 0.0971045], b: [0.1430804, 0.0606169, 0.7141733] },
            adobergb: { r: [0.6097559, 0.3111242, 0.0194811], g: [0.2052401, 0.6256560, 0.0608902], b: [0.1492240, 0.0632198, 0.7448387] },
            displayp3: { r: [0.5151187, 0.2411892, -0.0010505], g: [0.2919778, 0.6922441, 0.0418791], b: [0.1571035, 0.0665668, 0.7843814] },
        };
        const pm = primaries[id] || primaries.srgb;
        const makeXYZ = (xyz) => { const d = new Uint8Array(20); d.set([0x58,0x59,0x5A,0x20,0,0,0,0],0); writeS15F16(d,8,xyz[0]); writeS15F16(d,12,xyz[1]); writeS15F16(d,16,xyz[2]); return d; };
        extraTags.push({ sig: 'rXYZ', data: makeXYZ(pm.r) });
        extraTags.push({ sig: 'gXYZ', data: makeXYZ(pm.g) });
        extraTags.push({ sig: 'bXYZ', data: makeXYZ(pm.b) });
        extraTags.push({ sig: 'rTRC', data: trcFull });
        extraTags.push({ sig: 'gTRC', data: trcFull });
        extraTags.push({ sig: 'bTRC', data: trcFull });
    } else if (space === 'CMYK') {
        colorSpaceSig = [0x43, 0x4D, 0x59, 0x4B]; // 'CMYK'
        pcsSpace = [0x4C, 0x61, 0x62, 0x20]; // 'Lab '
        // Minimal A2B0 tag (identity-ish LUT) for CMYK profile validity
        // We use a type 'mft2' (lut16) minimal identity
        const lutSize = 2; // grid points
        const inCh = 4, outCh = 3;
        const clutEntries = Math.pow(lutSize, inCh) * outCh; // 16*3 = 48
        const mft2Len = 52 + 0 + clutEntries * 2 + 0; // header=52, no input/output tables for identity
        const a2b0 = new Uint8Array(52 + 2 * inCh + clutEntries * 2 + 2 * outCh);
        a2b0.set([0x6D,0x66,0x74,0x32], 0); // 'mft2'
        a2b0.set([0,0,0,0], 4); // reserved
        a2b0[8] = inCh;  // input channels
        a2b0[9] = outCh;  // output channels
        a2b0[10] = lutSize; // grid points
        a2b0[11] = 0; // padding
        // 3x3 identity matrix (e8.8 fixed point at offset 12)
        const matOff = 12;
        const writeE8F8 = (arr, off, val) => {
            const v = Math.round(val * 256);
            arr[off] = (v >> 8) & 0xff;
            arr[off + 1] = v & 0xff;
        };
        // Identity 3x3 for PCS
        writeE8F8(a2b0, matOff, 1); writeE8F8(a2b0, matOff+2, 0); writeE8F8(a2b0, matOff+4, 0);
        writeE8F8(a2b0, matOff+6, 0); writeE8F8(a2b0, matOff+8, 1); writeE8F8(a2b0, matOff+10, 0);
        writeE8F8(a2b0, matOff+12, 0); writeE8F8(a2b0, matOff+14, 0); writeE8F8(a2b0, matOff+16, 1);
        // Input table entries count
        a2b0[48] = 0; a2b0[49] = 2; // 2 entries per channel
        // Output table entries count
        a2b0[50] = 0; a2b0[51] = 2;
        // Input tables (identity: 0, 65535 for each of 4 channels)
        let off = 52;
        for (let ch = 0; ch < inCh; ch++) {
            a2b0[off] = 0; a2b0[off+1] = 0; off += 2;
            a2b0[off] = 0xff; a2b0[off+1] = 0xff; off += 2;
        }
        // CLUT: simple CMYK->Lab mapping (basic approximation)
        // For each grid point combination, produce Lab values
        for (let i = 0; i < Math.pow(lutSize, inCh); i++) {
            // Simple: map to L* 100→0 based on total ink, a*=128, b*=128 (neutral)
            let c = (i >> 3) & 1, m = (i >> 2) & 1, y = (i >> 1) & 1, k = i & 1;
            const L = 1.0 - (0.2 * c + 0.2 * m + 0.2 * y + 0.4 * k);
            const a = 0.5, b = 0.5; // neutral
            const write16 = (arr, o, v) => { const u = Math.round(v * 65535); arr[o] = (u >> 8) & 0xff; arr[o+1] = u & 0xff; };
            write16(a2b0, off, L); off += 2;
            write16(a2b0, off, a); off += 2;
            write16(a2b0, off, b); off += 2;
        }
        // Output tables (identity: 0, 65535 for each of 3 channels)
        for (let ch = 0; ch < outCh; ch++) {
            a2b0[off] = 0; a2b0[off+1] = 0; off += 2;
            a2b0[off] = 0xff; a2b0[off+1] = 0xff; off += 2;
        }
        extraTags.push({ sig: 'A2B0', data: a2b0 });
    } else { // Gray
        colorSpaceSig = [0x47, 0x52, 0x41, 0x59]; // 'GRAY'
        pcsSpace = [0x58, 0x59, 0x5A, 0x20]; // 'XYZ '
        // kTRC — tone reproduction curve (gamma 2.2 or dot gain)
        const trcData = new Uint8Array(14);
        trcData.set([0x63, 0x75, 0x72, 0x76], 0); // 'curv'
        trcData.set([0, 0, 0, 0], 4);
        trcData[8] = 0; trcData[9] = 0; trcData[10] = 0; trcData[11] = 1;
        const gamma = id === 'dotgain20' ? 461 : 563; // ~1.8 for dot gain, 2.2 for standard
        trcData[12] = (gamma >> 8) & 0xff;
        trcData[13] = gamma & 0xff;
        extraTags.push({ sig: 'kTRC', data: trcData });
    }

    // Assemble all tags
    const allTags = [
        { sig: 'desc', data: descTagData },
        { sig: 'wtpt', data: wtptData },
        { sig: 'cprt', data: cprtTagData },
        ...extraTags,
    ];

    // Calculate sizes
    const tagCount = allTags.length;
    const tagTableSize = 4 + tagCount * 12; // count(4) + entries
    let dataOffset = 128 + tagTableSize;
    // Align to 4 bytes
    dataOffset = (dataOffset + 3) & ~3;

    let totalDataSize = 0;
    const tagOffsets = [];
    for (const tag of allTags) {
        const aligned = (tag.data.length + 3) & ~3;
        tagOffsets.push({ offset: dataOffset + totalDataSize, size: tag.data.length });
        totalDataSize += aligned;
    }
    const profileSize = dataOffset + totalDataSize;

    // Build profile
    const profile = new Uint8Array(profileSize);
    const view = new DataView(profile.buffer);

    // Header (128 bytes)
    view.setUint32(0, profileSize); // size
    profile.set([0x6E, 0x6F, 0x6E, 0x65], 4); // preferred CMM: 'none'
    // Version 2.1.0
    profile[8] = 2; profile[9] = 0x10; profile[10] = 0; profile[11] = 0;
    // Device class: 'mntr' (monitor/output)
    const devClass = space === 'CMYK' ? [0x70,0x72,0x74,0x72] : [0x6D,0x6E,0x74,0x72]; // 'prtr' for CMYK, 'mntr' for RGB/Gray
    profile.set(devClass, 12);
    // Color space
    profile.set(colorSpaceSig, 16);
    // PCS
    profile.set(pcsSpace, 20);
    // Date: 2024-01-01
    view.setUint16(24, 2024); view.setUint16(26, 1); view.setUint16(28, 1);
    view.setUint16(30, 0); view.setUint16(32, 0); view.setUint16(34, 0);
    // 'acsp' signature
    profile.set([0x61, 0x63, 0x73, 0x70], 36);
    // Platform: 'APPL'
    profile.set([0x41, 0x50, 0x50, 0x4C], 40);
    // Rendering intent: perceptual (0)
    view.setUint32(64, 0);
    // D50 illuminant
    writeS15F16(profile, 68, 0.9505);
    writeS15F16(profile, 72, 1.0);
    writeS15F16(profile, 76, 1.089);

    // Tag table
    let pos = 128;
    view.setUint32(pos, tagCount); pos += 4;
    const sigToBytes = (s) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
    for (let i = 0; i < tagCount; i++) {
        profile.set(sigToBytes(allTags[i].sig), pos); pos += 4;
        view.setUint32(pos, tagOffsets[i].offset); pos += 4;
        view.setUint32(pos, tagOffsets[i].size); pos += 4;
    }

    // Tag data
    for (let i = 0; i < tagCount; i++) {
        profile.set(allTags[i].data, tagOffsets[i].offset);
    }

    return profile;
}

// Embed ICC profile into pdf-lib document using low-level API
// ─── PDF/A-2b identification ───
// A PDF/A file MUST declare its conformance level in the XMP metadata stream
// (<pdfaid:part> / <pdfaid:conformance>). The Info dictionary alone is not enough:
// no validator accepts a document that only *says* “PDF/A archival document”.
function buildPdfaXmp({ title, author, producer, lang }) {
    const iso = d => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const now = iso(new Date());
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <xmp:CreateDate>${now}</xmp:CreateDate>
   <xmp:ModifyDate>${now}</xmp:ModifyDate>
   <xmp:MetadataDate>${now}</xmp:MetadataDate>
   <xmp:CreatorTool>PDF-YZ</xmp:CreatorTool>
   <pdf:Producer>${esc(producer || 'PDF-YZ by Zigmoon')}</pdf:Producer>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title || 'Sans titre')}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${esc(author || '')}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">PDF/A-2b archival document</rdf:li></rdf:Alt></dc:description>
   <dc:language><rdf:Bag><rdf:li>${esc(lang || 'fr-FR')}</rdf:li></rdf:Bag></dc:language>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function applyPdfaMetadata(doc, opts) {
    const xml = buildPdfaXmp(opts);
    const bytes = new TextEncoder().encode(xml);
    const stream = doc.context.stream(bytes, { Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML') });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    if (!doc.catalog.has(PDFName.of('Lang'))) {
        // /Lang must be a STRING (a Name here is a spec violation pdfcpu rejects).
        doc.catalog.set(PDFName.of('Lang'), PDFString.of(opts.lang || 'fr-FR'));
    }
}

function embedICCProfile(doc, iccProfile, intentSubtype) {
    if (!iccProfile?.bytes || iccProfile.bytes.length < 128) return;
    const info = ICC_PROFILES[iccProfile.id] || { space: 'RGB', components: 3 };
    const ctx = doc.context;

    // Create the ICC stream object
    const iccStreamDict = ctx.obj({
        N: info.components,
        Alternate: info.space === 'CMYK' ? 'DeviceCMYK' : (info.space === 'Gray' ? 'DeviceGray' : 'DeviceRGB'),
        Filter: 'FlateDecode',
    });

    // Compress the ICC data with DeflateRaw
    let compressedData;
    try {
        // Use pako-lite compression via CompressionStream if available
        const cs = new CompressionStream('deflate');
        const writer = cs.writable.getWriter();
        const reader = cs.readable.getReader();
        writer.write(iccProfile.bytes);
        writer.close();
        const chunks = [];
        const pump = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        };
        // Sync fallback: embed uncompressed
        compressedData = null;
    } catch { compressedData = null; }

    // Embed uncompressed (simpler, always works)
    const iccDict = new Map();
    iccDict.set('N', ctx.obj(info.components));
    if (info.space === 'CMYK') iccDict.set('Alternate', ctx.obj('DeviceCMYK'));
    else if (info.space === 'Gray') iccDict.set('Alternate', ctx.obj('DeviceGray'));
    else iccDict.set('Alternate', ctx.obj('DeviceRGB'));

    const iccStream = ctx.stream(iccProfile.bytes, {
        N: info.components,
        Alternate: info.space === 'CMYK' ? 'DeviceCMYK' : (info.space === 'Gray' ? 'DeviceGray' : 'DeviceRGB'),
    });
    const iccRef = ctx.register(iccStream);

    // Create the ICCBased color space array: [/ICCBased, streamRef]
    const csArray = ctx.obj([ctx.obj('ICCBased'), iccRef]);
    const csRef = ctx.register(csArray);

    // Apply to each page's resources
    for (let i = 0; i < doc.getPageCount(); i++) {
        const page = doc.getPage(i);
        const pageDict = page.node;
        // Get or create Resources
        let resources = pageDict.get(ctx.obj('Resources'));
        if (!resources) {
            resources = ctx.obj({});
            pageDict.set(ctx.obj('Resources'), resources);
        }
        // Dereference if indirect
        if (resources.constructor.name === 'PDFRef') {
            resources = ctx.lookup(resources);
        }
        // Get or create ColorSpace dict in Resources
        let csDictObj = resources.get(ctx.obj('ColorSpace'));
        if (!csDictObj) {
            csDictObj = ctx.obj({});
            resources.set(ctx.obj('ColorSpace'), csDictObj);
        }
        if (csDictObj.constructor.name === 'PDFRef') {
            csDictObj = ctx.lookup(csDictObj);
        }
        // Set the default color space name
        const csName = info.space === 'CMYK' ? 'DefaultCMYK' : (info.space === 'Gray' ? 'DefaultGray' : 'DefaultRGB');
        csDictObj.set(ctx.obj(csName), csRef);
    }

    // Also set OutputIntent for PDF/X & PDF/A compatibility
    // NOTE: OutputConditionIdentifier / RegistryName / Info must be STRINGS —
    // ctx.obj() would turn them into Names, which validators reject.
    const outputIntentDict = ctx.obj({
        Type: PDFName.of('OutputIntent'),
        S: PDFName.of(intentSubtype || 'GTS_PDFX'),
        OutputConditionIdentifier: PDFString.of(iccProfile.name || 'Custom'),
        RegistryName: PDFString.of('http://www.color.org'),
        Info: PDFString.of(iccProfile.name || 'ICC Profile'),
        DestOutputProfile: iccRef,
    });
    const oiRef = ctx.register(outputIntentDict);
    const catalog = doc.catalog;
    const existingOI = catalog.get(ctx.obj('OutputIntents'));
    if (existingOI) {
        const arr = ctx.lookup(existingOI);
        if (arr && typeof arr.push === 'function') arr.push(oiRef);
    } else {
        catalog.set(ctx.obj('OutputIntents'), ctx.obj([oiRef]));
    }
}

// ─── ICC Panel UI logic ───
function updateICCUI() {
    document.querySelectorAll('.icc-profile-item').forEach(item => {
        item.classList.toggle('active', S.iccProfile?.id === item.dataset.icc);
    });
    const label = S.iccProfile?.name || 'None (Device RGB)';
    $('iccActiveLabel').textContent = label;
}

function selectICCProfile(id) {
    const info = ICC_PROFILES[id];
    if (!info) return;
    const bytes = generateICCProfile(id);
    if (!bytes) { toast('Failed to generate ICC profile'); return; }
    S.iccProfile = { id, name: info.name, space: info.space, bytes };
    localStorage.setItem('pdfz-icc-id', id);
    updateICCUI();
    toast('Profile: ' + info.name);
}

function clearICCProfile() {
    S.iccProfile = null;
    localStorage.removeItem('pdfz-icc-id');
    localStorage.removeItem('pdfz-icc-custom');
    $('iccCustomList').innerHTML = '';
    updateICCUI();
    toast('Color profile cleared');
}

// Restore saved profile on load
if (S.iccProfile?.pending) {
    const savedId = S.iccProfile.id;
    if (ICC_PROFILES[savedId]) {
        const info = ICC_PROFILES[savedId];
        const bytes = generateICCProfile(savedId);
        S.iccProfile = bytes ? { id: savedId, name: info.name, space: info.space, bytes } : null;
    } else {
        // Custom profile — try to restore from localStorage
        try {
            const customData = localStorage.getItem('pdfz-icc-custom');
            if (customData) {
                const parsed = JSON.parse(customData);
                S.iccProfile = { id: parsed.id, name: parsed.name, space: parsed.space, bytes: new Uint8Array(parsed.bytes) };
            } else {
                S.iccProfile = null;
            }
        } catch { S.iccProfile = null; }
    }
}

// Build standard profile click handlers
document.querySelectorAll('.icc-profile-item[data-icc]').forEach(item => {
    item.addEventListener('click', () => {
        const id = item.dataset.icc;
        if (id && ICC_PROFILES[id]) selectICCProfile(id);
    });
});

// ICC panel toggle
$('btnICC').onclick = () => {
    const p = $('iccPanel');
    if (!p.classList.contains('visible') && $('frPanel').classList.contains('visible')) closeFindReplace();
    if (!p.classList.contains('visible')) $('prefsPanel').classList.remove('open');
    p.classList.toggle('visible');
    if (p.classList.contains('visible')) updateICCUI();
};
$('iccClose').onclick = () => $('iccPanel').classList.remove('visible');
$('iccClear').onclick = clearICCProfile;

// Custom ICC upload
$('iccUploadBtn').onclick = () => $('iccFileInput').click();
$('iccFileInput').onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('ICC file too large (max 5 MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        // Basic ICC validation: check 'acsp' signature at offset 36
        if (bytes.length < 128 || String.fromCharCode(bytes[36], bytes[37], bytes[38], bytes[39]) !== 'acsp') {
            toast('Invalid ICC profile file');
            return;
        }
        // Detect color space from header offset 16
        const spaceTag = String.fromCharCode(bytes[16], bytes[17], bytes[18], bytes[19]).trim();
        let space = 'RGB', components = 3;
        if (spaceTag === 'CMYK') { space = 'CMYK'; components = 4; }
        else if (spaceTag === 'GRAY') { space = 'Gray'; components = 1; }
        const customId = 'custom_' + Date.now();
        const profileName = file.name.replace(/\.(icc|icm)$/i, '');
        S.iccProfile = { id: customId, name: profileName, space, bytes };
        ICC_PROFILES[customId] = { name: profileName, space, components };
        localStorage.setItem('pdfz-icc-id', customId);
        // Store custom bytes in localStorage (for persistence)
        try {
            if (bytes.length < 2 * 1024 * 1024) {
                localStorage.setItem('pdfz-icc-custom', JSON.stringify({
                    id: customId, name: profileName, space, bytes: Array.from(bytes)
                }));
            }
        } catch {}
        // Add to custom list UI
        const item = document.createElement('div');
        item.className = 'icc-profile-item active';
        item.dataset.icc = customId;
        const badge = space === 'CMYK' ? 'cmyk' : (space === 'Gray' ? 'gray' : 'rgb');
        item.innerHTML = `<div class="icc-radio"></div><div class="icc-profile-info"><div class="icc-profile-name">${profileName}</div><div class="icc-profile-desc">Custom uploaded profile · ${space}</div></div><span class="icc-profile-badge ${badge}">${space}</span>`;
        item.addEventListener('click', () => {
            S.iccProfile = { id: customId, name: profileName, space, bytes };
            localStorage.setItem('pdfz-icc-id', customId);
            updateICCUI();
            toast('Profile: ' + profileName);
        });
        $('iccCustomList').appendChild(item);
        updateICCUI();
        toast('Custom profile loaded: ' + profileName);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
};

updateICCUI();

// ─── Blank PDF ───
async function createBlank() {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    await openPDF((await doc.save()).buffer, 'untitled.pdf');
}

// ─── Find/Replace ───
const FR = { matches: [], current: -1, timer: null, runId: 0, caseSensitive: false, wholeWord: false };

function openFindReplace() {
    $('frPanel').classList.add('visible');
    document.body.classList.add('pdf-search-open');
    $('btnFind').classList.add('active');
    $('btnFind').setAttribute('aria-pressed', 'true');
    syncMobileFooterState();
    $('prefsPanel')?.classList.remove('open');
    setTimeout(() => { $('frFind').focus(); $('frFind').select(); }, 50);
    doFind();
}

function closeFindReplace() {
    $('frPanel').classList.remove('visible');
    document.body.classList.remove('pdf-search-open');
    $('btnFind').classList.remove('active');
    $('btnFind').setAttribute('aria-pressed', 'false');
    syncMobileFooterState();
    clearFRHighlights();
}

function clearFRHighlights() {
    document.querySelectorAll('.fr-highlight, .fr-current').forEach(el => {
        el.classList.remove('fr-highlight', 'fr-current');
    });
    FR.matches = [];
    FR.current = -1;
    $('frCount').textContent = 'Saisissez un mot';
    $('frPage').textContent = '';
    updateFRActions();
}

function isFRWordChar(char) {
    return !!char && /[\p{L}\p{N}_]/u.test(char);
}

function findTextOccurrences(content, query) {
    const haystack = FR.caseSensitive ? content : content.toLocaleLowerCase();
    const needle = FR.caseSensitive ? query : query.toLocaleLowerCase();
    const occurrences = [];
    let start = 0;
    while (start <= haystack.length - needle.length) {
        const index = haystack.indexOf(needle, start);
        if (index < 0) break;
        const wholeMatch = !FR.wholeWord || (
            !isFRWordChar(content[index - 1]) &&
            !isFRWordChar(content[index + query.length])
        );
        if (wholeMatch) occurrences.push(index);
        start = index + Math.max(needle.length, 1);
    }
    return occurrences;
}

async function doFind() {
    const runId = ++FR.runId;
    // Remove old highlights but keep state
    document.querySelectorAll('.fr-highlight, .fr-current').forEach(el => {
        el.classList.remove('fr-highlight', 'fr-current');
    });
    FR.matches = [];
    FR.current = -1;

    const q = $('frFind').value;
    if (!q) { updateFRCount(); return; }
    const currentPage = getCurrentPageIndex();
    const pages = $('frScope').value === 'current'
        ? [[S.pages[currentPage], currentPage]]
        : S.pages.map((page, index) => [page, index]);

    for (let pageOffset = 0; pageOffset < pages.length; pageOffset++) {
        const [p, pi] = pages[pageOffset];
        if (!p) continue;
        p.elements.forEach(el => {
            if (el.type !== 'text' || el._deleted || !el.content) return;
            for (const start of findTextOccurrences(el.content, q)) {
                FR.matches.push({ el, page: pi, start, length: q.length });
            }
        });
        if (pages.length > 24 && pageOffset % 12 === 11) {
            $('frCount').textContent = `Recherche… ${pageOffset + 1}/${pages.length}`;
            await _uiYield();
            if (runId !== FR.runId) return;
        }
    }
    if (runId !== FR.runId) return;

    // Highlight all matches
    FR.matches.forEach(m => {
        const dom = S.pages[m.page]?.editLayer.querySelector(`[data-id="${m.el.id}"]`);
        if (dom) dom.classList.add('fr-highlight');
    });

    if (FR.matches.length > 0) {
        FR.current = 0;
        markFRCurrent();
    }
    updateFRCount();
}

function updateFRCount() {
    if (!$('frFind').value) {
        $('frCount').textContent = 'Saisissez un mot';
        $('frPage').textContent = '';
        updateFRActions();
        return;
    }
    if (FR.matches.length === 0) {
        $('frCount').textContent = 'Aucun résultat';
        $('frPage').textContent = $('frScope').value === 'current'
            ? `Page ${getCurrentPageIndex() + 1}`
            : `${S.pages.length} pages analysées`;
        updateFRActions();
        return;
    }
    const pageCount = new Set(FR.matches.map(match => match.page)).size;
    const match = FR.matches[FR.current];
    $('frCount').textContent = `${FR.current + 1} / ${FR.matches.length}`;
    $('frPage').textContent = `Page ${match.page + 1} · ${pageCount} page${pageCount > 1 ? 's' : ''}`;
    updateFRActions();
}

function updateFRActions() {
    const hasMatches = FR.matches.length > 0;
    $('frPrev').disabled = !hasMatches;
    $('frNext').disabled = !hasMatches;
    $('frReplaceOne').disabled = !hasMatches;
    $('frReplaceAll').disabled = !hasMatches;
}

function markFRCurrent() {
    document.querySelectorAll('.fr-current').forEach(el => el.classList.remove('fr-current'));
    if (FR.current < 0 || FR.current >= FR.matches.length) return;
    const m = FR.matches[FR.current];
    const dom = S.pages[m.page]?.editLayer.querySelector(`[data-id="${m.el.id}"]`);
    if (dom) {
        dom.classList.add('fr-current');
        dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    updateFRCount();
}

function frGoNext() {
    if (FR.matches.length === 0) return;
    FR.current = (FR.current + 1) % FR.matches.length;
    markFRCurrent();
}

function frGoPrev() {
    if (FR.matches.length === 0) return;
    FR.current = (FR.current - 1 + FR.matches.length) % FR.matches.length;
    markFRCurrent();
}

function scheduleFind() {
    clearTimeout(FR.timer);
    FR.runId++;
    $('frCount').textContent = $('frFind').value ? 'Recherche…' : 'Saisissez un mot';
    FR.timer = setTimeout(doFind, S.pages.length > 80 ? 140 : 60);
}

function toggleFROption(key, button) {
    FR[key] = !FR[key];
    button.classList.toggle('active', FR[key]);
    button.setAttribute('aria-pressed', String(FR[key]));
    doFind();
}

$('btnFind').onclick = () => {
    if ($('frPanel').classList.contains('visible')) closeFindReplace();
    else openFindReplace();
};
$('frClose').onclick = closeFindReplace;
$('frFind').oninput = scheduleFind;
$('frCase').onclick = () => toggleFROption('caseSensitive', $('frCase'));
$('frWhole').onclick = () => toggleFROption('wholeWord', $('frWhole'));
$('frScope').onchange = doFind;
$('frFind').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? frGoPrev() : frGoNext(); }
    if (e.key === 'Escape') { e.preventDefault(); closeFindReplace(); }
});
$('frReplace').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('frReplaceOne').click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeFindReplace(); }
});
$('frNext').onclick = frGoNext;
$('frPrev').onclick = frGoPrev;

$('frReplaceOne').onclick = () => {
    if (FR.matches.length === 0 || FR.current < 0) { toast('No match to replace'); return; }
    const rep = $('frReplace').value;
    const m = FR.matches[FR.current];
    m.el.content = m.el.content.substring(0, m.start) + rep + m.el.content.substring(m.start + m.length);
    syncTextToDOM(m.el);
    markDirty();
    toast('Occurrence remplacée');
    doFind();
};

$('frReplaceAll').onclick = () => {
    if (!FR.matches.length) return;
    const rep = $('frReplace').value;
    const matchesByElement = new Map();
    for (const match of FR.matches) {
        if (!matchesByElement.has(match.el)) matchesByElement.set(match.el, []);
        matchesByElement.get(match.el).push(match);
    }
    for (const [el, matches] of matchesByElement) {
        matches.sort((a, b) => b.start - a.start);
        for (const match of matches) {
            el.content = el.content.substring(0, match.start) + rep + el.content.substring(match.start + match.length);
        }
        syncTextToDOM(el);
    }
    const count = FR.matches.length;
    markDirty();
    toast(`${count} occurrence${count > 1 ? 's' : ''} remplacée${count > 1 ? 's' : ''}`);
    doFind();
};

// ─── Signature modal ───
const sigCtx = $('sigCanvas').getContext('2d');
let sigDraw = false;
function openSigModal() {
    if (!S.pdfDoc) return;
    sigCtx.clearRect(0, 0, 420, 140);
    setSigColor(S.sigColor);
    $('sigModal').classList.add('visible');
}
// Ink colour: the signature is captured as a transparent PNG, so the chosen
// colour is painted into the image itself and therefore survives the export.
(function () {
    const wrap = $('sigSwatches');
    if (!wrap) return;
    COLOR_PRESETS.slice(0, 8).forEach(hex => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color-swatch' + (hex.toLowerCase() === String(S.sigColor).toLowerCase() ? ' active' : '');
        b.style.background = hex;
        b.dataset.color = hex;
        b.title = hex;
        b.setAttribute('aria-label', hex);
        b.addEventListener('click', () => setSigColor(hex));
        wrap.appendChild(b);
    });
    $('sigColor').addEventListener('input', () => setSigColor($('sigColor').value));
    $('sigColor').addEventListener('change', () => setSigColor($('sigColor').value));
})();
$('sigCanvas').style.touchAction = 'none';
$('sigCanvas').addEventListener('pointerdown', e => {
    e.preventDefault();
    sigDraw = true; const r = $('sigCanvas').getBoundingClientRect();
    sigCtx.beginPath(); sigCtx.moveTo(e.clientX - r.left, e.clientY - r.top);
    try { $('sigCanvas').setPointerCapture(e.pointerId); } catch (_) {}
});
$('sigCanvas').addEventListener('pointermove', e => {
    if (!sigDraw) return; e.preventDefault(); const r = $('sigCanvas').getBoundingClientRect();
    sigCtx.lineWidth = 2; sigCtx.lineCap = 'round'; sigCtx.strokeStyle = S.sigColor;
    sigCtx.lineTo(e.clientX - r.left, e.clientY - r.top); sigCtx.stroke();
});
$('sigCanvas').addEventListener('pointerup', () => sigDraw = false);
$('sigCanvas').addEventListener('pointercancel', () => sigDraw = false);
$('sigClear').onclick = () => sigCtx.clearRect(0,0,420,140);
$('sigCancel').onclick = () => $('sigModal').classList.remove('visible');
$('sigApply').onclick = () => { addSignature($('sigCanvas').toDataURL('image/png')); $('sigModal').classList.remove('visible'); };

// ─── File inputs ───
// Read a File as ArrayBuffer with live splash progress (0–2%).
function readFileWithSplashProgress(file, label = 'Reading file…') {
    return new Promise((resolve, reject) => {
        const onSplash = !$('splash').classList.contains('hidden');
        if (onSplash) {
            beginSplashProgress(label);
            setSplashProgress(0.5, label);
        }
        const r = new FileReader();
        r.onprogress = (e) => {
            if (!onSplash || !e.lengthComputable) return;
            const pct = (e.loaded / e.total) * 2; // first 0–2% reserved for the read
            setSplashProgress(pct, `${label} ${Math.round(e.loaded / e.total * 100)}%`);
        };
        r.onerror = () => reject(r.error || new Error('File read failed'));
        r.onload = () => resolve(r.result);
        r.readAsArrayBuffer(file);
    });
}

async function loadPDFFile(f) {
    if (!f) return;
    if (_isOpening) { toast('Already loading a PDF…'); return; }
    if (f.size > 200 * 1024 * 1024) {
        if (!confirm(`This PDF is ${(f.size / 1048576).toFixed(0)} MB. Loading very large files may be slow. Continue?`)) return;
    }
    try {
        const buf = await readFileWithSplashProgress(f, 'Reading file…');
        if (S.pdfDoc) await appendPDF(buf, f.name);
        else {
            // A user-selected file is a new source document, never a continuation
            // of element overlays staged by the resume-session bootstrap.
            delete S._savedElements;
            delete S._savedPaths;
            await openPDF(buf, f.name);
        }
    } catch (err) {
        endSplashProgress(); hideLoader();
        toast('Failed to read file: ' + (err && err.message ? err.message : err));
        console.error(err);
    }
}

$('filePDF').onchange = e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.type && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
        toast('Please select a PDF file');
        return;
    }
    loadPDFFile(f);
};
$('fileImg').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const mode = $('fileImg').dataset.mode;
    const r = new FileReader();
    r.onload = () => {
        const img = new Image();
        img.onload = () => {
            if (mode === 'replace' && S.selected && (S.selected.type === 'image' || S.selected.type === 'pdf-image')) {
                const el = S.selected;
                const dom = S.selectedDOM;
                el.src = r.result;
                el.replacedSrc = r.result;
                // Keep position/size, update the <img> inside the DOM
                const imgEl = dom.querySelector('img');
                if (imgEl) imgEl.src = r.result;
                if (el.type === 'pdf-image') {
                    dom.classList.add('replaced');
                    syncNativePreview(el);
                }
                markDirty();
                toast('Image replaced');
            } else {
                addImage(null, r.result, img.naturalWidth, img.naturalHeight);
            }
        };
        img.src = r.result;
    };
    r.readAsDataURL(f); e.target.value = '';
    $('fileImg').dataset.mode = 'add';
};

$('propReplace').onclick = () => {
    $('fileImg').dataset.mode = 'replace';
    $('fileImg').click();
};

// ─── Splash events ───
$('btnOpen').onclick = () => { if (_isOpening) return; $('filePDF').click(); };
$('dropZone').onclick = () => { if (_isOpening) return; $('filePDF').click(); };
$('dropZone').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!_isOpening) $('filePDF').click();
    }
});
$('btnBlank').onclick = async () => {
    if (_isOpening) return;
    $('btnBlank').disabled = true;
    $('btnBlank').style.opacity = '0.5';
    try { await createBlank(); }
    finally { $('btnBlank').disabled = false; $('btnBlank').style.opacity = ''; }
};
if ($('btnSave')) $('btnSave').onclick = () => {
    if (!S.pdfDoc) return;
    // Pre-fill export modal from current state
    $('exportFileName').value = S.fileName;
    $('exportStandard').value = prefs.standard || 'default';
    $('exportDPI').value = String(prefs.dpi || 150);
    $('exportPageSize').value = prefs.pageSize || 'keep';
    updateExportSummary();
    $('exportModal').classList.add('visible');
    $('exportFileName').select();
};
// Mirror the floating top-right export button to the same handler.
if ($('btnSaveFixed')) $('btnSaveFixed').onclick = () => { if ($('btnSave')) $('btnSave').click(); };
function updateExportSummary() {
    const total = S.pdfDoc ? S.pdfDoc.getPageCount() : 0;
    const fmt = getPageFormat();
    const els = S.pages.reduce((n, p) => n + p.elements.filter(e => !e._deleted && (!e.extracted || e.content !== e.originalContent || e.color !== e.originalColor || e._moved)).length, 0);
    const paths = S.pages.reduce((n, p) => n + (p.paths?.length || 0), 0);
    const notes = S.pages.reduce((n, p) => n + p.elements.filter(e => e.type === 'note' && !e._deleted).length, 0);
    const icc = S.iccProfile ? (ICC_PROFILES[S.iccProfile.id]?.name || 'Custom') : 'None';
    let html = `<strong>${total}</strong> page${total > 1 ? 's' : ''} · <strong>${fmt}</strong><br>`;
    html += `Elements: <strong>${els}</strong> · Drawings: <strong>${paths}</strong> · Notes: <strong>${notes}</strong><br>`;
    const rasters = S.pages.reduce((n, p) => n + p.elements.filter(e =>
        !e._deleted && e.src && (e.type === 'image' || e.type === 'signature')).length, 0);
    const compLabel = prefs.compress === 'none' ? 'none' : prefs.compress === 'heavy' ? 'aggressive' : 'light';
    // Read the DPI from the dialog itself: prefs.dpi is only synced when the user
    // clicks Export, so using it here showed the previous value.
    const liveDpi = document.getElementById('exportDPI')
        ? (+document.getElementById('exportDPI').value || prefs.dpi || 150)
        : (prefs.dpi || 150);
    html += `Output: <strong>${liveDpi} DPI</strong> · Compression: <strong>${compLabel}</strong>`;
    if (prefs.compress !== 'none') html += ` · Quality: <strong>${Math.round((+prefs.imgQuality || 0.8) * 100)}%</strong>`;
    html += `<br>Raster pictures that will be optimised: <strong>${prefs.compress === 'none' ? 0 : rasters}</strong>`;
    if (prefs.flatten) html += `<br><strong>Flatten: on</strong> — pages become images (text no longer selectable)`;
    html += `<br>ICC Profile: <strong>${icc}</strong>`;
    if (prefs.watermark?.trim()) html += ` · Watermark: <strong>${prefs.watermark.trim()}</strong>`;
    if (prefs.cropMarks) html += ` · <strong>Crop marks</strong>`;
    $('exportSummary').innerHTML = html;
}
$('exportStandard').onchange = $('exportDPI').onchange = $('exportPageSize').onchange = updateExportSummary;
$('exportCancel').onclick = () => $('exportModal').classList.remove('visible');
$('exportGo').onclick = () => {
    // Apply modal values to prefs
    const name = $('exportFileName').value.trim() || S.fileName;
    S.fileName = name.endsWith('.pdf') ? name : name + '.pdf';
    prefs.standard = $('exportStandard').value;
    prefs.dpi = parseInt($('exportDPI').value);
    prefs.pageSize = $('exportPageSize').value;
    savePrefs();
    $('exportModal').classList.remove('visible');
    exportPDF();
};
// Close on backdrop click
$('exportModal').addEventListener('mousedown', e => { if (e.target === $('exportModal')) $('exportModal').classList.remove('visible'); });
// Close on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('exportModal').classList.contains('visible')) { e.stopPropagation(); $('exportModal').classList.remove('visible'); } });

// ─── Annotation FAB ───
$('btnAnnot').onclick = () => {
    if (S.tool === 'note') { setTool('select'); }
    else { setTool('note'); toast('Click on a page to add a note'); }
};

// ─── Preferences panel UI wiring ───
// (prefs + savePrefs are declared at the top of the module to avoid TDZ.)
function syncPrefsUI() {
    $('prefDPI').value = prefs.dpi;
    $('prefImgQuality').value = prefs.imgQuality;
    $('prefStandard').value = prefs.standard;
    $('prefCompress').value = prefs.compress;
    $('prefPageSize').value = prefs.pageSize;
    $('prefTitle').value = prefs.title;
    $('prefAuthor').value = prefs.author;
    $('prefFlatten').classList.toggle('on', prefs.flatten);
    $('prefEmbedFonts').classList.toggle('on', prefs.embedFonts);
    $('prefAutoSave').classList.toggle('on', prefs.autoSave);
    $('prefWatermark').value = prefs.watermark || '';
    $('prefWmOpacity').value = prefs.wmOpacity || 0.1;
    $('prefCropMarks').classList.toggle('on', prefs.cropMarks);
    $('prefCropLength').value = prefs.cropLength || 8;
    $('prefCropOffset').value = prefs.cropOffset || 6;
}
syncPrefsUI();
$('btnPrefs').onclick = () => {
    const willOpen = !$('prefsPanel').classList.contains('open');
    if (willOpen && $('frPanel').classList.contains('visible')) closeFindReplace();
    $('prefsPanel').classList.toggle('open');
    $('propsPanel').classList.remove('visible');
    // Close text panel if prefs opens
    if ($('prefsPanel').classList.contains('open')) closeTextPanel();
};
$('prefsClose').onclick = () => $('prefsPanel').classList.remove('open');
// Bind selects
$('prefDPI').onchange = () => { prefs.dpi = +$('prefDPI').value; savePrefs(); };
$('prefImgQuality').onchange = () => { prefs.imgQuality = +$('prefImgQuality').value; savePrefs(); if ($('exportModal').classList.contains('visible')) updateExportSummary(); };
$('prefStandard').onchange = () => { prefs.standard = $('prefStandard').value; savePrefs(); };
$('prefCompress').onchange = () => { prefs.compress = $('prefCompress').value; savePrefs(); if ($('exportModal').classList.contains('visible')) updateExportSummary(); };
$('prefPageSize').onchange = () => { prefs.pageSize = $('prefPageSize').value; savePrefs(); };
$('prefTitle').oninput = () => { prefs.title = $('prefTitle').value; savePrefs(); };
$('prefAuthor').oninput = () => { prefs.author = $('prefAuthor').value; savePrefs(); };
$('prefWatermark').oninput = () => { prefs.watermark = $('prefWatermark').value; savePrefs(); };
$('prefWmOpacity').onchange = () => { prefs.wmOpacity = +$('prefWmOpacity').value; savePrefs(); };
$('prefCropLength').onchange = () => { prefs.cropLength = +$('prefCropLength').value; savePrefs(); };
$('prefCropOffset').onchange = () => { prefs.cropOffset = +$('prefCropOffset').value; savePrefs(); };
// Toggles
['prefFlatten','prefEmbedFonts','prefAutoSave','prefCropMarks'].forEach(id => {
    const key = id.replace('pref','').charAt(0).toLowerCase() + id.replace('pref','').slice(1);
    $(id).onclick = () => {
        prefs[key] = !prefs[key];
        $(id).classList.toggle('on', prefs[key]);
        savePrefs();
        // The export dialog may be open behind the Preferences panel: keep its
        // summary truthful about what the next export will actually do.
        if ($('exportModal').classList.contains('visible')) updateExportSummary();
    };
});

// ─── Click-outside to close floating panels ───
document.addEventListener('mousedown', e => {
    const fr = $('frPanel'), pp = $('prefsPanel'), icc = $('iccPanel');
    if (pp.classList.contains('open') && !pp.contains(e.target) && e.target !== $('btnPrefs') && !$('btnPrefs').contains(e.target)) {
        pp.classList.remove('open');
    }
    if (icc.classList.contains('visible') && !icc.contains(e.target) && e.target !== $('btnICC') && !$('btnICC').contains(e.target)) {
        icc.classList.remove('visible');
    }
});

// ─── Global full-page drag & drop ───
let dragCounter = 0;
document.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) $('dragOverlay').classList.add('visible');
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragleave', e => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; $('dragOverlay').classList.remove('visible'); }
});
document.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    $('dragOverlay').classList.remove('visible');
    $('dropZone').classList.remove('drag-over');
    if (_isOpening) { toast('Already loading a PDF…'); return; }
    const f = e.dataTransfer.files[0]; if (!f) return;
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        loadPDFFile(f);
    } else if (f.type.startsWith('image/') && S.pdfDoc) {
        const r = new FileReader();
        r.onload = () => { const img = new Image(); img.onload = () => addImage(null, r.result, img.naturalWidth, img.naturalHeight); img.src = r.result; };
        r.readAsDataURL(f);
    } else {
        toast('Drop a PDF or image file');
    }
});
// Splash drop zone visual (still useful on splash)
['dragenter','dragover'].forEach(ev => $('dropZone').addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); $('dropZone').classList.add('drag-over'); }));
['dragleave'].forEach(ev => $('dropZone').addEventListener(ev, e => { e.stopPropagation(); $('dropZone').classList.remove('drag-over'); }));

// ─── Keyboard ───
// Strategy:
//  • When the user is typing in a real <input>/<textarea>/contenteditable, we
//    only intercept truly-app-level shortcuts (Save/Find/Print/Esc) and let the
//    browser handle Ctrl+Z/Y/X/C/V/A/etc. natively in the field.
//  • Otherwise, full shortcut set is active.
document.addEventListener('keydown', e => {
    const ae = document.activeElement;
    const inField = !!ae && (
        ae.isContentEditable ||
        ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT'
    );
    const meta = e.ctrlKey || e.metaKey;

    // ─ Always-on, app-level (work even while typing) ─
    if (meta && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); $('btnSave').click(); return; }
    if (meta && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); printPDF(); return; }
    if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (!$('frPanel').classList.contains('visible')) openFindReplace();
        else { $('frFind').focus(); $('frFind').select(); }
        return;
    }
    if (meta && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); if (!_isOpening) $('filePDF').click(); return; }
    if (meta && e.shiftKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); $('btnNewDoc').click(); return; }

    // Esc — universal escape
    if (e.key === 'Escape') {
        if ($('mobileSheetLayer')?.classList.contains('visible')) { closeMobileSheet(); return; }
        if ($('kbdModal').classList.contains('visible')) { $('kbdModal').classList.remove('visible'); return; }
        if ($('spModal')?.classList.contains('visible')) { closeSpModal(); return; }
        if ($('pdfz-donate-overlay')?.classList.contains('visible')) { return; /* overlay handles its own Esc */ }
        if ($('frPanel').classList.contains('visible')) { closeFindReplace(); return; }
        if ($('textEditPanel').classList.contains('open')) { closeTextPanel(); return; }
        // Esc while in modify mode closes it (auto-saves the page).
        if (S.editMode) { setEditMode(false); return; }
        deselect();
        $('prefsPanel').classList.remove('open');
        $('sigModal')?.classList.remove('visible');
        $('impoModal')?.classList.remove('visible');
        $('iccPanel')?.classList.remove('visible');
        $('sidebar').classList.remove('open');
        return;
    }

    // From here on: don't fight the browser inside form fields
    if (inField) return;

    // ─ Undo / Redo ─
    if (meta && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); $('btnUndo').click(); return; }
    if (meta && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); $('btnRedo').click(); return;
    }

    // ─ Zoom ─
    if (meta && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom(S.zoom + 0.15); return; }
    if (meta && e.key === '-')                     { e.preventDefault(); setZoom(S.zoom - 0.15); return; }
    if (meta && e.key === '0')                     { e.preventDefault(); setZoom(1); return; }
    if (meta && e.key === '1')                     { e.preventDefault(); $('btnZoomFit').click(); return; }

    // ─ Pages sidebar / Help ─
    if (meta && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); $('btnPages').click(); return; }
    if (e.key === '?') { e.preventDefault(); $('kbdModal').classList.add('visible'); return; }
    if (e.key === 'F1') { e.preventDefault(); $('kbdModal').classList.add('visible'); return; }

    // ─ Page navigation (Page Up / Down / Home / End) ─
    if (['PageUp','PageDown','Home','End'].includes(e.key)) {
        const wraps = document.querySelectorAll('.page-canvas-wrap');
        if (!wraps.length) return;
        const area = $('canvasArea');
        const r0 = area.getBoundingClientRect();
        let curIdx = 0, bestOverlap = -1;
        wraps.forEach((w, i) => {
            const r = w.getBoundingClientRect();
            const overlap = Math.max(0, Math.min(r.bottom, r0.bottom) - Math.max(r.top, r0.top));
            if (overlap > bestOverlap) { bestOverlap = overlap; curIdx = i; }
        });
        let target = curIdx;
        if (e.key === 'PageUp')   target = Math.max(0, curIdx - 1);
        if (e.key === 'PageDown') target = Math.min(wraps.length - 1, curIdx + 1);
        if (e.key === 'Home')     target = 0;
        if (e.key === 'End')      target = wraps.length - 1;
        e.preventDefault();
        wraps[target].scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    // ─ Selection-bound actions ─
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) { e.preventDefault(); deleteSelected(); return; }

    // Ctrl+D — duplicate selected (uses the data model, not DOM cloning)
    if (meta && (e.key === 'd' || e.key === 'D') && S.selected) {
        const src = S.selected;
        // A provisional block (Text tool, nothing typed) has nothing to duplicate.
        if (src._provisional) return;
        e.preventDefault();
        const pageData = S.pages[src.page];
        if (!pageData) return;
        const clone = JSON.parse(JSON.stringify(src));
        delete clone._provisional;
        clone.id = (crypto.randomUUID && crypto.randomUUID().slice(0, 8)) || ('id' + Date.now().toString(36));
        clone.x = (clone.x || 0) + 15;
        clone.y = (clone.y || 0) + 15;
        delete clone._lastX; delete clone._lastY;
        // A duplicate of an extracted text becomes a regular text block
        if (clone.extracted) { clone.extracted = false; clone.originalContent = clone.content; }
        pageData.elements.push(clone);
        const dom = placeElement(clone, pageData.editLayer);
        deselect();
        selectEl(clone, dom);
        pushUndo({ type: 'add', el: clone, pageIdx: src.page });
        markDirty();
        toast('Element duplicated');
        return;
    }

    // Arrow keys — nudge selected element (Shift = 10px)
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && S.selected) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const el = S.selected;
        if (e.key === 'ArrowLeft')  el.x -= step;
        if (e.key === 'ArrowRight') el.x += step;
        if (e.key === 'ArrowUp')    el.y -= step;
        if (e.key === 'ArrowDown')  el.y += step;
        if (S.selectedDOM) {
            S.selectedDOM.style.left = el.x + 'px';
            S.selectedDOM.style.top  = el.y + 'px';
        }
        markDirty();
        return;
    }

    // ─ Tool shortcuts (single-letter, no modifiers) ─
    if (!meta && !e.altKey && !e.shiftKey) {
        switch (e.key) {
            case 'v': case 'V': setTool('select');    return;
            case 't': case 'T': setTool('text');      return;
            case 'i': case 'I': setTool('image');     return;
            case 'd': case 'D': setTool('draw');      return;
            case 'h': case 'H': setTool('highlight'); return;
            case 'e': case 'E': setTool('eraser');    return;
            case 'm': case 'M': $('btnModify').click(); return;
            case '+': case '=': setZoom(S.zoom + 0.15); return;
            case '-':           setZoom(S.zoom - 0.15); return;
            case '0':           $('btnZoomFit').click(); return;
        }
    }
});

// Ctrl+Scroll zoom
$('canvasArea').addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(S.zoom + (e.deltaY > 0 ? -0.1 : 0.1)); }
}, { passive: false });

// ─── Print ───
async function printPDF() {
    if (!S.pdfDoc) return;
    showLoader('Preparing print…');
    try {
        const bytes = await S.pdfDoc.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
        iframe.src = url;
        document.body.appendChild(iframe);
        iframe.onload = () => {
            hideLoader();
            iframe.contentWindow.print();
            // Keep the document alive while the print dialog is open. Removing the
            // iframe after a fixed 5 s raced with the user picking print options.
            let done = false;
            const cleanup = () => {
                if (done) return; done = true;
                try { document.body.removeChild(iframe); } catch (_) {}
                try { URL.revokeObjectURL(url); } catch (_) {}
            };
            try { iframe.contentWindow.addEventListener('afterprint', cleanup); } catch (_) {}
            setTimeout(cleanup, 300000);   // safety net if afterprint never fires
        };
    } catch (e) { hideLoader(); toast('Print error: ' + e.message); }
}
$('prefPrint').onclick = printPDF;

// ─── Merge another PDF ───
$('btnMergePDF').onclick = () => { if (!S.pdfDoc) { toast('Open a PDF first'); return; } $('fileMerge').click(); };
$('fileMerge').onchange = async e => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = '';
    showLoader('Merging PDF…');
    try {
        const buf = await f.arrayBuffer();
        const srcDoc = await PDFDocument.load(buf);
        const pages = await S.pdfDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(p => S.pdfDoc.addPage(p));
        await rebuild();
        toast(`Merged ${pages.length} page(s) from ${f.name}`);
    } catch (err) { hideLoader(); toast('Merge error: ' + err.message); console.error(err); }
};

// ─── Imposition ───
// Two families, both driven by an explicit print order so what the user sees in
// the preview is exactly what gets written:
//   • booklet (signature) — 2 pages per sheet side, the SuperPrint order:
//       multiple of 4, then [n,1] [2,n-1] [n-2,3] [4,n-3] … one output page per
//       sheet side. A 4-page job gives [4,1] then [2,3]; an 8-page job gives
//       [8,1] [2,7] [6,3] [4,5].
//   • N-up — the page sequence laid out on a grid, in reading order.
const IMPO_GRIDS = { '4up':[2,2], '8up':[4,2], '16up':[4,4], '20up':[5,4], '24up':[6,4], '32up':[8,4], '64up':[8,8] };

let _impoMode = 'booklet';

// SuperPrint-compatible signature order. Returns the flat print sequence; each
// pair of consecutive entries is one printed side (left, right).
//   4 pages  → [4,1, 2,3]
//   8 pages  → [8,1, 2,7, 6,3, 4,5]
//   20 pages → [20,1, 2,19, 18,3, 4,17, …]
function calculateImpositionOrder(numPages) {
    const fromKernel = Kernel.signatureOrder(numPages);
    if (fromKernel) return Array.from(fromKernel);
    const adjusted = Math.ceil(Math.max(1, numPages) / 4) * 4;
    const sheets = adjusted / 4;
    const order = [];
    let front = 1, back = adjusted;
    for (let sheet = 0; sheet < sheets; sheet++) {
        order.push(back, front); back--; front++;   // recto: outside of the sheet
        order.push(front, back); front++; back--;   // verso: inside of the sheet
    }
    return order;
}

// Perfect-bound pairing: the pages simply follow each other two by two, so a
// spread is [1,2] [3,4] … Nothing to compute beyond the multiple of 4.
function calculateSequentialOrder(numPages) {
    const fromKernel = Kernel.sequentialOrder(numPages);
    if (fromKernel) return Array.from(fromKernel);
    const adjusted = Math.ceil(Math.max(1, numPages) / 4) * 4;
    const order = [];
    for (let p = 1; p <= adjusted; p++) order.push(p);
    return order;
}

// The imposed sides described as { left, right } of 1-based page numbers, where
// a number greater than the real page count means "blank padding page".
function buildImposedSides(numPages, binding = 'saddle') {
    const fromKernel = Kernel.imposedSides(numPages, binding);
    if (fromKernel) {
        return fromKernel.map(s => ({ left: s.left, right: s.right, sheet: s.sheet, side: s.front ? 'front' : 'back' }));
    }
    const flat = binding === 'perfect'
        ? calculateSequentialOrder(numPages)
        : calculateImpositionOrder(numPages);
    const sides = [];
    for (let i = 0; i < flat.length; i += 2) {
        sides.push({
            left: flat[i],
            right: flat[i + 1],
            sheet: Math.floor(i / 4) + 1,
            side: (i % 4) < 2 ? 'front' : 'back',
        });
    }
    return sides;
}

function getImpoBinding() { return $('impoBinding')?.value || 'saddle'; }
function getImpoGrid() {
    const layout = document.querySelector('.impo-card.selected')?.dataset.layout || '4up';
    return IMPO_GRIDS[layout] || [2, 2];
}
const escHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function updateImpoModeUI() {
    const booklet = _impoMode === 'booklet';
    if ($('impoBookletSection')) $('impoBookletSection').style.display = booklet ? '' : 'none';
    if ($('impoLayoutSection')) $('impoLayoutSection').style.display = booklet ? 'none' : '';
    document.querySelectorAll('.impo-mode').forEach(m => {
        m.classList.toggle('selected', m.dataset.mode === _impoMode);
    });
}

$('btnImpoToolbar').onclick = () => {
    if (!S.pdfDoc) { toast('Open a PDF first'); return; }
    $('sidebar').classList.remove('open');
    updateImpoModeUI();
    $('impoModal').classList.add('visible');
    updateImpoPreview();
};
$('impoCancel').onclick = () => $('impoModal').classList.remove('visible');

// Mode cards
document.querySelectorAll('.impo-mode').forEach(card => {
    card.addEventListener('click', () => {
        _impoMode = card.dataset.mode || 'booklet';
        updateImpoModeUI();
        updateImpoPreview();
    });
});

// Layout card selection
document.querySelectorAll('.impo-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.impo-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        updateImpoPreview();
    });
});

// Sheet size → custom row toggle
$('impoSheetSize').addEventListener('change', () => {
    $('impoCustomRow').classList.toggle('visible', $('impoSheetSize').value === 'custom');
    updateImpoPreview();
});

// Page range toggle
$('impoPageRange').addEventListener('change', () => {
    $('impoRangeOpt').style.display = $('impoPageRange').value === 'custom' ? '' : 'none';
    updateImpoPreview();
});
if ($('impoRangeInput')) $('impoRangeInput').addEventListener('input', updateImpoPreview);
if ($('impoBinding')) $('impoBinding').addEventListener('change', updateImpoPreview);

// Update preview on any relevant change
['impoOrientation','impoGutter','impoBleed','impoMarginT','impoMarginB','impoMarginL','impoMarginR','impoPageOrder'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', updateImpoPreview);
    if (el) el.addEventListener('input', updateImpoPreview);
});

// Which source pages the imposition will use (1-based, in document order).
function impoSelectedPages() {
    const total = S.pdfDoc ? S.pdfDoc.getPageCount() : 0;
    if (!total) return [];
    if ($('impoPageRange').value === 'custom') {
        const list = parsePageRange($('impoRangeInput').value, total).map(i => i + 1);
        if (list.length) return list;
    }
    return Array.from({ length: total }, (_, i) => i + 1);
}

// ─── Imposition preview ───
function updateImpoPreview() {
    const cvs = $('impoPreviewCanvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);

    const pages = impoSelectedPages();
    const total = pages.length;
    const booklet = _impoMode === 'booklet';

    // Print order + explanation, exactly like the source of truth used to write.
    const orderEl = $('impoOrderList');
    const summaryEl = $('impoOrderSummary');
    let sides = [];
    let label = n => (n > total ? '·' : String(pages[n - 1]));

    if (booklet) {
        sides = buildImposedSides(total, getImpoBinding());
        const padded = sides.length * 2;
        if (summaryEl) {
            summaryEl.textContent = total
                ? `— ${total} page${total > 1 ? 's' : ''} → ${padded} on press → ${sides.length} sheet side${sides.length > 1 ? 's' : ''}`
                : '';
        }
        if (orderEl) {
            orderEl.innerHTML = sides.map(s => {
                const l = s.left > total ? '<span class="impo-sheet-sep">blank</span>' : '<b>' + escHtml(String(pages[s.left - 1])) + '</b>';
                const r = s.right > total ? '<span class="impo-sheet-sep">blank</span>' : '<b>' + escHtml(String(pages[s.right - 1])) + '</b>';
                const tag = `<span class="impo-sheet-sep">${s.sheet}${s.side === 'front' ? 'R' : 'V'}</span>`;
                return `${tag} [${l} | ${r}]`;
            }).join(' &nbsp; ');
        }
        const hint = $('impoBookletHint');
        if (hint) {
            const blanks = sides.length * 2 - total;
            hint.textContent = total
                ? (blanks > 0
                    ? `A booklet needs a multiple of 4 pages: ${blanks} blank page${blanks > 1 ? 's are' : ' is'} added at the end (the document itself is not modified). Print double-sided, flip on the short edge, then fold.`
                    : 'Print double-sided, flip on the short edge, then fold along the spine.')
                : 'Open a document to compute the imposition.';
        }
    } else {
        const [cols, rows] = getImpoGrid();
        const perSheet = cols * rows;
        const padded = Math.max(perSheet, Math.ceil(total / perSheet) * perSheet);
        const sheets = Math.max(1, padded / perSheet);
        if (summaryEl) {
            summaryEl.textContent = total
                ? `— ${total} page${total > 1 ? 's' : ''} → ${padded} on press → ${sheets} sheet${sheets > 1 ? 's' : ''}`
                : '';
        }
        if (orderEl) {
            const cells = [];
            for (let s = 0; s < sheets; s++) {
                const row = [];
                for (let i = 0; i < perSheet; i++) {
                    const n = s * perSheet + i + 1;
                    row.push(n > total ? '<span class="impo-sheet-sep">blank</span>' : '<b>' + escHtml(String(pages[n - 1])) + '</b>');
                }
                cells.push(`<span class="impo-sheet-sep">S${s + 1}</span> [${row.join(' | ')}]`);
            }
            orderEl.innerHTML = cells.join(' &nbsp; ');
        }
    }

    // Sheet diagram: one imposed side, with the real page numbers in the slots.
    const pad = 10;
    const sheetW = W - pad * 2, sheetH = H - pad * 2;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#111';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pad, pad, sheetW, sheetH);

    const gx = 4;
    const slots = booklet ? 2 : getImpoGrid()[0] * getImpoGrid()[1];
    const cols = booklet ? 2 : getImpoGrid()[0];
    const rows = booklet ? 1 : getImpoGrid()[1];
    const slotW = (sheetW - gx * (cols - 1)) / cols;
    const slotH = (sheetH - 4 * (rows - 1)) / rows;
    const first = sides[0] || null;
    let num = 1;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = pad + c * (slotW + gx);
            const y = pad + r * (slotH + 4);
            ctx.fillStyle = 'rgba(var(--accent-rgb),0.07)';
            ctx.fillRect(x, y, slotW, slotH);
            ctx.strokeStyle = 'rgba(var(--accent-rgb),0.35)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, slotW, slotH);
            let txt = '';
            if (booklet) {
                const src = c === 0 ? first?.left : first?.right;
                txt = src ? label(src) : '';
            } else {
                txt = num <= total ? String(pages[num - 1]) : '·';
            }
            if (txt) {
                ctx.fillStyle = accent;
                ctx.font = `600 ${booklet ? 20 : Math.max(9, Math.min(16, slotW / 3))}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(txt, x + slotW / 2, y + slotH / 2);
            }
            num++;
        }
    }
    if (booklet && first) {
        ctx.fillStyle = accent;
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Sheet ${first.sheet} — ${first.side === 'front' ? 'front' : 'back'}`, W / 2, H - 1);
    }
}

// ─── Parse page range string ───
function parsePageRange(str, maxPage) {
    const fromKernel = Kernel.parsePageRange(str, maxPage);
    if (fromKernel) return Array.from(fromKernel);
    const pages = new Set();
    str.split(',').forEach(part => {
        part = part.trim();
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
            const a = Math.max(1, parseInt(m[1])), b = Math.min(maxPage, parseInt(m[2]));
            for (let i = a; i <= b; i++) pages.add(i - 1); // 0-indexed
        } else if (/^\d+$/.test(part)) {
            const p = parseInt(part);
            if (p >= 1 && p <= maxPage) pages.add(p - 1);
        }
    });
    return [...pages].sort((a, b) => a - b);
}

// ─── Get imposition options ───
function getImpoOptions() {
    const mmToPt = 2.83465;
    const gutter = parseFloat($('impoGutter').value) || 0;
    const bleed = parseFloat($('impoBleed').value) || 0;
    const marginT = parseFloat($('impoMarginT').value) || 0;
    const marginB = parseFloat($('impoMarginB').value) || 0;
    const marginL = parseFloat($('impoMarginL').value) || 0;
    const marginR = parseFloat($('impoMarginR').value) || 0;
    return {
        gutter: gutter * mmToPt,
        bleed: bleed * mmToPt,
        marginT: marginT * mmToPt,
        marginB: marginB * mmToPt,
        marginL: marginL * mmToPt,
        marginR: marginR * mmToPt,
        cropMarks: $('impoCropMarks').checked,
        autoRotate: $('impoAutoRotate').checked,
        pageOrder: $('impoPageOrder').value,
        orientation: $('impoOrientation').value,
    };
}

// ─── Get sheet size in points ───
// 'auto' returns a zero size: the caller replaces it with 2 × the source page so
// the imposed pages come out at 100 %. 
function getImpoSheetSize() {
    const sheetSizes = {
        a5: [419.53, 595.28], a4: [595.28, 841.89], a3: [841.89, 1190.55],
        a2: [1190.55, 1683.78], sra3: [907.09, 1275.59], sra4: [637.80, 907.09],
        letter: [612, 792], legal: [612, 1008], tabloid: [792, 1224],
    };
    const key = $('impoSheetSize').value;
    if (key === 'auto') return [0, 0];
    if (key === 'custom') {
        const w = parseFloat($('impoCustomW').value) || 210;
        const h = parseFloat($('impoCustomH').value) || 297;
        const unit = $('impoCustomUnit').value;
        const factor = unit === 'mm' ? 2.83465 : unit === 'in' ? 72 : 1;
        return [w * factor, h * factor];
    }
    return sheetSizes[key] || sheetSizes.a4;
}

// ─── Draw crop marks ───
function drawCropMarks(page, x, y, slotW, slotH, markLen) {
    const ml = markLen || 12;
    const off = 4; // offset from trim edge
    const rgb = { type: 'RGB', red: 0, green: 0, blue: 0 };
    // Eight marks around the trim box, never inside it.
    const fromKernel = Kernel.cropMarks(x, y, slotW, slotH, ml, off);
    const lines = fromKernel
        ? fromKernel.map(m => [m.x1, m.y1, m.x2, m.y2])
        : [
        // Top-left
        [x - off, y + slotH, x - off - ml, y + slotH],
        [x, y + slotH + off, x, y + slotH + off + ml],
        // Top-right
        [x + slotW + off, y + slotH, x + slotW + off + ml, y + slotH],
        [x + slotW, y + slotH + off, x + slotW, y + slotH + off + ml],
        // Bottom-left
        [x - off, y, x - off - ml, y],
        [x, y - off, x, y - off - ml],
        // Bottom-right
        [x + slotW + off, y, x + slotW + off + ml, y],
        [x + slotW, y - off, x + slotW, y - off - ml],
    ];
    lines.forEach(([x1, y1, x2, y2]) => {
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: rgb });
    });
}

// ─── Build slot positions ───
function buildSlotPositions(cols, rows, slotW, slotH, gutter, marginL, marginB, order) {
    // Le noyau renvoie déjà les emplacements triés pour `order` ; le seul
    // appelant ne lit que `x` et `y`.
    const fromKernel = Kernel.nupSlots(cols, rows, slotW, slotH, gutter, marginL, marginB, order);
    if (fromKernel) return fromKernel;
    const positions = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            positions.push({
                x: marginL + c * (slotW + gutter),
                y: marginB + (rows - 1 - r) * (slotH + gutter), // PDF y is bottom-up
                col: c, row: r,
            });
        }
    }
    // Reorder based on page order setting
    if (order === 'rtl-ttb') {
        positions.sort((a, b) => a.row - b.row || b.col - a.col);
    } else if (order === 'ltr-btt') {
        positions.sort((a, b) => b.row - a.row || a.col - b.col);
    } else if (order === 'ttb-ltr') {
        positions.sort((a, b) => a.col - b.col || a.row - b.row);
    }
    // Default ltr-ttb: already sorted row then col
    return positions;
}

$('impoApply').onclick = async () => {
    if (!S.pdfDoc) { toast('No PDF loaded'); return; }
    if (!impoSelectedPages().length) { toast('Select at least one page'); return; }
    $('impoModal').classList.remove('visible');
    showLoader('Applying imposition…');
    try {
        const sides = await applyImposition(_impoMode);
        if (sides) toast(`Imposition applied — ${sides} sheet side${sides > 1 ? 's' : ''}`);
    } catch (err) { toast('Imposition error: ' + err.message); console.error(err); }
    hideLoader();
};

// Builds a NEW document where every page is one imposed press-sheet side.
// The source document is never mutated: blank padding exists only on the sheets.
async function applyImposition(mode = 'booklet') {
    const opts = getImpoOptions();
    const booklet = mode === 'booklet';
    const binding = getImpoBinding();

    // Read current PDF (a snapshot — the live document keeps its own pages)
    const srcBytes = await S.pdfDoc.save();
    const srcDoc = await PDFDocument.load(srcBytes);

    // Pages picked by the user, as 1-based source page numbers, in document order.
    const picked = impoSelectedPages();
    const pageCount = picked.length;
    if (!pageCount) throw new Error('no page selected');

    // ── Sheet geometry ──
    const auto = $('impoSheetSize').value === 'auto';
    let [sheetW, sheetH] = getImpoSheetSize();
    const firstPage = srcDoc.getPage(picked[0] - 1);
    const firstSize = firstPage.getSize();
    if (auto) {
        if (booklet) {
            // A spread: two pages side by side (portrait pages → landscape sheet).
            sheetW = firstSize.width * 2;
            sheetH = firstSize.height;
        } else {
            sheetW = firstSize.width;
            sheetH = firstSize.height;
        }
    }

    const [baseCols, baseRows] = booklet ? [2, 1] : getImpoGrid();
    const cols = baseCols, rows = baseRows;
    const perSheet = cols * rows;

    // ── Orientation ──
    if (opts.orientation === 'landscape') {
        if (sheetW < sheetH) [sheetW, sheetH] = [sheetH, sheetW];
    } else if (opts.orientation === 'portrait') {
        if (sheetW > sheetH) [sheetW, sheetH] = [sheetH, sheetW];
    } else if (cols > rows && sheetW < sheetH) {
        [sheetW, sheetH] = [sheetH, sheetW];
    }

    // ── Slot geometry ──
    const usableW = sheetW - opts.marginL - opts.marginR - opts.gutter * (cols - 1);
    const usableH = sheetH - opts.marginT - opts.marginB - opts.gutter * (rows - 1);
    const slotW = Math.max(1, usableW / cols);
    const slotH = Math.max(1, usableH / rows);

    const outDoc = await PDFDocument.create();
    const embedCache = new Map();
    const getEmbedded = async (srcIdx) => {
        if (!embedCache.has(srcIdx)) {
            // embedPdf(sourceDoc, indices) is the correct API — embedPages() expects
            // PDFPage objects and throws when handed page indices.
            const [embedded] = await outDoc.embedPdf(srcDoc, [srcIdx]);
            embedCache.set(srcIdx, embedded);
        }
        return embedCache.get(srcIdx);
    };
    const placeOn = async (outPage, slotX, slotY, srcPageNumber) => {
        if (!srcPageNumber || srcPageNumber > pageCount) return; // blank padding page
        const srcIdx = picked[srcPageNumber - 1] - 1;
        if (srcIdx < 0 || srcIdx >= srcDoc.getPageCount()) return;
        const embedded = await getEmbedded(srcIdx);
        const dims = embedded.size();
        let dw = dims.width, dh = dims.height;
        if (opts.autoRotate && ((dw > dh && slotW < slotH) || (dh > dw && slotW > slotH))) {
            [dw, dh] = [dh, dw];
        }
        const scale = Math.min(slotW / dw, slotH / dh);
        const x = slotX + (slotW - dw * scale) / 2;
        const y = slotY + (slotH - dh * scale) / 2;
        outPage.drawPage(embedded, { x, y, width: dw * scale, height: dh * scale });
        if (opts.cropMarks) drawCropMarks(outPage, slotX, slotY, slotW, slotH);
    };

    let written = 0;
    if (booklet) {
        // One output page per printed side: left page | gutter | right page.
        const sides = buildImposedSides(pageCount, binding);
        for (const side of sides) {
            const outPage = outDoc.addPage([sheetW, sheetH]);
            // Left slot sits at the left margin, right slot after the spine gutter.
            await placeOn(outPage, opts.marginL, opts.marginB, side.left);
            await placeOn(outPage, opts.marginL + slotW + opts.gutter, opts.marginB, side.right);
            written++;
        }
    } else {
        // N-up: the page sequence in reading order, `perSheet` slots per sheet.
        const positions = buildSlotPositions(cols, rows, slotW, slotH, opts.gutter, opts.marginL, opts.marginB, opts.pageOrder);
        for (let i = 0; i < pageCount; i += perSheet) {
            const outPage = outDoc.addPage([sheetW, sheetH]);
            for (let s = 0; s < perSheet; s++) {
                const n = i + s + 1;
                if (n > pageCount) break;    // remaining slots stay blank
                const pos = positions[s];
                await placeOn(outPage, pos.x, pos.y, n);
            }
            written++;
        }
    }

    const outBytes = await outDoc.save();
    const suffix = booklet ? `_booklet-${binding}` : `_${document.querySelector('.impo-card.selected')?.dataset.layout || '4up'}`;
    await openPDF(outBytes.buffer, S.fileName.replace(/\.pdf$/i, `${suffix}.pdf`));
    return written;
}

// ─── Keyboard help ───
$('kbdClose').onclick = () => $('kbdModal').classList.remove('visible');

// ─── GLOBAL TEXT CLICK HANDLER ───
// Captures mousedown in capture phase on canvasArea to find text near click.
// This is the MAIN reliable mechanism for clicking on PDF text to edit it.
$('canvasArea').addEventListener('mousedown', (e) => {
    // Don't interfere if in draw/highlight/eraser/text/image/note mode
    if (S.tool === 'draw' || S.tool === 'highlight' || S.tool === 'eraser' || S.tool === 'text' || S.tool === 'image' || S.tool === 'note') return;
    // Don't interfere with panels/toolbar
    if (e.target.closest('.toolbar-container, .sidebar, .text-edit-panel, .fr-panel, .prefs-panel, .search-fab, .annot-fab, .icc-panel, #btnPagesFixed, #btnSaveFixed, #btnConvertSp')) return;
    // Don't interfere with clicks ON existing editable elements or the inline textarea
    // (their own handlers manage selection / inline editing)
    if (e.target.closest('.el-text, .el-img, .el-sig, .el-note, .el-pdf-img, .el-pdf-graphic, .el-stroke, .pdfz-inline-textarea, .resize-h')) return;

    // Find which page was clicked
    const wrap = e.target.closest('.page-canvas-wrap');
    if (!wrap) return;
    const pageNum = parseInt(wrap.dataset.page);
    const pageData = S.pages[pageNum - 1];
    if (!pageData || !pageData.elements.length) return;

    const r = wrap.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;

    // Find the closest extracted text element
    let best = null, bestDist = Infinity;
    for (const el of pageData.elements) {
        if (!el.extracted || el._deleted) continue;
        const ew = el.width || 100;
        const eh = el.height || el.fontSize * 1.5;
        const cx = Math.max(el.x, Math.min(mx, el.x + ew));
        const cy = Math.max(el.y, Math.min(my, el.y + eh));
        const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
        if (dist < bestDist) {
            bestDist = dist;
            best = el;
        }
    }

    // If clicked within 8px of an element, select and open panel
    if (best && bestDist <= 8) {
        e.stopPropagation();
        e.preventDefault();
        const dom = pageData.editLayer.querySelector(`[data-id="${best.id}"]`);
        if (dom) {
            selectEl(best, dom);
            // In modify mode a single click selects; text editing is an explicit action.
            if (!S.editMode) openTextPanel(best);
        }
    }
}, true); // CAPTURE PHASE — fires before element-level handlers

// ─── Pre-home: previous-sessions pane ───
// Inspect the saved session WITHOUT loading its PDF, so the list can be painted
// on the very first frame.
function _peekSavedSession() {
    try {
        const meta = localStorage.getItem('pdfz-meta');
        const b64  = localStorage.getItem('pdfz-pdf');
        if (!meta || !b64) return null;
        const data = JSON.parse(meta);
        if (!data || !data.timestamp) return null;
        if (Date.now() - data.timestamp > SESSION_TTL) return null;
        const pages = data.elements ? Object.keys(data.elements).length : 0;
        // approx decoded byte size of the base64 payload
        const sizeB = Math.floor(b64.length * 3 / 4);
        return {
            fileName: data.fileName || 'document.pdf',
            timestamp: data.timestamp,
            pages,
            size: sizeB,
        };
    } catch (_) { return null; }
}

function _formatAge(ts) {
    if (!ts) return '—';
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1)    return 'Just now';
    if (min < 60)   return min + ' min ago';
    if (min < 1440) return Math.round(min / 60) + ' h ago';
    if (min < 10080) return Math.round(min / 1440) + ' d ago';
    return Math.round(min / 10080) + ' w ago';
}
function _formatBytes(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
}

// Every session known to the app, newest first, flagged with:
//  • hasPdf   — the payload is really stored, so it can be resumed
//  • current  — this is the document held by the legacy autosave slot
function _splashSessionList() {
    const sessions = _readSessions();
    const legacy = _peekSavedSession();
    if (legacy) {
        const id = _sessionId(legacy.fileName);
        const hit = sessions.find(s => s.id === id);
        if (!hit) {
            sessions.unshift({ ...legacy, id });
        } else {
            if (!hit.size) hit.size = legacy.size;
            if (!hit.pages) hit.pages = legacy.pages;
            if (!hit.timestamp) hit.timestamp = legacy.timestamp;
        }
    }
    let currentName = null;
    try { currentName = JSON.parse(localStorage.getItem('pdfz-meta') || 'null')?.fileName || null; } catch (_) {}
    const legacyName = legacy ? legacy.fileName : null;
    return sessions
        .map(s => ({
            ...s,
            current: !!currentName && s.fileName === currentName,
            hasPdf: _sessionsWithBytes.has(s.id)
                || (!!legacyName && s.fileName === legacyName),
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// Forget one session everywhere: index, payload store and legacy slot.
async function _forgetSession(session) {
    if (!session) return;
    await _idbDelete(session.id);
    _sessionsWithBytes.delete(session.id);
    _writeSessions(_readSessions().filter(x => x.id !== session.id));
    try {
        const legacyMeta = JSON.parse(localStorage.getItem('pdfz-meta') || 'null');
        if (legacyMeta && legacyMeta.fileName === session.fileName) {
            localStorage.removeItem('pdfz-meta');
            localStorage.removeItem('pdfz-pdf');
        }
    } catch (_) {}
}

(function _initSplashSessions() {
    const panel = $('splashResume');
    const list = $('splashSessionsList');
    const search = $('splashSessionsSearch');
    const countEl = $('splashSessionsCount');
    if (!panel || !list) return;

    const ICON_FILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    const ICON_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const ICON_EMPTY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

    let query = '';
    let busy = false;

    const chip = (text, cls) => {
        const el = document.createElement('span');
        if (cls) el.className = cls;
        el.textContent = text;
        return el;
    };
    const emptyState = (title, sub) => {
        const box = document.createElement('div');
        box.className = 'splash-sessions-empty';
        box.innerHTML = ICON_EMPTY;
        const t = document.createElement('strong');
        t.textContent = title;
        const s = document.createElement('span');
        s.textContent = sub;
        box.append(t, s);
        return box;
    };

    const openSession = async (s) => {
        if (busy || _isOpening) return;
        if (!_sessionsScanDone) { try { await _scanSessionBytes(); } catch (_) {} render(); }
        if (!s.hasPdf) {
            toast('This session’s PDF is no longer stored — open the file again to continue');
            return;
        }
        busy = true;
        const ok = await restoreSession(s.id);
        busy = false;
        if (!ok) {
            toast('Could not restore this session');
            render();
        }
    };

    const forgetSession = async (s) => {
        if (busy) return;
        busy = true;
        await _forgetSession(s);
        busy = false;
        render();
    };

    const render = () => {
        const all = _splashSessionList();
        const q = query.trim().toLowerCase();
        const shown = q ? all.filter(s => (s.fileName || '').toLowerCase().includes(q)) : all;

        if (countEl) {
            countEl.textContent = String(all.length);
            countEl.hidden = all.length === 0;
        }
        if (search) {
            search.parentElement.style.display = all.length > 3 ? '' : 'none';
            if (!all.length && search.value) { search.value = ''; query = ''; }
        }

        list.innerHTML = '';
        if (!all.length) {
            list.appendChild(emptyState('No previous sessions', 'Documents you open are kept here for 7 days.'));
            return;
        }
        if (!shown.length) {
            list.appendChild(emptyState('No match', `No session named “${query.trim()}”.`));
            return;
        }

        shown.forEach(s => {
            const card = document.createElement('div');
            card.className = 'splash-session'
                + (s.hasPdf ? '' : ' is-missing')
                + (s.current ? ' is-current' : '');
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.title = s.hasPdf ? 'Resume this session'
                : 'The PDF of this session is no longer stored — open the file again';

            const icon = document.createElement('span');
            icon.className = 'splash-session-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = ICON_FILE;

            const title = document.createElement('span');
            title.className = 'splash-session-title';
            title.textContent = s.fileName || 'document.pdf';

            const metaRow = document.createElement('span');
            metaRow.className = 'splash-session-meta';
            metaRow.appendChild(chip(s.hasPdf ? 'Ready' : 'No PDF', s.hasPdf ? 's-ready' : 's-missing'));
            metaRow.appendChild(chip(_formatAge(s.timestamp)));
            // One combined chip keeps the card on a single meta line at 3 columns.
            const detail = [
                s.pages ? s.pages + (s.pages > 1 ? ' pages' : ' page') : '',
                _formatBytes(s.size),
            ].filter(Boolean).join(' · ');
            if (detail) metaRow.appendChild(chip(detail));

            const actions = document.createElement('span');
            actions.className = 'splash-session-actions';
            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'splash-session-play';
            play.innerHTML = ICON_PLAY;
            play.appendChild(document.createTextNode('Resume'));
            play.tabIndex = -1;
            if (!s.hasPdf) play.style.display = 'none';
            play.addEventListener('click', e => { e.stopPropagation(); openSession(s); });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'splash-session-del';
            del.title = 'Forget this session';
            del.setAttribute('aria-label', 'Forget this session');
            del.innerHTML = ICON_X;
            del.tabIndex = -1;
            del.addEventListener('click', e => { e.stopPropagation(); forgetSession(s); });
            actions.append(play, del);

            card.append(icon, title, metaRow, actions);
            card.addEventListener('click', () => openSession(s));
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSession(s); }
            });
            list.appendChild(card);
        });
    };

    if (search) {
        search.addEventListener('input', () => { query = search.value || ''; render(); });
    }
    render();
    // A fresh autosave can add a session while the splash is still on screen.
    window.__refreshSplashSessions = render;
    // Then confirm which sessions really have a stored payload, and clean up.
    _scanSessionBytes().then(render).catch(() => {});
    _pruneSessions().then(render).catch(() => {});
})();

// ─── All sessions popin (multi-session history) ───
(function _initSessionsPopin() {
    const modal = $('sessionsModal');
    const list  = $('sessionsList');
    const allBtn = $('splashResumeAllBtn');
    if (!modal || !list) return;

    const _renderSessions = () => {
        const sessions = _splashSessionList();
        const q = ($('sessionsSearch')?.value || '').trim().toLowerCase();
        const filter = document.querySelector('.sessions-filter.active')?.dataset.filter || 'all';
        let filtered = sessions;
        if (q) filtered = filtered.filter(s => (s.fileName || '').toLowerCase().includes(q));
        if (filter === 'recent') {
            const cutoff = Date.now() - 7 * 86400000;
            filtered = filtered.filter(s => (s.timestamp || 0) > cutoff);
        }
        list.innerHTML = '';
        if (!filtered.length) {
            list.innerHTML = '<div class="sessions-empty">No saved sessions yet.</div>';
            return;
        }
        filtered.forEach(s => {
            const card = document.createElement('div');
            card.className = 'session-card';
            card.innerHTML = `
                <div class="session-card-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div class="session-card-body">
                    <div class="session-card-title"></div>
                    <div class="session-card-meta">
                        <span class="s-age"></span>
                        <span class="s-pages"></span>
                        <span class="s-size"></span>
                    </div>
                </div>
                <div class="session-card-actions">
                    <button class="session-card-btn s-open" title="Open this session">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <button class="session-card-btn s-del" title="Delete session">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>`;
            card.querySelector('.session-card-title').textContent = s.fileName || 'document.pdf';
            card.querySelector('.s-age').textContent = _formatAge(s.timestamp);
            card.querySelector('.s-pages').textContent = s.pages ? s.pages + (s.pages > 1 ? ' pages' : ' page') : '—';
            card.querySelector('.s-size').textContent = _formatBytes(s.size) || '—';
            if (!s.hasPdf) {
                card.classList.add('is-missing');
                const openBtn = card.querySelector('.s-open');
                openBtn.disabled = true;
                openBtn.title = 'This PDF is no longer stored';
                openBtn.style.opacity = '0.35';
                openBtn.style.cursor = 'not-allowed';
                card.querySelector('.session-card-meta').appendChild(
                    Object.assign(document.createElement('span'), { textContent: 'No PDF' })
                );
            }
            card.querySelector('.s-open').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!s.hasPdf) { toast('This session’s PDF is no longer stored'); return; }
                modal.classList.remove('visible');
                const ok = await restoreSession(s.id);
                if (!ok) toast('Could not restore this session');
            });
            card.querySelector('.s-del').addEventListener('click', async (e) => {
                e.stopPropagation();
                await _forgetSession(s);
                _renderSessions();
            });
            card.addEventListener('click', async () => {
                if (!s.hasPdf) { toast('This session’s PDF is no longer stored'); return; }
                modal.classList.remove('visible');
                const ok = await restoreSession(s.id);
                if (!ok) toast('Could not restore this session');
            });
            list.appendChild(card);
        });
    };

    // Wire popin controls
    $('sessionsClose').addEventListener('click', () => modal.classList.remove('visible'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });
    if (allBtn) allBtn.addEventListener('click', async () => {
        if (!_sessionsScanDone) { try { await _scanSessionBytes(); } catch (_) {} }
        _renderSessions();
        modal.classList.add('visible');
    });
    document.querySelectorAll('.sessions-filter').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.sessions-filter').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            _renderSessions();
        });
    });
    const searchInput = $('sessionsSearch');
    if (searchInput) searchInput.addEventListener('input', _renderSessions);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') modal.classList.remove('visible');
    });
})();

// ─── PWA: file_handlers (launchQueue) — opens PDFs from OS / "Open with" ───
if ('launchQueue' in window && 'LaunchParams' in window) {
    try {
        window.launchQueue.setConsumer(async (params) => {
            if (!params || !params.files || !params.files.length) return;
            try {
                const handle = params.files[0];
                const file = await handle.getFile();
                if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
                    await loadPDFFile(file);
                }
            } catch (err) {
                console.warn('launchQueue file open failed:', err);
            }
        });
    } catch (_) {}
}

// ─── PWA: Web Share Target — receive PDFs shared from other apps ───
// The service worker stores the shared file in a Cache and redirects to ?share=1.
(async () => {
    try {
        const u = new URL(window.location.href);
        if (u.searchParams.get('share') !== '1') return;
        const cache = await caches.open('pdfz-share');
        const res = await cache.match('/PDF-YZ/__shared__');
        if (!res) return;
        const blob = await res.blob();
        await cache.delete('/PDF-YZ/__shared__');
        // Clean URL so a refresh doesn't try to re-load nothing.
        u.searchParams.delete('share');
        history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
        const file = new File([blob], 'shared.pdf', { type: 'application/pdf' });
        await loadPDFFile(file);
    } catch (err) {
        console.warn('Share target consumption failed:', err);
    }
})();

// ─── PWA: Install prompt + Service Worker with update notification ───
(function () {
    // NOTE: the visible install button was removed from the UI (per design review).
    // The PWA itself is kept — install is offered via the browser menu / iOS Share,
    // and the native beforeinstallprompt is captured for future UI entry points.
    const swUpdateToast    = document.getElementById('swUpdateToast');
    const swUpdateReload   = document.getElementById('swUpdateReloadBtn');
    const swUpdateDismiss  = document.getElementById('swUpdateDismissBtn');

    const isStandalonePwa = () =>
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    let deferredPrompt = null;
    let waitingWorker  = null;
    let hasReloaded    = false;
    let _swReloadRequested = false;   // set only by the “Reloading…” button

    // Lazy-load the PayPal SDK once (vault + subscription mode).
    let paypalSdkPromise = null;
    const loadPaypalSdk = () => {
        if (paypalSdkPromise) return paypalSdkPromise;
        paypalSdkPromise = new Promise((resolve, reject) => {
            if (window.paypal && window.paypal.HostedButtons) { resolve(window.paypal); return; }
            const s = document.createElement('script');
            // 2026-05-04 : passage de l'abonnement au paiement unique 24€ (collection app.zigmoon.com).
            s.src = 'https://www.paypal.com/sdk/js?client-id=BAAquYvIhLx-TZn41GHOZViIFLsBZAHw5qCpMSiwnh-UxVNGfQ4dcaKXu7dir8JGoogPhAGSupxrlEUfBY&components=hosted-buttons&disable-funding=venmo&currency=EUR';
            s.async = true;
            s.onload  = () => resolve(window.paypal);
            s.onerror = () => { paypalSdkPromise = null; reject(new Error('PayPal SDK failed to load')); };
            document.head.appendChild(s);
        });
        return paypalSdkPromise;
    };

    const ALREADY_DONATED_KEY = 'pdfz_donated_v1';
    const VALID_CODES         = ['808316'];

    // Returns true if user already paid / used a valid code, OR completes the
    // pop-in successfully (subscription approved, or valid promo code).
    const ensureDonationOrSkip = async () => {
        let alreadyDonated = false;
        try { alreadyDonated = localStorage.getItem(ALREADY_DONATED_KEY) === '1'; } catch (_) {}
        if (alreadyDonated) return true;

        const overlay   = document.getElementById('pdfz-donate-overlay');
        const closeBtn  = document.getElementById('pdfz-donate-close-btn');
        const skipBtn   = document.getElementById('pdfz-donate-skip-btn');
        const container = document.getElementById('pdfz-paypal-container');
        if (!overlay || !closeBtn || !skipBtn || !container) return false;

        return new Promise((resolve) => {
            let done = false;
            const cleanup = (didDonate) => {
                if (done) return;
                done = true;
                overlay.classList.remove('visible');
                closeBtn.removeEventListener('click', onCancel);
                skipBtn.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKey);
                setTimeout(() => resolve(didDonate), 220);
            };
            const onCancel   = (e) => { if (e) e.preventDefault(); cleanup(false); };
            const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
            const onKey      = (e) => { if (e.key === 'Escape') cleanup(false); };

            closeBtn.addEventListener('click', onCancel);
            skipBtn.addEventListener('click', onCancel);
            overlay.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKey);

            // Lazy-load PayPal SDK and render the subscription button.
            loadPaypalSdk()
                .then((paypal) => {
                    if (!paypal || container.dataset.rendered === '1') return;
                    container.dataset.rendered = '1';
                    paypal.HostedButtons({ hostedButtonId: 'DHFGPJBRF88Q4' })
                        .render('#pdfz-paypal-container');
                    const onPaypalMsg = (ev) => {
                        try {
                            if (!ev || !ev.origin) return;
                            if (!/paypal\.com$/.test(new URL(ev.origin).hostname)) return;
                            const d = ev.data;
                            const txt = (typeof d === 'string') ? d : (d ? JSON.stringify(d) : '');
                            if (/COMPLETED|payment\.captured|onApprove|order\.approved/i.test(txt)) {
                                try { localStorage.setItem(ALREADY_DONATED_KEY, '1'); } catch (_) {}
                                window.removeEventListener('message', onPaypalMsg);
                                cleanup(true);
                            }
                        } catch (_) {}
                    };
                    window.addEventListener('message', onPaypalMsg);
                })
                .catch(() => {
                    container.innerHTML = '<p style="font-size:10px;color:#ff6b6b;text-align:center;letter-spacing:0.5px;">PayPal could not load. Try a promo code below or check your connection.</p>';
                });

            // Promo code (partners / press / friends)
            const codeInput = document.getElementById('pdfz-donate-code');
            const codeBtn   = document.getElementById('pdfz-donate-code-btn');
            const codeMsg   = document.getElementById('pdfz-donate-code-msg');
            const tryCode = () => {
                if (!codeInput) return;
                const v = (codeInput.value || '').trim();
                if (VALID_CODES.includes(v)) {
                    try { localStorage.setItem(ALREADY_DONATED_KEY, '1'); } catch (_) {}
                    if (codeMsg) { codeMsg.style.color = '#9de9ba'; codeMsg.textContent = 'Code accepted — unlocking install…'; }
                    cleanup(true);
                } else if (v.length > 0) {
                    if (codeMsg) { codeMsg.style.color = '#ff6b6b'; codeMsg.textContent = 'Invalid code'; }
                }
            };
            if (codeBtn)   codeBtn.addEventListener('click', tryCode);
            if (codeInput) codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryCode(); } });

            overlay.classList.add('visible');
        });
    };

    const setUpdateVisible = (visible) => {
        if (!swUpdateToast) return;
        swUpdateToast.hidden = !visible;
        swUpdateToast.classList.toggle('show', visible);
    };

    const showUpdateToast = (registration) => {
        if (!registration || !registration.waiting || !navigator.serviceWorker.controller) return;
        waitingWorker = registration.waiting;
        setUpdateVisible(true);
    };

    const bindSwUpdates = (registration) => {
        if (!registration) return;
        if (registration.waiting) showUpdateToast(registration);
        registration.addEventListener('updatefound', () => {
            const nw = registration.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
                if (nw.state === 'installed') showUpdateToast(registration);
            });
        });
    };

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        if (typeof toast === 'function') toast('PDF-YZ installed');
    });

    // Update toast actions
    if (swUpdateReload) {
        swUpdateReload.addEventListener('click', () => {
            if (!waitingWorker) return;
            swUpdateReload.disabled = true;
            swUpdateReload.textContent = 'Reloading…';
            // Only an explicit click may take the page down: activating a new worker
            // used to reload the tab on its own, mid-export, with no warning.
            _swReloadRequested = true;
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        });
    }
    if (swUpdateDismiss) {
        swUpdateDismiss.addEventListener('click', () => setUpdateVisible(false));
    }

    setUpdateVisible(false);

    // Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (hasReloaded) return;
            if (!_swReloadRequested) return;   // never reload behind the user's back
            hasReloaded = true;
            window.location.reload();
        });
        window.addEventListener('load', async () => {
            try {
                const reg = await navigator.serviceWorker.register('service-worker.js', {
                    updateViaCache: 'none'
                });
                bindSwUpdates(reg);
                try { reg.update(); } catch (_) {}
            } catch (err) {
                console.warn('PDF-YZ: Service Worker registration failed:', err);
            }
        });
    }
})();
