// parsers.js — Extracción determinista de datos a partir del texto crudo del OCR.
//
// Todo aquí es lógica pura y verificable: no depende de la nube ni de un modelo.
// La estrategia es "confiar pero verificar": el OCR propone, estas funciones
// validan con dígitos verificadores y coherencia interna, y devuelven un nivel
// de confianza para que la UI sepa qué resaltar para revisión humana.

// ---------------------------------------------------------------------------
// Utilidades de normalización
// ---------------------------------------------------------------------------

/** Quita acentos y pasa a mayúsculas. El OCR rara vez acierta los acentos. */
export function normalizar(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/** Colapsa espacios múltiples y recorta. */
export function limpiarEspacios(texto) {
  return (texto || '').replace(/\s+/g, ' ').trim();
}

// Confusiones típicas del OCR. Se usan para generar variantes de un token
// cuando la primera lectura no cuadra con ningún patrón conocido.
const CONFUSIONES_A_DIGITO = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const CONFUSIONES_A_LETRA = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '7': 'T' };

/** Fuerza un carácter a dígito si el OCR probablemente lo confundió. */
function aDigito(c) { return CONFUSIONES_A_DIGITO[c] ?? c; }
/** Fuerza un carácter a letra si el OCR probablemente lo confundió. */
function aLetra(c) { return CONFUSIONES_A_LETRA[c] ?? c; }

// ---------------------------------------------------------------------------
// CURP
// ---------------------------------------------------------------------------

const ENTIDADES_CURP = new Set([
  'AS', 'BC', 'BS', 'CC', 'CL', 'CM', 'CS', 'CH', 'DF', 'DG', 'GT', 'GR', 'HG',
  'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OC', 'PL', 'QT', 'QR', 'SP', 'SL', 'SR',
  'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS', 'NE', // NE = nacido en el extranjero
]);

const RE_CURP = /\b([A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d)\b/;

// Alfabeto oficial para el dígito verificador del CURP (incluye la enye).
const DICC_CURP = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/**
 * Calcula el dígito verificador (posición 18) de un CURP a partir de los
 * primeros 17 caracteres. Algoritmo oficial de RENAPO.
 */
export function digitoVerificadorCurp(curp17) {
  let suma = 0;
  for (let i = 0; i < 17; i++) {
    const valor = DICC_CURP.indexOf(curp17[i]);
    if (valor === -1) return null;
    suma += valor * (18 - i);
  }
  return (10 - (suma % 10)) % 10;
}

/**
 * Valida un CURP completo: forma, entidad federativa, fecha coherente y
 * dígito verificador. Un CURP que pasa esto es correcto con altísima certeza,
 * lo cual nos permite confiar en el resto de la lectura.
 */
export function validarCurp(curp) {
  const c = normalizar(curp).replace(/\s/g, '');
  if (c.length !== 18) return { valido: false, motivo: 'longitud' };
  if (!/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/.test(c)) {
    return { valido: false, motivo: 'formato' };
  }
  if (!ENTIDADES_CURP.has(c.slice(11, 13))) return { valido: false, motivo: 'entidad' };

  const fecha = fechaDesdeCurp(c);
  if (!fecha) return { valido: false, motivo: 'fecha' };

  const esperado = digitoVerificadorCurp(c.slice(0, 17));
  if (esperado === null || String(esperado) !== c[17]) {
    return { valido: false, motivo: 'digito_verificador' };
  }
  return {
    valido: true,
    curp: c,
    fechaNacimiento: fecha,
    sexo: c[10] === 'H' ? 'Hombre' : 'Mujer',
  };
}

/**
 * Deriva la fecha de nacimiento de un CURP. El siglo se infiere del carácter
 * de homoclave (posición 17): dígito = 1900s, letra = 2000s.
 */
export function fechaDesdeCurp(curp) {
  const aa = curp.slice(4, 6), mm = curp.slice(6, 8), dd = curp.slice(8, 10);
  const siglo = /\d/.test(curp[16]) ? '19' : '20';
  const anio = Number(siglo + aa), mes = Number(mm), dia = Number(dd);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${dd}/${mm}/${anio}`;
}

/** Busca un CURP en un bloque de texto, probando correcciones de OCR. */
export function extraerCurp(texto) {
  const t = normalizar(texto).replace(/[^A-Z0-9\n ]/g, ' ');

  const directo = t.match(RE_CURP);
  if (directo) {
    const v = validarCurp(directo[1]);
    if (v.valido) return { ...v, confianza: 'alta' };
  }

  // Segunda pasada: tomamos cualquier token de 18 caracteres y corregimos las
  // posiciones donde el formato exige dígito o letra.
  for (const token of t.split(/\s+/)) {
    if (token.length !== 18) continue;
    const corregido = [...token].map((c, i) => {
      const esNumerica = (i >= 4 && i <= 9) || i === 17;
      if (esNumerica) return aDigito(c);
      return i === 16 ? c : aLetra(c);
    }).join('');
    const v = validarCurp(corregido);
    if (v.valido) return { ...v, confianza: 'media', corregido: corregido !== token };
  }

  // Última pasada: aceptamos un CURP bien formado aunque falle el verificador,
  // marcándolo para revisión manual.
  const laxo = t.match(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/);
  if (laxo) {
    return { valido: false, curp: laxo[0], confianza: 'baja', motivo: 'digito_verificador' };
  }
  return null;
}

// Partículas que el CURP ignora al tomar la inicial del apellido.
const PARTICULAS = /^(DE\s+LA\s+|DE\s+LAS\s+|DE\s+LOS\s+|DEL\s+|DE\s+|LA\s+|LAS\s+|LOS\s+|Y\s+|MAC|MC|VAN\s+|VON\s+)/;

function limpiarParticula(apellido) {
  let a = limpiarEspacios(apellido);
  while (PARTICULAS.test(a)) a = a.replace(PARTICULAS, '');
  return a;
}

/**
 * Cruza el nombre leído por OCR contra las 4 primeras letras del CURP.
 * Es la verificación más útil que tenemos: si coinciden, ambos datos se
 * confirman mutuamente sin costo alguno.
 */
export function nombreCoincideConCurp(curp, apellidoPaterno, apellidoMaterno, nombres) {
  const c = normalizar(curp);
  if (c.length < 4) return null;

  const ap = limpiarParticula(normalizar(apellidoPaterno));
  const am = limpiarParticula(normalizar(apellidoMaterno));
  const nom = normalizar(nombres).split(/\s+/).filter(Boolean);

  // Si el primer nombre es MARIA o JOSE y hay más nombres, el CURP usa el segundo.
  const nombreParaCurp = (nom.length > 1 && /^(MARIA|MA|M|JOSE|J)\.?$/.test(nom[0])) ? nom[1] : nom[0];
  if (!ap || !nombreParaCurp) return null;

  const vocalInterna = ap.slice(1).match(/[AEIOU]/);
  const esperado = [
    ap[0],
    vocalInterna ? vocalInterna[0] : 'X',
    am ? am[0] : 'X',
    nombreParaCurp[0],
  ].join('');

  return { coincide: esperado === c.slice(0, 4), esperado, leido: c.slice(0, 4) };
}

// ---------------------------------------------------------------------------
// Clave de elector (INE)
// ---------------------------------------------------------------------------

// 6 letras (consonantes de apellidos y nombre) + 6 dígitos (fecha) + 2 dígitos
// (entidad) + H/M + 3 dígitos.
const RE_CLAVE_ELECTOR = /\b([A-Z]{6}\d{8}[HM]\d{3})\b/;

export function extraerClaveElector(texto) {
  const t = normalizar(texto).replace(/[^A-Z0-9\n ]/g, ' ');
  const m = t.match(RE_CLAVE_ELECTOR);
  if (m) return { clave: m[1], confianza: 'alta' };

  for (const token of t.split(/\s+/)) {
    if (token.length !== 18) continue;
    const corregido = [...token].map((c, i) => {
      if (i < 6) return aLetra(c);
      if (i === 14) return c;
      return aDigito(c);
    }).join('');
    if (RE_CLAVE_ELECTOR.test(corregido)) return { clave: corregido, confianza: 'media' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nombre en credencial INE
// ---------------------------------------------------------------------------

// En la INE el nombre viene bajo la etiqueta "NOMBRE" en tres renglones:
// apellido paterno, apellido materno, nombre(s).
const ETIQUETAS_RUIDO = /^(NOMBRE|DOMICILIO|CLAVE\s*DE\s*ELECTOR|CURP|ESTADO|MUNICIPIO|LOCALIDAD|SECCION|EMISION|VIGENCIA|FECHA\s*DE\s*NACIMIENTO|SEXO|ANO\s*DE\s*REGISTRO|INSTITUTO|NACIONAL|ELECTORAL|CREDENCIAL|PARA\s*VOTAR|MEXICO)/;

export function extraerNombreINE(texto) {
  const lineas = normalizar(texto)
    .split('\n')
    .map(l => limpiarEspacios(l.replace(/[^A-ZÑ\s]/g, ' ')))
    .filter(Boolean);

  const iNombre = lineas.findIndex(l => /^NOMBRE\b/.test(l));
  if (iNombre === -1) return null;

  // Tomamos hasta 3 renglones útiles después de la etiqueta.
  const partes = [];
  for (let i = iNombre + 1; i < lineas.length && partes.length < 3; i++) {
    const l = lineas[i];
    if (!l || l.length < 2) continue;
    if (ETIQUETAS_RUIDO.test(l)) break;
    partes.push(l);
  }
  if (partes.length === 0) return null;

  // Caso frecuente: el OCR junta los tres renglones en uno solo.
  if (partes.length === 1) {
    return {
      completo: partes[0],
      apellidoPaterno: '', apellidoMaterno: '', nombres: '',
      confianza: 'baja',
    };
  }

  const [paterno, materno = '', nombres = ''] = partes;
  return {
    apellidoPaterno: paterno,
    apellidoMaterno: materno,
    nombres,
    completo: limpiarEspacios(`${nombres} ${paterno} ${materno}`),
    confianza: partes.length === 3 ? 'media' : 'baja',
  };
}

// ---------------------------------------------------------------------------
// MRZ (pasaportes y documentos ICAO 9303)
// ---------------------------------------------------------------------------

/**
 * Dígito verificador ICAO 9303: pesos cíclicos 7-3-1 sobre el valor de cada
 * carácter (dígitos = su valor, A-Z = 10..35, '<' = 0).
 */
export function digitoVerificadorMrz(cadena) {
  const pesos = [7, 3, 1];
  let suma = 0;
  for (let i = 0; i < cadena.length; i++) {
    const c = cadena[i];
    let v;
    if (c === '<') v = 0;
    else if (c >= '0' && c <= '9') v = c.charCodeAt(0) - 48;
    else if (c >= 'A' && c <= 'Z') v = c.charCodeAt(0) - 55;
    else return null;
    suma += v * pesos[i % 3];
  }
  return suma % 10;
}

/** YYMMDD de la MRZ a DD/MM/AAAA. Ventana de 20 años para inferir el siglo. */
function formatearFechaMrz(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const aa = Number(yymmdd.slice(0, 2));
  const corte = (new Date().getFullYear() % 100) + 20;
  const anio = aa <= corte ? 2000 + aa : 1900 + aa;
  return `${yymmdd.slice(4, 6)}/${yymmdd.slice(2, 4)}/${anio}`;
}

/**
 * Parsea la MRZ de un pasaporte (formato TD3: 2 líneas de 44 caracteres).
 * Es la lectura más confiable que existe: cada campo trae su propio dígito
 * verificador, así que sabemos con certeza si el OCR falló y en qué campo.
 */
export function extraerMrz(texto) {
  const lineas = normalizar(texto)
    .split('\n')
    .map(l => l.replace(/\s/g, '').replace(/[«»‹›]/g, '<'))
    .filter(l => l.length >= 30 && /</.test(l));

  for (let i = 0; i < lineas.length - 1; i++) {
    const l1 = lineas[i].padEnd(44, '<').slice(0, 44);
    const l2 = lineas[i + 1].padEnd(44, '<').slice(0, 44);
    if (!/^P[A-Z<]/.test(l1)) continue;

    const [apellidos = '', nombres = ''] = l1.slice(5).split('<<');
    const limpiar = s => limpiarEspacios(s.replace(/</g, ' '));

    const numero = l2.slice(0, 9);
    const nacionalidad = l2.slice(10, 13).replace(/</g, '');
    const nacimiento = l2.slice(13, 19);
    const sexo = l2[20];
    const expiracion = l2.slice(21, 27);

    const checks = {
      numero: String(digitoVerificadorMrz(numero)) === l2[9],
      nacimiento: String(digitoVerificadorMrz(nacimiento)) === l2[19],
      expiracion: String(digitoVerificadorMrz(expiracion)) === l2[27],
    };
    const validos = Object.values(checks).filter(Boolean).length;

    return {
      tipo: 'Pasaporte',
      numero: numero.replace(/</g, ''),
      nacionalidad,
      apellidos: limpiar(apellidos),
      nombres: limpiar(nombres),
      completo: limpiarEspacios(`${limpiar(nombres)} ${limpiar(apellidos)}`),
      fechaNacimiento: formatearFechaMrz(nacimiento),
      fechaExpiracion: formatearFechaMrz(expiracion),
      sexo: sexo === 'M' ? 'Hombre' : sexo === 'F' ? 'Mujer' : '',
      checks,
      confianza: validos === 3 ? 'alta' : validos >= 2 ? 'media' : 'baja',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placas vehiculares mexicanas
// ---------------------------------------------------------------------------

// Los formatos varían por estado. Cada patrón describe la forma esperada como
// secuencia de 'L' (letra) y 'D' (dígito), junto con dónde van los guiones.
const FORMATOS_PLACA = [
  { forma: 'LLLDDDL', guiones: [3, 6], etiqueta: 'Particular (estándar actual)' },
  { forma: 'LLLDDDD', guiones: [3], etiqueta: 'Particular' },
  { forma: 'LLLDDLL', guiones: [3, 5], etiqueta: 'Particular' },
  { forma: 'DDDLLL', guiones: [3], etiqueta: 'Particular (formato previo)' },
  { forma: 'LLLDDD', guiones: [3], etiqueta: 'Particular / carga' },
  { forma: 'LLDDDDD', guiones: [2], etiqueta: 'Servicio público / federal' },
  { forma: 'DDDLL', guiones: [3], etiqueta: 'Motocicleta' },
  { forma: 'LLLDD', guiones: [3], etiqueta: 'Motocicleta' },
];

/** Convierte un token a su "forma" (L/D) para compararlo con los patrones. */
function formaDe(token) {
  return [...token].map(c => (/\d/.test(c) ? 'D' : /[A-Z]/.test(c) ? 'L' : '?')).join('');
}

/** Inserta guiones según el formato detectado. */
function formatearPlaca(token, guiones) {
  let salida = '', previo = 0;
  for (const g of guiones) {
    salida += token.slice(previo, g) + '-';
    previo = g;
  }
  return salida + token.slice(previo);
}

/**
 * Busca placas en el texto. Prueba la lectura directa y, si no cuadra con
 * ningún formato conocido, aplica correcciones de OCR posición por posición
 * (la O leída donde debe ir un 0, la S donde debe ir un 5, etc.).
 */
export function extraerPlacas(texto) {
  const candidatos = normalizar(texto)
    .replace(/[^A-Z0-9\n\-\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/-/g, ''))
    .filter(t => t.length >= 5 && t.length <= 7 && /^[A-Z0-9]+$/.test(t) && /\d/.test(t));

  const resultados = [];
  for (const token of candidatos) {
    const exacto = FORMATOS_PLACA.find(f => f.forma === formaDe(token));
    if (exacto) {
      resultados.push({
        placas: formatearPlaca(token, exacto.guiones),
        tipo: exacto.etiqueta, confianza: 'alta', crudo: token,
      });
      continue;
    }
    // Corrección dirigida: forzamos cada posición al tipo que el patrón exige.
    for (const f of FORMATOS_PLACA) {
      if (f.forma.length !== token.length) continue;
      const corregido = [...token].map((c, i) => (f.forma[i] === 'D' ? aDigito(c) : aLetra(c))).join('');
      if (formaDe(corregido) === f.forma) {
        resultados.push({
          placas: formatearPlaca(corregido, f.guiones),
          tipo: f.etiqueta, confianza: 'media', crudo: token,
        });
        break;
      }
    }
  }

  // Preferimos las lecturas de alta confianza y descartamos duplicados.
  const vistos = new Set();
  return resultados
    .sort((a, b) => (a.confianza === 'alta' ? 0 : 1) - (b.confianza === 'alta' ? 0 : 1))
    .filter(r => (vistos.has(r.placas) ? false : vistos.add(r.placas)));
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

/**
 * Analiza el texto completo del OCR y arma el registro del huésped.
 * Devuelve además una lista de avisos para que la UI señale exactamente qué
 * campos necesitan ojo humano, en lugar de pedir revisar todo.
 */
export function analizarTexto(texto) {
  const avisos = [];
  const datos = {
    nombre: '', tipoDocumento: '', numeroDocumento: '', curp: '',
    fechaNacimiento: '', sexo: '', nacionalidad: '', placas: '', tipoPlaca: '',
  };

  const mrz = extraerMrz(texto);
  if (mrz) {
    datos.nombre = mrz.completo;
    datos.tipoDocumento = 'Pasaporte';
    datos.numeroDocumento = mrz.numero;
    datos.fechaNacimiento = mrz.fechaNacimiento;
    datos.sexo = mrz.sexo;
    datos.nacionalidad = mrz.nacionalidad;
    if (mrz.confianza !== 'alta') {
      avisos.push('La MRZ del pasaporte no verificó del todo — confirma número y nombre.');
    }
  }

  const curp = extraerCurp(texto);
  if (curp) {
    datos.curp = curp.curp;
    if (!datos.tipoDocumento) datos.tipoDocumento = 'INE';
    if (curp.valido) {
      datos.fechaNacimiento ||= curp.fechaNacimiento;
      datos.sexo ||= curp.sexo;
      datos.nacionalidad ||= 'MEX';
    } else {
      avisos.push('El CURP no pasó el dígito verificador — revísalo carácter por carácter.');
    }
  }

  const nombreIne = extraerNombreINE(texto);
  if (nombreIne && !datos.nombre) {
    datos.nombre = nombreIne.completo;
    datos.tipoDocumento ||= 'INE';
    if (nombreIne.confianza === 'baja') {
      avisos.push('El nombre se leyó en un solo bloque — verifica el orden de los apellidos.');
    }
    // Verificación cruzada: el CURP codifica las iniciales del nombre.
    if (curp?.valido && nombreIne.apellidoPaterno) {
      const cruce = nombreCoincideConCurp(
        curp.curp, nombreIne.apellidoPaterno, nombreIne.apellidoMaterno, nombreIne.nombres,
      );
      if (cruce && !cruce.coincide) {
        avisos.push(`El nombre no concuerda con el CURP (esperaba "${cruce.esperado}", leyó "${cruce.leido}") — uno de los dos está mal.`);
      }
    }
  }

  const clave = extraerClaveElector(texto);
  if (clave && !datos.numeroDocumento) {
    datos.numeroDocumento = clave.clave;
    datos.tipoDocumento ||= 'INE';
  }

  const placas = extraerPlacas(texto);
  if (placas.length > 0) {
    datos.placas = placas[0].placas;
    datos.tipoPlaca = placas[0].tipo;
    if (placas[0].confianza !== 'alta') {
      avisos.push(`Las placas se corrigieron de "${placas[0].crudo}" — confírmalas.`);
    }
    if (placas.length > 1) {
      avisos.push(`Se detectó más de una placa posible: ${placas.map(p => p.placas).join(', ')}`);
    }
  }

  if (!datos.nombre) avisos.push('No se pudo leer el nombre — captúralo a mano.');
  if (!datos.placas) avisos.push('No se detectaron placas en la imagen.');

  return { datos, avisos, placasAlternativas: placas.slice(1).map(p => p.placas) };
}
