/**
 * Doable — service-worker.js
 * Cache-first strategy for the app shell.
 * Google OAuth / Calendar API requests are always passed through.
 */

const CACHE_NAME = 'doable-v1';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './googleCalendar.js',
  './favicon.svg',
  './manifest.json',
];

// Hostnames whose requests must never be intercepted
const PASSTHROUGH_HOSTS = [
  'accounts.google.com',
  'www.googleapis.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* ── Install: pre-cache the app shell ─────── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: delete old caches ─────────── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for same-origin ───── */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always pass through non-GET and external auth/API origins
  if (e.request.method !== 'GET') return;
  if (PASSTHROUGH_HOSTS.some((h) => url.hostname === h)) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request).then((res) => {
        // Only cache successful same-origin responses
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      });
    })
  );
});
