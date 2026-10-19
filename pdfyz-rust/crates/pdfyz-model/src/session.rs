//! Identifiant stable d'une session, et normalisation du nom de fichier.
//!
//! Une session est stockee sous une cle derivee du **nom du document**, pas de son
//! horodatage : deux ouvertures du meme fichier doivent ecraser la meme entree, pas
//! en creer une seconde. Le prefixe `doc:` evite qu'un nom de fichier ressemble a
//! une autre cle du stockage.

/// Nom de fichier de repli quand le document n'en a pas.
pub const DEFAULT_FILE_NAME: &str = "document.pdf";

/// Identifiant de session : `doc:` + nom nettoye en minuscules.
///
/// C'est exactement `_sessionId(name)` cote JavaScript :
/// `'doc:' + String(name || 'document.pdf').trim().toLowerCase()`.
#[must_use]
pub fn session_id(file_name: &str) -> String {
    let trimmed = file_name.trim();
    let base = if trimmed.is_empty() {
        DEFAULT_FILE_NAME
    } else {
        trimmed
    };
    format!("doc:{}", base.to_lowercase())
}

/// Normalise un nom de fichier pour l'affichage : jamais vide, jamais entoure
/// d'espaces.
#[must_use]
pub fn display_name(file_name: &str) -> String {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        DEFAULT_FILE_NAME.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Suffixe ajoute au nom exporte d'une imposition (`_booklet-saddle`, `_4up`…).
///
/// Le point de l'extension est cherche **en fin** de chaine : un fichier nomme
/// `rapport.v2` doit donner `rapport.v2_4up`, pas `rapport_4up`.
#[must_use]
pub fn imposed_name(file_name: &str, suffix: &str) -> String {
    let name = display_name(file_name);
    let lower = name.to_lowercase();
    if lower.ends_with(".pdf") {
        format!("{}{}.pdf", &name[..name.len() - 4], suffix)
    } else {
        format!("{name}{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiant_stable() {
        assert_eq!(session_id("Rapport.PDF"), "doc:rapport.pdf");
        assert_eq!(session_id("  affiche-A3.pdf "), "doc:affiche-a3.pdf");
        assert_eq!(session_id(""), "doc:document.pdf");
        assert_eq!(session_id("   "), "doc:document.pdf");
        // Deux graphies du meme fichier tombent sur la meme cle.
        assert_eq!(session_id("A.PDF"), session_id("a.pdf"));
    }

    #[test]
    fn nom_affiche() {
        assert_eq!(display_name("  x.pdf  "), "x.pdf");
        assert_eq!(display_name(""), "document.pdf");
    }

    #[test]
    fn suffixe_dimposition() {
        assert_eq!(imposed_name("test.pdf", "_4up"), "test_4up.pdf");
        assert_eq!(
            imposed_name("TEST.PDF", "_booklet-saddle"),
            "TEST_booklet-saddle.pdf"
        );
        // Pas d'extension .pdf : on ajoute le suffixe tel quel.
        assert_eq!(imposed_name("rapport.v2", "_4up"), "rapport.v2_4up");
        // Un nom vide prend le nom de repli, qui porte deja .pdf.
        assert_eq!(imposed_name("", "_4up"), "document_4up.pdf");
    }
}
