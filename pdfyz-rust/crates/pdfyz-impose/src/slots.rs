//! Grille N-up : positions des emplacements sur la planche.
//!
//! L'origine est le **coin bas-gauche** de la planche (repere PDF), d'ou
//! `y = margin_b + (rows - 1 - row) * (slot_h + gutter)` : la premiere ligne de la
//! grille est celle du haut, comme la lit un lecteur.

/// Ordre de parcours des emplacements.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotOrder {
    /// Gauche → droite, haut → bas (defaut, ordre de lecture).
    LtrTtb,
    /// Droite → gauche, haut → bas.
    RtlTtb,
    /// Gauche → droite, bas → haut.
    LtrBtt,
    /// Haut → bas, gauche → droite.
    TtbLtr,
}

impl SlotOrder {
    /// Depuis la valeur du `<select>` du panneau.
    #[must_use]
    pub fn parse(value: &str) -> Self {
        match value {
            "rtl-ttb" => Self::RtlTtb,
            "ltr-btt" => Self::LtrBtt,
            "ttb-ltr" => Self::TtbLtr,
            _ => Self::LtrTtb,
        }
    }

    /// Depuis le code numerique de la frontiere WebAssembly.
    #[must_use]
    pub fn from_code(code: u32) -> Self {
        match code {
            1 => Self::RtlTtb,
            2 => Self::LtrBtt,
            3 => Self::TtbLtr,
            _ => Self::LtrTtb,
        }
    }

    /// Code numerique, pour la frontiere.
    #[must_use]
    pub fn code(self) -> u32 {
        match self {
            Self::LtrTtb => 0,
            Self::RtlTtb => 1,
            Self::LtrBtt => 2,
            Self::TtbLtr => 3,
        }
    }

    /// Valeur du `<select>`, pour l'aller-retour dans l'interface.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LtrTtb => "ltr-ttb",
            Self::RtlTtb => "rtl-ttb",
            Self::LtrBtt => "ltr-btt",
            Self::TtbLtr => "ttb-ltr",
        }
    }
}

/// Un emplacement : coin bas-gauche et position dans la grille.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slot {
    pub x: f64,
    pub y: f64,
    pub col: u32,
    pub row: u32,
}

impl Slot {
    /// Centre de l'emplacement, pour poser une page sans calcul dans l'appelant.
    #[must_use]
    pub fn center(self, slot_w: f64, slot_h: f64) -> (f64, f64) {
        (self.x + slot_w / 2.0, self.y + slot_h / 2.0)
    }
}

/// Positions des emplacements d'une grille `cols × rows`.
///
/// Les emplacements sont construits ligne par ligne (de haut en bas), puis **tries**
/// selon `order` — un tri stable, comme `Array.prototype.sort` en JavaScript : deux
/// emplacements de meme cle gardent leur ordre de construction, donc la meme page
/// tombe au meme endroit dans les deux implementations.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn nup_slots(
    cols: u32,
    rows: u32,
    slot_w: f64,
    slot_h: f64,
    gutter: f64,
    margin_l: f64,
    margin_b: f64,
    order: SlotOrder,
) -> Vec<Slot> {
    let mut slots = Vec::with_capacity((cols as usize) * (rows as usize));
    for row in 0..rows {
        for col in 0..cols {
            slots.push(Slot {
                x: margin_l + f64::from(col) * (slot_w + gutter),
                y: margin_b + f64::from(rows - 1 - row) * (slot_h + gutter),
                col,
                row,
            });
        }
    }
    match order {
        SlotOrder::LtrTtb => {}
        SlotOrder::RtlTtb => slots.sort_by(|a, b| a.row.cmp(&b.row).then(b.col.cmp(&a.col))),
        SlotOrder::LtrBtt => slots.sort_by(|a, b| b.row.cmp(&a.row).then(a.col.cmp(&b.col))),
        SlotOrder::TtbLtr => slots.sort_by(|a, b| a.col.cmp(&b.col).then(a.row.cmp(&b.row))),
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn grille_quatre_deux() {
        let slots = nup_slots(4, 2, 100.0, 200.0, 10.0, 20.0, 30.0, SlotOrder::LtrTtb);
        assert_eq!(slots.len(), 8);
        // Premier emplacement : coin haut-gauche, donc y = marge basse + (2-1-0)*(200+10).
        approx(slots[0].x, 20.0);
        approx(slots[0].y, 30.0 + 210.0);
        // Deuxieme : decale d'une colonne.
        approx(slots[1].x, 20.0 + 110.0);
        approx(slots[1].y, 240.0);
        // Cinquieme : ligne du bas.
        approx(slots[4].x, 20.0);
        approx(slots[4].y, 30.0);
        assert_eq!((slots[4].col, slots[4].row), (0, 1));
    }

    #[test]
    fn ordres_de_parcours() {
        let base = |order| nup_slots(2, 2, 100.0, 100.0, 0.0, 0.0, 0.0, order);
        // Lecture : (0,0) (1,0) (0,1) (1,1)
        let ltr = base(SlotOrder::LtrTtb);
        assert_eq!(
            ltr.iter().map(|s| (s.col, s.row)).collect::<Vec<_>>(),
            vec![(0, 0), (1, 0), (0, 1), (1, 1)]
        );
        // Droite -> gauche
        let rtl = base(SlotOrder::RtlTtb);
        assert_eq!(
            rtl.iter().map(|s| (s.col, s.row)).collect::<Vec<_>>(),
            vec![(1, 0), (0, 0), (1, 1), (0, 1)]
        );
        // Bas -> haut
        let btt = base(SlotOrder::LtrBtt);
        assert_eq!(
            btt.iter().map(|s| (s.col, s.row)).collect::<Vec<_>>(),
            vec![(0, 1), (1, 1), (0, 0), (1, 0)]
        );
        // Colonne par colonne
        let ttb = base(SlotOrder::TtbLtr);
        assert_eq!(
            ttb.iter().map(|s| (s.col, s.row)).collect::<Vec<_>>(),
            vec![(0, 0), (0, 1), (1, 0), (1, 1)]
        );
    }

    #[test]
    fn codes_et_aller_retour() {
        for order in [
            SlotOrder::LtrTtb,
            SlotOrder::RtlTtb,
            SlotOrder::LtrBtt,
            SlotOrder::TtbLtr,
        ] {
            assert_eq!(SlotOrder::from_code(order.code()), order);
            assert_eq!(SlotOrder::parse(order.as_str()), order);
        }
        assert_eq!(SlotOrder::parse("n-importe-quoi"), SlotOrder::LtrTtb);
    }

    #[test]
    fn centre_dun_emplacement() {
        let slot = Slot {
            x: 10.0,
            y: 20.0,
            col: 0,
            row: 0,
        };
        let (cx, cy) = slot.center(100.0, 50.0);
        approx(cx, 60.0);
        approx(cy, 45.0);
    }
}
