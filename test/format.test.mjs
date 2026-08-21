import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANTILLA_POR_DEFECTO, renderizar, mensajeDeReserva, camposDeReserva,
  formatearRangoFechas, bloqueOtrosHuespedes, textoPlacas,
  enlaceWhatsApp, resumenDelDia, aCSV,
} from '../js/format.js';

// La reserva de ejemplo reproduce un caso real de la clienta.
const RESERVA = {
  propiedad: 'Departamento 606 Torre 2',
  fechaInicio: '2026-08-16',
  fechaFin: '2026-08-17',
  sinAuto: true,
  placas: '',
  vehiculo: '',
  codigo: '',
  personas: [
    { nombre: 'Ana Ruiz', esResponsable: true },
    { nombre: 'Luis Ruiz', esResponsable: false },
    { nombre: 'Diego Andres Castillo', esResponsable: false },
  ],
};

// ---------------------------------------------------------------------------
// Rango de fechas
// ---------------------------------------------------------------------------

test('un rango dentro del mismo mes se escribe "16-17 agosto"', () => {
  assert.equal(formatearRangoFechas('2026-08-16', '2026-08-17'), '16-17 agosto');
});

test('un rango que cruza de mes nombra ambos meses', () => {
  assert.equal(formatearRangoFechas('2026-08-30', '2026-09-02'), '30 agosto - 2 septiembre');
});

test('una sola noche no repite el día', () => {
  assert.equal(formatearRangoFechas('2026-08-16', '2026-08-16'), '16 agosto');
});

test('sin fecha de salida se muestra solo la llegada', () => {
  assert.equal(formatearRangoFechas('2026-08-16', ''), '16 agosto');
});

test('sin ninguna fecha devuelve cadena vacía', () => {
  assert.equal(formatearRangoFechas('', ''), '');
});

// ---------------------------------------------------------------------------
// Bloques del mensaje
// ---------------------------------------------------------------------------

test('el bloque de acompañantes lleva su encabezado', () => {
  assert.equal(
    bloqueOtrosHuespedes(['Luis Ruiz', 'Diego Andres Castillo']),
    'Otros huéspedes:\nLuis Ruiz\nDiego Andres Castillo',
  );
});

test('viajando una sola persona el bloque desaparece', () => {
  assert.equal(bloqueOtrosHuespedes([]), '');
  assert.equal(bloqueOtrosHuespedes(['', '  ']), '');
});

test('sin auto, el renglón de placas lo dice explícitamente', () => {
  assert.equal(textoPlacas({ sinAuto: true, placas: 'ABC-123-D' }), 'No traen auto');
});

test('con auto se combinan placas y vehículo', () => {
  assert.equal(
    textoPlacas({ sinAuto: false, placas: 'ABC-123-D', vehiculo: 'Nissan Versa 2022' }),
    'ABC-123-D · Nissan Versa 2022',
  );
});

test('con placas pero sin modelo no queda separador colgando', () => {
  assert.equal(textoPlacas({ sinAuto: false, placas: 'ABC-123-D', vehiculo: '' }), 'ABC-123-D');
});

// ---------------------------------------------------------------------------
// Mensaje completo
// ---------------------------------------------------------------------------

test('reproduce exactamente el formato que ya usa la clienta', () => {
  assert.equal(mensajeDeReserva(RESERVA), [
    'Departamento 606 Torre 2',
    'Fechas: 16-17 agosto',
    'Responsable: Ana Ruiz',
    'Otros huéspedes:',
    'Luis Ruiz',
    'Diego Andres Castillo',
    'Placas: No traen auto',
  ].join('\n'));
});

test('con una sola persona se omite el bloque de acompañantes', () => {
  const salida = mensajeDeReserva({
    ...RESERVA,
    personas: [{ nombre: 'Miguel Ángel García Fernández', esResponsable: true }],
    sinAuto: false,
    placas: 'ABC-123-D',
    vehiculo: 'Nissan Versa 2022',
  });
  assert.ok(!salida.includes('Otros huéspedes'), `sobró el bloque:\n${salida}`);
  assert.match(salida, /Responsable: Miguel Ángel García Fernández/);
  assert.match(salida, /Placas: ABC-123-D · Nissan Versa 2022/);
});

test('si nadie está marcado como responsable, toma a la primera persona', () => {
  const campos = camposDeReserva({
    ...RESERVA,
    personas: [{ nombre: 'Ana Gómez' }, { nombre: 'Luis Díaz' }],
  });
  assert.equal(campos.responsable, 'Ana Gómez');
  assert.equal(campos.otrosHuespedes, 'Otros huéspedes:\nLuis Díaz');
});

test('el responsable no se repite entre los acompañantes', () => {
  const salida = mensajeDeReserva(RESERVA);
  assert.equal(salida.match(/Ana Ruiz/g).length, 1);
});

test('una reserva sin unidad no deja un renglón vacío al inicio', () => {
  const salida = mensajeDeReserva({ ...RESERVA, propiedad: '' });
  assert.ok(!salida.startsWith('\n'));
  assert.ok(salida.startsWith('Fechas:'), `arrancó mal:\n${JSON.stringify(salida)}`);
});

test('renderizar respeta una plantilla personalizada', () => {
  const salida = renderizar('Unidad {{propiedad}} | {{totalPersonas}} personas', camposDeReserva(RESERVA));
  assert.equal(salida, 'Unidad Departamento 606 Torre 2 | 3 personas');
});

test('la plantilla por defecto no deja marcadores sin resolver', () => {
  assert.ok(!mensajeDeReserva(RESERVA, PLANTILLA_POR_DEFECTO).includes('{{'));
});

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

test('el enlace de WhatsApp codifica el mensaje', () => {
  const url = enlaceWhatsApp('Hola & adiós');
  assert.ok(url.startsWith('https://wa.me/?text='));
  assert.match(url, /Hola%20%26%20adi/);
});

test('con teléfono el enlace apunta a ese chat y limpia el formato', () => {
  assert.match(enlaceWhatsApp('hola', '+52 55 1234 5678'), /^https:\/\/wa\.me\/525512345678\?text=/);
});

// ---------------------------------------------------------------------------
// Resumen e exportación
// ---------------------------------------------------------------------------

test('el resumen del día agrupa por reserva y cuenta personas', () => {
  const otra = {
    propiedad: 'Departamento 101 Torre 1',
    fechaInicio: '2026-08-16',
    sinAuto: false,
    placas: 'ABC-123-D',
    personas: [{ nombre: 'Miguel García', esResponsable: true }],
  };
  const salida = resumenDelDia([RESERVA, otra], '2026-08-16');
  assert.match(salida, /2 reserva\(s\), 4 persona\(s\)/);
  assert.match(salida, /Responsable: Ana Ruiz/);
  assert.match(salida, /Acompañan: Luis Ruiz, Diego Andres Castillo/);
  assert.match(salida, /Placas: No traen auto/);
  assert.match(salida, /Placas: ABC-123-D/);
});

test('el resumen ignora reservas de otras fechas', () => {
  assert.match(resumenDelDia([RESERVA], '2026-08-20'), /sin reservas/);
});

test('el CSV genera una fila por persona con su rol', () => {
  const csv = aCSV([RESERVA]);
  const filas = csv.split('\n');
  assert.equal(filas.length, 4); // encabezado + 3 personas
  assert.match(filas[1], /"Ana Ruiz","Responsable"/);
  assert.match(filas[2], /"Luis Ruiz","Acompañante"/);
  assert.match(csv, /"No traen auto"/);
});

test('el CSV escapa comillas y comas', () => {
  const csv = aCSV([{ ...RESERVA, personas: [{ nombre: 'PEREZ, JUAN "EL CHATO"', esResponsable: true }] }]);
  assert.match(csv, /"PEREZ, JUAN ""EL CHATO"""/);
});

// ---------------------------------------------------------------------------
// Unidad y fechas son opcionales: vienen de Airbnb, no del huésped
// ---------------------------------------------------------------------------

test('sin unidad ni fechas el mensaje arranca por el responsable', () => {
  const salida = mensajeDeReserva({ ...RESERVA, propiedad: '', fechaInicio: '', fechaFin: '' });
  assert.equal(salida, [
    'Responsable: Ana Ruiz',
    'Otros huéspedes:',
    'Luis Ruiz',
    'Diego Andres Castillo',
    'Placas: No traen auto',
  ].join('\n'));
});

test('no inventa un renglón de fechas vacío', () => {
  const salida = mensajeDeReserva({ ...RESERVA, fechaInicio: '', fechaFin: '' });
  assert.ok(!salida.includes('Fechas:'), `quedó el renglón vacío:\n${salida}`);
  assert.match(salida, /^Departamento 606 Torre 2/);
});

test('el resumen usa la fecha de captura cuando no hay fecha de llegada', () => {
  const sinFecha = {
    propiedad: '',
    fechaInicio: '',
    capturadoEn: '2026-08-20T18:30:00.000Z',
    sinAuto: true,
    personas: [{ nombre: 'Sofia Herrera', esResponsable: true }],
  };
  const salida = resumenDelDia([sinFecha], '2026-08-20');
  assert.match(salida, /Sofia Herrera/);
  assert.match(salida, /1 reserva\(s\)/);
});

test('el resumen no mezcla reservas capturadas otro día', () => {
  const sinFecha = {
    fechaInicio: '',
    capturadoEn: '2026-08-19T18:30:00.000Z',
    personas: [{ nombre: 'Sofia Herrera', esResponsable: true }],
  };
  assert.match(resumenDelDia([sinFecha], '2026-08-20'), /sin reservas/);
});

test('una reserva con fecha de llegada sigue mandando sobre la de captura', () => {
  const conFecha = {
    fechaInicio: '2026-08-22',
    capturadoEn: '2026-08-20T18:30:00.000Z',
    personas: [{ nombre: 'Sofia Herrera', esResponsable: true }],
  };
  assert.match(resumenDelDia([conFecha], '2026-08-20'), /sin reservas/);
  assert.match(resumenDelDia([conFecha], '2026-08-22'), /Sofia Herrera/);
});
