import { defineConfig } from 'astro/config';

/**
 * PDF-YZ — configuration Astro.
 *
 * L'application était un unique `index.html` servi tel quel sous
 * `https://app.zigmoon.com/PDF-YZ/`. Astro reprend la génération du document,
 * mais l'URL publiée ne doit pas bouger : d'où `base: '/PDF-YZ'` (les ressources
 * produites par Astro sont préfixées) et `build.format: 'preserve'`
 * (`src/pages/index.astro` → `dist/index.html`).
 *
 * Pour publier ailleurs, seul `base` change — les chemins du balisage historique
 * sont relatifs, et le service worker déduit sa portée de sa propre URL.
 */
export default defineConfig({
  site: 'https://app.zigmoon.com',
  base: '/PDF-YZ',
  srcDir: 'src',
  publicDir: 'public',
  outDir: 'dist',

  build: {
    // URL publiées conservées : /PDF-YZ/ et non /PDF-YZ/index.
    format: 'preserve',
    // La page embarque sa feuille dans le <head>, comme avant la migration.
    inlineStylesheets: 'always',
  },

  // Le balisage historique contient des commentaires de travail et un espacement
  // significatif dans les <pre> et les gabarits : on ne touche à rien.
  compressHTML: false,

  trailingSlash: 'ignore',

  devToolbar: { enabled: false },

  // 4321 est déjà pris par superprint_ASTRO sur cette machine.
  server: { host: true, port: 4322 },

  vite: {
    build: {
      // Le noyau WebAssembly (154 Ko) est servi depuis public/ : Vite ne doit
      // pas tenter de l'insérer en base64.
      assetsInlineLimit: 0,
      // La cascade CSS d'origine a été découpée en 16 tranches chargées dans
      // l'ordre : la minification d'esbuild la réécrirait.
      cssMinify: false,
      // Même règle pour le module de l'éditeur : le code livré reste celui
      // qu'on peut relire dans les sources (le poids est assumé, l'application
      // est déjà hors-ligne et charge pdf.js depuis un CDN).
      minify: false,
    },
  },
});
