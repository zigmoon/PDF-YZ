// Valide le module WebAssembly du noyau Rust — et le compare à l'implémentation
// JavaScript de référence.
//
// Trois choses sont vérifiées, dans cet ordre :
//
//   1. le module se charge avec `WebAssembly.instantiate(bytes, {})` : AUCUN
//      import, donc pas de WASI ni de fonction hôte ;
//   2. ses exports attendus sont là, et `pz_version` correspond à la colle ;
//   3. **parité** : pour chaque fonction, le résultat du noyau Rust est identique
//      à celui de l'implémentation JavaScript, sur une matrice de cas. C'est le
//      point le plus important : les deux implémentations coexistent (repli
//      annoncé dans l'application), et deux implémentations qui divergent en
//      silence valent moins que zéro.
//
// Usage : node scripts/validate-wasm.mjs [chemin-du-wasm]
// Retour : 0 si tout passe, 1 sinon.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const wasmPath = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist', 'pdfyz_core.wasm');

const ERR = { NULL: -1000001, TOO_SMALL: -1000002, BAD_INPUT: -1000003 };
const VERSION = '0.1.0';

let failures = 0;
let checks = 0;

function ok(label) {
  checks++;
  void label;
}

function fail(label, detail) {
  failures++;
  console.error(`  ✗ ${label}\n    ${detail}`);
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return ok(label);
  return fail(label, `attendu ${e}\n    obtenu  ${a}`);
}

function close(label, actual, expected, tolerance = 1e-9) {
  if (Math.abs(actual - expected) <= tolerance) return ok(label);
  return fail(label, `attendu ${expected}, obtenu ${actual}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Implémentations JavaScript de référence
//
//  Elles sont volontairement recopiées ici, et non importées de l'application :
//  ce fichier doit pouvoir tourner seul, sans navigateur ni build. Si quelqu'un
//  modifie la règle d'un côté, la parité casse et le dit.
// ─────────────────────────────────────────────────────────────────────────────

const jsPad4 = (n) => Math.ceil(Math.max(1, n) / 4) * 4;

function jsSignatureOrder(n) {
  const adjusted = jsPad4(n);
  const sheets = adjusted / 4;
  const order = [];
  let front = 1;
  let back = adjusted;
  for (let s = 0; s < sheets; s++) {
    order.push(back, front); back--; front++;
    order.push(front, back); front++; back--;
  }
  return order;
}

function jsSequentialOrder(n) {
  const adjusted = jsPad4(n);
  return Array.from({ length: adjusted }, (_, i) => i + 1);
}

function jsImposedSides(n, binding) {
  const flat = binding === 'perfect' ? jsSequentialOrder(n) : jsSignatureOrder(n);
  const sides = [];
  for (let i = 0; i < flat.length; i += 2) {
    sides.push({ left: flat[i], right: flat[i + 1], sheet: Math.floor(i / 4) + 1, front: i % 4 < 2 });
  }
  return sides;
}

function jsNupSlots(cols, rows, slotW, slotH, gutter, marginL, marginB, order) {
  const positions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push({
        x: marginL + c * (slotW + gutter),
        y: marginB + (rows - 1 - r) * (slotH + gutter),
        col: c,
        row: r,
      });
    }
  }
  if (order === 'rtl-ttb') positions.sort((a, b) => a.row - b.row || b.col - a.col);
  else if (order === 'ltr-btt') positions.sort((a, b) => b.row - a.row || a.col - b.col);
  else if (order === 'ttb-ltr') positions.sort((a, b) => a.col - b.col || a.row - b.row);
  return positions.map((p) => ({ x: p.x, y: p.y }));
}

function jsCropMarks(x, y, w, h, markLen, offset) {
  const ml = markLen > 0 ? markLen : 12;
  const off = offset > 0 ? offset : 4;
  const lines = [
    [x - off, y + h, x - off - ml, y + h],
    [x, y + h + off, x, y + h + off + ml],
    [x + w + off, y + h, x + w + off + ml, y + h],
    [x + w, y + h + off, x + w, y + h + off + ml],
    [x - off, y, x - off - ml, y],
    [x, y - off, x, y - off - ml],
    [x + w + off, y, x + w + off + ml, y],
    [x + w, y - off, x + w, y - off - ml],
  ];
  return lines.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
}

function jsAutoSheet(pageW, pageH, booklet) {
  return booklet ? { width: pageW * 2, height: pageH } : { width: pageW, height: pageH };
}

function jsResolveOrientation(width, height, orientation, cols, rows) {
  let w = width;
  let h = height;
  if (orientation === 'landscape') {
    if (w < h) [w, h] = [h, w];
  } else if (orientation === 'portrait') {
    if (w > h) [w, h] = [h, w];
  } else if (cols > rows && w < h) {
    [w, h] = [h, w];
  }
  return { width: w, height: h };
}

function jsParsePageRange(str, maxPage) {
  const pages = new Set();
  String(str).split(',').forEach((raw) => {
    const part = raw.trim();
    const span = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (span) {
      const a = Math.max(1, parseInt(span[1], 10));
      const b = Math.min(maxPage, parseInt(span[2], 10));
      for (let i = a; i <= b; i++) pages.add(i - 1);
      return;
    }
    if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= maxPage) pages.add(p - 1);
    }
  });
  return [...pages].sort((a, b) => a - b);
}

function jsBounds(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let seen = false;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]; const y = points[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen = true;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return seen ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

function jsPathData(points, lens, ox, oy) {
  const parts = [];
  let cursor = 0;
  for (const n of lens) {
    const slice = points.slice(cursor * 2, (cursor + n) * 2);
    cursor += n;
    if (n < 2) continue;
    const piece = [];
    for (let i = 0; i < n; i++) {
      const x = slice[i * 2] - ox;
      const y = slice[i * 2 + 1] - oy;
      piece.push(`${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    parts.push(piece.join(' '));
  }
  return parts.join(' ');
}

function jsToHex(values) {
  const channels = values.slice(0, 3).map((value) => {
    const numeric = Number(value) || 0;
    return Math.max(0, Math.min(255, Math.round(numeric <= 1 ? numeric * 255 : numeric)));
  });
  return '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function jsCmykHex(values) {
  const [c, m, y, k] = values.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
  return jsToHex([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
}

function jsShadeHex(hex, amount) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const t = amount < 0 ? v * (1 + amount) : v + (255 - v) * amount;
    return Math.max(0, Math.min(255, Math.round(t)));
  });
  return '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function jsHexToRgb(hex) {
  const text = String(hex).trim().replace(/^#/, '');
  const digit = (c) => (/[0-9a-f]/i.test(c) ? parseInt(c, 16) : null);
  if (text.length === 3) {
    const [r, g, b] = [...text].map((c) => digit(c) * 17);
    return Number.isNaN(r) ? null : { r, g, b };
  }
  if (text.length === 6) {
    const r = digit(text[0]) * 16 + digit(text[1]);
    const g = digit(text[2]) * 16 + digit(text[3]);
    const b = digit(text[4]) * 16 + digit(text[5]);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

function jsModalHex(list) {
  const counts = new Map();
  for (const hex of list) {
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  if (!counts.size) return '';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function jsSessionId(name) {
  return 'doc:' + String(name || 'document.pdf').trim().toLowerCase();
}

function jsGraphicSignature(o) {
  const r = (v) => {
    const rounded = Math.round(v);
    return Object.is(rounded, -0) ? '0' : String(rounded);
  };
  return [
    `${o.stroked ? 's' : ''}${o.filled ? 'f' : ''}`,
    o.color,
    r(o.lineWidth * 10),
    r(o.minX),
    r(o.minY),
    r(o.width),
    r(o.height),
    o.subpaths,
    o.firstLength,
  ].join('|');
}

function jsZIndex(kind, extracted) {
  if (kind === 'pdf-graphic') return 1;
  if (kind === 'pdf-image') return 2;
  if (kind === 'note') return 6;
  if (kind === 'text') return extracted ? 3 : 5;
  return 4;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Chargement du module
// ─────────────────────────────────────────────────────────────────────────────

console.log(`-- validation de ${wasmPath}`);

const bytes = await readFile(wasmPath).catch(() => null);
if (!bytes) {
  console.error(`  ✗ module introuvable : ${wasmPath} (lance scripts/build-wasm.ps1)`);
  process.exit(1);
}

const compiled = await WebAssembly.compile(bytes);
const importCount = WebAssembly.Module.imports(compiled).length;
if (importCount !== 0) {
  fail('module sans import', `${importCount} import(s) déclaré(s) : le module doit être autonome`);
} else {
  ok('module sans import');
}

const instance = await WebAssembly.instantiate(compiled, {});
const wasm = instance.exports;

const expectedExports = [
  'memory', 'pz_alloc', 'pz_free', 'pz_version',
  'pz_signature_order', 'pz_sequential_order', 'pz_imposed_sides',
  'pz_nup_slots', 'pz_crop_marks', 'pz_auto_sheet', 'pz_resolve_orientation',
  'pz_path_bounds', 'pz_subpaths_bounds', 'pz_path_data', 'pz_fit_centered',
  'pz_hex_to_rgb', 'pz_cmyk_to_hex', 'pz_shade_hex', 'pz_modal_hex',
  'pz_parse_page_range', 'pz_session_id', 'pz_graphic_signature', 'pz_z_index',
];
const missing = expectedExports.filter((name) => !(name in wasm));
if (missing.length) fail('exports attendus', `manquants : ${missing.join(', ')}`);
else ok('exports attendus');

// ─────────────────────────────────────────────────────────────────────────────
//  Protocole en deux passes, côté test
// ─────────────────────────────────────────────────────────────────────────────

/** Mémoire allouée pour un appel : libérée systématiquement. */
function withBlocks(sizes, body) {
  const blocks = sizes.map((size) => {
    const ptr = wasm.pz_alloc(Math.max(1, size));
    if (!ptr) throw new Error('allocation impossible');
    return { ptr, size: Math.max(1, size) };
  });
  try {
    return body(blocks);
  } finally {
    blocks.forEach((b) => wasm.pz_free(b.ptr, b.size));
  }
}

/** Vue neuve, jamais réutilisée au-delà de l'appel (règle de la mémoire détachée). */
function u32(ptr, count) { return new Uint32Array(wasm.memory.buffer, ptr, count); }
function f64(ptr, count) { return new Float64Array(wasm.memory.buffer, ptr, count); }
function u8(ptr, count) { return new Uint8Array(wasm.memory.buffer, ptr, count); }

function textBytes(text) {
  return new TextEncoder().encode(String(text));
}

/** Deux passes pour une sortie de nombres. */
function twoPassNumbers(invoke, Ctor) {
  return withBlocks([4], ([lenBlock]) => {
    let rc = invoke(0, 0, lenBlock.ptr);
    const needed = u32(lenBlock.ptr, 1)[0];
    if (rc === 0) return [];
    if (rc !== ERR.TOO_SMALL) throw new Error(`code inattendu ${rc}`);
    return withBlocks([needed * Ctor.BYTES_PER_ELEMENT], ([out]) => {
      rc = invoke(out.ptr, needed, lenBlock.ptr);
      if (rc < 0) throw new Error(`code inattendu ${rc}`);
      const count = u32(lenBlock.ptr, 1)[0];
      return Array.from(new Ctor(wasm.memory.buffer, out.ptr, count));
    });
  });
}

/** Deux passes pour une sortie texte. */
function twoPassText(invoke) {
  return withBlocks([4], ([lenBlock]) => {
    let rc = invoke(0, 0, lenBlock.ptr);
    const needed = u32(lenBlock.ptr, 1)[0];
    if (rc === 0) return '';
    if (rc !== ERR.TOO_SMALL) throw new Error(`code inattendu ${rc}`);
    return withBlocks([needed], ([out]) => {
      rc = invoke(out.ptr, needed, lenBlock.ptr);
      if (rc < 0) throw new Error(`code inattendu ${rc}`);
      const count = u32(lenBlock.ptr, 1)[0];
      return new TextDecoder().decode(u8(out.ptr, count));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Version
// ─────────────────────────────────────────────────────────────────────────────

const version = twoPassText((out, cap, len) => wasm.pz_version(out, cap, len));
eq('pz_version', version, VERSION);

// ─────────────────────────────────────────────────────────────────────────────
//  Imposition : parité
// ─────────────────────────────────────────────────────────────────────────────

for (let n = 0; n <= 40; n++) {
  const got = twoPassNumbers((out, cap, len) => wasm.pz_signature_order(n, out, cap, len), Uint32Array);
  const want = jsSignatureOrder(n);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`signature_order(${n})`, `attendu [${want.join(',')}], obtenu [${got.join(',')}]`);
  } else ok('signature_order');
}

for (const n of [0, 1, 4, 5, 8, 12, 20, 36]) {
  const got = twoPassNumbers((out, cap, len) => wasm.pz_sequential_order(n, out, cap, len), Uint32Array);
  eq(`sequential_order(${n})`, got, jsSequentialOrder(n));
}

for (const binding of ['saddle', 'perfect']) {
  const code = binding === 'perfect' ? 1 : 0;
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 20, 32]) {
    const flat = twoPassNumbers(
      (out, cap, len) => wasm.pz_imposed_sides(n, code, out, cap, len),
      Uint32Array,
    );
    const got = [];
    for (let i = 0; i + 3 < flat.length; i += 4) {
      got.push({ left: flat[i], right: flat[i + 1], sheet: flat[i + 2], front: flat[i + 3] === 1 });
    }
    eq(`imposed_sides(${n}, ${binding})`, got, jsImposedSides(n, binding));
  }
}

for (const order of ['ltr-ttb', 'rtl-ttb', 'ltr-btt', 'ttb-ltr']) {
  const code = { 'ltr-ttb': 0, 'rtl-ttb': 1, 'ltr-btt': 2, 'ttb-ltr': 3 }[order];
  for (const [cols, rows] of [[2, 2], [4, 2], [4, 4], [5, 4], [8, 8], [1, 3]]) {
    for (const gutter of [0, 9.5]) {
      const flat = twoPassNumbers(
        (out, cap, len) => wasm.pz_nup_slots(
          cols, rows, 123.4, 98.7, gutter, 12.5, 7.25, code, out, cap, len,
        ),
        Float64Array,
      );
      const got = [];
      for (let i = 0; i + 1 < flat.length; i += 2) got.push({ x: flat[i], y: flat[i + 1] });
      eq(`nup_slots(${cols}x${rows}, ${order}, gutter ${gutter})`, got,
        jsNupSlots(cols, rows, 123.4, 98.7, gutter, 12.5, 7.25, order));
    }
  }
}

for (const [x, y, w, h, ml, off] of [
  [0, 0, 100, 100, 12, 4],
  [100, 200, 300, 400, 12, 4],
  [-50, -20, 10, 10, 6, 2],
  [10, 10, 200, 50, 0, 0],
]) {
  const flat = twoPassNumbers(
    (out, cap, len) => wasm.pz_crop_marks(x, y, w, h, ml, off, out, cap, len),
    Float64Array,
  );
  const got = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    got.push({ x1: flat[i], y1: flat[i + 1], x2: flat[i + 2], y2: flat[i + 3] });
  }
  eq(`crop_marks(${x},${y},${w}x${h})`, got, jsCropMarks(x, y, w, h, ml, off));
}

for (const [pw, ph, booklet] of [[595.28, 841.89, 1], [595.28, 841.89, 0], [842, 595, 1]]) {
  const flat = twoPassNumbers(
    (out, cap, len) => wasm.pz_auto_sheet(pw, ph, booklet, out, cap, len),
    Float64Array,
  );
  const want = jsAutoSheet(pw, ph, !!booklet);
  eq(`auto_sheet(${pw}x${ph}, booklet=${booklet})`, { width: flat[0], height: flat[1] }, want);
}

for (const [w, h, orientation, cols, rows] of [
  [595, 842, 'auto', 2, 1],
  [595, 842, 'auto', 4, 2],
  [842, 595, 'auto', 2, 4],
  [595, 842, 'landscape', 2, 2],
  [842, 595, 'portrait', 2, 2],
]) {
  const code = { auto: 0, portrait: 1, landscape: 2 }[orientation];
  const flat = twoPassNumbers(
    (out, cap, len) => wasm.pz_resolve_orientation(w, h, code, cols, rows, out, cap, len),
    Float64Array,
  );
  eq(`resolve_orientation(${w}x${h}, ${orientation}, ${cols}x${rows})`,
    { width: flat[0], height: flat[1] }, jsResolveOrientation(w, h, orientation, cols, rows));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Trace vectoriel : parité
// ─────────────────────────────────────────────────────────────────────────────

const cases = [
  { points: [10, 20, 40, 20, 40, 50, 10, 50, 10, 20], lens: [5] },
  { points: [0, 0, 100, 0], lens: [2] },
  { points: [-0.001, 0.004, 12.3456, -7.891], lens: [2] },
  { points: [0, 0, 1, 1, 5, 5], lens: [2, 1] },
  { points: [], lens: [] },
];

for (const [index, c] of cases.entries()) {
  withBlocks([Math.max(8, c.points.length * 8), Math.max(4, c.lens.length * 4)], ([pts, lens]) => {
    if (c.points.length) f64(pts.ptr, c.points.length).set(c.points);
    if (c.lens.length) u32(lens.ptr, c.lens.length).set(c.lens);

    const gotBounds = (() => {
      const flat = twoPassNumbers(
        (out, cap, len) => wasm.pz_subpaths_bounds(
          pts.ptr, c.points.length, lens.ptr, c.lens.length, out, cap, len,
        ),
        Float64Array,
      );
      if (flat.length < 4) return null;
      return { x: flat[0], y: flat[1], w: flat[2], h: flat[3] };
    })();
    // Référence : bornes de tous les points, sous-chemins ou pas.
    eq(`subpaths_bounds(cas ${index})`, gotBounds, jsBounds(c.points));

    const gotPath = twoPassText((out, cap, len) => wasm.pz_path_data(
      pts.ptr, c.points.length, lens.ptr, c.lens.length, 0, 0, out, cap, len,
    ));
    eq(`path_data(cas ${index})`, gotPath, jsPathData(c.points, c.lens, 0, 0));
  });
}

// Décalage d'origine (le chemin est relatif à la boîte de l'objet).
withBlocks([32, 4], ([pts, lens]) => {
  const flat = [100, 200, 150, 250];
  f64(pts.ptr, flat.length).set(flat);
  u32(lens.ptr, 1).set([2]);
  const got = twoPassText((out, cap, len) => wasm.pz_path_data(
    pts.ptr, flat.length, lens.ptr, 1, 100, 200, out, cap, len,
  ));
  eq('path_data avec origine', got, jsPathData(flat, [2], 100, 200));
  eq('path_data avec origine (valeur)', got, 'M0.00 0.00 L50.00 50.00');
});

// ─────────────────────────────────────────────────────────────────────────────
//  Couleurs : parité
// ─────────────────────────────────────────────────────────────────────────────

for (const [c, m, y, k] of [
  [0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0],
  [0, 0, 0, 1], [0, 0, 0, 0.5], [0.2, 0.4, 0.6, 0.1], [2, -1, 0.3, 0.7],
]) {
  const got = twoPassText((out, cap, len) => wasm.pz_cmyk_to_hex(c, m, y, k, out, cap, len));
  eq(`cmyk_to_hex(${c},${m},${y},${k})`, got, jsCmykHex([c, m, y, k]));
}

for (const [hex, amount] of [
  ['#fff9c4', -0.14], ['#808080', 0], ['#808080', 1], ['#808080', -1],
  ['#1f4f78', 0.25], ['pas-une-couleur', -0.2],
]) {
  const bytesIn = textBytes(hex);
  withBlocks([Math.max(1, bytesIn.length)], ([input]) => {
    u8(input.ptr, bytesIn.length).set(bytesIn);
    const got = twoPassText((out, cap, len) => wasm.pz_shade_hex(
      input.ptr, bytesIn.length, amount, out, cap, len,
    ));
    eq(`shade_hex(${hex}, ${amount})`, got, jsShadeHex(hex, amount));
  });
}

for (const hex of ['#fff', '#1f4f78', '1F4F78', '#12345', 'zz', '']) {
  const bytesIn = textBytes(hex);
  withBlocks([Math.max(1, bytesIn.length), 4, 4], ([input, out, len]) => {
    if (bytesIn.length) u8(input.ptr, bytesIn.length).set(bytesIn);
    const rc = wasm.pz_hex_to_rgb(input.ptr, bytesIn.length, out.ptr, 3, len.ptr);
    const want = jsHexToRgb(hex);
    if (want === null) {
      eq(`hex_to_rgb(${hex}) refuse`, rc, ERR.BAD_INPUT);
    } else {
      const got = { r: u8(out.ptr, 3)[0], g: u8(out.ptr, 3)[1], b: u8(out.ptr, 3)[2] };
      eq(`hex_to_rgb(${hex})`, got, want);
    }
  });
}

for (const sample of [['#ffffff', '#1f4f78', '#1f4f78'], ['#a', '#b', '#a'], []]) {
  const payload = textBytes(sample.join('\n'));
  withBlocks([Math.max(1, payload.length)], ([input]) => {
    if (payload.length) u8(input.ptr, payload.length).set(payload);
    const got = twoPassText((out, cap, len) => wasm.pz_modal_hex(
      input.ptr, payload.length, out, cap, len,
    ));
    eq(`modal_hex(${JSON.stringify(sample)})`, got, jsModalHex(sample));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Modèle : parité
// ─────────────────────────────────────────────────────────────────────────────

for (const [input, max] of [
  ['1-4', 10], ['1-4, 7, 10-12', 12], [' 9 , 2 - 4 ', 10], ['0-2', 3],
  ['2-99', 3], ['5-2', 10], ['abc, 3, x-y', 10], ['', 10], ['1.5', 10], ['1-4', 0],
]) {
  const payload = textBytes(input);
  withBlocks([Math.max(1, payload.length)], ([inputBlock]) => {
    if (payload.length) u8(inputBlock.ptr, payload.length).set(payload);
    const got = twoPassNumbers((out, cap, len) => wasm.pz_parse_page_range(
      inputBlock.ptr, payload.length, max, out, cap, len,
    ), Uint32Array);
    eq(`parse_page_range(${JSON.stringify(input)}, ${max})`, got, jsParsePageRange(input, max));
  });
}

for (const name of ['Rapport.PDF', '  affiche-A3.pdf ', '', 'A']) {
  const payload = textBytes(name);
  withBlocks([Math.max(1, payload.length)], ([inputBlock]) => {
    if (payload.length) u8(inputBlock.ptr, payload.length).set(payload);
    const got = twoPassText((out, cap, len) => wasm.pz_session_id(
      inputBlock.ptr, payload.length, out, cap, len,
    ));
    eq(`session_id(${JSON.stringify(name)})`, got, jsSessionId(name));
  });
}

for (const o of [
  { stroked: true, filled: false, color: '#1f4f78', lineWidth: 0.8, minX: 60, minY: 582, width: 300, height: 180, subpaths: 1, firstLength: 5 },
  { stroked: false, filled: true, color: '#f2a61a', lineWidth: 1, minX: 80.4, minY: 605.5, width: 34, height: 34, subpaths: 1, firstLength: 5 },
  { stroked: true, filled: true, color: '#000000', lineWidth: 0, minX: -0.4, minY: 0, width: 10, height: 10, subpaths: 2, firstLength: 3 },
]) {
  const payload = textBytes(o.color);
  withBlocks([Math.max(1, payload.length)], ([colorBlock]) => {
    u8(colorBlock.ptr, payload.length).set(payload);
    const got = twoPassText((out, cap, len) => wasm.pz_graphic_signature(
      o.stroked ? 1 : 0, o.filled ? 1 : 0, colorBlock.ptr, payload.length,
      o.lineWidth, o.minX, o.minY, o.width, o.height, o.subpaths, o.firstLength,
      out, cap, len,
    ));
    eq(`graphic_signature(${o.color})`, got, jsGraphicSignature(o));
  });
}

for (const [kind, extracted] of [
  ['pdf-graphic', true], ['pdf-image', true], ['text', true], ['text', false],
  ['image', false], ['signature', false], ['stroke', false], ['note', false],
  ['inconnu', false],
]) {
  const payload = textBytes(kind);
  withBlocks([Math.max(1, payload.length)], ([inputBlock]) => {
    u8(inputBlock.ptr, payload.length).set(payload);
    const rc = wasm.pz_z_index(inputBlock.ptr, payload.length, extracted ? 1 : 0);
    eq(`z_index(${kind}, extracted=${extracted})`, rc, jsZIndex(kind, extracted));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Robustesse : entrées refusées, tampon trop petit, mémoire détachée
// ─────────────────────────────────────────────────────────────────────────────

withBlocks([4], ([len]) => {
  eq('hex_to_rgb pointeur nul',
    wasm.pz_hex_to_rgb(0, 4, 0, 0, len.ptr), ERR.NULL);
  eq('version sans out_len',
    wasm.pz_version(0, 0, 0), ERR.NULL);
});

withBlocks([4], ([len]) => {
  const rc = wasm.pz_signature_order(8, 0, 0, len.ptr);
  eq('tampon trop petit annoncé', rc, ERR.TOO_SMALL);
  eq('taille nécessaire annoncée', u32(len.ptr, 1)[0], 8);
});

// La mémoire peut être détachée par une allocation : on vérifie qu'une vue
// reconstruite après chaque appel rend toujours le bon résultat (c'est la règle
// que suit la colle).
{
  let previous = null;
  for (let i = 0; i < 5; i++) {
    const order = twoPassNumbers((out, cap, len) => wasm.pz_signature_order(8, out, cap, len), Uint32Array);
    if (previous && JSON.stringify(order) !== JSON.stringify(previous)) {
      fail('stabilité après allocations', `appel ${i} différent`);
    }
    previous = order;
  }
  ok('stabilité après allocations');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Résultat
// ─────────────────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n✗ ${failures} échec(s) sur ${checks + failures} vérifications`);
  process.exit(1);
}
console.log(`\n✓ ${checks} vérifications, 0 échec — noyau Rust et JavaScript d'accord`);
