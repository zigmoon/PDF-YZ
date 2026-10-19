# Audit — Bouton « Convertir un PDF en .sp » (SuperPrint)

Date : 2026-10-04 · Statut : **audit terminé, aucun code écrit**

Objectif : depuis la home de PDF-YZ, proposer un bouton qui transforme le PDF
chargé en fichier `.sp` ouvrable dans l'app **SuperPrint**.

---

## 1. Verdict

**Oui, c'est faisable.** Confiance élevée, sans modification de SuperPrint.

Beaucoup plus simple que prévu : les objets d'un `.sp` sont exprimés dans
l'unité du PDF lui-même. Il n'y a donc **aucune conversion d'unité** à faire,
juste un miroir vertical sur les ordonnées.

| Niveau | Contenu du `.sp` | Difficulté | Fidélité |
|---|---|---|---|
| **A — image** | 1 image de page par page | Faible (½ journée) | Visuelle 100 %, texte non éditable |
| **B — image + texte** | idem + blocs de texte Fabric | Moyenne (2–3 jours) | Visuelle 100 % + texte éditable dans SuperPrint |

Recommandation : livrer **A** d'abord (visible, utile, risque quasi nul),
puis **B** si vous validez.

---

## 2. Le format `.sp` — ce qui est réellement exigé

Source : `superprint/app/JS/main.js`.

Le validateur du format (`_spValidateProjectFile`, ligne 92681) est **très
permissif**. Il exige seulement :

1. `_sp.format === 'SuperPrint Document'`
2. `document.format.width` et `.height` numériques > 0
3. `pages` : tableau non vide, chaque page ayant un tableau `objects`

```js
return !!(spFile && spFile._sp && spFile._sp.format === 'SuperPrint Document'
    && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    && Array.isArray(spFile.pages) && spFile.pages.length > 0
    && spFile.pages.every(page => page && Array.isArray(page.objects)));
```

Tout le reste (`meta`, `resources`, `textLinks`, `guides`, `masters`,
`numbering`, `styles`…) est **optionnel** : le lecteur met des valeurs par
défaut si la clé est absente.

### Squelette minimal valide

```json
{
  "_sp": { "format": "SuperPrint Document", "version": "1.0.0", "engine": "Fabric.js 5.3.0" },
  "meta": { "title": "mon-document" },
  "document": {
    "format": { "width": 210, "height": 297, "unit": "mm", "orientation": "portrait" },
    "margin": 0, "margins": { "top": 0, "bottom": 0, "inner": 0, "outer": 0, "left": 0, "right": 0 },
    "bleed": 0, "viewMode": "single", "colorMode": "rgb"
  },
  "resources": { "fonts": [], "colors": [], "spotInks": {}, "customFonts": [] },
  "textLinks": {},
  "pages": [ { "index": 0, "label": "Page 1", "masterId": null, "objects": [] } ]
}
```

`window.loadProjectSP(x)` accepte **une chaîne OU un objet JSON déjà parsé**
(ligne 92924 : `typeof fileContent === 'string' ? JSON.parse(...) : fileContent`).
SuperPrint utilise lui-même ce mécanisme en interne pour ses imports :
`saveProjectSP_toObject()` → on remplace 3 clés → `loadProjectSP(sp)`
(fonction `_spImportNouveauDocument`, ligne 40173). C'est exactement la
démarche d'un convertisseur.

---

## 3. Les 3 découvertes qui changent tout

### a. Les unités du `.sp` sont les **points PDF** (72 dpi)

```js
// ligne 13381
const mmToPx = (mm) => (mm * 72) / 25.4;
const pxToMm = (px) => (px * 25.4) / 72;
```

Un document A4 fait 210 mm de large, soit **595,28 dans `document.format.width`**,
et la zone Fabric correspondante mesure 595,28 px. Autrement dit : `format.width`
est en mm mais les coordonnées des objets sont en points.

Conséquence majeure : **les coordonnées d'un PDF sont directement
réutilisables**. Une page PDF 595,28 × 841,89 pt se place 1:1. Seul ajustement :
Fabric compte `top` **vers le bas**, le PDF vers le haut :

```
left_fabric = x_pdf
top_fabric  = hauteur_page_pt - y_pdf - hauteur_objet
```

C'est la conversion la plus simple imaginable — pas de facteur d'échelle, pas
de gestion de dpi.

### b. Les images acceptent une source en `data:` URL

SuperPrint hydrate déjà des images dont la source est posée après coup
(`_spAiImageUrl`, ligne 93031). Une image de page en PNG base64 suit le même
chemin : `{ "type": "image", "src": "data:image/png;base64,…", "left": …, "top": …, "scaleX": …, "scaleY": … }`.

### c. Les polices peuvent être embarquées dans le `.sp`

`resources.customFonts` = `[{ name, data (dataURL) }]`. SuperPrint les
ré-enregistre à l'ouverture (`_spRegisterCustomFontDataUrl`, ligne 93116).
C'est ce qui permettra au niveau B de transporter la typographie réelle du PDF
sans dépendre de Google Fonts côté SuperPrint.

---

## 4. Architecture proposée pour PDF-YZ

Réutilisation directe de ce qui existe déjà dans l'éditeur :

1. **Rendu** : pdf.js page par page → `canvas.toDataURL('image/png')`.
   Le code fait déjà cela pour `addImage` / l'imposition.
   Résolution conseillée : 150 dpi (≈ 2,08 px/pt) → bon compromis
   poids/qualité. 300 dpi réservé à une option « impression ».
2. **Format** : `width/height` = `page.getViewport({scale:1})` en points,
   convertis en mm pour `document.format` (`pt × 25.4 / 72`).
3. **Objet image** : `left = 0`, `top = 0`, `scaleX/scaleY` = `pagePt / imagePx`.
4. **Objet texte (niveau B)** : pour chaque bloc de `extractPageText`, un
   `textbox` Fabric avec `fontFamily`, `fontSize` (en points !), `fill`,
   `left/top` convertis. La police va dans `resources.fonts` (+ `customFonts`
   si on veut être autonome).
5. **Sortie** : `JSON.stringify(sp)` → `Blob` → `<a download>` avec l'extension
   `.sp`, exactement comme l'export PDF actuel.

Le bouton vit sur la home à côté de l'export, avec un libellé du type
« Convertir en .sp (SuperPrint) ».

---

## 5. Points de vigilance

| # | Sujet | Détail |
|---|---|---|
| 1 | **Poids du fichier** | 8 pages A4 en PNG 150 dpi ≈ 10–25 Mo de JSON (base64). Il faut un avertissement + un choix de résolution (72 / 150 dpi). JPEG = 5–10× plus léger mais sans transparence. |
| 2 | **Hors-couleur / fonds perdus** | Le PDF fournit un `TrimBox`/`BleedBox`. On sait les lire ; l'audit recommande de poser `bleed: 0` au départ, puis d'ajouter la gestion du fonds perdu en option. |
| 3 | **Texte = refonte, pas édition native** | Le PDF n'a pas de blocs de texte Fabric. Les blocs reconstruits seront approximatifs (lignes, césures, justification). D'où le conseil de livrer A d'abord. |
| 4 | **Polices absentes côté SuperPrint** | Le niveau B doit embarquer les TTF dans `customFonts`, sinon SuperPrint affichera un avertissement de police manquante. |
| 5 | **Pas de partage de `localStorage`** | PDF-YZ et SuperPrint sont sur des origines différentes : la passerelle `sp213_import_sp` + `?from=sp213` utilisée par le studio SP213 n'est **pas** réutilisable. Le seul canal honnête est le **téléchargement du fichier** (puis glisser-déposer dans SuperPrint). |
| 6 | **Ne pas charger `main.js` de SuperPrint** | 5,4 Mo, état global non isolé, écraserait la page. On n'écrit que du JSON : aucune dépendance à SuperPrint. |

---

## 6. Plan par étapes

**Étape 1 — Niveau A (recommandé pour démarrer)**
1. `pdfToSpObjects()` : rendu des pages + objets image.
2. `exportSP()` : construction du squelette + téléchargement.
3. Bouton sur la home + modale de choix de résolution.
4. Vérification : ouvrir le `.sp` dans SuperPrint, contrôler le nombre de pages
   et l'absence de décalage.

**Étape 2 — Niveau B (optionnel, sur validation)**
5. Injection des blocs de texte depuis `extractPageText` (déjà calculés à
   l'ouverture d'un PDF, donc coût marginal faible).
6. Embarquement des polices dans `customFonts`.
7. Test comparatif côte à côte.

**Étape 3 — Confort**
8. Gestion du fonds perdu / `TrimBox`.
9. Option JPEG + qualité.

---

## 7. Décision en attente

- [x] **Niveau B retenu et implémenté** (niveau A inclus comme option dans la modale).

---

## 8. Implémenté — 2026-10-04

Choix retenus (l'utilisateur n'étant pas disponible, les options recommandées ont été prises) :

| Point | Décision |
|---|---|
| Emplacement | Bouton sur la home **et** bouton flottant `#btnSpFixed` sous « Export PDF », plus une entrée du menu mobile |
| Déroulé | Le PDF s'ouvre dans l'éditeur (texte déjà extrait), puis la modale s'ouvre seule |
| Fin de parcours | Bandeau avec bouton « Ouvrir SuperPrint ↗ » |

Fonctions ajoutées : `openSpModal`, `closeSpModal`, `syncSpChoices`, `updateSpSummary`,
`convertToSP`, `showSpDone`, `spTextBlocksOf`, `spFabricFamily`, `spProbeBackground`,
`_abToBase64`, `_fontMime`.

### Vérifications faites sur `dossier_de_presse_superprint.pdf` (8 pages, A4)

- **Géométrie exacte** : le bloc `SUPERPRINT.cc` sort à `left = 108.7`, `top = 318.2`, alors que
  le calcul indépendant depuis pdf.js (item à `x = 108.7`, baseline `y = 464.8`, corps `73.6 pt`,
  page `841.89 pt`) donne `841.89 − 464.8 − 0.8 × 73.6 = 318.2`. Identique sur les deux axes.
- **Pixels** : `scaleX = 72 / dpi`. Mesuré `595.28 / 1240 = 0.4801` à 150 dpi et
  `595.28 / 794 = 0.7497` à 96 dpi. L'image de page est donc exactement à l'échelle des points PDF.
- **150 blocs de texte** convertis en 150 `textbox` + 150 rectangles de masque (`#ffffff`),
  8 images de page, 308 objets au total, 0 objet hors page.
- **Poids** : 1,9 Mo en PNG 150 dpi ; 794 Ko en JPEG 96 dpi (l'estimation affichée annonçait 1,0 Mo).
- **Polices** : IBM Plex Sans, Bebas Neue, Lato, Open Sans embarquées en woff2.
- Le `.sp` passe `_spValidateProjectFile` (contrôlé sur la structure produite).

### Limite connue

Les polices sont embarquées en **woff2** : SuperPrint les affiche (il enregistre une `FontFace`),
mais son `opentype.parse` — utilisé pour le « texte vectoriel » à l'export print — ne lit pas le woff2
et échoue silencieusement. Conséquence : le texte s'affiche correctement à l'écran, mais la
vectorisation des polices embarquées n'est pas disponible tant qu'on n'envoie pas du TTF.
