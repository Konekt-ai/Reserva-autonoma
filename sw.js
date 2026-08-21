// sw.js — Service worker: hace que la app funcione sin conexión.
//
// Tras la primera visita, todo queda en caché: la app abre y procesa sin
// internet. Es lo que permite prometer "esto no depende de la nube".
//
// La estrategia es distinta según el tipo de archivo, y esa distinción importa:
// los binarios del motor de OCR pesan megabytes y no cambian nunca, mientras
// que los archivos de la aplicación sí se actualizan y una versión vieja
// atorada en el caché es un error muy difícil de diagnosticar para quien la usa.

const CACHE = 'reserva-autonoma-v2';

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

/** ¿Es un binario del motor de OCR? Pesan mucho y nunca cambian. */
function esInmutable(url) {
  return url.pathname.includes('/vendor/')
    || url.hostname.endsWith('jsdelivr.net')
    || url.hostname.endsWith('projectnaptha.com');
}

/** Caché primero: para lo que no cambia, evita descargar megabytes de más. */
async function cachePrimero(request) {
  const enCache = await caches.match(request);
  if (enCache) return enCache;

  const respuesta = await fetch(request);
  if (respuesta.ok && (respuesta.type === 'basic' || respuesta.type === 'cors')) {
    const cache = await caches.open(CACHE);
    cache.put(request, respuesta.clone()).catch(() => {});
  }
  return respuesta;
}

/**
 * Red primero: para los archivos de la aplicación. Así una versión nueva llega
 * en cuanto hay señal, y el caché queda solo como respaldo para cuando no la hay.
 */
async function redPrimero(request) {
  try {
    const respuesta = await fetch(request);
    if (respuesta.ok && respuesta.type === 'basic') {
      const cache = await caches.open(CACHE);
      cache.put(request, respuesta.clone()).catch(() => {});
    }
    return respuesta;
  } catch (error) {
    const enCache = await caches.match(request);
    if (enCache) return enCache;
    // Sin red y sin caché: para navegaciones devolvemos la página principal.
    if (request.mode === 'navigate') {
      const inicio = await caches.match('./index.html');
      if (inicio) return inicio;
    }
    throw error;
  }
}

self.addEventListener('fetch', evento => {
  const { request } = evento;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  evento.respondWith(esInmutable(url) ? cachePrimero(request) : redPrimero(request));
});
