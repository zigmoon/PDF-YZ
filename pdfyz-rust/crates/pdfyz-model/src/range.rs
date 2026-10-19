//! Analyse de la plage de pages saisie dans le panneau d'imposition.
//!
//! La saisie accepte `1-4, 7, 10-12`. Les valeurs hors document sont **bornees**,
//! pas rejetees : une faute de frappe ne doit pas vider la selection et produire un
//! document de zero page.
//!
//! Le resultat est trie et sans doublon, en indices **0-based** — la forme attendue
//! par pdf-lib (`embedPdf(doc, [indices])`).

use std::collections::BTreeSet;

/// Extrait les indices de page (0-based) d'une saisie libre.
///
/// * `input` — la saisie, telle quelle ;
/// * `max_page` — nombre de pages du document (1-based).
///
/// Rend une liste triee, sans doublon, vide si rien n'est exploitable.
#[must_use]
pub fn parse_page_range(input: &str, max_page: usize) -> Vec<usize> {
    let mut pages: BTreeSet<usize> = BTreeSet::new();
    if max_page == 0 {
        return Vec::new();
    }
    for part in input.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = parse_span(part) {
            let start = a.max(1);
            let end = b.min(max_page);
            for p in start..=end {
                if p >= 1 && p <= max_page {
                    pages.insert(p - 1);
                }
            }
        } else if let Some(p) = parse_index(part) {
            if p >= 1 && p <= max_page {
                pages.insert(p - 1);
            }
        }
    }
    pages.into_iter().collect()
}

/// `12-34` (espaces tolerees autour du tiret) -> `(12, 34)`.
fn parse_span(part: &str) -> Option<(usize, usize)> {
    let mut pieces = part.split('-');
    let a = pieces.next()?.trim();
    let b = pieces.next()?.trim();
    if pieces.next().is_some() {
        return None;
    }
    Some((parse_index(a)?, parse_index(b)?))
}

/// Un entier decimal positif, sans signe ni separateur.
fn parse_index(text: &str) -> Option<usize> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse::<usize>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plage_simple() {
        assert_eq!(parse_page_range("1-4", 10), vec![0, 1, 2, 3]);
        assert_eq!(parse_page_range("3", 10), vec![2]);
        assert_eq!(
            parse_page_range("1-4, 7, 10-12", 12),
            vec![0, 1, 2, 3, 6, 9, 10, 11]
        );
    }

    #[test]
    fn espaces_et_ordre() {
        assert_eq!(parse_page_range(" 9 , 2 - 4 ", 10), vec![1, 2, 3, 8]);
        // Les doublons sont absorbes.
        assert_eq!(parse_page_range("1-3, 2, 3", 10), vec![0, 1, 2]);
    }

    #[test]
    fn bornes_du_document() {
        // 0 est borne a 1, 99 a max_page.
        assert_eq!(parse_page_range("0-2", 3), vec![0, 1]);
        assert_eq!(parse_page_range("2-99", 3), vec![1, 2]);
        // Hors bornes : rien.
        assert!(parse_page_range("50", 10).is_empty());
        assert!(parse_page_range("0", 10).is_empty());
        // Intervalle inverse : rien non plus (la boucle ne tourne pas).
        assert!(parse_page_range("5-2", 10).is_empty());
    }

    #[test]
    fn saisies_invalides() {
        assert!(parse_page_range("", 10).is_empty());
        assert!(parse_page_range("abc", 10).is_empty());
        assert!(parse_page_range("1-2-3", 10).is_empty());
        assert!(parse_page_range("-5", 10).is_empty());
        assert!(parse_page_range("1.5", 10).is_empty());
        // Un document vide n'a aucune page a rendre.
        assert!(parse_page_range("1-4", 0).is_empty());
    }

    #[test]
    fn melange_de_parts_invalides() {
        // La partie illisible est ignoree, le reste est retenu.
        assert_eq!(parse_page_range("abc, 3, x-y", 10), vec![2]);
    }
}
