# PDF-YZ — noyau Rust

Refactorisation des **parties calculatoires** de PDF-YZ en **Rust**, compilé en
**WebAssembly** pour être appelé depuis l'application web.

> ⚠️ **Dossier indépendant.** Il ne modifie pas `../index.html` (la version
> classique, seule servie en production aujourd'hui). Ce fichier reste la
> **référence de comportement** : chaque fonction Rust est comparée à son
> équivalent JavaScript par `scripts/validate-wasm.mjs`.

## Pourquoi Rust

PDF-YZ est un éditeur PDF qui tourne **entièrement dans le navigateur**. Ses
calculs les plus fragiles sont aujourd'hui des fonctions JavaScript disséminées
dans un unique fichier de 11 400 lignes, sans test :

| Domaine | Aujourd'hui | Ici |
|---|---|---|
| Ordre d'imposition (cahier, dos carré) | `calculateImpositionOrder` | `pdfyz-impose::signature` ✅ |
| Positions de slots N-up, repères de coupe | `buildSlotPositions`, `drawCropMarks` | `pdfyz-impose::slots`, `marks` ✅ |
| Format de feuille auto, orientation | `getSheetSize` | `pdfyz-impose::sheet` ✅ |
| Bornes et `d` SVG d'un tracé extrait | `_viewSubpaths`, `pathData` | `pdfyz-core::path` ✅ |
| Couleurs (hex, CMJN, ombrage, modale) | `toHex`, `shadeHex`, `modalHex` | `pdfyz-core::color` ✅ |
| Conversions mm / pt / px | `mmToPt`, `ptToPx` | `pdfyz-core::units` ✅ |
| Plages de pages, identifiants de session | `parsePageRange`, `sessionId` | `pdfyz-model` ✅ |

Deux objectifs concrets : **déterminisme** (l'imposition est vérifiable page par
page, pas « à l'œil ») et **testabilité** (65 tests `cargo test`, aucun
navigateur requis).

## Règles du workspace

- **Zéro dépendance externe.** Aucun crate hors `std`. Pas de `wasm-bindgen`, pas
  de `serde` : la frontière JavaScript est une ABI C écrite à la main
  (`pz_alloc` / `pz_free`, protocole en deux passes).
- **`unsafe` à un seul endroit.** Les trois crates de calcul sont
  `#![forbid(unsafe_code)]` ; tout l'`unsafe` vit dans `pdfyz-wasm`.
- **Parité obligatoire.** Le repli JavaScript reste dans l'application : deux
  implémentations qui divergent en silence valent moins que zéro. D'où
  `scripts/validate-wasm.mjs`, qui rejoue 206 vérifications.

## Les quatre crates

| Crate | Rôle | Tests |
|---|---|---|
| `pdfyz-core` | Unités, géométrie, couleurs, tracés vectoriels | 21 |
| `pdfyz-impose` | Imposition : signatures, feuilles, slots, repères | 20 |
| `pdfyz-model` | Plages de pages, sessions, empreintes, ordre Z | 15 |
| `pdfyz-wasm` | La frontière C (cdylib), seul crate à produire un `.wasm` | 9 |

## Construire et vérifier

```powershell
# Tout : fmt, clippy, tests, build wasm, parité
pwsh -File scripts/check.ps1

# Juste le module + la parité
pwsh -File scripts/build-wasm.ps1
node scripts/validate-wasm.mjs
```

> **Pas de `cargo test` natif sur cette machine** — l'éditeur de liens MSVC
> (`link.exe`) n'est pas installé. Les tests tournent donc sous
> `wasm32-wasip1`, ce qui a l'avantage de tester exactement la cible déployée :
>
> ```powershell
> cargo test --workspace --target wasm32-wasip1
> ```

## Utilisation depuis le navigateur

```js
const core = await PdfyzCore.load();      // web/pdfyz-core.js
core.signatureOrder(8);                    // [8,1,2,7,6,3,4,5]
core.imposedSides(8, 0);                  // faces à imprimer
core.pathData(flatPoints, [5], 0, 0);     // "M10.00 20.00 L…"
```

`web/pdfyz-core.js` masque le protocole en deux passes, reconstruit
systématiquement ses vues typées (la mémoire WASM est **détachée** à chaque
allocation) et libère chaque bloc dans un `finally`. Il rend `backend: 'wasm'`
ou `'none'` : l'application peut toujours retomber sur son JavaScript.

Feuille de route et inventaire complet : `docs/PLAN.md`.
