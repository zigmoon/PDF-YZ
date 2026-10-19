//! Couleurs : RVB, CMJN, hexadecimales, contraste et couleur modale.
//!
//! Toutes les regles viennent de l'application JavaScript et sont reproduites
//! **au bit pres**, parce que les deux implementations doivent donner le meme
//! resultat (le repli JavaScript et le noyau Rust coexistent, voir
//! `scripts/validate-wasm.mjs`) :
//!
//! * `toHex(values)` : une composante `<= 1` est une **fraction**, au-dela c'est
//!   une valeur 0-255. Les operateurs pdf.js rendent tantot l'un tantot l'autre.
//! * `cmykHex` : conversion naive `(1-c)(1-k)` — sans profil ICC, comme l'apercu.
//! * `shadeHex` : eclaircit vers le blanc ou assombrit vers le noir.

/// Couleur RVB, canaux entiers 0-255.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    #[inline]
    #[must_use]
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Hexadecimal `#rrggbb` en minuscules — la forme stockee dans le modele.
    #[must_use]
    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Luminance percue (Rec. 601), celle qu'utilise l'echantillonnage de texte.
    #[inline]
    #[must_use]
    pub fn luminance(self) -> f64 {
        0.299 * f64::from(self.r) + 0.587 * f64::from(self.g) + 0.114 * f64::from(self.b)
    }
}

/// Couleur CMJN, canaux 0.0-1.0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cmyk {
    pub c: f64,
    pub m: f64,
    pub y: f64,
    pub k: f64,
}

impl Cmyk {
    #[must_use]
    pub fn new(c: f64, m: f64, y: f64, k: f64) -> Self {
        Self {
            c: clamp_unit(c),
            m: clamp_unit(m),
            y: clamp_unit(y),
            k: clamp_unit(k),
        }
    }

    /// Conversion naive RVB (sans profil ICC) : celle de l'apercu et de
    /// l'extraction des objets vectoriels.
    #[must_use]
    pub fn to_rgb(self) -> Rgb {
        let f = |v: f64| to_channel((1.0 - v) * (1.0 - self.k));
        Rgb::new(f(self.c), f(self.m), f(self.y))
    }

    #[must_use]
    pub fn to_hex(self) -> String {
        self.to_rgb().to_hex()
    }
}

#[inline]
fn clamp_unit(v: f64) -> f64 {
    if v.is_nan() {
        0.0
    } else {
        v.clamp(0.0, 1.0)
    }
}

/// Convertit une composante « pdf.js » en octet.
///
/// Une valeur `<= 1` est une fraction (0-1) ; au-dela, c'est deja un octet.
/// C'est exactement la regle de `toHex` cote JavaScript — sans elle, un gris
/// `0.5` deviendrait `0.5` sur 255 au lieu de `128`.
#[must_use]
pub fn to_channel(value: f64) -> u8 {
    let numeric = if value.is_finite() { value } else { 0.0 };
    let scaled = if numeric <= 1.0 {
        numeric * 255.0
    } else {
        numeric
    };
    let rounded = scaled.round();
    if rounded <= 0.0 {
        0
    } else if rounded >= 255.0 {
        255
    } else {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let v = rounded as u8;
        v
    }
}

/// Hexadecimal a partir de trois composantes « pdf.js ».
#[must_use]
pub fn to_hex(values: [f64; 3]) -> String {
    Rgb::new(
        to_channel(values[0]),
        to_channel(values[1]),
        to_channel(values[2]),
    )
    .to_hex()
}

/// Gris (`OPS.setFillGray`) : une seule composante, repetee.
#[must_use]
pub fn gray_hex(value: f64) -> String {
    to_hex([value, value, value])
}

/// CMJN « pdf.js » en hexadecimal.
#[must_use]
pub fn cmyk_hex(values: [f64; 4]) -> String {
    Cmyk::new(values[0], values[1], values[2], values[3]).to_hex()
}

/// Analyse `#rgb`, `#rrggbb` (avec ou sans diese). `None` si illisible.
#[must_use]
pub fn hex_to_rgb(hex: &str) -> Option<Rgb> {
    let s = hex.trim().trim_start_matches('#');
    let digit = |c: u8| -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    };
    match s.len() {
        3 => {
            let b = s.as_bytes();
            let r = digit(b[0])?;
            let g = digit(b[1])?;
            let bl = digit(b[2])?;
            Some(Rgb::new(r * 17, g * 17, bl * 17))
        }
        6 => {
            let b = s.as_bytes();
            let pair = |i: usize| -> Option<u8> { Some(digit(b[i])? * 16 + digit(b[i + 1])?) };
            Some(Rgb::new(pair(0)?, pair(2)?, pair(4)?))
        }
        _ => None,
    }
}

/// Eclaircit (`amount > 0`) ou assombrit (`amount < 0`) une couleur.
///
/// Reproduit `shadeHex` : `v * (1 + amount)` vers le noir, `v + (255 - v) * amount`
/// vers le blanc. Une entree illisible est rendue **telle quelle** : mieux vaut
/// une couleur inchangee qu'une couleur inventee.
#[must_use]
pub fn shade_hex(hex: &str, amount: f64) -> String {
    let Some(rgb) = hex_to_rgb(hex) else {
        return hex.to_string();
    };
    let amount = if amount.is_finite() { amount } else { 0.0 };
    let channel = |v: u8| -> u8 {
        let v = f64::from(v);
        let t = if amount < 0.0 {
            v * (1.0 + amount)
        } else {
            v + (255.0 - v) * amount
        };
        let rounded = t.round();
        if rounded <= 0.0 {
            0
        } else if rounded >= 255.0 {
            255
        } else {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let out = rounded as u8;
            out
        }
    };
    Rgb::new(channel(rgb.r), channel(rgb.g), channel(rgb.b)).to_hex()
}

/// Rapport de contraste WCAG entre deux couleurs (1.0 a 21.0).
///
/// Sert a decider si un texte doit passer en clair sur un fond colore.
#[must_use]
pub fn contrast_ratio(a: Rgb, b: Rgb) -> f64 {
    fn relative_luminance(c: Rgb) -> f64 {
        let f = |v: u8| {
            let s = f64::from(v) / 255.0;
            if s <= 0.039_28 {
                s / 12.92
            } else {
                ((s + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    let la = relative_luminance(a);
    let lb = relative_luminance(b);
    let (hi, lo) = if la >= lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

/// Couleur la plus frequente d'un echantillon, dans l'ordre d'apparition.
///
/// C'est la regle de `sampleSurroundColor` : on sonde huit points autour de
/// l'objet et on garde la valeur majoritaire. En cas d'egalite, la premiere
/// rencontree gagne — le tri de `Map` en JavaScript est stable, donc ordonne par
/// insertion ; ignorer cet ordre ferait changer la couleur d'un masque d'un
/// navigateur a l'autre.
#[must_use]
pub fn modal_hex(hexes: &[String]) -> Option<String> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for hex in hexes {
        if hex.is_empty() {
            continue;
        }
        match counts.iter_mut().find(|(key, _)| key == hex) {
            Some((_, n)) => *n += 1,
            None => counts.push((hex.clone(), 1)),
        }
    }
    counts
        .into_iter()
        .fold(None::<(String, usize)>, |best, (hex, n)| match best {
            Some((_, bn)) if bn >= n => best,
            _ => Some((hex, n)),
        })
        .map(|(hex, _)| hex)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fraction_ou_octet() {
        // Regle exacte de `toHex`.
        assert_eq!(to_channel(0.0), 0);
        assert_eq!(to_channel(0.5), 128);
        assert_eq!(to_channel(1.0), 255);
        assert_eq!(to_channel(128.0), 128);
        assert_eq!(to_channel(300.0), 255);
        assert_eq!(to_channel(-4.0), 0);
        assert_eq!(to_channel(f64::NAN), 0);
    }

    #[test]
    fn hexadecimales_de_base() {
        assert_eq!(to_hex([0.0, 0.0, 0.0]), "#000000");
        assert_eq!(to_hex([1.0, 1.0, 1.0]), "#ffffff");
        assert_eq!(gray_hex(0.5), "#808080");
        assert_eq!(hex_to_rgb("#fff"), Some(Rgb::new(255, 255, 255)));
        assert_eq!(hex_to_rgb("1f4f78"), Some(Rgb::new(31, 79, 120)));
        assert_eq!(hex_to_rgb("#1F4F78"), Some(Rgb::new(31, 79, 120)));
        assert_eq!(hex_to_rgb("#12345"), None);
        assert_eq!(Rgb::new(31, 79, 120).to_hex(), "#1f4f78");
    }

    #[test]
    fn cmyk_naif() {
        // Cyan pur : (1-1)(1-0)=0 en rouge et vert, 1 en bleu.
        assert_eq!(cmyk_hex([1.0, 0.0, 0.0, 0.0]), "#00ffff");
        // Tout en noir.
        assert_eq!(cmyk_hex([0.0, 0.0, 0.0, 1.0]), "#000000");
        // Un 50 % de noir, sans encre.
        assert_eq!(cmyk_hex([0.0, 0.0, 0.0, 0.5]), "#808080");
        // Les valeurs hors bornes sont bornees, pas propagees.
        assert_eq!(cmyk_hex([2.0, -1.0, 0.0, 0.0]), "#00ffff");
    }

    #[test]
    fn eclaircir_et_assombrir() {
        assert_eq!(shade_hex("#808080", 0.0), "#808080");
        assert_eq!(shade_hex("#808080", 1.0), "#ffffff");
        assert_eq!(shade_hex("#808080", -1.0), "#000000");
        // 0x80 = 128 ; assombri de 14 % -> 110 = 0x6e (valeur de `shadeHex`).
        assert_eq!(shade_hex("#fff9c4", -0.14), "#dbd6a9");
        // Entree illisible : rendue telle quelle.
        assert_eq!(shade_hex("pas-une-couleur", -0.2), "pas-une-couleur");
    }

    #[test]
    fn contraste() {
        let noir = Rgb::new(0, 0, 0);
        let blanc = Rgb::new(255, 255, 255);
        assert!((contrast_ratio(noir, blanc) - 21.0).abs() < 0.01);
        assert!((contrast_ratio(blanc, blanc) - 1.0).abs() < 0.01);
    }

    #[test]
    fn couleur_modale_ordre_dinsertion() {
        let sample = [
            "#ffffff".to_string(),
            "#1f4f78".to_string(),
            "#ffffff".to_string(),
            "#1f4f78".to_string(),
            "#000000".to_string(),
        ];
        // Egalite 2-2 : la premiere apparue (#ffffff) gagne, comme le tri stable JS.
        assert_eq!(modal_hex(&sample).as_deref(), Some("#ffffff"));

        let sample2 = [
            "#1f4f78".to_string(),
            "#ffffff".to_string(),
            "#ffffff".to_string(),
        ];
        assert_eq!(modal_hex(&sample2).as_deref(), Some("#ffffff"));
        assert_eq!(modal_hex(&[]), None);
    }
}
