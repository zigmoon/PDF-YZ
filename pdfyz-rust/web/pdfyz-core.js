/*!
 * pdfyz-core.js — colle entre le noyau Rust/WebAssembly et l'application PDF-YZ.
 *
 * ⚠️ CE FICHIER EST UN SCRIPT CLASSIQUE (pas un module ES) : il doit pouvoir être
 * chargé aussi bien par l'application Astro (`<script src="pdfyz-core.js">`) que
 * par l'ancien fichier unique `index.html`, sans étape de compilation. Il n'y a
 * donc aucune instruction `import`/`export` : la surface publique est posée sur
 * `globalThis.PdfyzCore`.
 *
 * ## Ce que fait cette colle
 *
 * Elle charge `pdfyz_core.wasm` (construit par `scripts/build-wasm.ps1`) et
 * présente au reste du code des fonctions **amicales** — des tableaux JavaScript,
 * des objets nommés, des exceptions explicites — au lieu du contrat C brut
 * (pointeurs, codes d'erreur négatifs, protocole d'écriture en deux passes).
 *
 * ## Ce qu'elle ne fait PAS
 *
 * Elle ne réimplémente rien en JavaScript. Si le module ne peut pas être chargé
 * (navigateur sans WebAssembly, politique de sécurité, fichier absent d'un
 * déploiement), `backend` vaut `'none'` et **chaque fonction lève une erreur
 * nommée** au lieu de rendre un résultat approximatif. Le repli JavaScript vit
 * dans l'application (`pdfyz-astro/src/scripts/core/`), à un seul endroit, et il
 * est annoncé dans l'interface. C'est la règle du projet : aucune bascule à
 * l'aveugle, et jamais deux implémentations muettes qui divergent.
 *
 * ## Le piège à connaître
 *
 * `memory.buffer` est **détaché** dès qu'une fonction Rust agrandit la mémoire.
 * Toute vue `TypedArray` construite avant l'appel devient alors inutilisable
 * (longueur 0, accès qui lèvent). Cette colle reconstruit donc **systématiquement**
 * une vue neuve à chaque lecture, et ne conserve jamais une vue au-delà de
 * l'appel courant. `scripts/validate-wasm.mjs` vérifie cette règle sur chaque
 * fonction.
 *
 * Licence : propriétaire, tous droits réservés — voir ../LICENSE.
 */

(function (global) {
  'use strict';

  /** Version de la colle. Doit rester alignée sur `PZ_VERSION` côté Rust. */
  var VERSION = '0.1.0';

  /** Codes d'erreur de la frontière C (voir `crates/pdfyz-wasm/src/lib.rs`). */
  var ERR = {
    NULL: -1000001,
    TOO_SMALL: -1000002,
    BAD_INPUT: -1000003
  };

  /** Erreur du noyau : message lisible + code + fonction concernée. */
  function CoreError(message, options) {
    var error = Error.call(this, message);
    this.name = 'CoreError';
    this.message = message;
    this.code = options && options.code !== undefined ? options.code : undefined;
    this.fn = (options && options.fn) || undefined;
    this.cause = options && options.cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, CoreError);
    else this.stack = error.stack;
  }
  CoreError.prototype = Object.create(Error.prototype);
  CoreError.prototype.constructor = CoreError;

  /** Traduit un code négatif de la frontière en exception explicite. */
  function lever(code, fn) {
    var message;
    switch (code) {
      case ERR.NULL:
        message = 'pointeur nul transmis au noyau';
        break;
      case ERR.TOO_SMALL:
        message = 'tampon de sortie trop petit';
        break;
      case ERR.BAD_INPUT:
        message = 'entrée refusée par le noyau (texte illisible ou dimensions nulles)';
        break;
      default:
        message = 'échec du noyau (code ' + code + ')';
    }
    throw new CoreError(message + ' — ' + fn, { code: code, fn: fn });
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  État
  // ───────────────────────────────────────────────────────────────────────────

  /** @type {{memory:WebAssembly.Memory, exports:Object}|null} */
  var module_ = null;

  /** 'wasm' quand le noyau est chargé, 'none' sinon. */
  var backend = 'none';

  /** Mémoire allouée par appel : libérée dans un `finally`, jamais laissée fuir. */
  function alloc(bytes) {
    var size = Math.max(1, bytes | 0);
    var ptr = module_.exports.pz_alloc(size);
    if (!ptr) throw new CoreError('allocation refusée par le noyau (' + size + ' octets)');
    return { ptr: ptr, size: size };
  }

  function free(block) {
    if (block && block.ptr) module_.exports.pz_free(block.ptr, block.size);
  }

  /** Écrit une chaîne dans la mémoire du module (UTF-8) et rend le bloc alloué. */
  function pushText(text) {
    var bytes = new TextEncoder().encode(String(text == null ? '' : text));
    var block = alloc(bytes.length || 1);
    if (bytes.length) new Uint8Array(module_.exports.memory.buffer, block.ptr, bytes.length).set(bytes);
    return { block: block, length: bytes.length };
  }

  /** Écrit un tableau de nombres `f64` et rend le bloc alloué. */
  function pushF64(values) {
    var list = values || [];
    var block = alloc(list.length * 8 || 8);
    if (list.length) new Float64Array(module_.exports.memory.buffer, block.ptr, list.length).set(list);
    return { block: block, length: list.length };
  }

  /** Écrit un tableau de nombres `u32` et rend le bloc alloué. */
  function pushU32(values) {
    var list = values || [];
    var block = alloc(list.length * 4 || 4);
    if (list.length) new Uint32Array(module_.exports.memory.buffer, block.ptr, list.length).set(list);
    return { block: block, length: list.length };
  }

  /** Bloc de `count` nombres de `bytes` octets (0 = un octet, pour ne pas être nul). */
  function emptyOut(count, bytes) {
    var size = Math.max(1, count * bytes);
    var block = alloc(size);
    return block;
  }

  /** Vue neuve sur la mémoire — jamais conservée au-delà de l'appel. */
  function view(Ctor, ptr, count) {
    return new Ctor(module_.exports.memory.buffer, ptr, count);
  }

  /**
   * Protocole en deux passes pour une sortie de nombres.
   *
   * `invoke(out, cap, outLenPtr)` appelle la fonction du noyau. On commence avec
   * `cap = 0` : le noyau annonce la taille nécessaire puis rend `TOO_SMALL`. On
   * alloue, on rappelle, on lit.
   */
  function twoPass(invoke, Ctor, bytesPer, fnName) {
    var lenBlock = alloc(4);
    try {
      var rc = invoke(0, 0, lenBlock.ptr);
      var needed = view(Uint32Array, lenBlock.ptr, 1)[0];
      if (rc === 0) return [];
      if (rc !== ERR.TOO_SMALL) {
        if (rc < 0) lever(rc, fnName);
        // Succès immédiat (aucune donnée) : rien à lire.
        return [];
      }
      var out = emptyOut(needed, bytesPer);
      try {
        rc = invoke(out.ptr, needed, lenBlock.ptr);
        if (rc < 0) lever(rc, fnName);
        var count = view(Uint32Array, lenBlock.ptr, 1)[0];
        if (!count) return [];
        return Array.from(view(Ctor, out.ptr, count));
      } finally {
        free(out);
      }
    } finally {
      free(lenBlock);
    }
  }

  /** Même protocole, sortie texte UTF-8. */
  function twoPassText(invoke, fnName) {
    var lenBlock = alloc(4);
    try {
      var rc = invoke(0, 0, lenBlock.ptr);
      var needed = view(Uint32Array, lenBlock.ptr, 1)[0];
      if (rc === 0) return '';
      if (rc !== ERR.TOO_SMALL) {
        if (rc < 0) lever(rc, fnName);
        return '';
      }
      var out = alloc(Math.max(1, needed));
      try {
        rc = invoke(out.ptr, needed, lenBlock.ptr);
        if (rc < 0) lever(rc, fnName);
        var count = view(Uint32Array, lenBlock.ptr, 1)[0];
        if (!count) return '';
        return new TextDecoder().decode(view(Uint8Array, out.ptr, count));
      } finally {
        free(out);
      }
    } finally {
      free(lenBlock);
    }
  }

  /** Garde-fou : toute fonction exige le module chargé. */
  function need(name) {
    if (!module_) {
      throw new CoreError(
        'noyau Rust non chargé : appelle PdfyzCore.load() avant « ' + name + ' »',
        { fn: name }
      );
    }
    return module_.exports;
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Chargement
  // ───────────────────────────────────────────────────────────────────────────

  var loading = null;

  /**
   * Charge et instancie le module.
   *
   * @param {string} [url] chemin du `.wasm` ; par défaut `pdfyz_core.wasm`, résolu
   *   **relativement à la page**, ce qui fonctionne aussi bien à la racine (`/`)
   *   que sous un sous-dossier (`/PDF-YZ/`).
   * @returns {Promise<'wasm'|'none'>} le backend réellement actif.
   */
  function load(url) {
    if (loading) return loading;
    var target = url || 'pdfyz_core.wasm';
    loading = (async function () {
      if (typeof WebAssembly !== 'object') {
        backend = 'none';
        return backend;
      }
      try {
        var response = await fetch(target, { cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status + ' sur ' + target);
        var bytes = await response.arrayBuffer();
        // Aucun import : pas de WASI, pas de fonction hôte. C'est vérifié ici aussi,
        // pour qu'un module compilé par erreur avec des imports échoue franchement.
        var compiled = await WebAssembly.instantiate(bytes, {});
        var instance = compiled.instance || compiled;
        var exports = instance.exports;
        ['pz_alloc', 'pz_free', 'pz_version', 'memory'].forEach(function (name) {
          if (!(name in exports)) throw new Error('export manquant : ' + name);
        });
        module_ = { memory: exports.memory, exports: exports };
        // Un module périmé rendrait des résultats qui ne correspondent plus au
        // JavaScript du même dépôt : on refuse plutôt que de diverger en silence.
        var actual = version();
        if (actual !== VERSION) {
          module_ = null;
          throw new Error('version du noyau ' + actual + ' ≠ colle ' + VERSION);
        }
        backend = 'wasm';
        return backend;
      } catch (error) {
        module_ = null;
        backend = 'none';
        if (global.console) {
          console.warn('[PdfyzCore] noyau Rust indisponible :', error && error.message);
        }
        return backend;
      }
    })();
    return loading;
  }

  /** Version du noyau chargé (ou de la colle si le noyau est absent). */
  function version() {
    if (!module_) return VERSION;
    return twoPassText(function (out, cap, len) {
      return module_.exports.pz_version(out, cap, len);
    }, 'pz_version');
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Imposition
  // ───────────────────────────────────────────────────────────────────────────

  function signatureOrder(pages) {
    var ex = need('signatureOrder');
    return twoPass(function (out, cap, len) {
      return ex.pz_signature_order(pages | 0, out, cap, len);
    }, Uint32Array, 4, 'pz_signature_order');
  }

  function sequentialOrder(pages) {
    var ex = need('sequentialOrder');
    return twoPass(function (out, cap, len) {
      return ex.pz_sequential_order(pages | 0, out, cap, len);
    }, Uint32Array, 4, 'pz_sequential_order');
  }

  /**
   * Faces imposées d'un livret.
   *
   * @param {number} pages nombre de pages du document
   * @param {'saddle'|'perfect'} [binding] reliure
   * @returns {Array<{left:number,right:number,sheet:number,front:boolean}>}
   */
  function imposedSides(pages, binding) {
    var ex = need('imposedSides');
    var code = binding === 'perfect' ? 1 : 0;
    var flat = twoPass(function (out, cap, len) {
      return ex.pz_imposed_sides(pages | 0, code, out, cap, len);
    }, Uint32Array, 4, 'pz_imposed_sides');
    var sides = [];
    for (var i = 0; i + 3 < flat.length; i += 4) {
      sides.push({ left: flat[i], right: flat[i + 1], sheet: flat[i + 2], front: flat[i + 3] === 1 });
    }
    return sides;
  }

  var SLOT_ORDER = { 'ltr-ttb': 0, 'rtl-ttb': 1, 'ltr-btt': 2, 'ttb-ltr': 3 };
  var ORIENTATION = { auto: 0, portrait: 1, landscape: 2 };

  /** Emplacements d'une grille N-up, en points. */
  function nupSlots(cols, rows, slotW, slotH, gutter, marginL, marginB, order) {
    var ex = need('nupSlots');
    var flat = twoPass(function (out, cap, len) {
      return ex.pz_nup_slots(
        cols | 0, rows | 0, slotW, slotH, gutter || 0, marginL || 0, marginB || 0,
        SLOT_ORDER[order] || 0, out, cap, len
      );
    }, Float64Array, 8, 'pz_nup_slots');
    var slots = [];
    for (var i = 0; i + 1 < flat.length; i += 2) slots.push({ x: flat[i], y: flat[i + 1] });
    return slots;
  }

  /** Traits de coupe d'un emplacement : 8 segments. */
  function cropMarks(x, y, slotW, slotH, markLen, offset) {
    var ex = need('cropMarks');
    var flat = twoPass(function (out, cap, len) {
      return ex.pz_crop_marks(x, y, slotW, slotH, markLen || 0, offset || 0, out, cap, len);
    }, Float64Array, 8, 'pz_crop_marks');
    var marks = [];
    for (var i = 0; i + 3 < flat.length; i += 4) {
      marks.push({ x1: flat[i], y1: flat[i + 1], x2: flat[i + 2], y2: flat[i + 3] });
    }
    return marks;
  }

  /** Planche « auto » : 2 × page en livret, la page elle-même en N-up. */
  function autoSheet(pageW, pageH, booklet) {
    var ex = need('autoSheet');
    var flat = twoPass(function (out, cap, len) {
      return ex.pz_auto_sheet(pageW, pageH, booklet ? 1 : 0, out, cap, len);
    }, Float64Array, 8, 'pz_auto_sheet');
    return { width: flat[0], height: flat[1] };
  }

  /** Applique l'orientation demandée à une planche. */
  function resolveOrientation(width, height, orientation, cols, rows) {
    var ex = need('resolveOrientation');
    var flat = twoPass(function (out, cap, len) {
      return ex.pz_resolve_orientation(
        width, height, ORIENTATION[orientation] || 0, cols | 0, rows | 0, out, cap, len
      );
    }, Float64Array, 8, 'pz_resolve_orientation');
    return { width: flat[0], height: flat[1] };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Trace vectoriel
  // ───────────────────────────────────────────────────────────────────────────

  /** Boîte englobante d'une suite de points `[x0,y0,x1,y1,…]` ; `null` si vide. */
  function pathBounds(points) {
    var ex = need('pathBounds');
    var input = pushF64(points);
    try {
      var flat = twoPass(function (out, cap, len) {
        return ex.pz_path_bounds(input.block.ptr, input.length, out, cap, len);
      }, Float64Array, 8, 'pz_path_bounds');
      if (flat.length < 4) return null;
      return { x: flat[0], y: flat[1], w: flat[2], h: flat[3] };
    } finally {
      free(input.block);
    }
  }

  /**
   * Boîte englobante de sous-chemins.
   *
   * @param {number[]} points suite à plat de tous les points
   * @param {number[]} lens nombre de points de chaque sous-chemin
   */
  function subpathsBounds(points, lens) {
    var ex = need('subpathsBounds');
    var pts = pushF64(points);
    var sizes = pushU32(lens);
    try {
      var flat = twoPass(function (out, cap, len) {
        return ex.pz_subpaths_bounds(
          pts.block.ptr, pts.length, sizes.block.ptr, sizes.length, out, cap, len
        );
      }, Float64Array, 8, 'pz_subpaths_bounds');
      if (flat.length < 4) return null;
      return { x: flat[0], y: flat[1], w: flat[2], h: flat[3] };
    } finally {
      free(pts.block);
      free(sizes.block);
    }
  }

  /** Attribut `d` d'un `<path>` SVG, relatif à `(ox, oy)`. */
  function pathData(points, lens, ox, oy) {
    var ex = need('pathData');
    var pts = pushF64(points);
    var sizes = pushU32(lens);
    try {
      return twoPassText(function (out, cap, len) {
        return ex.pz_path_data(
          pts.block.ptr, pts.length, sizes.block.ptr, sizes.length, ox || 0, oy || 0, out, cap, len
        );
      }, 'pz_path_data');
    } finally {
      free(pts.block);
      free(sizes.block);
    }
  }

  /** Place un contenu centré dans un emplacement. */
  function fitCentered(contentW, contentH, slotX, slotY, slotW, slotH) {
    var ex = need('fitCentered');
    var flat = twoPass(function (out, cap, len) {
      return ex.pz_fit_centered(
        contentW, contentH, slotX, slotY, slotW, slotH, out, cap, len
      );
    }, Float64Array, 8, 'pz_fit_centered');
    return { x: flat[0], y: flat[1], w: flat[2], h: flat[3] };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Couleurs
  // ───────────────────────────────────────────────────────────────────────────

  /** `#rrggbb` → `{r,g,b}` ; `null` si illisible (le noyau refuse, il n'invente pas). */
  function hexToRgb(hex) {
    var ex = need('hexToRgb');
    var input = pushText(hex);
    var out = alloc(4);
    var lenBlock = alloc(4);
    try {
      var rc = ex.pz_hex_to_rgb(input.block.ptr, input.length, out.ptr, 3, lenBlock.ptr);
      if (rc === ERR.BAD_INPUT) return null;
      if (rc < 0) lever(rc, 'pz_hex_to_rgb');
      var bytes = view(Uint8Array, out.ptr, 3);
      return { r: bytes[0], g: bytes[1], b: bytes[2] };
    } finally {
      free(input.block);
      free(out);
      free(lenBlock);
    }
  }

  /** CMJN (0-1) → `#rrggbb`, conversion naïve sans profil ICC. */
  function cmykToHex(c, m, y, k) {
    var ex = need('cmykToHex');
    return twoPassText(function (out, cap, len) {
      return ex.pz_cmyk_to_hex(c, m, y, k, out, cap, len);
    }, 'pz_cmyk_to_hex');
  }

  /** Éclaircit (`amount > 0`) ou assombrit (`amount < 0`) une couleur. */
  function shadeHex(hex, amount) {
    var ex = need('shadeHex');
    var input = pushText(hex);
    try {
      return twoPassText(function (out, cap, len) {
        return ex.pz_shade_hex(input.block.ptr, input.length, amount, out, cap, len);
      }, 'pz_shade_hex');
    } finally {
      free(input.block);
    }
  }

  /** Couleur majoritaire d'un échantillon (première rencontrée en cas d'égalité). */
  function modalHex(hexes) {
    var ex = need('modalHex');
    var input = pushText((hexes || []).join('\n'));
    try {
      return twoPassText(function (out, cap, len) {
        return ex.pz_modal_hex(input.block.ptr, input.length, out, cap, len);
      }, 'pz_modal_hex');
    } finally {
      free(input.block);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Modèle
  // ───────────────────────────────────────────────────────────────────────────

  /** Indices de page 0-based d'une saisie `1-4, 7, 10-12`. */
  function parsePageRange(text, maxPage) {
    var ex = need('parsePageRange');
    var input = pushText(text);
    try {
      return twoPass(function (out, cap, len) {
        return ex.pz_parse_page_range(input.block.ptr, input.length, maxPage | 0, out, cap, len);
      }, Uint32Array, 4, 'pz_parse_page_range');
    } finally {
      free(input.block);
    }
  }

  /** Identifiant de session (`doc:nom-en-minuscules`). */
  function sessionId(name) {
    var ex = need('sessionId');
    var input = pushText(name);
    try {
      return twoPassText(function (out, cap, len) {
        return ex.pz_session_id(input.block.ptr, input.length, out, cap, len);
      }, 'pz_session_id');
    } finally {
      free(input.block);
    }
  }

  /**
   * Empreinte d'un objet graphique, pour supprimer les doublons.
   *
   * @param {Object} o `{stroked, filled, color, lineWidth, minX, minY, width, height, subpaths, firstLength}`
   */
  function graphicSignature(o) {
    var ex = need('graphicSignature');
    var options = o || {};
    var input = pushText(options.color || '');
    try {
      return twoPassText(function (out, cap, len) {
        return ex.pz_graphic_signature(
          options.stroked ? 1 : 0,
          options.filled ? 1 : 0,
          input.block.ptr,
          input.length,
          options.lineWidth || 0,
          options.minX || 0,
          options.minY || 0,
          options.width || 0,
          options.height || 0,
          options.subpaths || 0,
          options.firstLength || 0,
          out,
          cap,
          len
        );
      }, 'pz_graphic_signature');
    } finally {
      free(input.block);
    }
  }

  /** Rang dans la pile du calque d'édition. */
  function zIndex(kind, extracted) {
    var ex = need('zIndex');
    var input = pushText(kind);
    try {
      var rc = ex.pz_z_index(input.block.ptr, input.length, extracted ? 1 : 0);
      if (rc < 0) lever(rc, 'pz_z_index');
      return rc;
    } finally {
      free(input.block);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Surface publique
  // ───────────────────────────────────────────────────────────────────────────

  global.PdfyzCore = {
    VERSION: VERSION,
    ERR: ERR,
    CoreError: CoreError,
    get backend() {
      return backend;
    },
    get ready() {
      return module_ !== null;
    },
    load: load,
    version: version,
    signatureOrder: signatureOrder,
    sequentialOrder: sequentialOrder,
    imposedSides: imposedSides,
    nupSlots: nupSlots,
    cropMarks: cropMarks,
    autoSheet: autoSheet,
    resolveOrientation: resolveOrientation,
    pathBounds: pathBounds,
    subpathsBounds: subpathsBounds,
    pathData: pathData,
    fitCentered: fitCentered,
    hexToRgb: hexToRgb,
    cmykToHex: cmykToHex,
    shadeHex: shadeHex,
    modalHex: modalHex,
    parsePageRange: parsePageRange,
    sessionId: sessionId,
    graphicSignature: graphicSignature,
    zIndex: zIndex
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
