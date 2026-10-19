//! Geometrie d'impression : points, rectangles, matrices de transformation.
//!
//! Les matrices suivent la convention PDF / Canvas — `[a b c d e f]` — parce que
//! c'est celle que pdf.js et le DOM emploient deja : `viewport.transform` et
//! `el.style.transform` passent tels quels par [`Matrix`].

/// Un point en coordonnees reelles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    #[inline]
    #[must_use]
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// Vrai si les deux coordonnees sont finies (ni NaN ni infini).
    #[inline]
    #[must_use]
    pub fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

/// Un rectangle aligne sur les axes, coin superieur gauche + dimensions.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    #[inline]
    #[must_use]
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }

    #[inline]
    #[must_use]
    pub fn right(&self) -> f64 {
        self.x + self.w
    }

    #[inline]
    #[must_use]
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }

    /// Un rectangle sans surface, ou non fini, ne peut pas etre dessine : c'est le
    /// cas de `subpathsBounds` qui rend `null` quand il n'y a aucun point exploitable.
    #[inline]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        !(self.w.is_finite() && self.h.is_finite() && self.x.is_finite() && self.y.is_finite())
            || self.w <= 0.0
            || self.h <= 0.0
    }

    #[inline]
    #[must_use]
    pub fn area(&self) -> f64 {
        if self.is_empty() {
            0.0
        } else {
            self.w * self.h
        }
    }

    #[inline]
    #[must_use]
    pub fn center(&self) -> Point {
        Point::new(self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Boite englobante d'une liste de points, `None` si aucun point n'est fini.
    #[must_use]
    pub fn from_points(points: &[Point]) -> Option<Self> {
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut seen = false;
        for p in points {
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
        if !seen {
            return None;
        }
        Some(Self::new(min_x, min_y, max_x - min_x, max_y - min_y))
    }

    /// Deux rectangles se touchent-ils ? Les bords communs ne comptent pas.
    ///
    /// C'est le test qui decide si un objet graphique a ete recouvert par un masque
    /// d'effacement (voir `_refreshMaskedOverlaps` cote application).
    #[inline]
    #[must_use]
    pub fn intersects(&self, other: &Rect) -> bool {
        if self.is_empty() || other.is_empty() {
            return false;
        }
        self.x < other.right()
            && other.x < self.right()
            && self.y < other.bottom()
            && other.y < self.bottom()
    }

    #[must_use]
    pub fn union(&self, other: &Rect) -> Rect {
        if self.is_empty() {
            return *other;
        }
        if other.is_empty() {
            return *self;
        }
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        let right = self.right().max(other.right());
        let bottom = self.bottom().max(other.bottom());
        Rect::new(x, y, right - x, bottom - y)
    }

    #[must_use]
    pub fn translated(&self, dx: f64, dy: f64) -> Rect {
        Rect::new(self.x + dx, self.y + dy, self.w, self.h)
    }
}

/// Matrice de transformation PDF / Canvas : `[a b c d e f]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub const IDENTITY: Matrix = Matrix {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    #[inline]
    #[must_use]
    pub fn new(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Self {
        Self { a, b, c, d, e, f }
    }

    #[inline]
    #[must_use]
    pub fn is_identity(&self) -> bool {
        *self == Matrix::IDENTITY
    }

    /// Applique la matrice a un point.
    #[inline]
    #[must_use]
    pub fn apply(&self, p: Point) -> Point {
        Point::new(
            self.a * p.x + self.c * p.y + self.e,
            self.b * p.x + self.d * p.y + self.f,
        )
    }

    /// Applique la matrice a un point exprime en coordonnees separees.
    #[inline]
    #[must_use]
    pub fn apply_xy(&self, x: f64, y: f64) -> Point {
        self.apply(Point::new(x, y))
    }

    #[inline]
    #[must_use]
    pub fn determinant(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    /// Compose deux matrices : le resultat applique `self` **puis** `other`.
    ///
    /// Les six termes reproduisent exactement `multiply(a, b)` de l'application,
    /// qui concatenait les transformations PDF (`OPS.transform`).
    #[must_use]
    pub fn multiply(&self, other: &Matrix) -> Matrix {
        Matrix::new(
            self.a * other.a + self.c * other.b,
            self.b * other.a + self.d * other.b,
            self.a * other.c + self.c * other.d,
            self.b * other.c + self.d * other.d,
            self.a * other.e + self.c * other.f + self.e,
            self.b * other.e + self.d * other.f + self.f,
        )
    }

    /// Inverse la matrice, `None` si elle est degeneree.
    ///
    /// C'est la transformation utilisee pour repasser des coordonnees ecran aux
    /// coordonnees PDF apres un deplacement a la souris.
    #[must_use]
    pub fn invert(&self) -> Option<Matrix> {
        let det = self.determinant();
        if det == 0.0 || !det.is_finite() {
            return None;
        }
        Some(Matrix::new(
            self.d / det,
            -self.b / det,
            -self.c / det,
            self.a / det,
            (self.c * self.f - self.d * self.e) / det,
            (self.b * self.e - self.a * self.f) / det,
        ))
    }
}

/// Facteur d'echelle pour faire tenir un contenu dans un emplacement, sans le
/// deformer : le plus petit des deux rapports.
///
/// Rend `0.0` si l'une des dimensions est nulle — l'appelant traite alors
/// l'emplacement comme inutilisable plutot que de produire un `NaN`.
#[must_use]
pub fn fit_scale(content_w: f64, content_h: f64, slot_w: f64, slot_h: f64) -> f64 {
    if content_w <= 0.0 || content_h <= 0.0 || slot_w <= 0.0 || slot_h <= 0.0 {
        return 0.0;
    }
    (slot_w / content_w).min(slot_h / content_h)
}

/// Place un contenu centre dans un emplacement, a l'echelle qui le fait tenir.
#[must_use]
pub fn fit_centered(content_w: f64, content_h: f64, slot: Rect) -> Rect {
    let scale = fit_scale(content_w, content_h, slot.w, slot.h);
    if scale <= 0.0 {
        return Rect::new(slot.x, slot.y, 0.0, 0.0);
    }
    let w = content_w * scale;
    let h = content_h * scale;
    Rect::new(
        slot.x + (slot.w - w) / 2.0,
        slot.y + (slot.h - h) / 2.0,
        w,
        h,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn boite_englobante_ignore_les_points_non_finis() {
        let pts = [
            Point::new(10.0, 20.0),
            Point::new(f64::NAN, 5.0),
            Point::new(-5.0, 40.0),
        ];
        let r = Rect::from_points(&pts).expect("au moins deux points finis");
        approx(r.x, -5.0);
        approx(r.y, 20.0);
        approx(r.w, 15.0);
        approx(r.h, 20.0);
        assert!(Rect::from_points(&[]).is_none());
        assert!(Rect::from_points(&[Point::new(f64::INFINITY, 0.0)]).is_none());
    }

    #[test]
    fn intersection_exclut_les_bords_communs() {
        let a = Rect::new(0.0, 0.0, 10.0, 10.0);
        let b = Rect::new(10.0, 0.0, 10.0, 10.0);
        assert!(
            !a.intersects(&b),
            "un bord partage n'est pas un recouvrement"
        );
        let c = Rect::new(9.0, 0.0, 10.0, 10.0);
        assert!(a.intersects(&c));
    }

    #[test]
    fn union_et_translation() {
        let a = Rect::new(0.0, 0.0, 10.0, 10.0);
        let b = Rect::new(20.0, 5.0, 5.0, 5.0);
        let u = a.union(&b);
        approx(u.x, 0.0);
        approx(u.y, 0.0);
        approx(u.w, 25.0);
        approx(u.h, 10.0);
        let t = a.translated(3.0, -2.0);
        approx(t.x, 3.0);
        approx(t.y, -2.0);
    }

    #[test]
    fn matrice_composee_comme_application() {
        // Recopie de `multiply(a, b)` du JavaScript : deux translations composent.
        let t1 = Matrix::new(1.0, 0.0, 0.0, 1.0, 10.0, 20.0);
        let t2 = Matrix::new(1.0, 0.0, 0.0, 1.0, 5.0, -3.0);
        let m = t1.multiply(&t2);
        approx(m.e, 15.0);
        approx(m.f, 17.0);
        let p = m.apply(Point::new(0.0, 0.0));
        approx(p.x, 15.0);
        approx(p.y, 17.0);
    }

    #[test]
    fn inverse_redonne_les_coordonnees_de_depart() {
        // Une transformation realiste : echelle 1,79 et miroir vertical de pdf.js.
        let m = Matrix::new(1.79, 0.0, 0.0, -1.79, 0.0, 1506.0);
        let inv = m.invert().expect("determinant non nul");
        let p = Point::new(123.0, 456.0);
        let round = inv.apply(m.apply(p));
        approx(round.x, p.x);
        approx(round.y, p.y);
        assert!(Matrix::new(0.0, 0.0, 0.0, 0.0, 0.0, 0.0).invert().is_none());
    }

    #[test]
    fn echelle_de_placement() {
        // Une page A4 dans un emplacement de 400 x 400 : c'est la hauteur qui contraint.
        let s = fit_scale(595.0, 842.0, 400.0, 400.0);
        approx(s, 400.0 / 842.0);
        let slot = Rect::new(0.0, 0.0, 400.0, 400.0);
        let r = fit_centered(595.0, 842.0, slot);
        approx(r.w, 400.0 * 595.0 / 842.0);
        approx(r.h, 400.0);
        approx(r.x, (400.0 - r.w) / 2.0);
        approx(r.y, 0.0);
        assert_eq!(fit_scale(0.0, 10.0, 10.0, 10.0), 0.0);
    }
}
