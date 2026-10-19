//! Trace vectoriel : aplatissement de courbes, boite englobante, chemin SVG.
//!
//! Les objets graphiques extraits d'un PDF sont stockes comme des **sous-chemins**
//! de points (les courbes de Bezier sont aplaties a l'extraction). Ce module porte
//! les trois operations que l'application refaisait a chaque rendu :
//!
//! * `bounds` — la boite englobante, qui pilote la position et le cadre de selection ;
//! * `path_data` — l'attribut `d` d'un `<path>` SVG, pour l'apercu et le test de clic ;
//! * `translate` — le decalage en points PDF, applique quand l'objet a ete deplace.
//!
//! Les nombres sont ecrits avec **deux decimales**, comme `toFixed(2)` cote
//! JavaScript : un chemin trop precis alourdit le DOM pour rien.

use crate::geometry::{Point, Rect};

/// Un sous-chemin : une polyligne fermee ou non, en points PDF.
#[derive(Clone, Debug, PartialEq)]
pub struct Subpath {
    pub points: Vec<Point>,
}

impl Subpath {
    #[must_use]
    pub fn new(points: Vec<Point>) -> Self {
        Self { points }
    }

    /// Un sous-chemin dessinable a besoin d'au moins deux points distincts.
    #[inline]
    #[must_use]
    pub fn is_drawable(&self) -> bool {
        self.points.len() >= 2
    }
}

/// Aplatit une courbe de Bezier cubique en `steps` segments.
///
/// `from` est exclu (le point courant du sous-chemin), `to` est inclus : c'est la
/// convention de l'extraction, qui pousse les points successifs dans un seul
/// sous-chemin. Le minimum est de deux pas : un pas unique rendrait une droite et
/// ferait disparaitre toute courbure.
#[must_use]
pub fn flatten_cubic(from: Point, c1: Point, c2: Point, to: Point, steps: usize) -> Vec<Point> {
    let steps = steps.max(2);
    let mut out = Vec::with_capacity(steps);
    #[allow(clippy::cast_precision_loss)]
    let n = steps as f64;
    for i in 1..=steps {
        #[allow(clippy::cast_precision_loss)]
        let t = i as f64 / n;
        let u = 1.0 - t;
        out.push(Point::new(
            u * u * u * from.x + 3.0 * u * u * t * c1.x + 3.0 * u * t * t * c2.x + t * t * t * to.x,
            u * u * u * from.y + 3.0 * u * u * t * c1.y + 3.0 * u * t * t * c2.y + t * t * t * to.y,
        ));
    }
    out
}

/// Boite englobante de tous les sous-chemins, `None` si aucun point n'est fini.
///
/// Les points non finis sont ignores un par un : un seul `NaN` dans un trace PDF
/// ne doit pas faire disparaitre l'objet entier.
#[must_use]
pub fn bounds(subpaths: &[Subpath]) -> Option<Rect> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut seen = false;
    for sp in subpaths {
        for p in &sp.points {
            if !p.is_finite() {
                continue;
            }
            seen = true;
            if p.x < min_x {
                min_x = p.x;
            }
            if p.y < min_y {
                min_y = p.y;
            }
            if p.x > max_x {
                max_x = p.x;
            }
            if p.y > max_y {
                max_y = p.y;
            }
        }
    }
    if !seen {
        return None;
    }
    Some(Rect::new(min_x, min_y, max_x - min_x, max_y - min_y))
}

/// Ecrit un nombre comme `toFixed(2)` : deux decimales, jamais `-0.00`.
fn fixed2(v: f64) -> String {
    let v = if v == 0.0 { 0.0 } else { v };
    format!("{v:.2}")
}

/// Donnees de chemin SVG (`d`) pour un ensemble de sous-chemins, relatives a
/// l'origine `(ox, oy)`.
///
/// Les sous-chemins de moins de deux points sont ignores, comme dans
/// `subpathsToPathData` : un point isole produirait un `M` sans `L`, que certains
/// moteurs de rendu refusent de tracer.
#[must_use]
pub fn path_data(subpaths: &[Subpath], ox: f64, oy: f64) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(subpaths.len());
    for sp in subpaths {
        if !sp.is_drawable() {
            continue;
        }
        let mut piece = String::with_capacity(sp.points.len() * 16);
        for (i, p) in sp.points.iter().enumerate() {
            if !p.is_finite() {
                continue;
            }
            if !piece.is_empty() {
                piece.push(' ');
            }
            piece.push(if i == 0 { 'M' } else { 'L' });
            piece.push_str(&fixed2(p.x - ox));
            piece.push(' ');
            piece.push_str(&fixed2(p.y - oy));
        }
        if !piece.is_empty() {
            parts.push(piece);
        }
    }
    parts.join(" ")
}

/// Decale tous les sous-chemins (deplacement d'un objet en points PDF).
#[must_use]
pub fn translate(subpaths: &[Subpath], dx: f64, dy: f64) -> Vec<Subpath> {
    subpaths
        .iter()
        .map(|sp| {
            Subpath::new(
                sp.points
                    .iter()
                    .map(|p| Point::new(p.x + dx, p.y + dy))
                    .collect(),
            )
        })
        .collect()
}

/// Longueur cumulee des sous-chemins (utile pour ignorer les traits invisibles).
#[must_use]
pub fn total_length(subpaths: &[Subpath]) -> f64 {
    let mut total = 0.0;
    for sp in subpaths {
        for w in sp.points.windows(2) {
            let dx = w[1].x - w[0].x;
            let dy = w[1].y - w[0].y;
            total += dx.hypot(dy);
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    fn carre(x: f64, y: f64, cote: f64) -> Subpath {
        Subpath::new(vec![
            Point::new(x, y),
            Point::new(x + cote, y),
            Point::new(x + cote, y + cote),
            Point::new(x, y + cote),
            Point::new(x, y),
        ])
    }

    #[test]
    fn aplatissement_dune_courbe() {
        let from = Point::new(0.0, 0.0);
        let to = Point::new(100.0, 0.0);
        let pts = flatten_cubic(from, Point::new(0.0, 80.0), Point::new(100.0, 80.0), to, 10);
        assert_eq!(pts.len(), 10);
        // Le dernier point est exactement l'arrivee.
        approx(pts[9].x, 100.0);
        approx(pts[9].y, 0.0);
        // Le milieu de la courbe est au-dessus de la corde.
        assert!(
            pts[4].y > 50.0,
            "courbe attendue au-dessus de l'axe, obtenu {}",
            pts[4].y
        );
        // Deux pas minimum, meme si l'appelant demande moins.
        assert_eq!(flatten_cubic(from, from, to, to, 0).len(), 2);
    }

    #[test]
    fn bornes_de_plusieurs_sous_chemins() {
        let subs = vec![carre(10.0, 20.0, 30.0), carre(-5.0, 60.0, 10.0)];
        let b = bounds(&subs).expect("des points finis");
        approx(b.x, -5.0);
        approx(b.y, 20.0);
        approx(b.w, 45.0);
        approx(b.h, 50.0);
        assert!(bounds(&[]).is_none());
    }

    #[test]
    fn chemin_svg_relatif_a_lorigine() {
        let subs = vec![carre(10.0, 20.0, 30.0)];
        let d = path_data(&subs, 10.0, 20.0);
        assert_eq!(
            d,
            "M0.00 0.00 L30.00 0.00 L30.00 30.00 L0.00 30.00 L0.00 0.00"
        );
        // Deux sous-chemins sont separes par une espace, un point isole est ignore.
        let deux = vec![
            Subpath::new(vec![Point::new(0.0, 0.0), Point::new(1.0, 1.0)]),
            Subpath::new(vec![Point::new(5.0, 5.0)]),
        ];
        assert_eq!(path_data(&deux, 0.0, 0.0), "M0.00 0.00 L1.00 1.00");
    }

    #[test]
    fn pas_de_moins_zero() {
        // toFixed(-0.001) rend "-0.00" en JavaScript ? Non, il rend "-0.00"… mais
        // l'application arrondit toujours des coordonnees positives ; on garantit
        // ici qu'un zero ne s'ecrit jamais avec un signe.
        let subs = vec![Subpath::new(vec![
            Point::new(-0.0, 0.0),
            Point::new(0.0, 0.0),
        ])];
        assert_eq!(path_data(&subs, 0.0, 0.0), "M0.00 0.00 L0.00 0.00");
    }

    #[test]
    fn translation_et_longueur() {
        let subs = vec![carre(0.0, 0.0, 10.0)];
        let moved = translate(&subs, 5.0, -5.0);
        let b = bounds(&moved).expect("des points");
        approx(b.x, 5.0);
        approx(b.y, -5.0);
        approx(total_length(&subs), 40.0);
    }
}
