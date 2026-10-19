//! Conversions d'unites typographiques et d'impression.
//!
//! Reperes : 1 pouce = 25,4 mm ; 1 point PostScript = 1/72 pouce.
//! Ce sont exactement les constantes utilisees par l'application JavaScript
//! (`const mmToPt = 2.83465` y est l'arrondi de `72 / 25.4`).

/// Points PostScript par millimetre.
pub const PT_PER_MM: f64 = 72.0 / 25.4;
/// Millimetres par pouce.
pub const MM_PER_IN: f64 = 25.4;
/// Points PostScript par pouce.
pub const PT_PER_IN: f64 = 72.0;

/// Millimetres → points.
#[inline]
#[must_use]
pub fn mm_to_pt(mm: f64) -> f64 {
    mm * PT_PER_MM
}

/// Points → millimetres.
#[inline]
#[must_use]
pub fn pt_to_mm(pt: f64) -> f64 {
    pt / PT_PER_MM
}

/// Millimetres → pixels, pour une resolution donnee (p. ex. 300 DPI).
#[inline]
#[must_use]
pub fn mm_to_px(mm: f64, dpi: f64) -> f64 {
    mm / MM_PER_IN * dpi
}

/// Pixels → millimetres, pour une resolution donnee.
#[inline]
#[must_use]
pub fn px_to_mm(px: f64, dpi: f64) -> f64 {
    px / dpi * MM_PER_IN
}

/// Pouces → millimetres.
#[inline]
#[must_use]
pub fn in_to_mm(inches: f64) -> f64 {
    inches * MM_PER_IN
}

/// Points → pixels, pour une resolution donnee.
#[inline]
#[must_use]
pub fn pt_to_px(pt: f64, dpi: f64) -> f64 {
    pt / PT_PER_IN * dpi
}

/// Pixels → points, pour une resolution donnee.
#[inline]
#[must_use]
pub fn px_to_pt(px: f64, dpi: f64) -> f64 {
    px * PT_PER_IN / dpi
}

/// Facteur de conversion vers les points pour une unite nommee.
///
/// C'est ce que fait le champ « custom » du panneau d'imposition : l'utilisateur
/// saisit une largeur, une hauteur et une unite, et le document attend des points.
/// Une unite inconnue retombe sur les millimetres, comme dans l'application.
#[must_use]
pub fn unit_factor(unit: &str) -> f64 {
    match unit {
        "in" => PT_PER_IN,
        "pt" => 1.0,
        _ => PT_PER_MM,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn a4_en_points() {
        // A4 = 210 x 297 mm ; les valeurs attendues sont celles de pdf-lib.
        approx(mm_to_pt(210.0), 595.275_590_551_181);
        approx(mm_to_pt(297.0), 841.889_763_779_528);
    }

    #[test]
    fn aller_retour_mm_pt() {
        for mm in [0.0, 1.0, 12.5, 210.0, 297.0, 1000.0] {
            approx(pt_to_mm(mm_to_pt(mm)), mm);
        }
    }

    #[test]
    fn pixels_a_300_dpi() {
        // 1 pouce a 300 DPI = 300 px, soit 25,4 mm.
        approx(mm_to_px(25.4, 300.0), 300.0);
        approx(px_to_mm(300.0, 300.0), 25.4);
        approx(pt_to_px(72.0, 300.0), 300.0);
        approx(px_to_pt(300.0, 300.0), 72.0);
    }

    #[test]
    fn unites_du_panneau() {
        approx(unit_factor("mm"), PT_PER_MM);
        approx(unit_factor("in"), 72.0);
        approx(unit_factor("pt"), 1.0);
        approx(unit_factor("n-importe-quoi"), PT_PER_MM);
    }
}
