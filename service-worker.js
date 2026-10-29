// PDF-YZ Service Worker — Offline-first PWA
const CACHE_NAME = 'pdfyz-v37-image-fantome';
const PRECACHE_URLS = [
  '/PDF-YZ/',
  '/PDF-YZ/index.html',
  '/PDF-YZ/manifest.webmanifest',
  '/PDF-YZ/favicon.svg',
  '/PDF-YZ/logo-pdf-yz.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdn.tailwindcss.com',
];

// Install: pre-cache core assets (tolerant to individual failures on cross-origin)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    )
  );
});

// Activate: clean old caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow page to trigger immediate activation of a waiting worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: cache-first for known assets, network-first for navigation
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Web Share Target POST → stash the shared PDF in a cache, then redirect to /?share=1
  if (request.method === 'POST' && url.pathname === '/PDF-YZ/' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const formData = await request.formData();
        const file = formData.get('pdf');
        if (file && file.size) {
          const cache = await caches.open('pdfz-share');
          await cache.put(
            '/PDF-YZ/__shared__',
            new Response(file, { headers: { 'Content-Type': file.type || 'application/pdf' } })
          );
        }
      } catch (err) {
        // swallow — we still want to land on the app
      }
      return Response.redirect('/PDF-YZ/?share=1', 303);
    })());
    return;
  }

  // Skip non-GET below
  if (request.method !== 'GET') return;

  // Navigation requests: network-first with offline fallback
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
          return cached || caches.match('/PDF-YZ/index.html');
        })
    );
    return;
  }

  // Other requests: cache-first, then network with opportunistic caching
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 &&
            (response.type === 'basic' || response.type === 'cors')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
