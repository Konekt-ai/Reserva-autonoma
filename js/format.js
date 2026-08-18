// format.js — Arma el mensaje que se manda al grupo de seguridad.
//
// El objetivo de este módulo es que la clienta nunca escriba: recibe el texto
// ya formateado, listo para copiar o para abrir WhatsApp con él precargado.

export const PLANTILLA_POR_DEFECTO = [
  '🏠 ACCESO AUTORIZADO — {{propiedad}}',
  '📅 Entrada {{checkin}} · Salida {{checkout}}',
  '',
  '👤 {{nombre}}',
  '🆔 {{tipoDocumento}} {{numeroDocumento}}',
  '🚗 {{placas}} · {{vehiculo}}',
  '👥 {{personas}} persona(s)',
  '',
  'Reserva {{reserva}}',
].join('\n');

const SEPARADOR = '·';

/**
 * Resuelve un segmento de renglón. Devuelve null si el segmento contenía
 * marcadores y todos vinieron vacíos: así "Salida {{checkout}}" desaparece
 * entero en vez de dejar la palabra "Salida" colgando sin fecha.
 */
function resolverSegmento(segmento, datos) {
  const marcadores = [...segmento.matchAll(/\{\{(\w+)\}\}/g)];
  if (marcadores.length === 0) return segmento.trim() || null;

  const hayValor = marcadores.some(m => String(datos[m[1]] ?? '').trim() !== '');
  if (!hayValor) return null;

  return segmento
    .replace(/\{\{(\w+)\}\}/g, (_, clave) => String(datos[clave] ?? '').trim())
    .replace(/\s{2,}/g, ' ')
    .trim() || null;
}

/**
 * Rellena la plantilla. Trabaja segmento por segmento (separados por '·') para
 * que los datos faltantes se lleven consigo su etiqueta, y descarta el renglón
 * completo si no quedó nada — un huésped sin coche no debe producir un renglón
 * suelto con un emoji y nada más.
 */
export function renderizar(plantilla, datos) {
  return plantilla
    .split('\n')
    .map(linea => {
      if (linea.trim() === '') return '';

      const segmentos = linea
        .split(SEPARADOR)
        .map(s => resolverSegmento(s, datos))
        .filter(Boolean);

      return segmentos.length ? segmentos.join(` ${SEPARADOR} `) : null;
    })
    .filter(l => l !== null)
    // Colapsa renglones en blanco consecutivos.
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
}

/**
 * Construye el enlace que abre WhatsApp con el mensaje ya escrito.
 *
 * Importante: WhatsApp no permite dirigir un enlace a un GRUPO específico.
 * Sin número, abre el selector de chats y la clienta elige el grupo de
 * seguridad; con número, abre directo esa conversación individual.
 */
export function enlaceWhatsApp(mensaje, telefono = '') {
  const texto = encodeURIComponent(mensaje);
  const numero = telefono.replace(/\D/g, '');
  return numero
    ? `https://wa.me/${numero}?text=${texto}`
    : `https://wa.me/?text=${texto}`;
}

/**
 * Copia al portapapeles. Usa la API moderna y cae a un método antiguo cuando
 * el navegador la bloquea (pasa en páginas servidas sin HTTPS).
 */
export async function copiarAlPortapapeles(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
}

/**
 * Resumen diario para seguridad: una sola lista con todas las entradas del
 * día, que es lo que realmente le sirve al equipo en la caseta.
 */
export function resumenDelDia(registros, fecha) {
  const delDia = registros.filter(r => r.checkin === fecha);
  if (delDia.length === 0) {
    return `📋 ${fecha} — Sin entradas programadas.`;
  }

  const lineas = delDia
    .sort((a, b) => (a.propiedad || '').localeCompare(b.propiedad || ''))
    .map((r, i) => {
      const partes = [`${i + 1}. ${r.nombre || 'Sin nombre'}`];
      if (r.propiedad) partes.push(`— ${r.propiedad}`);
      if (r.placas) partes.push(`— 🚗 ${r.placas}`);
      if (r.personas) partes.push(`— 👥 ${r.personas}`);
      return partes.join(' ');
    });

  return [
    `📋 ENTRADAS DE HOY — ${fecha}`,
    `${delDia.length} reserva(s)`,
    '',
    ...lineas,
  ].join('\n');
}

/** Fecha de hoy en formato DD/MM/AAAA. */
export function hoy() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Convierte el valor de un <input type="date"> (AAAA-MM-DD) a DD/MM/AAAA. */
export function fechaISOaLocal(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Exporta el registro a CSV para respaldo o para entregarlo a administración. */
export function aCSV(registros) {
  const columnas = [
    'fechaCaptura', 'propiedad', 'checkin', 'checkout', 'nombre',
    'tipoDocumento', 'numeroDocumento', 'curp', 'placas', 'vehiculo',
    'personas', 'reserva',
  ];
  const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    columnas.join(','),
    ...registros.map(r => columnas.map(c => escapar(r[c])).join(',')),
  ].join('\n');
}
