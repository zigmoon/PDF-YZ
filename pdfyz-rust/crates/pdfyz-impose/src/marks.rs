//! Traits de coupe.
//!
//! Huit traits autour d'un emplacement : deux par coin, l'un prolongeant le bord
//! horizontal, l'autre le bord vertical, tous **a l'exterieur** du format de
//! coupe. Un trait ne doit jamais entrer dans la zone imprimee : a l'impression, il
//! se retrouverait sur la page.

/// Longueur de trait par defaut, en points (le panneau laisse la valeur vide).
pub const DEFAULT_MARK_LEN: f64 = 12.0;
/// Ecart entre le bord du format et le debut du trait.
pub const DEFAULT_MARK_OFFSET: f64 = 4.0;

/// Un segment de trait de coupe.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

impl Segment {
    #[inline]
    #[must_use]
    pub fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Self {
        Self { x1, y1, x2, y2 }
    }

    /// Longueur du segment.
    #[must_use]
    pub fn length(self) -> f64 {
        (self.x2 - self.x1).hypot(self.y2 - self.y1)
    }
}

/// Les huit traits de coupe d'un emplacement `slot_w × slot_h` place en `(x, y)`.
///
/// L'ordre est celui de `drawCropMarks` cote JavaScript (haut-gauche, haut-droite,
/// bas-gauche, bas-droite, deux traits par coin) : il ne change rien au dessin,
/// mais il rend les deux implementations comparables terme a terme.
#[must_use]
pub fn crop_marks(
    x: f64,
    y: f64,
    slot_w: f64,
    slot_h: f64,
    mark_len: f64,
    offset: f64,
) -> Vec<Segment> {
    let ml = if mark_len > 0.0 {
        mark_len
    } else {
        DEFAULT_MARK_LEN
    };
    let off = if offset > 0.0 {
        offset
    } else {
        DEFAULT_MARK_OFFSET
    };
    vec![
        // Coin superieur gauche
        Segment::new(x - off, y + slot_h, x - off - ml, y + slot_h),
        Segment::new(x, y + slot_h + off, x, y + slot_h + off + ml),
        // Coin superieur droit
        Segment::new(
            x + slot_w + off,
            y + slot_h,
            x + slot_w + off + ml,
            y + slot_h,
        ),
        Segment::new(
            x + slot_w,
            y + slot_h + off,
            x + slot_w,
            y + slot_h + off + ml,
        ),
        // Coin inferieur gauche
        Segment::new(x - off, y, x - off - ml, y),
        Segment::new(x, y - off, x, y - off - ml),
        // Coin inferieur droit
        Segment::new(x + slot_w + off, y, x + slot_w + off + ml, y),
        Segment::new(x + slot_w, y - off, x + slot_w, y - off - ml),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn huit_traits_autour_de_lemplacement() {
        let marks = crop_marks(100.0, 200.0, 300.0, 400.0, 12.0, 4.0);
        assert_eq!(marks.len(), 8);
        // Tous les traits partent du meme point : le coin superieur gauche,
        // decale de l'ecart sur chaque axe.
        approx(marks[0].x1, 96.0);
        approx(marks[0].y1, 600.0);
        approx(marks[0].x2, 84.0);
        approx(marks[0].y2, 600.0);
        approx(marks[1].x1, 100.0);
        approx(marks[1].y1, 604.0);
        // Le coin superieur droit prolonge vers la droite.
        approx(marks[2].x1, 404.0);
        approx(marks[2].x2, 416.0);
        // Le coin inferieur droit descend vers le bas.
        approx(marks[7].y1, 196.0);
        approx(marks[7].y2, 184.0);
        assert!(marks.iter().all(|m| (m.length() - 12.0).abs() < 1e-9));
    }

    #[test]
    fn aucune_longueur_nulle() {
        // Un champ vide vaut 0 : on retombe sur les valeurs par defaut, sinon un
        // trait de longueur nulle ne s'imprimerait pas et l'utilisateur croirait
        // avoir active les traits de coupe.
        let marks = crop_marks(0.0, 0.0, 10.0, 10.0, 0.0, 0.0);
        assert!(marks
            .iter()
            .all(|m| (m.length() - DEFAULT_MARK_LEN).abs() < 1e-9));
    }

    #[test]
    fn les_traits_ne_rentrent_pas_dans_le_format() {
        let (x, y, w, h) = (100.0, 200.0, 300.0, 400.0);
        for m in crop_marks(x, y, w, h, 12.0, 4.0) {
            let inside = |px: f64, py: f64| px > x && px < x + w && py > y && py < y + h;
            assert!(!inside(m.x1, m.y1) && !inside(m.x2, m.y2));
        }
    }
}
