// format.js — Arma el mensaje que se manda al grupo de seguridad.
//
// El objetivo de este módulo es que la clienta nunca escriba: recibe el texto
// ya formateado, listo para copiar o para abrir WhatsApp con él precargado.
//
// La plantilla por defecto reproduce el formato que ya usa con su equipo de
// seguridad, para que ellos no tengan que acostumbrarse a nada nuevo.

export const PLANTILLA_POR_DEFECTO = [
  '{{propiedad}}',
  'Fechas: {{fechas}}',
  'Responsable: {{responsable}}',
  '{{otrosHuespedes}}',
  'Placas: {{placas}}',
].join('\n');

export const TEXTO_SIN_AUTO = 'No traen auto';

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
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim() || null;
}

/**
 * Rellena la plantilla. Trabaja segmento por segmento (separados por '·') para
 * que los datos faltantes se lleven consigo su etiqueta, y descarta el renglón
 * completo si no quedó nada — un huésped sin coche no debe producir un renglón
 * suelto con una etiqueta y nada más.
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

// ---------------------------------------------------------------------------
// Composición de los campos de una reserva
// ---------------------------------------------------------------------------

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Formatea el rango de fechas como lo escribe la clienta: "16-17 agosto"
 * cuando caen en el mismo mes, y "30 agosto - 2 septiembre" cuando lo cruzan.
 */
export function formatearRangoFechas(inicioISO, finISO) {
  const partes = iso => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    const [a, m, d] = iso.split('-').map(Number);
    return { anio: a, mes: m - 1, dia: d };
  };

  const inicio = partes(inicioISO);
  const fin = partes(finISO);

  if (!inicio && !fin) return '';
  if (!fin) return `${inicio.dia} ${MESES[inicio.mes]}`;
  if (!inicio) return `${fin.dia} ${MESES[fin.mes]}`;

  if (inicio.anio === fin.anio && inicio.mes === fin.mes) {
    return inicio.dia === fin.dia
      ? `${inicio.dia} ${MESES[inicio.mes]}`
      : `${inicio.dia}-${fin.dia} ${MESES[inicio.mes]}`;
  }
  return `${inicio.dia} ${MESES[inicio.mes]} - ${fin.dia} ${MESES[fin.mes]}`;
}

/**
 * Construye el bloque de acompañantes, con su encabezado. Devuelve cadena
 * vacía si viaja sola una persona, para que el renglón desaparezca del mensaje.
 */
export function bloqueOtrosHuespedes(nombres) {
  const limpios = (nombres || []).map(n => (n || '').trim()).filter(Boolean);
  if (limpios.length === 0) return '';
  return ['Otros huéspedes:', ...limpios].join('\n');
}

/** Texto del renglón de placas: el dato, o la nota de que no traen coche. */
export function textoPlacas({ sinAuto, placas, vehiculo }) {
  if (sinAuto) return TEXTO_SIN_AUTO;
  const partes = [(placas || '').trim(), (vehiculo || '').trim()].filter(Boolean);
  return partes.join(` ${SEPARADOR} `);
}

/**
 * Traduce una reserva (propiedad, fechas, personas, vehículo) a los marcadores
 * que espera la plantilla.
 */
export function camposDeReserva(reserva) {
  const personas = reserva.personas || [];
  const responsable = personas.find(p => p.esResponsable) || personas[0];
  const otros = personas.filter(p => p !== responsable).map(p => p.nombre);

  return {
    propiedad: reserva.propiedad || '',
    fechas: formatearRangoFechas(reserva.fechaInicio, reserva.fechaFin),
    responsable: responsable?.nombre || '',
    otrosHuespedes: bloqueOtrosHuespedes(otros),
    placas: textoPlacas(reserva),
    vehiculo: reserva.vehiculo || '',
    reserva: reserva.codigo || '',
    totalPersonas: personas.length ? String(personas.length) : '',
  };
}

/** Arma el mensaje completo de una reserva. */
export function mensajeDeReserva(reserva, plantilla = PLANTILLA_POR_DEFECTO) {
  return renderizar(plantilla, camposDeReserva(reserva));
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Resumen y exportación
// ---------------------------------------------------------------------------

/**
 * Resumen diario para seguridad: una sola lista con todas las entradas del
 * día, que es lo que realmente le sirve al equipo en la caseta.
 */
export function resumenDelDia(reservas, fechaISO) {
  const delDia = reservas.filter(r => r.fechaInicio === fechaISO);
  const fechaLegible = formatearRangoFechas(fechaISO, fechaISO);

  if (delDia.length === 0) {
    return `ENTRADAS ${fechaLegible} — sin reservas programadas.`;
  }

  const bloques = delDia
    .sort((a, b) => (a.propiedad || '').localeCompare(b.propiedad || ''))
    .map((r, i) => {
      const campos = camposDeReserva(r);
      const personas = r.personas || [];
      const lineas = [`${i + 1}. ${campos.propiedad || 'Sin unidad'}`];
      if (campos.responsable) lineas.push(`   Responsable: ${campos.responsable}`);
      const otros = personas.filter(p => p.nombre !== campos.responsable).map(p => p.nombre).filter(Boolean);
      if (otros.length) lineas.push(`   Acompañan: ${otros.join(', ')}`);
      lineas.push(`   Placas: ${campos.placas || 'sin dato'}`);
      return lineas.join('\n');
    });

  return [
    `ENTRADAS ${fechaLegible}`,
    `${delDia.length} reserva(s), ${delDia.reduce((n, r) => n + (r.personas?.length || 0), 0)} persona(s)`,
    '',
    ...bloques,
  ].join('\n');
}

/** Exporta el registro a CSV, una fila por persona. */
export function aCSV(reservas) {
  const columnas = [
    'capturadoEn', 'propiedad', 'fechaInicio', 'fechaFin', 'persona', 'rol',
    'tipoDocumento', 'numeroDocumento', 'curp', 'placas', 'vehiculo', 'codigo',
  ];
  const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const filas = [];
  for (const r of reservas) {
    const personas = r.personas?.length ? r.personas : [{ nombre: '', esResponsable: true }];
    for (const p of personas) {
      filas.push(columnas.map(c => {
        switch (c) {
          case 'persona': return escapar(p.nombre);
          case 'rol': return escapar(p.esResponsable ? 'Responsable' : 'Acompañante');
          case 'tipoDocumento': return escapar(p.tipoDocumento);
          case 'numeroDocumento': return escapar(p.numeroDocumento);
          case 'curp': return escapar(p.curp);
          case 'placas': return escapar(textoPlacas(r));
          default: return escapar(r[c]);
        }
      }).join(','));
    }
  }

  return [columnas.join(','), ...filas].join('\n');
}

/** Fecha de hoy en formato ISO (AAAA-MM-DD), que es lo que usan los inputs. */
export function hoyISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
