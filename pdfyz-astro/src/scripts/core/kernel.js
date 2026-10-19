/**
 * Passerelle vers le noyau Rust (`pdfyz-rust`).
 *
 * Le noyau est compilé en WebAssembly sans aucune dépendance et exposé par la
 * colle `public/pdfyz-core.js`, un script classique qui publie `PdfyzCore` sur
 * `globalThis`. Cette passerelle donne au module de l'éditeur une surface
 * typée et, surtout, une règle claire :
 *
 *   • une fonction renvoie une valeur  → le noyau Rust a répondu ;
 *   • une fonction renvoie `undefined` → le noyau est absent ou a échoué,
 *     l'appelant doit retomber sur son implémentation JavaScript.
 *
 * Aucune fonction ne lève : une panne du noyau ne doit jamais empêcher
 * d'ouvrir un PDF. Les deux implémentations sont maintenues en parité par
 * `pdfyz-rust/scripts/validate-wasm.mjs` (206 vérifications), donc retomber sur
 * le JavaScript ne change pas le résultat — seulement le chemin.
 *
 * Le noyau n'est pas obligatoire : si `pdfyz_core.wasm` est absent (déploiement
 * partiel, navigateur sans WebAssembly), l'application fonctionne à l'identique.
 */

/** @typedef {{x:number,y:number,w:number,h:number}} Bounds */
/** @typedef {{left:number,right:number,sheet:number,front:boolean}} ImposedSide */

/** Colle disponible et noyau chargé ? */
function core() {
  const glue = globalThis.PdfyzCore;
  return glue && glue.ready ? glue : null;
}

/**
 * Appelle `name` sur le noyau et renvoie son résultat, ou `undefined` si le
 * noyau est absent, s'il n'expose pas la fonction, ou si l'appel échoue.
 *
 * @template T
 * @param {string} name
 * @param {unknown[]} args
 * @returns {T|undefined}
 */
function call(name, args) {
  const glue = core();
  if (!glue || typeof glue[name] !== 'function') return undefined;
  try {
    const value = glue[name](...args);
    return value === null ? null : value;
  } catch (error) {
    // Une seule fois par fonction : un noyau défaillant ne doit pas noyer la
    // console, mais l'information doit rester trouvable.
    if (!reported.has(name)) {
      reported.add(name);
      console.warn(`[noyau] ${name} a echoue, repli JavaScript :`, error && error.message);
    }
    return undefined;
  }
}

const reported = new Set();

export const Kernel = {
  /** Le noyau répond-il ? */
  get ready() {
    return core() !== null;
  },

  /** `'wasm'`, `'none'` — état de la colle, même avant chargement. */
  get backend() {
    const glue = globalThis.PdfyzCore;
    return glue ? glue.backend || 'none' : 'none';
  },

  /** Version annoncée par le noyau (celle de la colle s'il est absent). */
  get version() {
    const glue = globalThis.PdfyzCore;
    if (!glue) return '0.0.0';
    try {
      // La colle expose `version()` (fonction) et `VERSION` (chaîne).
      return typeof glue.version === 'function' ? glue.version() : glue.VERSION || '0.0.0';
    } catch {
      return glue.VERSION || '0.0.0';
    }
  },

  /**
   * Charge le noyau. Ne lève jamais : renvoie `'wasm'` ou `'none'`.
   * @param {string} [url] chemin du .wasm, relatif au document par défaut
   * @returns {Promise<'wasm'|'none'>}
   */
  async load(url) {
    const glue = globalThis.PdfyzCore;
    if (!glue || typeof glue.load !== 'function') return 'none';
    try {
      return await glue.load(url || 'pdfyz_core.wasm');
    } catch {
      return 'none';
    }
  },

  // ── Imposition ───────────────────────────────────────────────────────────

  /** Ordre de signature à plat : 8 pages → [8,1,2,7,6,3,4,5]. */
  signatureOrder(pages) {
    return call('signatureOrder', [pages]);
  },

  /** Ordre séquentiel à plat (reliure parfaite). */
  sequentialOrder(pages) {
    return call('sequentialOrder', [pages]);
  },

  /**
   * Faces imposées : `[{left, right, sheet, front}]`, 1-based, une entrée par
   * face de feuille. Une page au-delà du document est un blanc de calage.
   * @returns {ImposedSide[]|undefined}
   */
  imposedSides(pages, binding) {
    return call('imposedSides', [pages, binding]);
  },

  /** Emplacements d'une grille N-up, déjà triés selon `order`. */
  nupSlots(cols, rows, slotW, slotH, gutter, marginL, marginB, order) {
    return call('nupSlots', [cols, rows, slotW, slotH, gutter, marginL, marginB, order]);
  },

  /** Traits de coupe d'un emplacement : 8 segments `{x1,y1,x2,y2}`. */
  cropMarks(x, y, slotW, slotH, markLen, offset) {
    return call('cropMarks', [x, y, slotW, slotH, markLen, offset]);
  },

  /** Planche automatique : 2 × page en livret, la page elle-même en N-up. */
  autoSheet(pageW, pageH, booklet) {
    return call('autoSheet', [pageW, pageH, booklet]);
  },

  /** Applique une orientation (`auto` | `portrait` | `landscape`) à une planche. */
  resolveOrientation(width, height, orientation, cols, rows) {
    return call('resolveOrientation', [width, height, orientation, cols, rows]);
  },

  // ── Trace vectoriel ──────────────────────────────────────────────────────

  /**
   * Boîte englobante d'une suite de points `[x0,y0,x1,y1,…]`.
   * @returns {Bounds|null|undefined} `null` si la suite est vide
   */
  pathBounds(points) {
    return call('pathBounds', [points]);
  },

  /** Boîte englobante de sous-chemins (`lens` = nombre de points de chacun). */
  subpathsBounds(points, lens) {
    return call('subpathsBounds', [points, lens]);
  },

  /** Attribut `d` d'un `<path>` SVG, relatif à `(ox, oy)`. */
  pathData(points, lens, ox, oy) {
    return call('pathData', [points, lens, ox, oy]);
  },

  /** Place un contenu centré dans un emplacement. */
  fitCentered(contentW, contentH, slotX, slotY, slotW, slotH) {
    return call('fitCentered', [contentW, contentH, slotX, slotY, slotW, slotH]);
  },

  // ── Couleurs ─────────────────────────────────────────────────────────────

  /** `#rrggbb` → `{r,g,b}`, `null` si la chaîne n'est pas une couleur. */
  hexToRgb(hex) {
    return call('hexToRgb', [hex]);
  },

  /** CMJN (0-1) → `#rrggbb`. */
  cmykToHex(c, m, y, k) {
    return call('cmykToHex', [c, m, y, k]);
  },

  /** Éclaircit (`amount > 0`) ou assombrit (`amount < 0`) une couleur. */
  shadeHex(hex, amount) {
    return call('shadeHex', [hex, amount]);
  },

  /** Couleur majoritaire d'un échantillon (première rencontrée en cas d'égalité). */
  modalHex(hexes) {
    return call('modalHex', [hexes]);
  },

  // ── Modèle ───────────────────────────────────────────────────────────────

  /** Indices de page 0-based d'une saisie `1-4, 7, 10-12`. */
  parsePageRange(text, maxPage) {
    return call('parsePageRange', [text, maxPage]);
  },

  /** Identifiant de session : `doc:` + nom en minuscules. */
  sessionId(name) {
    return call('sessionId', [name]);
  },

  /**
   * Empreinte d'un objet graphique, pour supprimer les doublons.
   * @param {{stroked?:boolean,filled?:boolean,color?:string,lineWidth?:number,
   *          minX?:number,minY?:number,width?:number,height?:number,
   *          subpaths?:number,firstLength?:number}} o
   */
  graphicSignature(o) {
    return call('graphicSignature', [o]);
  },

  /** Rang dans la pile du calque d'édition. */
  zIndex(kind, extracted) {
    return call('zIndex', [kind, extracted]);
  },
};

export default Kernel;
