//! Format de planche : tailles nommees, taille automatique, orientation.
//!
//! Le panneau d'imposition propose `Auto — 2 × page size` par defaut : dans ce
//! cas la planche vaut **deux fois la page source** en livret (les pages sortent a
//! 100 %) et la page source elle-meme en N-up. Une planche vide (`0 × 0`) est la
//! convention interne pour « a calculer par l'appelant ».

use pdfyz_core::units::unit_factor;

/// Largeur et hauteur d'une planche, en points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SheetSize {
    pub width: f64,
    pub height: f64,
}

impl SheetSize {
    #[inline]
    #[must_use]
    pub fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }

    /// Vrai si la planche est en paysage.
    #[inline]
    #[must_use]
    pub fn is_landscape(&self) -> bool {
        self.width > self.height
    }

    /// Echange largeur et hauteur (rotation de 90°).
    #[inline]
    #[must_use]
    pub fn swapped(&self) -> Self {
        Self::new(self.height, self.width)
    }
}

/// A4 en points — valeur de repli quand une cle est inconnue.
pub const A4: SheetSize = SheetSize {
    width: 595.28,
    height: 841.89,
};

/// Orientation demandee dans le panneau.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orientation {
    Auto,
    Portrait,
    Landscape,
}

impl Orientation {
    /// Depuis la valeur du `<select>`.
    #[must_use]
    pub fn parse(value: &str) -> Self {
        match value {
            "portrait" => Self::Portrait,
            "landscape" => Self::Landscape,
            _ => Self::Auto,
        }
    }
}

/// Taille d'une planche nommee, en points. `None` pour `auto` et `custom`.
///
/// Les valeurs sont celles de `getImpoSheetSize` cote JavaScript ; elles sont
/// ecrites ici en dur parce qu'aucune n'est calculee : les arrondis differents
/// feraient bouger la sortie d'un demi-point d'une implementation a l'autre.
#[must_use]
pub fn sheet_size(key: &str) -> Option<SheetSize> {
    let size = match key {
        "a5" => SheetSize::new(419.53, 595.28),
        "a4" => A4,
        "a3" => SheetSize::new(841.89, 1190.55),
        "a2" => SheetSize::new(1190.55, 1683.78),
        "sra3" => SheetSize::new(907.09, 1275.59),
        "sra4" => SheetSize::new(637.80, 907.09),
        "letter" => SheetSize::new(612.0, 792.0),
        "legal" => SheetSize::new(612.0, 1008.0),
        "tabloid" => SheetSize::new(792.0, 1224.0),
        _ => return None,
    };
    Some(size)
}

/// Planche personnalisee : largeur et hauteur saisies, dans l'unite choisie.
#[must_use]
pub fn custom_sheet(width: f64, height: f64, unit: &str) -> SheetSize {
    let factor = unit_factor(unit);
    SheetSize::new(width * factor, height * factor)
}

/// Planche « auto ».
///
/// En livret, les deux pages sont cote a cote : la planche vaut deux fois la page
/// en largeur, une fois en hauteur. En N-up, c'est la page elle-meme (l'utilisateur
/// choisit ensuite la grille qui doit y tenir).
#[must_use]
pub fn auto_sheet(page_width: f64, page_height: f64, booklet: bool) -> SheetSize {
    if booklet {
        SheetSize::new(page_width * 2.0, page_height)
    } else {
        SheetSize::new(page_width, page_height)
    }
}

/// Applique l'orientation demandee a une planche.
///
/// `Auto` ne tourne que si la grille est plus large que haute : une planche
/// portrait avec une grille 4×2 doit passer en paysage, sinon les emplacements
/// sont des colonnes et les pages sont minuscules.
#[must_use]
pub fn resolve_orientation(
    sheet: SheetSize,
    orientation: Orientation,
    cols: u32,
    rows: u32,
) -> SheetSize {
    match orientation {
        Orientation::Landscape => {
            if sheet.width < sheet.height {
                sheet.swapped()
            } else {
                sheet
            }
        }
        Orientation::Portrait => {
            if sheet.width > sheet.height {
                sheet.swapped()
            } else {
                sheet
            }
        }
        Orientation::Auto => {
            if cols > rows && sheet.width < sheet.height {
                sheet.swapped()
            } else {
                sheet
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn tailles_nommees() {
        let a4 = sheet_size("a4").expect("A4 connue");
        approx(a4.width, 595.28);
        approx(a4.height, 841.89);
        assert!(!a4.is_landscape());
        let tab = sheet_size("tabloid").expect("tabloid connue");
        approx(tab.width, 792.0);
        assert!(sheet_size("auto").is_none());
        assert!(sheet_size("custom").is_none());
        assert!(sheet_size("inconnue").is_none());
    }

    #[test]
    fn planche_auto_en_livret() {
        // A4 portrait -> spread A3 paysage, pages a 100 %.
        let s = auto_sheet(595.28, 841.89, true);
        approx(s.width, 1190.56);
        approx(s.height, 841.89);
        assert!(s.is_landscape());
        // En N-up, c'est la page elle-meme.
        let n = auto_sheet(595.28, 841.89, false);
        approx(n.width, 595.28);
        approx(n.height, 841.89);
    }

    #[test]
    fn planche_personnalisee_en_millimetres() {
        let s = custom_sheet(210.0, 297.0, "mm");
        approx(s.width, 595.275_590_551_181);
        approx(s.height, 841.889_763_779_528);
        let inch = custom_sheet(8.5, 11.0, "in");
        approx(inch.width, 612.0);
        approx(inch.height, 792.0);
        let pt = custom_sheet(300.0, 400.0, "pt");
        approx(pt.width, 300.0);
    }

    #[test]
    fn orientation() {
        let portrait = SheetSize::new(595.0, 842.0);
        assert!(resolve_orientation(portrait, Orientation::Landscape, 2, 1).is_landscape());
        let landscape = SheetSize::new(842.0, 595.0);
        assert!(!resolve_orientation(landscape, Orientation::Portrait, 2, 1).is_landscape());
        // Auto : grille 4x2 (plus large que haute) sur une planche portrait.
        assert!(resolve_orientation(portrait, Orientation::Auto, 4, 2).is_landscape());
        // Auto : grille 2x4 sur planche paysage -> on ne tourne pas dans l'autre sens.
        let r = resolve_orientation(landscape, Orientation::Auto, 2, 4);
        approx(r.width, 842.0);
    }

    #[test]
    fn analyse_des_valeurs_du_panneau() {
        assert_eq!(Orientation::parse("portrait"), Orientation::Portrait);
        assert_eq!(Orientation::parse("landscape"), Orientation::Landscape);
        assert_eq!(Orientation::parse("auto"), Orientation::Auto);
        assert_eq!(Orientation::parse(""), Orientation::Auto);
    }
}
