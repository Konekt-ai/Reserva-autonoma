// sw.js — Service worker: hace que la app funcione sin conexión.
//
// Tras la primera visita, todo queda en caché: la app abre y procesa sin
// internet. Es lo que permite prometer "esto no depende de la nube".

const CACHE = 'reserva-autonoma-v1';

const ARCHIVOS_BASE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/ocr.js',
  './js/parsers.js',
  './js/format.js',
  './js/store.js',
  './manifest.webmanifest',
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ARCHIVOS_BASE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(
        claves.filter(c => c !== CACHE).map(c => caches.delete(c)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', evento => {
  const { request } = evento;
  if (request.method !== 'GET') return;

  // Caché primero: la app es estática y los modelos de OCR pesan bastante,
  // así que servirlos desde disco es lo correcto. La red solo es el respaldo.
  evento.respondWith(
    caches.match(request).then(enCache => {
      if (enCache) return enCache;

      return fetch(request).then(respuesta => {
        // Guardamos también lo que venga del CDN de Tesseract (modelos de
        // idioma y wasm): es lo que habilita el uso posterior sin internet.
        if (respuesta.ok && (respuesta.type === 'basic' || respuesta.type === 'cors')) {
          const copia = respuesta.clone();
          caches.open(CACHE).then(cache => cache.put(request, copia)).catch(() => {});
        }
        return respuesta;
      }).catch(() => {
        // Sin red y sin caché: para navegaciones devolvemos la página principal.
        if (request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Recurso no disponible sin conexión');
      });
    }),
  );
});
