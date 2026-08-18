import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  digitoVerificadorCurp,
  validarCurp,
  extraerCurp,
  fechaDesdeCurp,
  nombreCoincideConCurp,
  digitoVerificadorMrz,
  extraerMrz,
  extraerPlacas,
  extraerClaveElector,
  extraerNombreINE,
  analizarTexto,
} from '../js/parsers.js';

// Construye un CURP válido calculando su propio dígito verificador, para no
// depender de datos de una persona real en las pruebas.
function curpConDigito(base17) {
  return base17 + digitoVerificadorCurp(base17);
}

const CURP_BASE = 'LORF950315MDFPZR0'; // Ficticio: F. LOPEZ RUIZ, 15/03/1995, mujer, DF
const CURP_VALIDO = curpConDigito(CURP_BASE);

// ---------------------------------------------------------------------------
// CURP
// ---------------------------------------------------------------------------

test('el dígito verificador del CURP es reproducible y de un solo carácter', () => {
  const d = digitoVerificadorCurp(CURP_BASE);
  assert.ok(d >= 0 && d <= 9, `dígito fuera de rango: ${d}`);
  assert.equal(CURP_VALIDO.length, 18);
});

test('validarCurp acepta un CURP bien formado', () => {
  const r = validarCurp(CURP_VALIDO);
  assert.equal(r.valido, true, `motivo: ${r.motivo}`);
  assert.equal(r.fechaNacimiento, '15/03/1995');
  assert.equal(r.sexo, 'Mujer');
});

test('validarCurp rechaza un dígito verificador alterado', () => {
  const malo = CURP_BASE + ((Number(CURP_VALIDO[17]) + 1) % 10);
  assert.equal(validarCurp(malo).valido, false);
  assert.equal(validarCurp(malo).motivo, 'digito_verificador');
});

test('validarCurp rechaza una entidad federativa inexistente', () => {
  const malo = curpConDigito('LORF950315MZZPZR0');
  assert.equal(validarCurp(malo).motivo, 'entidad');
});

test('validarCurp rechaza una fecha imposible (31 de febrero)', () => {
  const malo = curpConDigito('LORF950231MDFPZR0');
  assert.equal(validarCurp(malo).motivo, 'fecha');
});

test('fechaDesdeCurp infiere el siglo por la homoclave', () => {
  // Homoclave numérica => 1900s; alfabética => 2000s.
  assert.equal(fechaDesdeCurp('LORF950315MDFPZR07'), '15/03/1995');
  assert.equal(fechaDesdeCurp('LORF050315MDFPZRA7'), '15/03/2005');
});

test('extraerCurp lo encuentra dentro de texto ruidoso de OCR', () => {
  const texto = `INSTITUTO NACIONAL ELECTORAL\nCURP  ${CURP_VALIDO}\nSECCION 1234`;
  const r = extraerCurp(texto);
  assert.equal(r.curp, CURP_VALIDO);
  assert.equal(r.valido, true);
  assert.equal(r.confianza, 'alta');
});

test('extraerCurp corrige confusiones típicas del OCR (O por 0, S por 5)', () => {
  // Sustituimos dígitos por las letras que el OCR suele confundir.
  const conRuido = CURP_VALIDO.slice(0, 4)
    + CURP_VALIDO.slice(4, 10).replace(/0/g, 'O').replace(/5/g, 'S').replace(/1/g, 'I')
    + CURP_VALIDO.slice(10);
  const r = extraerCurp(conRuido);
  assert.ok(r, 'no recuperó el CURP con ruido de OCR');
  assert.equal(r.curp, CURP_VALIDO);
  assert.equal(r.valido, true);
});

// ---------------------------------------------------------------------------
// Verificación cruzada nombre <-> CURP
// ---------------------------------------------------------------------------

test('el nombre concuerda con las iniciales del CURP', () => {
  // MARIA se salta: el CURP usa la inicial del segundo nombre (F de FERNANDA).
  const r = nombreCoincideConCurp(CURP_VALIDO, 'LOPEZ', 'RUIZ', 'MARIA FERNANDA');
  assert.equal(r.esperado, 'LORF');
  assert.equal(r.coincide, true);
});

test('detecta cuando el nombre NO concuerda con el CURP', () => {
  const r = nombreCoincideConCurp(CURP_VALIDO, 'GARCIA', 'PEREZ', 'JUAN');
  assert.equal(r.coincide, false);
  assert.equal(r.esperado, 'GAPJ');
});

test('ignora partículas como DE LA al derivar la inicial', () => {
  const r = nombreCoincideConCurp('TOMR900101HDFRRB05', 'DE LA TORRE', 'RAMIREZ', 'MIGUEL');
  assert.equal(r.esperado, 'TORM');
});

// ---------------------------------------------------------------------------
// MRZ de pasaporte (ejemplo oficial ICAO 9303)
// ---------------------------------------------------------------------------

const MRZ_LINEA_1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const MRZ_LINEA_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

test('el dígito verificador MRZ usa los pesos 7-3-1', () => {
  assert.equal(digitoVerificadorMrz('L898902C3'), 6);
  assert.equal(digitoVerificadorMrz('740812'), 2);
  assert.equal(digitoVerificadorMrz('120415'), 9);
});

test('extraerMrz lee el pasaporte de ejemplo con confianza alta', () => {
  const r = extraerMrz(`${MRZ_LINEA_1}\n${MRZ_LINEA_2}`);
  assert.ok(r, 'no detectó la MRZ');
  assert.equal(r.tipo, 'Pasaporte');
  assert.equal(r.numero, 'L898902C3');
  assert.equal(r.nacionalidad, 'UTO');
  assert.equal(r.completo, 'ANNA MARIA ERIKSSON');
  assert.equal(r.fechaNacimiento, '12/08/1974');
  assert.equal(r.sexo, 'Mujer');
  assert.equal(r.confianza, 'alta');
});

test('extraerMrz baja la confianza si un dígito verificador falla', () => {
  // Alteramos un dígito del número de pasaporte sin tocar su verificador.
  const corrupta = 'L898902C99UTO7408122F1204159ZE184226B<<<<<10';
  const r = extraerMrz(`${MRZ_LINEA_1}\n${corrupta}`);
  assert.equal(r.checks.numero, false);
  assert.notEqual(r.confianza, 'alta');
});

// ---------------------------------------------------------------------------
// Placas
// ---------------------------------------------------------------------------

test('reconoce el formato particular actual con guiones', () => {
  const r = extraerPlacas('placas ABC123D del carro');
  assert.equal(r[0].placas, 'ABC-123-D');
  assert.equal(r[0].confianza, 'alta');
});

test('acepta placas ya escritas con guiones', () => {
  const r = extraerPlacas('mi placa es ABC-123-D');
  assert.equal(r[0].placas, 'ABC-123-D');
});

test('corrige la I leída donde debía ir un 1', () => {
  const r = extraerPlacas('ABCI23D');
  assert.equal(r[0].placas, 'ABC-123-D');
  assert.equal(r[0].confianza, 'media');
  assert.equal(r[0].crudo, 'ABCI23D');
});

test('reconoce el formato previo de tres dígitos y tres letras', () => {
  const r = extraerPlacas('123ABC');
  assert.equal(r[0].placas, '123-ABC');
});

test('descarta tokens sin ningún dígito', () => {
  assert.equal(extraerPlacas('HOLA MUNDO ABCDEFG').length, 0);
});

// ---------------------------------------------------------------------------
// Campos de la INE
// ---------------------------------------------------------------------------

test('extraerClaveElector encuentra la clave de 18 caracteres', () => {
  const r = extraerClaveElector('CLAVE DE ELECTOR LPRZMR95031509M400');
  assert.equal(r.clave, 'LPRZMR95031509M400');
});

test('extraerNombreINE separa los tres renglones del nombre', () => {
  const texto = 'INSTITUTO NACIONAL ELECTORAL\nNOMBRE\nLOPEZ\nRUIZ\nMARIA FERNANDA\nDOMICILIO\nCALLE FALSA 123';
  const r = extraerNombreINE(texto);
  assert.equal(r.apellidoPaterno, 'LOPEZ');
  assert.equal(r.apellidoMaterno, 'RUIZ');
  assert.equal(r.nombres, 'MARIA FERNANDA');
  assert.equal(r.completo, 'MARIA FERNANDA LOPEZ RUIZ');
});

// ---------------------------------------------------------------------------
// Orquestador completo
// ---------------------------------------------------------------------------

test('analizarTexto arma el registro completo desde una INE simulada', () => {
  const texto = [
    'INSTITUTO NACIONAL ELECTORAL',
    'CREDENCIAL PARA VOTAR',
    'NOMBRE',
    'LOPEZ',
    'RUIZ',
    'MARIA FERNANDA',
    'DOMICILIO',
    'CALLE FALSA 123 COL CENTRO',
    `CURP ${CURP_VALIDO}`,
    'CLAVE DE ELECTOR LPRZMR95031509M400',
    'PLACAS ABC123D',
  ].join('\n');

  const { datos, avisos } = analizarTexto(texto);
  assert.equal(datos.nombre, 'MARIA FERNANDA LOPEZ RUIZ');
  assert.equal(datos.curp, CURP_VALIDO);
  assert.equal(datos.tipoDocumento, 'INE');
  assert.equal(datos.placas, 'ABC-123-D');
  assert.equal(datos.fechaNacimiento, '15/03/1995');
  assert.equal(datos.sexo, 'Mujer');
  // Todo cuadró: no debe pedir revisión de nombre, CURP ni placas.
  assert.deepEqual(avisos, []);
});

test('analizarTexto avisa cuando el nombre contradice al CURP', () => {
  const texto = [
    'NOMBRE',
    'GARCIA',
    'PEREZ',
    'JUAN CARLOS',
    'DOMICILIO',
    `CURP ${CURP_VALIDO}`,
  ].join('\n');

  const { avisos } = analizarTexto(texto);
  assert.ok(
    avisos.some(a => a.includes('no concuerda con el CURP')),
    `esperaba aviso de discrepancia, recibí: ${JSON.stringify(avisos)}`,
  );
});

test('analizarTexto reporta lo que faltó leer', () => {
  const { avisos } = analizarTexto('texto ilegible sin datos utiles');
  assert.ok(avisos.some(a => a.includes('nombre')));
  assert.ok(avisos.some(a => a.includes('placas')));
});
