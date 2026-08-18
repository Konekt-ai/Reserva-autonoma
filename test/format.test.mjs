import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANTILLA_POR_DEFECTO, renderizar, enlaceWhatsApp, resumenDelDia, aCSV, fechaISOaLocal,
} from '../js/format.js';

const COMPLETO = {
  nombre: 'MARIA FERNANDA LOPEZ RUIZ',
  tipoDocumento: 'INE',
  numeroDocumento: 'LPRZMR95031509M400',
  placas: 'ABC-123-D',
  vehiculo: 'Mazda 3 gris',
  propiedad: 'Torre B — 1204',
  checkin: '20/08/2026',
  checkout: '23/08/2026',
  personas: '3',
  reserva: 'HMABC123XY',
};

test('renderiza todos los renglones cuando hay datos completos', () => {
  const salida = renderizar(PLANTILLA_POR_DEFECTO, COMPLETO);
  assert.match(salida, /MARIA FERNANDA LOPEZ RUIZ/);
  assert.match(salida, /ABC-123-D · Mazda 3 gris/);
  assert.match(salida, /Entrada 20\/08\/2026 · Salida 23\/08\/2026/);
  assert.match(salida, /Reserva HMABC123XY/);
});

test('el segmento vacío se lleva su etiqueta: sin check-out no queda "Salida" colgando', () => {
  const salida = renderizar(PLANTILLA_POR_DEFECTO, { ...COMPLETO, checkout: '' });
  assert.match(salida, /Entrada 20\/08\/2026/);
  assert.ok(!salida.includes('Salida'), `quedó "Salida" huérfana en:\n${salida}`);
  assert.ok(!/·\s*$/m.test(salida), 'quedó un separador colgando al final de un renglón');
});

test('un huésped sin coche no genera el renglón del vehículo', () => {
  const salida = renderizar(PLANTILLA_POR_DEFECTO, { ...COMPLETO, placas: '', vehiculo: '' });
  assert.ok(!salida.includes('🚗'), `quedó el renglón del coche vacío:\n${salida}`);
  assert.match(salida, /MARIA FERNANDA/);
});

test('conserva las placas aunque no se sepa el modelo del coche', () => {
  const salida = renderizar(PLANTILLA_POR_DEFECTO, { ...COMPLETO, vehiculo: '' });
  assert.match(salida, /🚗 ABC-123-D/);
  assert.ok(!/ABC-123-D\s*·/.test(salida), 'quedó un separador sin contenido después de las placas');
});

test('sin código de reserva se elimina ese renglón', () => {
  const salida = renderizar(PLANTILLA_POR_DEFECTO, { ...COMPLETO, reserva: '' });
  assert.ok(!salida.includes('Reserva'));
});

test('no deja renglones en blanco duplicados al final', () => {
  const salida = renderizar(PLANTILLA_POR_DEFECTO, { nombre: 'JUAN PEREZ' });
  assert.ok(!/\n\n\n/.test(salida), `hay renglones en blanco de más:\n${JSON.stringify(salida)}`);
  assert.equal(salida.trim(), salida);
});

test('el enlace de WhatsApp codifica el mensaje', () => {
  const url = enlaceWhatsApp('Hola & adiós');
  assert.ok(url.startsWith('https://wa.me/?text='));
  assert.match(url, /Hola%20%26%20adi/);
});

test('con teléfono el enlace apunta a ese chat y limpia el formato', () => {
  assert.match(enlaceWhatsApp('hola', '+52 55 1234 5678'), /^https:\/\/wa\.me\/525512345678\?text=/);
});

test('el resumen del día lista solo las entradas de esa fecha', () => {
  const registros = [
    { nombre: 'ANA GOMEZ', checkin: '20/08/2026', placas: 'AAA-111-A', propiedad: 'Torre A' },
    { nombre: 'LUIS DIAZ', checkin: '21/08/2026', placas: 'BBB-222-B', propiedad: 'Torre B' },
    { nombre: 'SARA RUIZ', checkin: '20/08/2026', placas: 'CCC-333-C', propiedad: 'Torre C' },
  ];
  const salida = resumenDelDia(registros, '20/08/2026');
  assert.match(salida, /2 reserva/);
  assert.match(salida, /ANA GOMEZ/);
  assert.match(salida, /SARA RUIZ/);
  assert.ok(!salida.includes('LUIS DIAZ'));
});

test('el resumen avisa cuando no hay entradas', () => {
  assert.match(resumenDelDia([], '20/08/2026'), /Sin entradas/);
});

test('el CSV escapa comillas y comas', () => {
  const csv = aCSV([{ nombre: 'PEREZ, JUAN "EL CHATO"', placas: 'ABC-123-D' }]);
  assert.match(csv, /"PEREZ, JUAN ""EL CHATO"""/);
  assert.equal(csv.split('\n').length, 2);
});

test('convierte la fecha del input date a formato local', () => {
  assert.equal(fechaISOaLocal('2026-08-20'), '20/08/2026');
  assert.equal(fechaISOaLocal(''), '');
});
