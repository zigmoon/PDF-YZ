# Rapport d'audit — PDF-YZ

Date : 2026-10-04 · Méthode : analyse statique du code + tests automatisés dans un vrai navigateur

---

## 0. Méthode

- **Contrôle automatique de cohérence du DOM** (`_audit-dom.cjs`) : tous les identifiants
  référencés depuis le JavaScript existent-ils réellement dans le HTML ?
- **Test systématique** : 32 interactions enchaînées (boutons, panneaux, modales, outils)
  avec capture de toutes les erreurs JavaScript et des rejets de promesse non gérés.
- **Tests fonctionnels** : édition de texte, annuler/refaire, recherche/remplacement,
  export PDF, export `.sp`, fusion de documents, mode mobile, saturation du stockage.
- **Vérification croisée** : chaque résultat est recalculé indépendamment (par exemple la
  position d'un texte est comparée à celle calculée par pdf.js).

---

## 1. Ce qui est sain (vérifié, pas supposé)

| Vérification | Résultat |
|---|---|
| Identifiants DOM référencés mais inexistants | **0** sur 228 (aucun bouton mort par faute de frappe) |
| Identifiants dupliqués dans le HTML | 0 (hors gabarits `data-id`) |
| Erreurs JavaScript sur 32 interactions enchaînées | **0** |
| Ouverture/fermeture des 11 panneaux et modales | toutes correctes |
| Outils (sélection, texte, dessin, surlignage, gomme) | état actif correct à chaque clic |
| Menu « Annoter » | 4 entrées, ouverture/fermeture OK |
| Imposition | modale + aperçu rendu, fermeture OK |
| Zoom (boutons + ajustement) | 100 % → 115 % → 132 %, aucun bloc perdu |
| Annuler / Refaire sur une édition | **1 seul Ctrl+Z** suffit, granularité correcte |
| Accents, guillemets, chevrons, japonais, tabulations, multi-lignes | aller-retour parfait |
| Texte long (400 caractères) | mis en page et stocké correctement |
| Recherche / remplacement | 22 occurrences, annulable d'un coup |
| Fusion d'un PDF dans un PDF ouvert | 8 → 16 pages, 300 blocs |
| Export PDF avec typographie réelle | Bebas Neue, Lato, Oswald, Inter embarquées |
| Conversion `.sp` | géométrie exacte au 1/10 de point près |
| Échap | ferme recherche, préférences, aide clavier, modales |
| Stockage saturé | l'application ne plante pas, elle continue de fonctionner |
| Mode mobile (390 px) | barre d'outils mobile active, aucun débordement horizontal |

---

## 2. Défauts trouvés **et corrigés**

### D1 — La page se rechargeait toute seule, en pleine opération (critique)

`service-worker.js` active un nouveau worker, ce qui déclenche `controllerchange`, et
l'application appelait alors `window.location.reload()` **sans aucune action de
l'utilisateur**. C'est ce qui a interrompu un export pendant l'audit : document perdu,
150 blocs évaporés, historique vidé, retour à l'écran d'accueil.

Le bouton « Reload » du bandeau de mise à jour existe justement pour que l'utilisateur
choisisse le moment — le rechargement automatique le contournait.

**Correction** : le rechargement n'a lieu que si l'utilisateur a cliqué sur « Reload ».
Vérifié : après correction, plus aucun rechargement, même en redimensionnant la fenêtre.

### D2 — Un texte vidé laissait une zone invisible cliquable

Vider le contenu d'un bloc puis valider laissait dans la page une boîte vide, invisible,
mais qui captait toujours les clics et gagnait le test de sélection au clic. L'utilisateur
cliquait « dans le vide » et sélectionnait un objet fantôme.

**Correction** : le bloc est supprimé (avec message) et l'opération est annulable.
Le chemin d'édition en ligne est traité par le même code. L'état « vide » n'est plus
mémorisé dans l'historique : **un seul Ctrl+Z** ramène le texte d'origine (vérifié).

### D3 — Échap ne fermait pas la nouvelle modale `.sp`

Toutes les autres modales se fermaient avec Échap. La modale de conversion, non.
**Correction** : ajoutée au gestionnaire global. Le focus clavier est aussi placé dans
la boîte de dialogue à l'ouverture (elle est déclarée `aria-modal`).

### D4 — L'intention de conversion pouvait « fuiter »

Le bouton « Convertir en .sp » de la page d'accueil lève un drapeau, puis ouvre le
sélecteur de fichier. Si l'utilisateur **annulait** ce sélecteur, le drapeau restait armé :
le PDF suivant (déposé ou repris depuis une session) ouvrait la modale `.sp` sans raison.

**Correction** : le drapeau expire au bout de deux minutes et est explicitement levé.

### D5 — L'option « Embed fonts » ne faisait rien

`prefs.embedFonts` n'était lu que pour colorer le bouton dans les préférences. L'export
embarquait toujours les polices, quoi qu'affiche l'option.

**Correction** : implémentée. Vérifié en A/B sur le même bloc : option **décochée** →
le texte sort en Helvetica standard ; option **cochée** → il sort en Bebas Neue embarquée.

### D6 — L'échec de la sauvegarde automatique était silencieux

Stockage plein, navigation privée, quota dépassé : `saveElementsMeta()` échouait dans un
`console.warn` invisible pour l'utilisateur, qui continuait à travailler en croyant sa
session enregistrée — et perdait tout au rechargement.

**Correction** : message explicite invitant à exporter le PDF. Un seul message par série
d'échecs, réarmé dès qu'une sauvegarde réussit.

### D7 — Accessibilité et formatage

- `#exportModal` et `#kbdModal` n'avaient ni `role="dialog"` ni `aria-modal` ni libellé.
  Corrigé.
- Un retour à la ligne avait été avalé dans la boucle d'export (`for (...) { if (...)`)
  — sans conséquence fonctionnelle, corrigé.

---

## 3. Points ouverts — ils demandent votre décision

### O1 — Quatre réglages d'export sont purement décoratifs (le plus gênant)

> **RÉSOLU le 2026-10-04.** Les quatre réglages ont été implémentés : la résolution plafonne
> désormais la résolution des images raster de l'export, la compression et la qualité pilotent
> leur ré-échantillonnage / ré-encodage, et l'aplatissement reconstruit réellement le document
> en une image par page. L'aplatissement passe par défaut à **désactivé**, avec une migration
> unique pour les utilisateurs qui avaient l'ancien réglage inerte.
> Mesures : 595 Ko (aucune) → 431 Ko (légère) → 229 Ko (agressive) sur le même document ;
> 744 Ko à 300 dpi contre 431 Ko à 150 dpi ; aplatissement → 0 objet texte, fichier valide.
> Détails dans `RAPPORT-TESTS-2026-10-04.md`.

Dans toute la fonction d'export (lignes 6658 à 7075), **aucune** occurrence de `dpi`,
`imgQuality`, `compress`, `flatten` :

| Réglage | Où | Effet réel |
|---|---|---|
| Résolution 72/150/300/600 DPI | Dialogue d'export + Préférences | **aucun** |
| Image quality | Préférences | **aucun** |
| Compression | Préférences | **aucun** |
| Flatten annotations | Préférences | **aucun** |
| Embed fonts | Préférences | corrigé (voir D5) |

La raison : l'export écrit du contenu vectoriel et réutilise les images d'origine telles
quelles. Rien n'est ré-encodé, donc ces réglages n'ont rien sur quoi agir.

Trois solutions, par ordre de préférence :
1. **Les implémenter** : ré-encoder les images insérées (plafond en DPI, qualité JPEG,
   niveau de compression) et, pour « Flatten », rasteriser les pages. C'est un vrai
   chantier sur le chemin le plus critique — environ une demi-journée, avec tests.
2. **Les retirer de l'interface** : honnête, immédiat, sans risque. C'est ce que je
   recommande si vous ne voulez pas de cette fonctionnalité.
3. **Les neutraliser visuellement** (grisés + infobulle « bientôt disponible »).

Je n'ai rien touché : c'est un choix produit, pas un bug technique.

### O2 — PDF de plus de 10 Mo : reprise de session impossible, sans avertissement

`savePdfBytes()` sort silencieusement si le PDF dépasse 10 Mo. Les annotations sont bien
enregistrées, mais les octets du PDF ne le sont pas : la bannière « session précédente »
peut donc promettre une reprise qui échouera.

**Recommandation** : soit basculer sur IndexedDB (pas de limite de 10 Mo), soit avertir
qu'un document volumineux ne pourra pas être repris.

### O3 — PDF protégé : la protection est retirée sans le dire

`PDFDocument.load(bytes, { ignoreEncryption: true })` (3 endroits) ouvre un PDF chiffré
et le réenregistre **sans mot de passe ni restriction**. Aucun avertissement.

**Recommandation** : prévenir l'utilisateur, ou refuser l'ouverture d'un fichier protégé.

### O4 — Code mort (sans impact)

`prefs.detectImages` est déclaré et jamais utilisé. Les appels `pushUndo({type:'add',…})`
passent un argument désormais ignoré : inoffensif, l'instantané est bien pris.

### O5 — Libellés d'accessibilité des boutons de la barre d'outils

Ils reposent sur l'attribut `title` (utilisable par les lecteurs d'écran, mais moins
fiable qu'un `aria-label`). Amélioration mineure.

---

## 4. Ce que je n'ai pas pu tester

- **Impression réelle** (`window.print`) : non déclenchable dans un navigateur piloté.
  Le code est câblé (`#prefPrint` → `printPDF`) mais la sortie papier reste à valider.
- **Rendu dans SuperPrint** : le `.sp` produit est conforme au format et à la géométrie,
  mais l'ouverture réelle dans SuperPrint reste à confirmer par vous.
- **Signature manuscrite** au doigt / stylet : le code utilise les Pointer Events, la
  capture réelle sur tablette n'a pas été testée.
- **Export PDF/A validé par un outil de conformité** : les métadonnées sont posées, la
  conformité réelle (veraPDF) n'a pas été vérifiée.

---

## 5. Priorités recommandées

1. **Décider du sort des 4 réglages décoratifs** (O1) — c'est le seul point où
   l'interface promet quelque chose qu'elle ne fait pas.
2. **Traiter les PDF protégés** (O3) — question de confiance et de responsabilité.
3. **Documenter ou lever la limite des 10 Mo** (O2).
4. Valider l'impression et l'ouverture du `.sp` dans SuperPrint.
