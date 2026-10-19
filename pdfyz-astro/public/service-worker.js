// PDF-YZ — Service Worker (offline-first).
//
// Le worker vit à côté de la page (`./service-worker.js`), il en déduit donc sa
// portée. Plus aucun chemin n'est codé en dur : le même fichier fonctionne à la
// racine d'un domaine, sous `/PDF-YZ/` ou dans n'importe quel sous-dossier.
const BASE = new URL('./', self.location.href).pathname;
const CACHE_NAME = 'pdfyz-v41-livraison';
const PRECACHE_URLS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}favicon.svg`,
  `${BASE}logo-pdf-yz.svg`,
  `${BASE}icons/icon-32.png`,
  `${BASE}icons/icon-180.png`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
  `${BASE}donate-popin.js`,
  // Le noyau Rust et sa colle : sans eux l'application démarre, mais avec le
  // repli JavaScript pour tous les calculs (imposition, couleurs, tracés).
  `${BASE}pdfyz-core.js`,
  `${BASE}pdfyz_core.wasm`,
  // Plus aucune ressource distante : tout est servi depuis `vendor/`, produit par
  // tools/vendor-cdn.mjs. Les cartes CMap et les polices standard de pdf.js ne
  // sont PAS pré-cachées (1,9 Mo pour des documents qu'on n'ouvrira peut-être
  // jamais) : elles se mettent en cache à la première utilisation, ci-dessous.
  `${BASE}vendor/tailwind.js`,
  `${BASE}vendor/pdf-lib.min.js`,
  `${BASE}vendor/fontkit.umd.min.js`,
  `${BASE}vendor/pdfjs/pdf.min.mjs`,
  `${BASE}vendor/pdfjs/pdf.worker.min.mjs`,
  `${BASE}vendor/fonts/app.css`,
];

// Install : pré-cache tolérant (une ressource croisée indisponible ne doit pas
// faire échouer l'installation).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      ),
    ),
  );
});

// Activate : purge des anciens caches puis prise de contrôle.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Le document demande l'activation immédiate d'un worker en attente.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch : cache d'abord pour les ressources connues, réseau d'abord pour la
// navigation (une mise à jour du HTML doit être vue au premier rechargement).
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Web Share Target : le PDF partagé est déposé dans un cache, puis on
  // redirige vers l'application qui le récupère.
  if (request.method === 'POST' && url.pathname === BASE && url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        try {
          const formData = await request.formData();
          const file = formData.get('pdf');
          if (file && file.size) {
            const cache = await caches.open('pdfz-share');
            await cache.put(
              `${BASE}__shared__`,
              new Response(file, {
                headers: { 'Content-Type': file.type || 'application/pdf' },
              }),
            );
          }
        } catch (err) {
          // On avale : l'utilisateur doit atterrir dans l'application quoi qu'il arrive.
        }
        return Response.redirect(`${BASE}?share=1`, 303);
      })(),
    );
    return;
  }

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(`${BASE}index.html`);
        }),
    );
    return;
  }

  // Les paquets produits par Astro portent un empreinte dans leur nom : le
  // cache opportuniste suffit, et un nouveau déploiement change les URL.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            (response.type === 'basic' || response.type === 'cors')
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    }),
  );
});
