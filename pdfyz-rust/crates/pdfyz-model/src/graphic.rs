//! Empreinte d'un objet vectoriel extrait d'un PDF.
//!
//! Certains PDF peignent **deux fois** le meme objet : une passe d'ombre, un
//! contenu duplique, un groupe repeint. Sans empreinte, l'utilisateur voit deux
//! objets superposes et doit supprimer deux fois pour en retirer un seul — c'est
//! exactement le defaut signale sur les logos decomposes.
//!
//! L'empreinte combine ce qui identifie un trace a l'oeil : les deux canaux peints,
//! la couleur, l'epaisseur arrondie au dixieme, la boite arrondie au point et la
//! forme (nombre de sous-chemins et de points du premier). Deux objets qui
//! different d'un demi-point ne sont **pas** des doublons : l'arrondi absorbe le
//! bruit de conversion, pas une vraie difference.

/// Arrondi de JavaScript (`Math.round`) : demi vers +infini.
///
/// `f64::round` arrondit le demi **hors de zero** : pour `-2.5` il rend `-3` la ou
/// JavaScript rend `-2`. La difference ne se voit que sur des coordonnees PDF
/// negatives a la demie exacte, mais deux implementations qui divergent sur une
/// cle de deduplication cessent d'etre comparables — d'ou cette fonction.
#[must_use]
pub fn js_round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    (value + 0.5).floor()
}

/// Empreinte d'un objet graphique, telle que `_graphicSigs` la construit.
///
/// Les drapeaux sont ecrits en prefixe (`s` = contour, `f` = remplissage) pour que
/// deux objets de meme geometrie mais de peinture differente ne se confondent pas.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn graphic_signature(
    stroked: bool,
    filled: bool,
    color: &str,
    line_width: f64,
    min_x: f64,
    min_y: f64,
    width: f64,
    height: f64,
    subpaths: usize,
    first_subpath_len: usize,
) -> String {
    let flag_s = if stroked { "s" } else { "" };
    let flag_f = if filled { "f" } else { "" };
    let r = |v: f64| {
        let rounded = js_round(v);
        if rounded == 0.0 {
            // Un zero negatif s'ecrirait "-0" et casserait la comparaison de deux
            // empreintes identiques.
            "0".to_string()
        } else {
            #[allow(clippy::cast_possible_truncation)]
            let n = rounded as i64;
            n.to_string()
        }
    };
    format!(
        "{flag_s}{flag_f}|{color}|{}|{}|{}|{}|{}|{subpaths}|{first_subpath_len}",
        r(line_width * 10.0),
        r(min_x),
        r(min_y),
        r(width),
        r(height),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrondi_de_javascript() {
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(2.5), 3.0);
        // La difference avec f64::round, qui rend -3.
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(-2.5f64.round(), -3.0);
        assert_eq!(js_round(2.4), 2.0);
    }

    #[test]
    fn empreinte_complete() {
        let sig = graphic_signature(true, false, "#1f4f78", 0.8, 60.0, 582.0, 300.0, 180.0, 1, 5);
        assert_eq!(sig, "s|#1f4f78|8|60|582|300|180|1|5");
        // Meme objet, peint en remplissage : empreinte differente.
        let fill = graphic_signature(false, true, "#1f4f78", 0.8, 60.0, 582.0, 300.0, 180.0, 1, 5);
        assert_eq!(fill, "f|#1f4f78|8|60|582|300|180|1|5");
    }

    #[test]
    fn doublons_reconnus_et_vraies_differences_gardees() {
        let a = graphic_signature(true, true, "#000000", 1.0, 10.0, 20.0, 30.0, 40.0, 2, 4);
        let b = graphic_signature(true, true, "#000000", 1.0, 10.0, 20.0, 30.0, 40.0, 2, 4);
        assert_eq!(a, b, "deux peintures identiques sont un doublon");
        // Un demi-point de difference sur l'epaisseur (0.95 -> 10, 1.0 -> 10) : doublon.
        let c = graphic_signature(true, true, "#000000", 0.95, 10.0, 20.0, 30.0, 40.0, 2, 4);
        assert_eq!(a, c, "le bruit de conversion est absorbe");
        // Une couleur differente n'est pas un doublon.
        let d = graphic_signature(true, true, "#111111", 1.0, 10.0, 20.0, 30.0, 40.0, 2, 4);
        assert_ne!(a, d);
        // Un objet translate n'est pas un doublon non plus.
        let e = graphic_signature(true, true, "#000000", 1.0, 11.0, 20.0, 30.0, 40.0, 2, 4);
        assert_ne!(a, e);
    }

    #[test]
    fn zero_negatif_ne_casse_pas_la_cle() {
        let a = graphic_signature(true, false, "#000000", 0.0, -0.0, 0.0, 10.0, 10.0, 1, 2);
        let b = graphic_signature(true, false, "#000000", 0.0, 0.0, 0.0, 10.0, 10.0, 1, 2);
        assert_eq!(a, b);
        assert!(!a.contains("-0|"), "aucune composante negative nulle : {a}");
    }
}
