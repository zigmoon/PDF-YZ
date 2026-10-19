# Rapport de tests — PDF-YZ (les 4 points non couverts par l'audit)

Date : 2026-10-04 · Tous les tests ont été exécutés dans un vrai navigateur (Chromium piloté).

---

## 1. Impression réelle

**Méthode** : interception de l'iframe d'impression créée par l'application, vérification de
l'appel à `contentWindow.print()`, puis contrôle du document envoyé à l'imprimante.

**Résultat : fonctionne.**
- `print()` appelé une fois, sans erreur ; le voyant de chargement est bien masqué.
- Le document envoyé à l'imprimante est valide : **8 pages, A4 (595,3 × 841,9 pt), 208 objets texte**.
- L'iframe est retirée après usage (pas de fuite).

**Défaut corrigé au passage** : le nettoyage de l'iframe était déclenché **5 secondes après**
l'ouverture de la boîte d'impression — donc pendant que l'utilisateur choisit encore ses
options. Il attend désormais l'événement `afterprint`, avec un filet de sécurité à 5 minutes.

**Limite** : je ne peux pas observer la boîte de dialogue d'impression elle-même dans cet
environnement. La sortie papier reste donc à confirmer par vous.

---

## 2. Signature et dessin au doigt (tablette)

**Méthode** : vrais événements tactiles injectés par le protocole de débogage Chromium
(`Input.dispatchTouchEvent` : touchStart / touchMove / touchEnd), écran 1024 × 768, émulation
tactile activée. On compte ensuite les pixels d'encre réellement dessinés.

**Résultat : fonctionne.**
- **Signature** : un tracé au doigt produit **783 pixels d'encre**, la signature est ajoutée
  à la page (177 → 178 éléments) et l'opération est annulable.
- **Dessin sur la page** : **788 pixels d'encre**, `touch-action: none` confirmé, et
  l'annulation efface intégralement le tracé (0 pixel restant).

**Conclusion** : le passage aux Pointer Events est validé. Le risque « dessin cassé sur
tablette » qui figurait dans `agent.md` est levé.

---

## 3. Ouverture du `.sp` dans SuperPrint

**Méthode** : les deux applications servies sur la même origine locale, `.sp` généré par
PDF-YZ (1,98 Mo) puis transmis à SuperPrint par **son propre canal d'import studio**
(`localStorage['sp213_import_sp']` + `?from=sp213`), puis vérification à l'intérieur de SuperPrint.

**Résultat : succès complet.**
- Nom du projet relu depuis nos métadonnées : `dossier_de_presse_superprint`.
- **8 pages créées** (16 canvas Fabric), bandeau de vignettes « Page 1 → Page 8 », pagination « 1/8 ».
- **4 polices réenregistrées** par SuperPrint : Bebas Neue, Lato, IBM Plex Sans, Open Sans
  (nos fichiers woff2 embarqués dans le `.sp`).
- Objets posés : `[SP] formes ajoutées : 61 (total 85)` sur la page 1.
- **Zéro erreur** console.
- La capture d'écran confirme la page A4 complète : bandeaux noirs, icône, et « SUPERPRINT.CC »
  composé dans la vraie Bebas Neue embarquée, page 2 en dessous.

**Défaut trouvé et corrigé pendant ce test** : en bas de page, « superprint.cc » et
« contact@superprint.cc » se coupaient sur deux lignes. Cause : les métriques des polices web
sont légèrement plus larges que celles du PDF d'origine, et la largeur du bloc texte était
reproduite au point près, ce qui forçait un retour à la ligne. Les blocs sont désormais 12 %
plus larges (le masque qui recouvre le texte d'origine est élargi d'autant). Nouvel import :
chaque texte tient sur une ligne.

**Précision** : pendant le test, la passerelle `localStorage` n'a été utilisable que parce que
les deux applications étaient servies depuis la même origine. En production, PDF-YZ télécharge
le fichier et l'utilisateur le dépose dans SuperPrint — c'est ce que fait le bandeau final.

---

## 4. Conformité PDF/A (avec un outil dédié)

**Outillage** : veraPDF, le validateur de référence, est une application Java et ne s'installe
ici que via un installateur interactif — écarté. J'ai utilisé **pdfcpu 0.16** (outil PDF en
ligne de commande, installé via winget) en **mode strict** (conformité PDF 32000-1:2008), plus
un contrôle ciblé des exigences PDF/A.

### Avant : l'export « PDF/A » n'était pas du PDF/A

| Exigence PDF/A | État initial |
|---|---|
| Identification `pdfaid:part` / `pdfaid:conformance` dans le XMP | ❌ **absente** — le fichier ne se déclarait nulle part |
| OutputIntent avec profil ICC embarqué | ❌ **aucun** (0 OutputIntent) |
| XMP cohérent avec le dictionnaire Info | ❌ incohérent → erreur du validateur strict |
| Toutes les polices embarquées | ✅ (mon premier contrôle avait un faux négatif sur les polices composites) |
| Version de base 1.7 | ✅ |

Autrement dit : le réglage « PDF/A » ne faisait qu'écrire les mots « PDF/A archival document »
dans les métadonnées textuelles. Aucun validateur ne l'aurait accepté.

### Corrections apportées

1. **XMP d'identification** : `pdfaid:part=2`, `pdfaid:conformance=B`, titre, auteur,
   langue, dates, producteur. Plus `/Lang` dans le catalogue.
2. **OutputIntent obligatoire** avec `S = GTS_PDFA1` et un profil ICC embarqué —
   repli automatique sur le profil sRGB généré par l'application quand l'utilisateur n'en a
   choisi aucun.
3. `/Lang` écrit comme **chaîne** (écrit comme un nom, c'est une violation de la spécification).
4. Les chaînes de l'OutputIntent (`OutputConditionIdentifier`, `RegistryName`, `Info`) sont
   maintenant de vraies chaînes — **ce bug affectait aussi l'insertion ICC normale** (PDF/X).
5. Dates du dictionnaire Info normalisées en `D:AAAAMMJJHHmmSS+HH'mm'` : la forme `…Z` produite
   par pdf-lib est rejetée par les validateurs stricts.

### Après : validation stricte réussie

```
pdfcpu validate --mode=strict  →  validation ok   (code de sortie 0)
```

Vérifié sur **l'export PDF/A** et sur **l'export standard** (aucune régression).

**Point cosmétique restant** : pdfcpu signale un tableau `/Annots []` vide sur chaque page
(hérité du PDF source, sans impact sur la validation).

**Portée de ce verdict** : pdfcpu strict vérifie la conformité à la norme PDF 1.7. Le contrôle
ciblé couvre les exigences PDF/A-2b structurantes (identification XMP, OutputIntent + ICC,
polices embarquées, absence de chiffrement / JavaScript / LZW). Pour un verdict formel
ISO 19005, il faut veraPDF — sur une machine avec Java :

```
verapdf --format text --flavour 2b mon_fichier_PDFA.pdf
```

---

## Récapitulatif

| Test | Résultat |
|---|---|
| Impression réelle | ✅ fonctionne (nettoyage de l'iframe sécurisé) |
| Signature au doigt | ✅ 783 px d'encre, signature ajoutée et annulable |
| Dessin au doigt | ✅ 788 px d'encre, annulation complète |
| `.sp` ouvert dans SuperPrint | ✅ 8 pages, 4 polices, 0 erreur (+ défaut de retour à la ligne corrigé) |
| PDF/A | ❌ au départ → ✅ après correction (`validation ok` en mode strict) |

**Défauts corrigés grâce à ces tests : 4** (nettoyage d'impression, retour à la ligne des blocs
texte dans le `.sp`, plus les 3 bugs PDF/A : XMP, OutputIntent/ICC, types et dates).
