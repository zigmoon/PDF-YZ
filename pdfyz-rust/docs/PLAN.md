# PDF-YZ — plan du noyau Rust

Ce document dit **ce qui est porté**, **ce qui ne l'est pas encore**, et
**pourquoi**. Il est mis à jour à chaque étape, comme `../agent.md` côté
application.

## Principe de découpage

Trois questions décident si du code a sa place ici :

1. **Est-ce du calcul ?** Une règle qui se décrit par une entrée et une sortie
   (« 8 pages → [8,1,2,7,6,3,4,5] ») a sa place ici. Une règle qui dépend du DOM
   (position d'une poignée, classe CSS d'un panneau) n'y a pas sa place.
2. **Est-ce vérifiable sans navigateur ?** Si oui, ici. Sinon, dans l'Astro.
3. **Est-ce que l'application peut s'en passer ?** Toujours oui : la frontière
   est optionnelle, le JavaScript reste le repli. C'est ce qui permet de porter
   domaine par domaine sans jamais bloquer une livraison.

## Étape 1 — terminée

### `pdfyz-core`

- `units` — `PT_PER_MM`, `mm_to_pt`, `pt_to_mm`, `px_to_pt`, `pt_to_px`,
  `unit_factor`. La règle « 96 px par pouce » est celle du CSS.
- `geometry` — `Point`, `Rect` (`from_points`, `intersects`, `union`,
  `translated`), `Matrix` (`multiply`, `invert`, `apply`) compatible avec la
  convention pdf.js `[a b c d e f]`, `fit_scale`, `fit_centered`.
- `color` — `to_channel` (fraction 0–1 ou octet : la règle qui évite un PDF
  noir), `to_hex`, `gray_hex`, `cmyk_hex`, `hex_to_rgb`, `shade_hex`,
  `contrast_ratio`, `modal_hex` (ordre d'insertion stable : la pastille
  « la plus utilisée » ne doit pas sauter d'un rendu à l'autre).
- `path` — `flatten_cubic`, `bounds`, `path_data`, `translate`,
  `total_length`. `path_data` reproduit `toFixed(2)` **sans** écrire `-0.00` :
  un `d` qui contient `-0.00` ne casse rien, mais deux tracés identiques
  cessent de se comparer.

### `pdfyz-impose`

- `signature` — l'ordre de cahier de SuperPrint, porté tel quel :
  `front = 1`, `back = n`, puis par feuille `(back, front)` au recto et
  `(front+1, back-1)` au verso. `pad_to_multiple_of_four` complète en pages
  blanches **sans jamais toucher le document de l'utilisateur** (c'était le
  défaut de la première version).
- `sheet` — formats nommés (A5…tabloïd), `Orientation`, `custom_sheet`,
  `auto_sheet` (2 × la page en cahier).
- `slots` — `SlotOrder` (gauche→droite, haut→bas, colonne, ligne) et
  `nup_slots`, gouttière comprise.
- `marks` — `crop_marks` : 8 segments (2 par coin), 12 pt de décalage et 4 pt de
  longueur par défaut.

### `pdfyz-model`

- `range` — `parse_page_range` : 0-based, trié, dédupliqué, borné.
- `session` — `session_id` (`doc:<nom minuscule>`), `display_name`,
  `imposed_name`.
- `graphic` — `js_round` (demi vers +∞, comme `Math.round`) et
  `graphic_signature`, la clé qui reconnaît un objet PDF peint deux fois.
- `zorder` — la pile CSS : `pdf-graphic` 1, `pdf-image` 2, texte extrait 3,
  objet utilisateur 4, texte utilisateur 5, note 6.

### `pdfyz-wasm`

20 fonctions exportées, toutes en `extern "C"`, toutes avec le protocole en
deux passes. Codes d'erreur `< -1_000_000` pour qu'un compte d'éléments ne
puisse jamais être pris pour une erreur.

## Étape 2 — à faire

| Piste | Pourquoi | Difficulté |
|---|---|---|
| Analyse de contenu PDF (`/Resources`, `/Font`, matrice de texte) | sortir `pdf.js` du chemin d'édition | élevée |
| Découpage de texte pour l'édition (séparation mots/lignes) | le point le plus fragile de l'édition de texte extrait | moyenne |
| Ré-encodage d'image (niveaux de gris, sous-échantillonnage) | export allégé | moyenne |
| Compression DEFLATE des flux produits | poids des PDF exportés | moyenne |
| Écriture PDF directe (remplacer `pdf-lib` pour les sorties simples) | supprimer une dépendance CDN | élevée |

## Ce qui ne viendra **pas** ici

- Le rendu (canvas, DOM, curseurs) : c'est le métier d'Astro.
- La persistance (IndexedDB, `localStorage`) : dépend du navigateur.
- Les décisions d'interface (quelle poignée à quel endroit).

## Discipline de parité

Chaque fonction portée arrive avec **deux** choses :

1. des tests `cargo test` qui fixent la règle côté Rust ;
2. une entrée dans `scripts/validate-wasm.mjs`, qui compare le module à
   l'implémentation JavaScript **recopiée dans le validateur** (et non importée
   de l'application : le validateur doit tourner seul).

Une divergence est un échec de build, pas une surprise en production.
