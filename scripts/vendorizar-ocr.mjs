// vendorizar-ocr.mjs — Descarga el motor de OCR a vendor/ para operar sin red.
//
// Se corre UNA vez. A partir de ahí la aplicación no contacta ningún servidor
// externo: ni CDN, ni modelos de idioma, ni nada. Es lo que permite garantizar
// que la foto de una identificación nunca sale del equipo.
//
// Uso: node scripts/vendorizar-ocr.mjs

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(RAIZ, 'vendor');

const VERSION_JS = '5';
const VERSION_CORE = '5';
const VERSION_TESSDATA = '4.0.0';

const ARCHIVOS = [
  // Librería principal y worker.
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION_JS}/dist/tesseract.min.js`, destino: 'tesseract.min.js' },
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION_JS}/dist/worker.min.js`, destino: 'worker.min.js' },

  // Núcleo WebAssembly. Tesseract elige en tiempo de ejecución según lo que
  // soporte el navegador, así que se necesitan las cuatro variantes.
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${VERSION_CORE}/tesseract-core.wasm.js`, destino: 'tesseract-core.wasm.js' },
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${VERSION_CORE}/tesseract-core-simd.wasm.js`, destino: 'tesseract-core-simd.wasm.js' },
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${VERSION_CORE}/tesseract-core-lstm.wasm.js`, destino: 'tesseract-core-lstm.wasm.js' },
  { url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${VERSION_CORE}/tesseract-core-simd-lstm.wasm.js`, destino: 'tesseract-core-simd-lstm.wasm.js' },

  // Modelos de idioma. Solo español: agregar inglés sube la descarga de 8 a
  // 18 MB y casi duplica el tiempo de lectura, a cambio de casi nada de
  // precisión (ver el comentario de IDIOMAS en js/ocr.js). Si algún día hace
  // falta, se descomenta la línea del inglés y se ajusta IDIOMAS allá.
  { url: `https://tessdata.projectnaptha.com/${VERSION_TESSDATA}/spa.traineddata.gz`, destino: 'lang/spa.traineddata.gz' },
  // { url: `https://tessdata.projectnaptha.com/${VERSION_TESSDATA}/eng.traineddata.gz`, destino: 'lang/eng.traineddata.gz' },
];

const enMB = bytes => (bytes / 1024 / 1024).toFixed(1);

async function yaExiste(ruta) {
  try {
    const info = await stat(ruta);
    return info.size > 0 ? info.size : false;
  } catch {
    return false;
  }
}

async function descargar({ url, destino }) {
  const rutaFinal = join(VENDOR, destino);
  await mkdir(dirname(rutaFinal), { recursive: true });

  const existente = await yaExiste(rutaFinal);
  if (existente) {
    console.log(`  ya estaba  ${destino} (${enMB(existente)} MB)`);
    return existente;
  }

  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} en ${url}`);

  const datos = Buffer.from(await respuesta.arrayBuffer());
  await writeFile(rutaFinal, datos);
  console.log(`  descargado ${destino} (${enMB(datos.length)} MB)`);
  return datos.length;
}

console.log(`Descargando el motor de OCR a vendor/ …\n`);

let total = 0;
const fallidos = [];

for (const archivo of ARCHIVOS) {
  try {
    total += await descargar(archivo);
  } catch (error) {
    fallidos.push(`${archivo.destino}: ${error.message}`);
    console.log(`  FALLÓ      ${archivo.destino} — ${error.message}`);
  }
}

console.log(`\nTotal en vendor/: ${enMB(total)} MB`);

if (fallidos.length) {
  console.log(`\n${fallidos.length} archivo(s) no se pudieron descargar:`);
  fallidos.forEach(f => console.log(`  - ${f}`));
  console.log('\nLa app seguirá funcionando usando el CDN. Reintenta cuando tengas mejor conexión.');
  process.exitCode = 1;
} else {
  console.log('\nListo. La aplicación ya funciona 100% sin conexión y sin contactar ningún servidor.');
}
