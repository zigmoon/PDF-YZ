//! Ordre d'imposition d'un livret (signature) et decoupage en faces.
//!
//! # Pourquoi cet ordre
//!
//! Une feuille pliee porte quatre pages. La face **exterieure** recoit la derniere
//! page et la premiere ; la face **interieure** recoit la deuxieme et l'avant-
//! derniere. En repetant, on converge vers le centre du cahier :
//!
//! ```text
//! pages : 8
//! face 1 (recto, exterieur) : [8 | 1]
//! face 2 (verso, interieur) : [2 | 7]
//! face 3 (recto)            : [6 | 3]
//! face 4 (verso)            : [4 | 5]
//! ```
//!
//! Chaque face devient **une page** du nouveau document : c'est ce que produit
//! une imposition, et c'est ce que l'imprimante doit recevoir en recto-verso
//! (« retourner sur le bord court »).

/// Reliure demandee.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Binding {
    /// Dos agrafe : l'ordre de signature converge vers le centre (defaut).
    Saddle,
    /// Dos carre colle : les pages se suivent deux a deux, `[1|2] [3|4] …`.
    Perfect,
}

impl Binding {
    /// Depuis le code numerique de la frontiere WebAssembly (`0` = agrafe).
    #[must_use]
    pub fn from_code(code: u32) -> Self {
        if code == 1 {
            Self::Perfect
        } else {
            Self::Saddle
        }
    }

    /// Code numerique, pour la frontiere.
    #[must_use]
    pub fn code(self) -> u32 {
        match self {
            Self::Saddle => 0,
            Self::Perfect => 1,
        }
    }

    /// Depuis la valeur du `<select>` du panneau.
    #[must_use]
    pub fn parse(value: &str) -> Self {
        if value == "perfect" {
            Self::Perfect
        } else {
            Self::Saddle
        }
    }
}

/// Une face imprimee : deux pages et l'endroit ou elle se place dans le cahier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Side {
    /// Page de gauche (**1-based**). Au-dela du nombre reel de pages : page blanche.
    pub left: u32,
    /// Page de droite (**1-based**), meme convention.
    pub right: u32,
    /// Numero de feuille (**1-based**) : quatre pages par feuille.
    pub sheet: u32,
    /// Vrai pour le recto (face exterieure), faux pour le verso.
    pub front: bool,
}

impl Side {
    /// Cette face contient-elle au moins une page reelle ?
    #[must_use]
    pub fn has_content(self, pages: usize) -> bool {
        #[allow(clippy::cast_possible_truncation)]
        let n = pages as u32;
        self.left <= n || self.right <= n
    }

    /// Les deux pages de la face, dans l'ordre gauche-droite.
    #[must_use]
    pub fn pages(self) -> [u32; 2] {
        [self.left, self.right]
    }
}

/// Complete un nombre de pages au multiple de 4 superieur.
///
/// Un document vide compte comme une page : sans cela, une imposition sur un
/// document vide produirait zero planche et un export de zero page, que pdf-lib
/// refuse.
#[must_use]
pub fn pad_to_multiple_of_four(pages: usize) -> usize {
    let n = pages.max(1);
    n.div_ceil(4) * 4
}

/// Ordre de signature complet, a plat : deux entrees par face.
///
/// Reproduit **exactement** `calculateImposition` de SuperPrint.
#[must_use]
pub fn signature_order(pages: usize) -> Vec<u32> {
    let adjusted = pad_to_multiple_of_four(pages);
    let sheets = adjusted / 4;
    let mut order = Vec::with_capacity(adjusted);
    #[allow(clippy::cast_possible_truncation)]
    let mut front = 1u32;
    #[allow(clippy::cast_possible_truncation)]
    let mut back = adjusted as u32;
    for _ in 0..sheets {
        // Recto : la page haute a gauche, la page basse a droite.
        order.push(back);
        order.push(front);
        back = back.saturating_sub(1);
        front += 1;
        // Verso : la page basse a gauche, la page haute a droite.
        order.push(front);
        order.push(back);
        front += 1;
        back = back.saturating_sub(1);
    }
    order
}

/// Ordre sequentiel, complete au multiple de 4 (dos carre colle).
#[must_use]
pub fn sequential_order(pages: usize) -> Vec<u32> {
    let adjusted = pad_to_multiple_of_four(pages);
    #[allow(clippy::cast_possible_truncation)]
    (1..=adjusted as u32).collect()
}

/// Decoupe un ordre a plat en faces de deux pages.
#[must_use]
pub fn build_sides(pages: usize, binding: Binding) -> Vec<Side> {
    let flat = match binding {
        Binding::Saddle => signature_order(pages),
        Binding::Perfect => sequential_order(pages),
    };
    flat.chunks(2)
        .enumerate()
        .filter_map(|(i, pair)| {
            let left = *pair.first()?;
            let right = *pair.get(1).unwrap_or(&0);
            #[allow(clippy::cast_possible_truncation)]
            let index = i as u32;
            Some(Side {
                left,
                right,
                sheet: index / 2 + 1,
                front: index % 2 == 0,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_au_multiple_de_quatre() {
        assert_eq!(pad_to_multiple_of_four(0), 4);
        assert_eq!(pad_to_multiple_of_four(1), 4);
        assert_eq!(pad_to_multiple_of_four(4), 4);
        assert_eq!(pad_to_multiple_of_four(5), 8);
        assert_eq!(pad_to_multiple_of_four(6), 8);
        assert_eq!(pad_to_multiple_of_four(20), 20);
    }

    #[test]
    fn ordre_sur_quatre_pages() {
        // Attendu par l'enonce : [1-4][2-3], donc 4,1,2,3.
        assert_eq!(signature_order(4), vec![4, 1, 2, 3]);
        let sides = build_sides(4, Binding::Saddle);
        assert_eq!(sides.len(), 2);
        assert_eq!(sides[0].pages(), [4, 1]);
        assert_eq!(sides[0].sheet, 1);
        assert!(sides[0].front);
        assert_eq!(sides[1].pages(), [2, 3]);
        assert!(!sides[1].front);
    }

    #[test]
    fn ordre_sur_huit_pages() {
        assert_eq!(signature_order(8), vec![8, 1, 2, 7, 6, 3, 4, 5]);
        let sides = build_sides(8, Binding::Saddle);
        let pairs: Vec<[u32; 2]> = sides.iter().map(|s| s.pages()).collect();
        assert_eq!(pairs, vec![[8, 1], [2, 7], [6, 3], [4, 5]]);
        assert_eq!(
            sides.iter().map(|s| s.sheet).collect::<Vec<_>>(),
            vec![1, 1, 2, 2]
        );
    }

    #[test]
    fn ordre_sur_vingt_pages_comme_superprint() {
        // Le commentaire de `calculateImposition` donne cette suite.
        assert_eq!(
            signature_order(20),
            vec![20, 1, 2, 19, 18, 3, 4, 17, 16, 5, 6, 15, 14, 7, 8, 13, 12, 9, 10, 11]
        );
    }

    #[test]
    fn six_pages_ajoute_deux_blanches() {
        // 6 pages -> 8 sur la planche : les pages 7 et 8 n'existent pas.
        let sides = build_sides(6, Binding::Saddle);
        let pairs: Vec<[u32; 2]> = sides.iter().map(|s| s.pages()).collect();
        assert_eq!(pairs, vec![[8, 1], [2, 7], [6, 3], [4, 5]]);
        // Chaque face porte au moins une page reelle : elle doit etre imprimee.
        assert!(sides.iter().all(|s| s.has_content(6)));
        // Mais la page 8 n'existe pas : le cote gauche de la premiere face est blanc.
        assert_eq!(sides[0].left, 8);
        assert!(sides[0].left > 6, "cote gauche blanc sur la face [8|1]");
        assert_eq!(sides[1].right, 7);
        assert!(sides[1].right > 6, "cote droit blanc sur la face [2|7]");
    }

    #[test]
    fn dos_carre_colle_suit_lordre_du_document() {
        assert_eq!(sequential_order(4), vec![1, 2, 3, 4]);
        assert_eq!(sequential_order(6), vec![1, 2, 3, 4, 5, 6, 7, 8]);
        let sides = build_sides(4, Binding::Perfect);
        let pairs: Vec<[u32; 2]> = sides.iter().map(|s| s.pages()).collect();
        assert_eq!(pairs, vec![[1, 2], [3, 4]]);
    }

    #[test]
    fn codes_de_reliure() {
        assert_eq!(Binding::from_code(0), Binding::Saddle);
        assert_eq!(Binding::from_code(1), Binding::Perfect);
        assert_eq!(Binding::from_code(99), Binding::Saddle);
        assert_eq!(Binding::parse("perfect"), Binding::Perfect);
        assert_eq!(Binding::parse("saddle"), Binding::Saddle);
        assert_eq!(Binding::Perfect.code(), 1);
    }

    #[test]
    fn document_vide_reste_imposable() {
        let sides = build_sides(0, Binding::Saddle);
        assert_eq!(
            sides.len(),
            2,
            "un document vide occupe quand meme une feuille"
        );
    }
}
