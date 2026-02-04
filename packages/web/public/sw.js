const CACHE_NAME = 'assistants-web-v3';
const STATIC_CACHE = 'assistants-static-v1';
const CORE_ASSETS = ['/', '/manifest.json', '/icon.svg', '/offline.html'];

// Assets to cache for offline use
const STATIC_PATTERNS = [
  /\/_next\/static\//,
  /\/fonts\//,
  /\/images\//,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== STATIC_CACHE) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Handle skip waiting message from UpdatePrompt
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API requests and WebSocket connections
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/ws')) {
    return;
  }

  // Handle navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          // Try to return cached version
          const cached = await caches.match(request);
          if (cached) return cached;
          // Fall back to offline page
          return caches.match('/offline.html');
        })
    );
    return;
  }

  // Handle static assets with cache-first strategy
  if (url.origin === self.location.origin) {
    const isStatic = STATIC_PATTERNS.some((pattern) => pattern.test(url.pathname));

    if (isStatic) {
      // Cache-first for static assets
      event.respondWith(
        caches.match(request).then((cached) => {
          if (cached) return cached;

          return fetch(request).then((response) => {
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(STATIC_CACHE).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          });
        })
      );
    } else {
      // Network-first for other same-origin requests
      event.respondWith(
        fetch(request)
          .then((response) => {
            // Don't cache non-2xx responses
            if (!response.ok) return response;

            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
            return response;
          })
          .catch(() => caches.match(request))
      );
    }
  }
});
