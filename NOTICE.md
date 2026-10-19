# NOTICE — composants tiers

PDF-YZ est un logiciel propriétaire (voir [LICENSE](LICENSE)). Il intègre ou
redistribue les composants ci-dessous, qui restent soumis à leurs propres licences.
En cas de contradiction, la licence du composant prévaut pour ce composant.

## Bibliothèques de l'application

| Composant | Version | Licence | Emplacement |
|---|---|---|---|
| [pdf-lib](https://pdf-lib.js.org/) | 1.17.1 | MIT | `pdfyz-astro/public/vendor/pdf-lib.min.js` |
| [pdf.js](https://mozilla.github.io/pdf.js/) | 4.9.155 | Apache-2.0 | `pdfyz-astro/public/vendor/pdfjs/` (module, worker, cmaps, polices standard) |
| [fontkit](https://github.com/foliojs/fontkit) (`@pdf-lib/fontkit`) | 1.1.1 | MIT | `pdfyz-astro/public/vendor/fontkit.umd.min.js` |
| [Tailwind CSS](https://tailwindcss.com/) (compilation navigateur) | Play CDN | MIT | `pdfyz-astro/public/vendor/tailwind.js` |

Ces fichiers ne sont pas chargés depuis un CDN à l'exécution : ils sont recopiés
localement par `pdfyz-astro/tools/vendor-cdn.mjs`, qui enregistre leur origine et
leur empreinte SHA-256 dans `pdfyz-astro/public/vendor/manifest.json`. La liste
complète des 219 fichiers vit dans ce manifeste.

## Polices

| Famille | Licence | Emplacement |
|---|---|---|
| Inter | SIL Open Font License 1.1 | `pdfyz-astro/public/vendor/fonts/` |
| Space Mono | SIL Open Font License 1.1 | `pdfyz-astro/public/vendor/fonts/` |
| IBM Plex Mono | SIL Open Font License 1.1 | `pdfyz-astro/public/vendor/fonts/` |

Les polices standard livrées avec pdf.js (`pdfjs/standard_fonts/`) relèvent de
licences distinctes, documentées dans ce dossier.

## Chaîne de compilation

| Composant | Licence | Rôle |
|---|---|---|
| [Rust](https://www.rust-lang.org/) / `rustc` | MIT ou Apache-2.0 | compile le noyau en WebAssembly |
| [Astro](https://astro.build/) | MIT | compile l'interface |
| [Tauri](https://tauri.app/) (`tauri`, `wry`, `tao`) | MIT ou Apache-2.0 | enveloppe de bureau |
| [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) | distribué par Microsoft | moteur d'affichage sous Windows |

Le noyau `pdfyz-rust` **n'a aucune dépendance externe** : son `Cargo.lock` ne
contient que les quatre crates du projet. C'est une contrainte volontaire, et non
un hasard — elle rend la chaîne de compilation auditable d'un seul coup d'œil.

## Marques

« PDF-YZ », « Zigmoon » et « 2.13 » sont des marques du Concédant. Les noms et
logos des composants tiers appartiennent à leurs détenteurs respectifs et ne sont
cités qu'à titre d'identification.
