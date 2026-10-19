/**
 * Thème jour / nuit.
 *
 * Le défaut est le JOUR. Ce module ne fait que trois choses : lire le choix
 * enregistré, le poser sur `<html data-theme="…">`, et basculer au clic.
 *
 * Pourquoi un module séparé plutôt que du code dans app.js : le thème n'a rien à
 * voir avec l'édition d'un PDF. Il s'applique avant qu'un document soit ouvert,
 * il doit pouvoir fonctionner alors que `app.js` est encore en train de se lier au
 * noyau Rust, et il ne dépend d'aucun état de l'éditeur. Le séparer, c'est aussi
 * rendre lisible d'un coup d'œil ce qui décide de l'apparence.
 *
 * Pourquoi `data-theme` sur `<html>` et non une classe sur la pré-accueil : la
 * demande était explicite — choisir le sombre depuis la pré-accueil doit
 * assombrir le logiciel entier. Un attribut sur la racine du document est le seul
 * endroit qui couvre à la fois la pré-accueil, la barre d'outils, les panneaux et
 * les modales, sans que rien n'ait à être prévenu.
 *
 * La clé est distincte de `pdfz-prefs` : ce dernier appartient à app.js, qui le
 * réécrit en bloc à chaque enregistrement. Deux clés, deux propriétaires, aucune
 * course possible.
 */

const KEY = 'pdfz-theme';
const root = document.documentElement;

/** Thème courant. `light` si rien n'a été choisi — le défaut demandé. */
function get() {
  return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Applique un thème sans le mémoriser. */
function apply(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);

  // `color-scheme` fait suivre les widgets natifs (barres de défilement,
  // sélecteurs de date, autofill) : sans lui, un champ natif reste blanc sur un
  // panneau sombre.
  root.style.colorScheme = next;

  const button = document.getElementById('themeToggle');
  if (button) {
    const dark = next === 'dark';
    // L'icône annonce ce vers quoi on bascule, pas l'état courant : en jour on
    // montre la lune. `aria-pressed` porte l'état, le libellé porte l'action.
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    button.title = button.getAttribute('aria-label');
  }

  // La barre du navigateur (mobile) et le cadre de la fenêtre suivent.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#0b0b0e' : '#f4f4f6');

  document.dispatchEvent(new CustomEvent('pdfyz:theme', { detail: { theme: next } }));
}

/** Applique un thème et le retient pour la prochaine ouverture. */
function set(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, next);
  } catch (_) {
    // Stockage refusé (navigation privée stricte) : le thème vaut pour la
    // session en cours, ce qui reste préférable à un clic sans effet.
  }
  apply(next);
}

function toggle() {
  set(get() === 'dark' ? 'light' : 'dark');
}

// Le script en tête de document a déjà posé l'attribut ; on le repose pour
// garantir l'état si le module est chargé seul (page de test, iframe).
apply(get());

const button = document.getElementById('themeToggle');
if (button) button.addEventListener('click', toggle);

// `P` puis `T` change le thème au clavier, hors champ de saisie. Le raccourci est
// volontairement à deux touches : une lettre seule entrerait en conflit avec les
// raccourcis de l'éditeur (sélection, outils).
document.addEventListener('keydown', (event) => {
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return;
  if (event.key !== 't' && event.key !== 'T') return;
  const target = event.target;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  event.preventDefault();
  toggle();
});

// Point d'entrée pour le reste de l'application (et pour les tests).
window.PdfyzTheme = { get, set, toggle };
