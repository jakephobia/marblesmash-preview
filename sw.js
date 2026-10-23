/* Marblesmash service worker: app shell + network-first runtime cache. */

const CACHE_PREFIX = 'marblesmash-';
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) {
              await cache.put(url, response);
            }
          } catch {
            // Un asset di shell mancante non deve bloccare l'installazione.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Le richieste non GET non entrano mai in cache.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.endsWith('/sw.js')) {
    return;
  }
  if (request.headers.has('range')) {
    return;
  }

  event.respondWith(networkFirst(event, request));
});

async function networkFirst(event, request) {
  const runtime = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      event.waitUntil(
        runtime.put(request, response.clone()).catch(() => {
          // Quota o cache non disponibile: la risposta di rete resta valida.
        }),
      );
    }
    return response;
  } catch (error) {
    const cached = await runtime.match(request);
    if (cached) {
      return cached;
    }

    if (request.mode === 'navigate') {
      const shell = (await caches.match('./index.html')) || (await caches.match('./'));
      if (shell) {
        return shell;
      }
    }

    throw error;
  }
}
