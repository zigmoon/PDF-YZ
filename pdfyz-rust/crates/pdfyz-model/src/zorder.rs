//! Echelle de plans du calque d'edition.
//!
//! Les objets extraits d'un PDF et les objets ajoutes par l'utilisateur vivent dans
//! le meme calque DOM. Sans ordre explicite, un rectangle de fond opaque recupere
//! par l'extraction se place **au-dessus** du texte qu'il porte et avale les clics :
//! c'est le defaut d'origine de « on ne peut pas editer un texte sur un fond ».
//!
//! L'ordre ci-dessous est celui de la feuille de style ; il est ecrit ici pour que
//! le JavaScript et les tests partagent une seule source.

/// Nature d'un element du calque d'edition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    /// Objet vectoriel extrait du PDF (fond, filet, cadre, logo decompose).
    PdfGraphic,
    /// Image bitmap extraite du PDF.
    PdfImage,
    /// Bloc de texte extrait (zone de clic).
    ExtractedText,
    /// Image, signature ou trace ajoute par l'utilisateur.
    UserObject,
    /// Bloc de texte ajoute par l'utilisateur.
    UserText,
    /// Note autocollante.
    Note,
}

impl Layer {
    /// Depuis le type d'element du modele (`'pdf-graphic'`, `'text'`…) et son
    /// caractere extrait ou non.
    #[must_use]
    pub fn of(kind: &str, extracted: bool) -> Layer {
        match kind {
            "pdf-graphic" => Layer::PdfGraphic,
            "pdf-image" => Layer::PdfImage,
            "note" => Layer::Note,
            "text" => {
                if extracted {
                    Layer::ExtractedText
                } else {
                    Layer::UserText
                }
            }
            _ => Layer::UserObject,
        }
    }

    /// Rang dans la pile : plus grand = plus haut.
    #[must_use]
    pub fn z_index(self) -> u32 {
        match self {
            Layer::PdfGraphic => 1,
            Layer::PdfImage => 2,
            Layer::ExtractedText => 3,
            Layer::UserObject => 4,
            Layer::UserText => 5,
            Layer::Note => 6,
        }
    }
}

/// Rang dans la pile d'un element decrit par son type et son origine.
#[must_use]
pub fn z_index(kind: &str, extracted: bool) -> u32 {
    Layer::of(kind, extracted).z_index()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echelle_complete() {
        assert_eq!(z_index("pdf-graphic", true), 1);
        assert_eq!(z_index("pdf-image", true), 2);
        assert_eq!(z_index("text", true), 3);
        assert_eq!(z_index("image", false), 4);
        assert_eq!(z_index("signature", false), 4);
        assert_eq!(z_index("stroke", false), 4);
        assert_eq!(z_index("text", false), 5);
        assert_eq!(z_index("note", false), 6);
    }

    #[test]
    fn le_texte_extrait_reste_au_dessus_des_objets_extraits() {
        // La propriete a garantir : un fond extrait ne recouvre jamais son texte.
        assert!(z_index("text", true) > z_index("pdf-graphic", true));
        assert!(z_index("text", true) > z_index("pdf-image", true));
        // Et un texte ajoute reste au-dessus de tout ce qui vient du PDF.
        assert!(z_index("text", false) > z_index("text", true));
        // La note est le sommet du calque.
        for kind in ["pdf-graphic", "pdf-image", "image", "stroke", "signature"] {
            assert!(z_index("note", false) > z_index(kind, false));
        }
    }

    #[test]
    fn type_inconnu_traite_comme_objet_utilisateur() {
        assert_eq!(Layer::of("quelque-chose", false), Layer::UserObject);
        assert_eq!(z_index("quelque-chose", true), 4);
    }
}
