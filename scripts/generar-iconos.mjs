// generar-iconos.mjs — Crea los PNG del PWA sin dependencias externas.
// Uso: node scripts/generar-iconos.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const FONDO = [15, 23, 42];    // slate-900
const TARJETA = [241, 245, 249]; // slate-100
const ACENTO = [20, 184, 166];  // teal-500

// --- Utilidades PNG ---------------------------------------------------------

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([longitud, cuerpo, crc]);
}

function aPNG(ancho, alto, pixeles) {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;  // profundidad de bits
  ihdr[9] = 6;  // color RGBA
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sin entrelazado

  // Cada scanline lleva su byte de filtro (0 = sin filtro).
  const crudo = Buffer.alloc(alto * (1 + ancho * 4));
  for (let y = 0; y < alto; y++) {
    const inicio = y * (1 + ancho * 4);
    crudo[inicio] = 0;
    pixeles.copy(crudo, inicio + 1, y * ancho * 4, (y + 1) * ancho * 4);
  }

  return Buffer.concat([
    firma,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(crudo, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Dibujo -----------------------------------------------------------------

/** Distancia con esquinas redondeadas: negativa dentro de la forma. */
function dentroDeRectRedondeado(x, y, cx, cy, mitadAncho, mitadAlto, radio) {
  const dx = Math.abs(x - cx) - (mitadAncho - radio);
  const dy = Math.abs(y - cy) - (mitadAlto - radio);
  const fuera = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return fuera - radio <= 0;
}

function generarIcono(tamano) {
  const pixeles = Buffer.alloc(tamano * tamano * 4);
  const c = tamano / 2;

  // Geometría de la credencial, proporcional al tamaño del icono.
  const tarjetaAncho = tamano * 0.30;
  const tarjetaAlto = tamano * 0.21;
  const tarjetaRadio = tamano * 0.035;

  const avatarCx = c - tamano * 0.145;
  const avatarR = tamano * 0.055;

  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      let color = FONDO;

      // Cuerpo de la credencial.
      if (dentroDeRectRedondeado(x, y, c, c, tarjetaAncho, tarjetaAlto, tarjetaRadio)) {
        color = TARJETA;

        // Foto circular a la izquierda.
        if (Math.hypot(x - avatarCx, y - (c - tamano * 0.03)) <= avatarR) {
          color = ACENTO;
        }
        // Hombros del retrato, recortados al área de la foto.
        const hombroY = c + tamano * 0.055;
        if (
          y > hombroY - tamano * 0.045 &&
          dentroDeRectRedondeado(x, y, avatarCx, hombroY, avatarR * 1.25, tamano * 0.035, tamano * 0.03)
        ) {
          color = ACENTO;
        }

        // Renglones de datos a la derecha.
        for (const [indice, ancho] of [[0, 0.115], [1, 0.09], [2, 0.06]]) {
          const lineaY = c - tamano * 0.055 + indice * tamano * 0.055;
          if (
            Math.abs(y - lineaY) <= tamano * 0.014 &&
            x >= c + tamano * 0.005 &&
            x <= c + tamano * 0.005 + tamano * ancho
          ) {
            color = ACENTO;
          }
        }
      }

      const i = (y * tamano + x) * 4;
      pixeles[i] = color[0];
      pixeles[i + 1] = color[1];
      pixeles[i + 2] = color[2];
      pixeles[i + 3] = 255;
    }
  }

  return aPNG(tamano, tamano, pixeles);
}

mkdirSync(join(RAIZ, 'assets'), { recursive: true });
for (const tamano of [192, 512]) {
  const destino = join(RAIZ, 'assets', `icono-${tamano}.png`);
  writeFileSync(destino, generarIcono(tamano));
  console.log(`✓ assets/icono-${tamano}.png`);
}
