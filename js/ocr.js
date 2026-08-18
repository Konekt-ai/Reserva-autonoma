// ocr.js — Reconocimiento de texto 100% local, dentro del navegador.
//
// Usa Tesseract compilado a WebAssembly: la imagen nunca sale del dispositivo,
// no hay servidor, no hay API key y no hay costo por uso. El preprocesado en
// canvas es lo que más sube la precisión — una foto de celular sin tratar da
// resultados notablemente peores que la misma imagen normalizada.

const TAMANO_MAXIMO = 1800; // px en el lado largo; más allá el OCR no mejora y sí tarda

const CDN_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let workerPromise = null;
let usandoLocal = false;

/** Inserta un <script> y espera a que cargue. */
function cargarScript(url) {
  return new Promise((resolver, rechazar) => {
    const etiqueta = document.createElement('script');
    etiqueta.src = url;
    etiqueta.onload = resolver;
    etiqueta.onerror = () => {
      etiqueta.remove();
      rechazar(new Error(`No se pudo cargar ${url}`));
    };
    document.head.append(etiqueta);
  });
}

/**
 * Carga la librería de OCR. Prefiere la copia local en vendor/ (ver
 * `npm run vendorizar`): con ella la app no contacta ningún servidor externo,
 * nunca. Si no está, cae al CDN, que el service worker guarda en caché para
 * que a partir del segundo uso tampoco haga falta internet.
 */
async function cargarLibreria() {
  if (typeof Tesseract !== 'undefined') return;
  try {
    await cargarScript('vendor/tesseract.min.js');
    usandoLocal = true;
  } catch {
    await cargarScript(CDN_TESSERACT);
  }
}

/** Indica si el OCR corre con los archivos locales (sin depender del CDN). */
export function esLocalCompleto() {
  return usandoLocal;
}

/**
 * Crea (una sola vez) el worker de Tesseract. Inicializarlo cuesta varios
 * segundos y carga los modelos de idioma, así que lo reutilizamos durante
 * toda la sesión.
 */
export async function obtenerWorker(alProgresar = () => {}) {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    try {
      await cargarLibreria();
    } catch {
      throw new Error(
        'No se pudo cargar el motor de lectura. Conéctate a internet solo la ' +
        'primera vez, o ejecuta "npm run vendorizar" para dejarlo instalado.',
      );
    }

    const opciones = {
      logger: m => {
        if (m.status === 'recognizing text') alProgresar(m.progress, 'Leyendo texto');
        else if (m.status?.includes('loading')) alProgresar(m.progress, 'Preparando el motor');
      },
    };

    // Con la copia local apuntamos todas las rutas a vendor/ para que ni el
    // worker ni el wasm ni los idiomas salgan a la red.
    if (usandoLocal) {
      opciones.workerPath = 'vendor/worker.min.js';
      opciones.corePath = 'vendor/';
      opciones.langPath = 'vendor/lang';
    }

    // Español primero: las credenciales mexicanas están en español, pero el
    // inglés ayuda con la MRZ de pasaportes y con placas alfanuméricas.
    return Tesseract.createWorker(['spa', 'eng'], 1, opciones);
  })();

  return workerPromise;
}

/** Libera el worker. Útil al cerrar la app o si el usuario lo pide. */
export async function liberarWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}

// ---------------------------------------------------------------------------
// Preprocesado de imagen
// ---------------------------------------------------------------------------

/**
 * Carga un File/Blob en un canvas, respetando la orientación EXIF (las fotos
 * de celular suelen venir rotadas) y limitando el tamaño.
 */
export async function imagenACanvas(archivo, rotacionGrados = 0) {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });

  const escala = Math.min(1, TAMANO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  // Con 90° o 270° el lienzo intercambia sus dimensiones.
  const giroImpar = rotacionGrados % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = giroImpar ? alto : ancho;
  canvas.height = giroImpar ? ancho : alto;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotacionGrados * Math.PI) / 180);
  ctx.drawImage(bitmap, -ancho / 2, -alto / 2, ancho, alto);
  bitmap.close();

  return canvas;
}

/**
 * Convierte a escala de grises y estira el contraste al rango completo.
 * Es el paso que más mejora el OCR en fotos de celular mal iluminadas.
 */
export function normalizarContraste(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  // Primera pasada: gris (luma ponderada) y búsqueda de extremos.
  const grises = new Uint8ClampedArray(d.length / 4);
  let min = 255, max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    grises[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  // Segunda pasada: expandimos [min,max] a [0,255].
  const rango = Math.max(1, max - min);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = ((grises[p] - min) * 255) / rango;
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Binariza con el método de Otsu (umbral global óptimo). Ayuda cuando la
 * iluminación es pareja; con sombras fuertes puede perjudicar, por eso es
 * opcional y la UI ofrece reintentar sin ella.
 */
export function binarizarOtsu(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  const histograma = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) histograma[d[i]]++;

  const total = d.length / 4;
  let sumaTotal = 0;
  for (let t = 0; t < 256; t++) sumaTotal += t * histograma[t];

  let sumaFondo = 0, pesoFondo = 0, varianzaMaxima = 0, umbral = 127;
  for (let t = 0; t < 256; t++) {
    pesoFondo += histograma[t];
    if (pesoFondo === 0) continue;
    const pesoFrente = total - pesoFondo;
    if (pesoFrente === 0) break;

    sumaFondo += t * histograma[t];
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (sumaTotal - sumaFondo) / pesoFrente;
    const varianza = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;

    if (varianza > varianzaMaxima) {
      varianzaMaxima = varianza;
      umbral = t;
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > umbral ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Reconocimiento
// ---------------------------------------------------------------------------

/**
 * Ejecuta el OCR sobre una imagen. Prueba primero con contraste normalizado y,
 * si el resultado sale con poca confianza, reintenta binarizando: son dos
 * preprocesados que fallan en situaciones distintas, así que uno suele
 * rescatar lo que el otro no pudo leer.
 *
 * @returns {Promise<{texto: string, confianza: number, canvas: HTMLCanvasElement}>}
 */
export async function reconocer(archivo, { rotacion = 0, alProgresar = () => {} } = {}) {
  const worker = await obtenerWorker(alProgresar);

  const canvas = normalizarContraste(await imagenACanvas(archivo, rotacion));
  const primera = await worker.recognize(canvas);

  let mejor = { texto: primera.data.text, confianza: primera.data.confidence, canvas };

  if (mejor.confianza < 70) {
    alProgresar(0, 'Reintentando con otro filtro');
    const canvasBin = binarizarOtsu(await imagenACanvas(archivo, rotacion));
    const segunda = await worker.recognize(canvasBin);
    if (segunda.data.confidence > mejor.confianza) {
      mejor = { texto: segunda.data.text, confianza: segunda.data.confidence, canvas: canvasBin };
    }
  }

  return mejor;
}

/**
 * Procesa varias imágenes (por ejemplo, INE por un lado y foto de las placas
 * por otro) y concatena el texto para que el analizador las considere juntas.
 *
 * @param {Array<{archivo: Blob, rotacion?: number}>} imagenes
 */
export async function reconocerVarias(imagenes, { alProgresar = () => {} } = {}) {
  const partes = [];
  let confianzaTotal = 0;

  for (let i = 0; i < imagenes.length; i++) {
    const etiqueta = imagenes.length > 1 ? `Imagen ${i + 1} de ${imagenes.length}` : '';
    const r = await reconocer(imagenes[i].archivo, {
      rotacion: imagenes[i].rotacion || 0,
      alProgresar: (p, estado) => alProgresar(p, etiqueta ? `${etiqueta} — ${estado}` : estado),
    });
    partes.push(r.texto);
    confianzaTotal += r.confianza;
  }

  return {
    texto: partes.join('\n'),
    confianza: imagenes.length ? confianzaTotal / imagenes.length : 0,
  };
}
