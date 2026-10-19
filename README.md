# PDF-YZ

Éditeur PDF qui tourne entièrement dans la machine de l'utilisateur : sélection et
retouche des objets d'une page, texte, images, annotations, imposition, export.
Aucun fichier n'est envoyé nulle part — le site comme l'application de bureau
fonctionnent hors connexion.

Le projet se présente en **trois dossiers** et deux chaînes de compilation :

| Dossier | Rôle | Produit |
|---|---|---|
| [`pdfyz-rust/`](pdfyz-rust/) | Le noyau de calcul, en Rust sans dépendance externe : géométrie, couleurs, imposition, ordre d'empilement, sessions. Compilé en **WebAssembly**. | `pdfyz_core.wasm` (~155 Ko) |
| [`pdfyz-astro/`](pdfyz-astro/) | L'interface, en **Astro** : 16 feuilles de style, 19 composants, une page. L'éditeur lui-même est un module JavaScript conservé tel quel de la version d'origine. | `dist/` (site statique) |
| [`pdfyz-desktop/`](pdfyz-desktop/) | L'enveloppe **Tauri 2** qui transforme ce site en application Windows, macOS et Linux. | `.exe` / `.msi`, `.app` / `.dmg`, `.AppImage` / `.deb` |

`index.html`, à la racine, est la **version d'origine en un seul fichier**. Elle n'est
plus modifiée : elle sert de référence de comportement et de source au découpage
automatique (`pdfyz-astro/tools/split-legacy.mjs`). Le site à déployer est `pdfyz-astro/dist/`.

---

## 1. Pourquoi un noyau en Rust
Les règles qui décident de ce qu'un utilisateur voit — où tombe une page dans un
cahier imposé, quelle couleur donne un mélange, quel objet passe devant quel autre —
sont difficiles à écrire deux fois de la même façon. Elles sont donc écrites **une
fois**, en Rust, et le WebAssembly devient la seule implémentation qui fait foi.

Le JavaScript garde une implémentation de repli : si le module ne charge pas, rien
ne casse. Cette double implémentation n'est tenable que parce qu'elle est
**vérifiée** : `pdfyz-rust/scripts/validate-wasm.mjs` rejoue les mêmes cas sur les
deux chemins et compare les résultats (206 vérifications). Un désaccord fait échouer
la vérification, il ne se découvre pas en production.

## 2. Construire et vérifier

Prérequis : **Node 22+** et **Rust stable**. La cible `wasm32-unknown-unknown` sert
au module livré, `wasm32-wasip1` aux tests. L'image de partage et les icônes PNG
demandent `sharp` (dépendance de développement, déjà dans `package.json`).

```bash
# Noyau : formatage, lint, tests, module, parité
cd pdfyz-rust
pwsh -File scripts/check.ps1        # Windows
# ou, système par système :
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --target wasm32-wasip1
node scripts/build-wasm.mjs

# Interface
cd pdfyz-astro
npm ci
npm run vendor        # récupère pdf.js, pdf-lib, fontkit, Tailwind et les polices
npm run dev           # http://127.0.0.1:4322/PDF-YZ/
npm run check         # typage des .astro
npm run build         # -> dist/
```

Les tests Rust tournent dans la cible livrée, pas en natif : ce qui part chez
l'utilisateur est du WebAssembly, et un test natif ne prouverait rien sur lui.

## 3. Application de bureau

```bash
cd pdfyz-desktop
npm ci
npx tauri dev         # fenêtre de développement
npx tauri build       # installeurs pour le système courant
```

`beforeBuildCommand` exécute `scripts/prepare-bundle.mjs`, qui enchaîne : noyau
WebAssembly → build Astro avec `--base /` → copie dans `frontend/`, le dossier
embarqué dans le binaire. Trois contrôles de sortie y échouent franchement plutôt
que de produire une fenêtre blanche (aucune ressource distante, noyau présent, wasm
embarqué).

### Compiler sans Visual Studio (Windows, MinGW)

Une chaîne LLVM-MinGW suffit, à condition d'utiliser la distribution Rust
`x86_64-pc-windows-gnullvm` :

```bash
rustup toolchain install stable-x86_64-pc-windows-gnullvm
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-gnullvm
pwsh -File scripts/build-windows-gnullvm.ps1
```

Le script lie `libunwind` statiquement et embarque `WebView2Loader.dll` (que la
chaîne MSVC, elle, lie statiquement). Le résultat atterrit dans `dist-windows/`.

### Les installeurs sont produits par GitHub Actions

| Workflow | Ce qu'il fait |
|---|---|
| [`.github/workflows/verifier.yml`](.github/workflows/verifier.yml) | À chaque `push` : formatage, clippy, tests, module + parité, puis `astro check` et `astro build`. |
| [`.github/workflows/bureau.yml`](.github/workflows/bureau.yml) | Sur étiquette `v*` ou manuellement : compile les quatre lots (Windows x64, macOS Intel, macOS ARM, Linux x64) et les publie dans une *release*. |

Les binaires ne sont **ni signés ni notarisés** : Windows SmartScreen et Gatekeeper
affichent un avertissement au premier lancement. Voir
[`.github/release-notes-desktop.md`](.github/release-notes-desktop.md).

## 4. La règle hors-ligne

L'application ne doit **jamais** dépendre du réseau à l'exécution. Deux conséquences,
qu'il faut respecter en modifiant le projet :

- Toute bibliothèque tierce est **recopiée localement** par
  `pdfyz-astro/tools/vendor-cdn.mjs` dans `public/vendor/` (5,6 Mo, 219 fichiers,
  empreintes SHA-256 dans `manifest.json`). Un second build ne télécharge rien.
- Un *service worker* ne suffirait pas : il ne s'enregistre pas dans une webview
  Tauri. La mise en cache à la première visite laisserait l'application de bureau
  muette hors connexion.

**L'unique exception, énoncée clairement :** le sélecteur de polices du panneau
texte propose des familles Google (Roboto, Lato…) qui ne sont pas embarquées.
En choisir une télécharge cette police **une fois**, à la demande, pour l'incorporer
au PDF exporté. L'éditeur fonctionne sans, et le message d'échec nomme la police au
lieu d'échouer en silence. `tools/verifie-livraison.mjs` tolère cette URL et échoue
sur toute autre.

Vérification : charger l'application réseau coupé, puis contrôler que
`performance.getEntriesByType('resource')` ne contient aucune URL distante.

## 5. Documentation

- [`agent.md`](agent.md) — guide de travail : structure, règles d'imposition, ordre
  d'empilement, couleur, cache, liste de contrôle avant livraison.
- [`pdfyz-rust/docs/PLAN.md`](pdfyz-rust/docs/PLAN.md) — découpage du noyau et
  contrat de l'interface C.
- [`pdfyz-rust/README.md`](pdfyz-rust/README.md) — le noyau crate par crate.

## Licence

Propriétaire — voir [LICENSE](LICENSE). Les composants tiers conservent leurs
propres licences : voir [NOTICE.md](NOTICE.md).
