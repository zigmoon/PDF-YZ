//! # pdfyz-wasm — la surface C du noyau Rust, pour le navigateur
//!
//! C'est le **seul** crate du workspace compile en `cdylib`, donc le seul qui
//! produise un `.wasm` qu'un navigateur peut charger. Les trois autres restent des
//! bibliotheques Rust pures, marquees `#![forbid(unsafe_code)]` : tout l'`unsafe`
//! de la frontiere est ici, et nulle part ailleurs.
//!
//! ## Pourquoi pas `wasm-bindgen`
//!
//! Le workspace s'est fixe la regle **zero dependance externe**. `wasm-bindgen`
//! imposerait, en plus de lui-meme, une chaine d'outils JavaScript a installer et a
//! versionner. Le noyau n'echange que des **nombres et des tampons** : une frontiere
//! C classique suffit, et elle se teste sans outil intermediaire. Le prix est
//! l'ecriture a la main de la gestion memoire ([`pz_alloc`] / [`pz_free`]).
//!
//! ## Contrat de la frontiere
//!
//! Toutes les fonctions rendent un `i32` :
//!
//! * `>= 0` : succes, c'est le **nombre d'elements** (ou d'octets) ecrits ;
//! * `< -1_000_000` : une erreur, une des constantes `PZ_ERR_*`.
//!
//! Les codes d'erreur sont volontairement tres negatifs : un compte d'elements ne
//! peut donc jamais etre confondu avec une erreur.
//!
//! Les fonctions d'ecriture suivent un protocole en **deux passes** : on appelle une
//! premiere fois avec `cap = 0`, la fonction ecrit la taille necessaire dans
//! `out_len` et rend [`PZ_ERR_TOO_SMALL`] ; on alloue, puis on rappelle. C'est ce que
//! fait `web/pdfyz-core.js`, qui masque entierement ce protocole a l'application.
//!
//! ## Repere d'appel (JavaScript)
//!
//! ```js
//! const { instance } = await WebAssembly.instantiate(bytes, {});
//! const { memory, pz_alloc, pz_free, pz_signature_order } = instance.exports;
//! const out = pz_alloc(16 * 4);          // 16 pages maximum, 4 octets par u32
//! const len = pz_alloc(4);
//! const rc = pz_signature_order(8, out, 16, len);
//! const n = new Uint32Array(memory.buffer, len, 1)[0];
//! const order = new Uint32Array(memory.buffer, out, n);
//! ```
//!
//! ⚠️ `memory.buffer` est **detache** des qu'une fonction Rust agrandit la memoire :
//! toute vue `TypedArray` construite avant l'appel devient inutilisable. La colle
//! reconstruit donc **systematiquement** une vue neuve, et `scripts/validate-wasm.mjs`
//! verifie cette regle sur chaque fonction.
//!
//! Feuille de route : `pdfyz_rust/docs/PLAN.md`.

#![deny(unsafe_op_in_unsafe_fn)]
// Ces fonctions SONT la frontiere C : elles recoivent des pointeurs bruts et les
// valident a l'execution (nul, capacite, UTF-8, coherence des longueurs). Les
// marquer `unsafe fn` ne deplacerait le contrat que vers l'appelant JavaScript,
// ou aucun mot-cle ne peut l'exprimer — cela n'acheterait aucune securite, et
// rendrait les tests Rust nettement plus bruyants. Le contrat est documente
// fonction par fonction.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use core::{ptr, slice};
use std::alloc::{alloc, dealloc, Layout};

use pdfyz_core::{color, geometry, path, Point, Rect, Subpath};
use pdfyz_impose::{
    crop_marks, nup_slots, sheet, signature, Binding, Orientation, SheetSize, SlotOrder,
};
use pdfyz_model::{graphic_signature, parse_page_range, session_id, z_index};

// ─────────────────────────── codes d'erreur ───────────────────────────

/// Pointeur nul la ou un tampon etait requis (ou `out_len` absent).
pub const PZ_ERR_NULL: i32 = -1_000_001;
/// Tampon de sortie trop petit : `out_len` porte alors la taille necessaire.
pub const PZ_ERR_TOO_SMALL: i32 = -1_000_002;
/// Entree illisible (texte non UTF-8, dimensions nulles, code inconnu…).
pub const PZ_ERR_BAD_INPUT: i32 = -1_000_003;

/// Version du noyau, rendue par [`pz_version`]. Doit rester alignee sur
/// `Cargo.toml` et sur `web/pdfyz-core.js` : c'est ce que verifie
/// `scripts/validate-wasm.mjs`.
pub const PZ_VERSION: &str = "0.1.0";

// ─────────────────────────── memoire ───────────────────────────

/// Alignement de toute allocation rendue par [`pz_alloc`].
///
/// Huit octets, comme l'ABI C : c'est ce qui permet aux sorties d'etre des `u32`
/// ou des `f64` sans ecriture sur un pointeur mal aligne — comportement indefini en
/// Rust, et piege classique des frontieres WebAssembly.
const PZ_ALIGN: usize = 8;

/// Alloue `len` octets (alignes sur [`PZ_ALIGN`]) et rend leur adresse.
///
/// Rend `0` si `len` est nul ou si l'allocation echoue. L'appelant rend le bloc avec
/// [`pz_free`], **avec la meme longueur**.
#[no_mangle]
pub extern "C" fn pz_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return ptr::null_mut();
    }
    match Layout::from_size_align(len, PZ_ALIGN) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => ptr::null_mut(),
    }
}

/// Libere un bloc rendu par [`pz_alloc`].
///
/// Un pointeur nul est ignore : la colle n'a pas a tester avant d'appeler.
#[no_mangle]
pub extern "C" fn pz_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len, PZ_ALIGN) {
        unsafe { dealloc(ptr, layout) };
    }
}

// ─────────────────────────── plomberie interne ───────────────────────────

/// Copie des `u32` dans le tampon de l'appelant (protocole en deux passes).
///
/// Rend le nombre d'elements ecrits, ou [`PZ_ERR_TOO_SMALL`] apres avoir annonce la
/// taille necessaire dans `out_len`.
unsafe fn write_u32(values: &[u32], out: *mut u32, cap: usize, out_len: *mut usize) -> i32 {
    if out_len.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { *out_len = values.len() };
    if values.len() > cap {
        return PZ_ERR_TOO_SMALL;
    }
    if values.is_empty() {
        return 0;
    }
    if out.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { ptr::copy_nonoverlapping(values.as_ptr(), out, values.len()) };
    i32::try_from(values.len()).unwrap_or(i32::MAX)
}

/// Meme protocole, pour des `f64` (geometrie).
unsafe fn write_f64(values: &[f64], out: *mut f64, cap: usize, out_len: *mut usize) -> i32 {
    if out_len.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { *out_len = values.len() };
    if values.len() > cap {
        return PZ_ERR_TOO_SMALL;
    }
    if values.is_empty() {
        return 0;
    }
    if out.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { ptr::copy_nonoverlapping(values.as_ptr(), out, values.len()) };
    i32::try_from(values.len()).unwrap_or(i32::MAX)
}

/// Meme protocole, pour du texte UTF-8 (la taille portee est en **octets**).
unsafe fn write_text(text: &str, out: *mut u8, cap: usize, out_len: *mut usize) -> i32 {
    if out_len.is_null() {
        return PZ_ERR_NULL;
    }
    let bytes = text.as_bytes();
    unsafe { *out_len = bytes.len() };
    if bytes.len() > cap {
        return PZ_ERR_TOO_SMALL;
    }
    if bytes.is_empty() {
        return 0;
    }
    if out.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len()) };
    i32::try_from(bytes.len()).unwrap_or(i32::MAX)
}

/// Lit un tampon d'octets, verifie l'UTF-8 et rend la chaine.
///
/// Une entree vide est valide (elle rend une chaine vide) : c'est ce qui permet
/// d'appeler une fonction d'analyse avec un champ de saisie vide sans cas special.
///
/// La chaine est **copiee** (`String`) : un emprunt sur la memoire WebAssembly
/// devrait porter une duree de vie que le pointeur brut ne peut pas exprimer, et
/// l'emprunt ne servirait a rien — les entrees font quelques dizaines d'octets.
unsafe fn read_str(ptr_in: *const u8, len: usize) -> Result<String, i32> {
    if len == 0 {
        return Ok(String::new());
    }
    if ptr_in.is_null() {
        return Err(PZ_ERR_NULL);
    }
    let bytes = unsafe { slice::from_raw_parts(ptr_in, len) };
    core::str::from_utf8(bytes)
        .map(str::to_string)
        .map_err(|_| PZ_ERR_BAD_INPUT)
}

/// Lit une serie de points `[x0, y0, x1, y1, …]`.
///
/// Un nombre impair de valeurs est refuse : mieux vaut une erreur nommee qu'un
/// point invente a partir d'une coordonnee orpheline.
unsafe fn read_points(ptr_in: *const f64, count: usize) -> Result<Vec<Point>, i32> {
    if count == 0 {
        return Ok(Vec::new());
    }
    if ptr_in.is_null() {
        return Err(PZ_ERR_NULL);
    }
    if count % 2 != 0 {
        return Err(PZ_ERR_BAD_INPUT);
    }
    let flat = unsafe { slice::from_raw_parts(ptr_in, count) };
    Ok(flat
        .chunks_exact(2)
        .map(|pair| Point::new(pair[0], pair[1]))
        .collect())
}

/// Reconstruit les sous-chemins a partir des points a plat et de leurs tailles.
///
/// `lens` donne le nombre de points de chaque sous-chemin ; leur somme doit valoir
/// `points.len()`, sinon l'entree est incoherente et refusee.
unsafe fn read_subpaths(
    points: &[Point],
    lens: *const u32,
    subpaths: usize,
) -> Result<Vec<Subpath>, i32> {
    if subpaths == 0 {
        return Ok(Vec::new());
    }
    if lens.is_null() {
        return Err(PZ_ERR_NULL);
    }
    let sizes = unsafe { slice::from_raw_parts(lens, subpaths) };
    let total: usize = sizes.iter().map(|n| *n as usize).sum();
    if total != points.len() {
        return Err(PZ_ERR_BAD_INPUT);
    }
    let mut out = Vec::with_capacity(subpaths);
    let mut cursor = 0usize;
    for n in sizes {
        let n = *n as usize;
        out.push(Subpath::new(points[cursor..cursor + n].to_vec()));
        cursor += n;
    }
    Ok(out)
}

// ─────────────────────────── version ───────────────────────────

/// Version du noyau, pour que la colle JS puisse refuser un module perime.
#[no_mangle]
pub extern "C" fn pz_version(out: *mut u8, cap: usize, out_len: *mut usize) -> i32 {
    unsafe { write_text(PZ_VERSION, out, cap, out_len) }
}

// ─────────────────────────── imposition ───────────────────────────

/// Ordre de signature (livret), a plat : deux pages par face.
#[no_mangle]
pub extern "C" fn pz_signature_order(
    pages: u32,
    out: *mut u32,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let order = signature::signature_order(pages as usize);
    unsafe { write_u32(&order, out, cap, out_len) }
}

/// Ordre sequentiel complete au multiple de 4 (dos carre colle).
#[no_mangle]
pub extern "C" fn pz_sequential_order(
    pages: u32,
    out: *mut u32,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let order = signature::sequential_order(pages as usize);
    unsafe { write_u32(&order, out, cap, out_len) }
}

/// Faces imposees, quatre `u32` par face : `[gauche, droite, feuille, recto]`.
///
/// `binding` : `0` = dos agrafe, `1` = dos carre colle.
#[no_mangle]
pub extern "C" fn pz_imposed_sides(
    pages: u32,
    binding: u32,
    out: *mut u32,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let sides = signature::build_sides(pages as usize, Binding::from_code(binding));
    let mut flat = Vec::with_capacity(sides.len() * 4);
    for side in sides {
        flat.push(side.left);
        flat.push(side.right);
        flat.push(side.sheet);
        flat.push(u32::from(side.front));
    }
    unsafe { write_u32(&flat, out, cap, out_len) }
}

/// Emplacements d'une grille N-up, deux `f64` par emplacement : `[x, y]`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_nup_slots(
    cols: u32,
    rows: u32,
    slot_w: f64,
    slot_h: f64,
    gutter: f64,
    margin_l: f64,
    margin_b: f64,
    order: u32,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    if cols == 0 || rows == 0 {
        return PZ_ERR_BAD_INPUT;
    }
    if !(slot_w.is_finite() && slot_h.is_finite() && gutter.is_finite()) {
        return PZ_ERR_BAD_INPUT;
    }
    let slots = nup_slots(
        cols,
        rows,
        slot_w,
        slot_h,
        gutter,
        margin_l,
        margin_b,
        SlotOrder::from_code(order),
    );
    let mut flat = Vec::with_capacity(slots.len() * 2);
    for slot in slots {
        flat.push(slot.x);
        flat.push(slot.y);
    }
    unsafe { write_f64(&flat, out, cap, out_len) }
}

/// Traits de coupe, quatre `f64` par trait : `[x1, y1, x2, y2]`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_crop_marks(
    x: f64,
    y: f64,
    slot_w: f64,
    slot_h: f64,
    mark_len: f64,
    offset: f64,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    if !(x.is_finite() && y.is_finite() && slot_w.is_finite() && slot_h.is_finite()) {
        return PZ_ERR_BAD_INPUT;
    }
    let marks = crop_marks(x, y, slot_w, slot_h, mark_len, offset);
    let mut flat = Vec::with_capacity(marks.len() * 4);
    for mark in marks {
        flat.push(mark.x1);
        flat.push(mark.y1);
        flat.push(mark.x2);
        flat.push(mark.y2);
    }
    unsafe { write_f64(&flat, out, cap, out_len) }
}

/// Planche « auto » : quatre `f64` — `[largeur, hauteur, 0, 0]`.
///
/// Le remplissage a quatre valeurs garde un tampon de taille fixe, donc pas de
/// deuxieme passe pour une fonction qui n'en a pas besoin.
#[no_mangle]
pub extern "C" fn pz_auto_sheet(
    page_w: f64,
    page_h: f64,
    booklet: u32,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    if !(page_w.is_finite() && page_h.is_finite()) || page_w <= 0.0 || page_h <= 0.0 {
        return PZ_ERR_BAD_INPUT;
    }
    let size = sheet::auto_sheet(page_w, page_h, booklet != 0);
    unsafe { write_f64(&[size.width, size.height], out, cap, out_len) }
}

/// Applique l'orientation : deux `f64` — `[largeur, hauteur]`.
///
/// `orientation` : `0` = auto, `1` = portrait, `2` = paysage.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_resolve_orientation(
    width: f64,
    height: f64,
    orientation: u32,
    cols: u32,
    rows: u32,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    if !(width.is_finite() && height.is_finite()) || width <= 0.0 || height <= 0.0 {
        return PZ_ERR_BAD_INPUT;
    }
    let mode = match orientation {
        1 => Orientation::Portrait,
        2 => Orientation::Landscape,
        _ => Orientation::Auto,
    };
    let size: SheetSize =
        sheet::resolve_orientation(SheetSize::new(width, height), mode, cols, rows);
    unsafe { write_f64(&[size.width, size.height], out, cap, out_len) }
}

// ─────────────────────────── geometrie / trace ───────────────────────────

/// Boite englobante de points a plat, quatre `f64` : `[x, y, largeur, hauteur]`.
///
/// Rend `0` (aucun element) quand aucun point n'est fini : c'est le contrat de
/// `bounding box` du modele, qui distingue « vide » de « erreur ».
#[no_mangle]
pub extern "C" fn pz_path_bounds(
    points: *const f64,
    count: usize,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let pts = match unsafe { read_points(points, count) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    match Rect::from_points(&pts) {
        Some(r) => unsafe { write_f64(&[r.x, r.y, r.w, r.h], out, cap, out_len) },
        None => unsafe { write_f64(&[], out, cap, out_len) },
    }
}

/// Donnees de chemin SVG (`d`) pour des sous-chemins.
///
/// `points` est la suite a plat de tous les points, `lens` la taille de chaque
/// sous-chemin (en points), `subpaths` leur nombre.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_path_data(
    points: *const f64,
    count: usize,
    lens: *const u32,
    subpaths: usize,
    ox: f64,
    oy: f64,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let pts = match unsafe { read_points(points, count) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let subs = match unsafe { read_subpaths(&pts, lens, subpaths) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let d = path::path_data(&subs, ox, oy);
    unsafe { write_text(&d, out, cap, out_len) }
}

/// Boite englobante d'un ensemble de sous-chemins, quatre `f64`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_subpaths_bounds(
    points: *const f64,
    count: usize,
    lens: *const u32,
    subpaths: usize,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let pts = match unsafe { read_points(points, count) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let subs = match unsafe { read_subpaths(&pts, lens, subpaths) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    match path::bounds(&subs) {
        Some(r) => unsafe { write_f64(&[r.x, r.y, r.w, r.h], out, cap, out_len) },
        None => unsafe { write_f64(&[], out, cap, out_len) },
    }
}

/// Place un contenu dans un emplacement, centre : quatre `f64`
/// `[x, y, largeur, hauteur]`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_fit_centered(
    content_w: f64,
    content_h: f64,
    slot_x: f64,
    slot_y: f64,
    slot_w: f64,
    slot_h: f64,
    out: *mut f64,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let slot = Rect::new(slot_x, slot_y, slot_w, slot_h);
    let r = geometry::fit_centered(content_w, content_h, slot);
    unsafe { write_f64(&[r.x, r.y, r.w, r.h], out, cap, out_len) }
}

// ─────────────────────────── couleurs ───────────────────────────

/// Hexadecimal vers RVB : trois octets.
#[no_mangle]
pub extern "C" fn pz_hex_to_rgb(
    hex: *const u8,
    len: usize,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let text = match unsafe { read_str(hex, len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    match color::hex_to_rgb(&text) {
        Some(rgb) => unsafe { write_u8(&[rgb.r, rgb.g, rgb.b], out, cap, out_len) },
        None => PZ_ERR_BAD_INPUT,
    }
}

/// CMJN vers hexadecimal (conversion naive, sans profil ICC).
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_cmyk_to_hex(
    c: f64,
    m: f64,
    y: f64,
    k: f64,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let hex = color::cmyk_hex([c, m, y, k]);
    unsafe { write_text(&hex, out, cap, out_len) }
}

/// Eclaircit / assombrit une couleur hexadecimalе (voir [`color::shade_hex`]).
#[no_mangle]
pub extern "C" fn pz_shade_hex(
    hex: *const u8,
    len: usize,
    amount: f64,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let text = match unsafe { read_str(hex, len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let shaded = color::shade_hex(&text, amount);
    unsafe { write_text(&shaded, out, cap, out_len) }
}

/// Couleur modale d'un echantillon : les hexadecimaux sont separes par `\n`.
///
/// Un echantillon vide rend une chaine vide, pas une erreur : l'appelant retombe
/// alors sur le blanc, comme `sampleSurroundColor`.
#[no_mangle]
pub extern "C" fn pz_modal_hex(
    sample: *const u8,
    len: usize,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let text = match unsafe { read_str(sample, len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let values: Vec<String> = text
        .split('\n')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let hex = color::modal_hex(&values).unwrap_or_default();
    unsafe { write_text(&hex, out, cap, out_len) }
}

// ─────────────────────────── modele ───────────────────────────

/// Analyse d'une plage de pages : indices **0-based**, un `u32` chacun.
#[no_mangle]
pub extern "C" fn pz_parse_page_range(
    text: *const u8,
    len: usize,
    max_page: u32,
    out: *mut u32,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let input = match unsafe { read_str(text, len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let pages = parse_page_range(&input, max_page as usize);
    let flat: Vec<u32> = pages
        .into_iter()
        .filter_map(|p| u32::try_from(p).ok())
        .collect();
    unsafe { write_u32(&flat, out, cap, out_len) }
}

/// Identifiant de session (`doc:nom-en-minuscules`).
#[no_mangle]
pub extern "C" fn pz_session_id(
    text: *const u8,
    len: usize,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let input = match unsafe { read_str(text, len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let id = session_id(&input);
    unsafe { write_text(&id, out, cap, out_len) }
}

/// Empreinte d'un objet graphique (deduplication).
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn pz_graphic_signature(
    stroked: u32,
    filled: u32,
    color_hex: *const u8,
    color_len: usize,
    line_width: f64,
    min_x: f64,
    min_y: f64,
    width: f64,
    height: f64,
    subpaths: u32,
    first_len: u32,
    out: *mut u8,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    let hex = match unsafe { read_str(color_hex, color_len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    let sig = graphic_signature(
        stroked != 0,
        filled != 0,
        &hex,
        line_width,
        min_x,
        min_y,
        width,
        height,
        subpaths as usize,
        first_len as usize,
    );
    unsafe { write_text(&sig, out, cap, out_len) }
}

/// Rang dans la pile d'un element (`pdf-graphic`, `text`, `note`…).
#[no_mangle]
pub extern "C" fn pz_z_index(kind: *const u8, len: usize, extracted: u32) -> i32 {
    let name = match unsafe { read_str(kind, len) } {
        Ok(v) => v,
        Err(code) => return code,
    };
    i32::try_from(z_index(&name, extracted != 0)).unwrap_or(0)
}

// ─────────────────────────── octets ───────────────────────────

/// Meme protocole que [`write_u32`], pour trois octets de couleur.
unsafe fn write_u8(values: &[u8], out: *mut u8, cap: usize, out_len: *mut usize) -> i32 {
    if out_len.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { *out_len = values.len() };
    if values.len() > cap {
        return PZ_ERR_TOO_SMALL;
    }
    if values.is_empty() {
        return 0;
    }
    if out.is_null() {
        return PZ_ERR_NULL;
    }
    unsafe { ptr::copy_nonoverlapping(values.as_ptr(), out, values.len()) };
    i32::try_from(values.len()).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Petit utilitaire : appelle une fonction d'ecriture en deux passes, comme la
    /// colle JavaScript, et rend le tampon final.
    fn two_pass<F>(call: F) -> Vec<u8>
    where
        F: Fn(*mut u8, usize, *mut usize) -> i32,
    {
        let mut needed = 0usize;
        let rc = call(ptr::null_mut(), 0, &mut needed);
        assert_eq!(
            rc, PZ_ERR_TOO_SMALL,
            "premiere passe doit annoncer la taille"
        );
        let mut buf = vec![0u8; needed * 8 + 8];
        let mut written = 0usize;
        let rc = call(buf.as_mut_ptr(), buf.len(), &mut written);
        assert!(rc >= 0, "seconde passe doit reussir, code {rc}");
        assert_eq!(written, needed);
        buf.truncate(written);
        buf
    }

    #[test]
    fn version_et_memoire() {
        let v = two_pass(|out, cap, len| pz_version(out, cap, len));
        assert_eq!(core::str::from_utf8(&v).unwrap(), PZ_VERSION);
        // Allocation / liberation : un bloc non nul, reliberable sans danger.
        let p = pz_alloc(64);
        assert!(!p.is_null());
        pz_free(p, 64);
        pz_free(ptr::null_mut(), 64);
        assert!(pz_alloc(0).is_null());
    }

    #[test]
    fn impositions_par_la_frontiere() {
        // Ordre de signature sur 8 pages.
        let mut out = [0u32; 16];
        let mut needed = 0usize;
        let rc = pz_signature_order(8, out.as_mut_ptr(), out.len(), &mut needed);
        assert_eq!(rc, 8);
        assert_eq!(needed, 8);
        assert_eq!(&out[..8], &[8, 1, 2, 7, 6, 3, 4, 5]);

        // Faces : quatre valeurs par face, recto = 1.
        let mut faces = [0u32; 16];
        let rc = pz_imposed_sides(4, 0, faces.as_mut_ptr(), faces.len(), &mut needed);
        assert_eq!(rc, 8);
        assert_eq!(&faces[..8], &[4, 1, 1, 1, 2, 3, 1, 0]);
    }

    #[test]
    fn tampon_trop_petit_est_annonce() {
        let mut small = [0u32; 2];
        let mut needed = 0usize;
        let rc = pz_signature_order(8, small.as_mut_ptr(), small.len(), &mut needed);
        assert_eq!(rc, PZ_ERR_TOO_SMALL);
        assert_eq!(needed, 8, "la taille necessaire est annoncee");
    }

    #[test]
    fn grille_et_traits_par_la_frontiere() {
        let mut slots = [0f64; 16];
        let mut needed = 0usize;
        let rc = pz_nup_slots(
            2,
            2,
            100.0,
            100.0,
            10.0,
            0.0,
            0.0,
            0,
            slots.as_mut_ptr(),
            slots.len(),
            &mut needed,
        );
        // Le code de retour compte les `f64` ecrits : 4 emplacements x 2 coordonnees.
        assert_eq!(rc, 8);
        assert_eq!(needed, 8);
        assert_eq!(
            &slots[..8],
            &[0.0, 110.0, 110.0, 110.0, 0.0, 0.0, 110.0, 0.0]
        );

        let mut marks = [0f64; 32];
        let rc = pz_crop_marks(
            100.0,
            200.0,
            300.0,
            400.0,
            12.0,
            4.0,
            marks.as_mut_ptr(),
            marks.len(),
            &mut needed,
        );
        // 8 traits x 4 coordonnees.
        assert_eq!(rc, 32);
        assert_eq!(&marks[..4], &[96.0, 600.0, 84.0, 600.0]);
    }

    #[test]
    fn chemins_par_la_frontiere() {
        let pts = [0.0, 0.0, 10.0, 0.0, 10.0, 10.0];
        let lens = [3u32];
        let d = two_pass(|out, cap, len| {
            pz_path_data(
                pts.as_ptr(),
                pts.len(),
                lens.as_ptr(),
                1,
                0.0,
                0.0,
                out,
                cap,
                len,
            )
        });
        assert_eq!(
            core::str::from_utf8(&d).unwrap(),
            "M0.00 0.00 L10.00 0.00 L10.00 10.00"
        );

        let mut bbox = [0f64; 8];
        let mut needed = 0usize;
        let rc = pz_subpaths_bounds(
            pts.as_ptr(),
            pts.len(),
            lens.as_ptr(),
            1,
            bbox.as_mut_ptr(),
            4,
            &mut needed,
        );
        assert_eq!(rc, 4);
        assert_eq!(&bbox[..4], &[0.0, 0.0, 10.0, 10.0]);
    }

    #[test]
    fn points_incoherents_sont_refuses() {
        let lens = [4u32];
        let pts = [0.0, 0.0, 1.0, 1.0];
        let mut bbox = [0f64; 8];
        let mut needed = 0usize;
        let rc = pz_subpaths_bounds(
            pts.as_ptr(),
            pts.len(),
            lens.as_ptr(),
            1,
            bbox.as_mut_ptr(),
            4,
            &mut needed,
        );
        assert_eq!(rc, PZ_ERR_BAD_INPUT);
        // Nombre impair de coordonnees.
        let odd = [0.0, 0.0, 1.0];
        let rc = pz_path_bounds(odd.as_ptr(), odd.len(), bbox.as_mut_ptr(), 4, &mut needed);
        assert_eq!(rc, PZ_ERR_BAD_INPUT);
    }

    #[test]
    fn couleurs_par_la_frontiere() {
        let hex = "#1f4f78";
        let mut rgb = [0u8; 8];
        let mut needed = 0usize;
        let rc = pz_hex_to_rgb(hex.as_ptr(), hex.len(), rgb.as_mut_ptr(), 3, &mut needed);
        assert_eq!(rc, 3);
        assert_eq!(&rgb[..3], &[31, 79, 120]);
        // Entree illisible : erreur nommee, pas une couleur inventee.
        let rc = pz_hex_to_rgb(b"zz".as_ptr(), 2, rgb.as_mut_ptr(), 3, &mut needed);
        assert_eq!(rc, PZ_ERR_BAD_INPUT);
        // CMJN.
        let out = two_pass(|out, cap, len| pz_cmyk_to_hex(1.0, 0.0, 0.0, 0.0, out, cap, len));
        assert_eq!(core::str::from_utf8(&out).unwrap(), "#00ffff");
        // Eclaircissement.
        let out =
            two_pass(|out, cap, len| pz_shade_hex(b"#808080".as_ptr(), 7, 1.0, out, cap, len));
        assert_eq!(core::str::from_utf8(&out).unwrap(), "#ffffff");
        // Couleur modale d'un echantillon.
        let sample = "#ffffff\n#1f4f78\n#1f4f78\n";
        let out =
            two_pass(|out, cap, len| pz_modal_hex(sample.as_ptr(), sample.len(), out, cap, len));
        assert_eq!(core::str::from_utf8(&out).unwrap(), "#1f4f78");
    }

    #[test]
    fn modele_par_la_frontiere() {
        let input = "1-4, 7";
        let mut pages = [0u32; 16];
        let mut needed = 0usize;
        let rc = pz_parse_page_range(
            input.as_ptr(),
            input.len(),
            12,
            pages.as_mut_ptr(),
            pages.len(),
            &mut needed,
        );
        assert_eq!(rc, 5);
        assert_eq!(&pages[..5], &[0, 1, 2, 3, 6]);

        let name = "Rapport.PDF";
        let out = two_pass(|out, cap, len| pz_session_id(name.as_ptr(), name.len(), out, cap, len));
        assert_eq!(core::str::from_utf8(&out).unwrap(), "doc:rapport.pdf");

        let sig = two_pass(|out, cap, len| {
            pz_graphic_signature(
                1,
                0,
                b"#000000".as_ptr(),
                7,
                0.8,
                60.0,
                582.0,
                300.0,
                180.0,
                1,
                5,
                out,
                cap,
                len,
            )
        });
        assert_eq!(
            core::str::from_utf8(&sig).unwrap(),
            "s|#000000|8|60|582|300|180|1|5"
        );

        let rc = pz_z_index(b"pdf-graphic".as_ptr(), 11, 1);
        assert_eq!(rc, 1);
        let rc = pz_z_index(b"note".as_ptr(), 4, 0);
        assert_eq!(rc, 6);
    }

    #[test]
    fn entrees_nulles_sont_refusees() {
        let mut needed = 0usize;
        let rc = pz_parse_page_range(ptr::null(), 4, 10, ptr::null_mut(), 0, &mut needed);
        assert_eq!(rc, PZ_ERR_NULL);
        let rc = pz_version(ptr::null_mut(), 0, ptr::null_mut());
        assert_eq!(rc, PZ_ERR_NULL);
    }
}
