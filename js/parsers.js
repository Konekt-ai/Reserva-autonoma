// parsers.js — Extracción determinista de datos a partir del texto crudo del OCR.
//
// Todo aquí es lógica pura y verificable: no depende de la nube ni de un modelo.
// La estrategia es "confiar pero verificar": el OCR propone, estas funciones
// validan con dígitos verificadores y coherencia interna, y devuelven un nivel
// de confianza para que la UI sepa qué resaltar para revisión humana.
//
// Los documentos reales que llegan por el chat de Airbnb son variados:
// licencias de California, credenciales INE, pasaportes, y muchas veces
// capturas de pantalla del propio chat donde el dato importante (las placas)
// viene escrito en el mensaje, no en la identificación.

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

// Partículas de apellido que por convención van en minúscula.
const PARTICULAS_MINUSCULA = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'VAN', 'VON', 'DA', 'DI']);

/**
 * Convierte un nombre a capitalización de título.
 *
 * Las credenciales imprimen los nombres en mayúsculas, así que el OCR siempre
 * los devuelve gritando. El mensaje a seguridad se lee mucho mejor con
 * "Luis Ruiz" que con "LUIS RUIZ", y así queda igual al formato que la
 * clienta ya escribía a mano.
 */
export function capitalizarNombre(nombre) {
  const palabras = limpiarEspacios(nombre).split(' ').filter(Boolean);

  return palabras.map((palabra, i) => {
    const mayus = palabra.toUpperCase();
    // Las partículas van en minúscula, salvo que abran el nombre.
    if (i > 0 && PARTICULAS_MINUSCULA.has(mayus)) return mayus.toLowerCase();
    return mayus.charAt(0) + mayus.slice(1).toLowerCase();
  }).join(' ');
}

// Confusiones típicas del OCR. Se usan para corregir un token cuando encaja
// casi con un patrón conocido — nunca de forma indiscriminada (ver extraerPlacas).
const CONFUSIONES_A_DIGITO = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const CONFUSIONES_A_LETRA = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '7': 'T' };

function aDigito(c) { return CONFUSIONES_A_DIGITO[c] ?? c; }
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
 * dígito verificador. Un CURP que pasa esto es correcto con altísima certeza.
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

const ETIQUETAS_RUIDO = /^(NOMBRE|DOMICILIO|CLAVE\s*DE\s*ELECTOR|CURP|ESTADO|MUNICIPIO|LOCALIDAD|SECCION|EMISION|VIGENCIA|FECHA\s*DE\s*NACIMIENTO|SEXO|ANO\s*DE\s*REGISTRO|INSTITUTO|NACIONAL|ELECTORAL|CREDENCIAL|PARA\s*VOTAR|MEXICO)/;

export function extraerNombreINE(texto) {
  const lineas = normalizar(texto)
    .split('\n')
    .map(l => limpiarEspacios(l.replace(/[^A-ZÑ\s]/g, ' ')))
    .filter(Boolean);

  const iNombre = lineas.findIndex(l => /^NOMBRE\b/.test(l));
  if (iNombre === -1) return null;

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
// Licencias de conducir de Estados Unidos
// ---------------------------------------------------------------------------
//
// Son las que más llegan en la práctica. Usan etiquetas "LN" (last name) y
// "FN" (first name). El OCR suele pegarlas al apellido ("LNRUIZ") o leer
// "FN" como "EN", así que los patrones son tolerantes a eso.

// Palabras que aparecen en la credencial y nunca son un nombre.
const PALABRAS_NO_NOMBRE = new Set([
  'CLASS', 'NONE', 'END', 'LICENSE', 'DRIVER', 'COMMERCIAL', 'FEDERAL', 'LIMITS',
  'APPLY', 'CORR', 'LENS', 'RSTR', 'DONOR', 'SEX', 'HAIR', 'EYES', 'HGT', 'WGT',
  'EXP', 'DOB', 'ISS', 'USA', 'CALIFORNIA', 'VETERAN', 'ORGAN', 'BLK', 'BRN', 'BLU',
]);

const ESTADOS_USA = [
  'ALABAMA', 'ALASKA', 'ARIZONA', 'ARKANSAS', 'CALIFORNIA', 'COLORADO', 'CONNECTICUT',
  'DELAWARE', 'FLORIDA', 'GEORGIA', 'HAWAII', 'IDAHO', 'ILLINOIS', 'INDIANA', 'IOWA',
  'KANSAS', 'KENTUCKY', 'LOUISIANA', 'MAINE', 'MARYLAND', 'MASSACHUSETTS', 'MICHIGAN',
  'MINNESOTA', 'MISSISSIPPI', 'MISSOURI', 'MONTANA', 'NEBRASKA', 'NEVADA', 'OHIO',
  'OKLAHOMA', 'OREGON', 'PENNSYLVANIA', 'TENNESSEE', 'TEXAS', 'UTAH', 'VERMONT',
  'VIRGINIA', 'WASHINGTON', 'WISCONSIN', 'WYOMING', 'NEW YORK', 'NEW JERSEY',
];

/**
 * Descarta capturas que son etiquetas de la credencial o basura del OCR en vez
 * de un nombre. Con fotos muy comprimidas el OCR produce fragmentos como
 * "SEN E" que pasarían un filtro laxo y acabarían en el mensaje a seguridad.
 */
function esNombrePlausible(candidato) {
  const limpio = limpiarEspacios(candidato);
  if (limpio.length < 3 || limpio.length > 40) return false;
  if (!/^[A-Z][A-Z ]*$/.test(limpio)) return false;

  const palabras = limpio.split(' ');
  if (palabras.some(p => PALABRAS_NO_NOMBRE.has(p))) return false;
  // Ninguna palabra suelta de una sola letra: es ruido, no una inicial real.
  if (palabras.some(p => p.length < 2)) return false;
  // Y al menos una palabra con cuerpo suficiente para ser un nombre.
  return palabras.some(p => p.length >= 3);
}

/**
 * Extrae los datos de una licencia estadounidense.
 *
 * El número de licencia de California tiene forma "letra + 7 dígitos", un
 * patrón bastante distintivo como para buscarlo aunque la etiqueta "DL" venga
 * ilegible — que es lo que pasa casi siempre.
 */
export function extraerLicenciaUSA(texto) {
  const t = normalizar(texto);
  const lineas = t.split('\n');

  const estado = ESTADOS_USA.find(e => t.includes(e));
  const pareceLicencia = /DRIVER\s*LICEN[SC]E|IDENTIFICATION\s*CARD/.test(t)
    || (estado && /\bDL\b|\bDOB\b|\bEXP\b/.test(t));
  if (!pareceLicencia) return null;

  let apellido = '', nombres = '';
  for (const linea of lineas) {
    // "LN RUIZ", "LNRUIZ", "LN  CASTILLO &" → apellido
    if (!apellido) {
      const m = linea.match(/\bLN\s*([A-Z][A-Z ]{1,28})/);
      if (m && esNombrePlausible(m[1])) apellido = limpiarEspacios(m[1]);
    }
    // "FN ANA", "EN DIEGO ANDRES" (la F leída como E) → nombre(s)
    if (!nombres) {
      const m = linea.match(/\b[EF]N\s+([A-Z][A-Z ]{1,28})/);
      if (m && esNombrePlausible(m[1])) nombres = limpiarEspacios(m[1]);
    }
  }

  // Número de licencia: patrón de California (1 letra + 7 dígitos).
  let numero = '';
  const conEtiqueta = t.match(/\bDL\s*[:.]?\s*([A-Z]\s?\d{7})\b/);
  if (conEtiqueta) {
    numero = conEtiqueta[1].replace(/\s/g, '');
  } else {
    const suelto = t.match(/\b([A-Z]\s?\d{7})\b/);
    if (suelto) numero = suelto[1].replace(/\s/g, '');
  }

  const nacimiento = t.match(/\bDOB\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/);
  const expiracion = t.match(/\bEXP\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/);

  if (!apellido && !nombres && !numero) return null;

  const completo = limpiarEspacios(`${nombres} ${apellido}`);
  const camposLeidos = [apellido, nombres, numero].filter(Boolean).length;

  return {
    tipo: 'Licencia',
    estado: estado || '',
    apellido,
    nombres,
    completo,
    numero,
    fechaNacimiento: nacimiento ? nacimiento[1] : '',
    fechaExpiracion: expiracion ? expiracion[1] : '',
    confianza: camposLeidos === 3 ? 'alta' : camposLeidos === 2 ? 'media' : 'baja',
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
// Contexto del chat de Airbnb
// ---------------------------------------------------------------------------
//
// Muchas veces lo que se sube es una captura del chat, no la identificación
// suelta. Ahí vienen datos que NO están en el documento: quién reservó, si
// traen coche y cuál, y con frecuencia las placas escritas a mano.

/**
 * Detecta el nombre de quien escribe en el chat.
 * Airbnb lo muestra como "Miguel · Booker 10:31 PM"; el OCR lee el punto medio
 * como guion, coma o nada.
 */
export function extraerRemitenteChat(texto) {
  // A diferencia del resto del módulo, aquí trabajamos sobre el texto original:
  // este nombre va tal cual al mensaje de seguridad, y "Miguel" se lee mejor
  // que "MIGUEL".
  const PALABRA = "[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'´-]+";
  const RE_REMITENTE = new RegExp(
    `^\\s*([A-ZÁÉÍÓÚÜÑ]${PALABRA}(?:\\s+[A-ZÁÉÍÓÚÜÑ]${PALABRA}){0,3})` +
    `\\s*[·\\-—,.]?\\s*(BOOKER|GUEST|HUESPED|HUÉSPED|ANFITRION|ANFITRIÓN|HOST)\\b`,
    'i',
  );

  for (const linea of (texto || '').split('\n')) {
    const m = linea.match(RE_REMITENTE);
    if (!m) continue;

    const nombre = limpiarEspacios(m[1]);
    if (nombre.length >= 2 && !PALABRAS_NO_NOMBRE.has(normalizar(nombre))) {
      return { nombre, rol: m[2].toUpperCase() };
    }
  }
  return null;
}

// Formas de decir "no traemos coche" en los dos idiomas que llegan.
const PATRONES_SIN_AUTO = [
  /\bWON'?T\s+BE\s+BRINGING\s+A\s+CAR\b/,
  /\bNOT\s+BRINGING\s+(A\s+)?(CAR|VEHICLE)\b/,
  /\bNO\s+CAR\b/,
  /\bWITHOUT\s+A\s+CAR\b/,
  /\bDON'?T\s+HAVE\s+A\s+CAR\b/,
  /\bNO\s+TRAE(N|MOS)?\s+(AUTO|CARRO|COCHE|VEHICULO)\b/,
  /\bSIN\s+(AUTO|CARRO|COCHE|VEHICULO)\b/,
  /\bNO\s+LLEV(O|AMOS|AN)\s+(AUTO|CARRO|COCHE|VEHICULO)\b/,
  /\bNO\s+VAMOS\s+EN\s+(AUTO|CARRO|COCHE)\b/,
];

/** Indica si el mensaje dice explícitamente que no llevan vehículo. */
export function detectarSinAuto(texto) {
  const t = normalizar(texto).replace(/[’']/g, "'");
  return PATRONES_SIN_AUTO.some(p => p.test(t));
}

// Marcas comunes en México y Estados Unidos.
const MARCAS = [
  'NISSAN', 'TOYOTA', 'HONDA', 'MAZDA', 'CHEVROLET', 'CHEVY', 'VOLKSWAGEN', 'VW',
  'FORD', 'KIA', 'HYUNDAI', 'SEAT', 'RENAULT', 'BMW', 'AUDI', 'MERCEDES', 'JEEP',
  'SUZUKI', 'MITSUBISHI', 'PEUGEOT', 'FIAT', 'TESLA', 'DODGE', 'CHRYSLER', 'GMC',
  'SUBARU', 'VOLVO', 'ACURA', 'LEXUS', 'INFINITI', 'BUICK', 'CADILLAC', 'LINCOLN',
  'RAM', 'MG', 'CHIREY', 'CHERY', 'BYD', 'JAC', 'CHANGAN', 'HAVAL', 'GREAT WALL',
];

// Marcas que se escriben en mayúsculas de verdad: capitalizarlas las arruina.
const MARCAS_SIGLA = new Set(['BMW', 'VW', 'GMC', 'MG', 'BYD', 'JAC', 'RAM', 'SEAT']);

/**
 * Deja el vehículo presentable: "NISSAN VERSA 2022" → "Nissan Versa 2022",
 * sin convertir "BMW" en "Bmw" ni tocar el año.
 */
export function formatearVehiculo(vehiculo) {
  return limpiarEspacios(vehiculo)
    .split(' ')
    .filter(Boolean)
    .map(palabra => {
      const mayus = palabra.toUpperCase();
      if (MARCAS_SIGLA.has(mayus)) return mayus;
      if (/^\d+$/.test(palabra)) return palabra;
      return mayus.charAt(0) + mayus.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Busca marca, modelo y año del vehículo en el texto del mensaje. */
export function extraerVehiculo(texto) {
  const t = normalizar(texto);
  for (const marca of MARCAS) {
    // El límite de palabra es imprescindible: sin él, el "SACRAMENTO" del
    // domicilio de una licencia activa la marca "RAM" e inventa un vehículo.
    const m = t.match(new RegExp(`\\b${marca}\\b`));
    if (!m) continue;
    // Tomamos la marca y hasta dos palabras siguientes (modelo y año).
    const cola = t.slice(m.index, m.index + 40).split(/[,\n;]/)[0];
    const palabras = cola.split(/\s+/).slice(0, 3).filter(Boolean);
    return { vehiculo: limpiarEspacios(palabras.join(' ')), marca };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Listas de nombres pegadas
// ---------------------------------------------------------------------------

// Encabezados que anuncian una lista de personas: se quitan y lo que sigue en
// el renglón todavía puede ser un nombre.
const ENCABEZADO_DE_PERSONAS = /^(otros\s+hu[eé]spedes|hu[eé]spedes|acompa[ñn]antes|invitados|personas|nombres?|responsable)\s*:?\s*/i;

// Etiquetas de otros campos del mensaje. Aquí se descarta el renglón COMPLETO:
// al pegar un mensaje anterior, "Placas: No traen auto" no debe convertirse en
// un huésped llamado "No Traen Auto".
const ETIQUETA_DE_OTRO_CAMPO = /^(fechas?|placas?|plates?|veh[ií]culo|auto|carro|coche|departamento|depa|unidad|torre|piso|check\s*-?\s*(in|out)|entrada|salida|reserva|c[oó]digo|tel[eé]fono)\b/i;

// Palabras con las que empieza una frase, nunca un nombre de pila.
const ARRANQUE_DE_FRASE = /^(hola|buenas?|buenos?|gracias|no|s[ií]|somos|soy|vamos|voy|llego|llegamos|ser[ií]a|es|son|est[aá]|est[aá]n|te|le|les|mi|mis|nuestro|nuestra|para|por|con|sin|claro|perfecto|ok|okay|hello|hi|thanks?|we|i|the|my|our)\b/i;

// Viñetas y numeración con las que suelen venir las listas.
const VINETA = /^\s*(?:[-–—*•·+]|\d+\s*[.)-])\s*/;

/**
 * Decide si un renglón suelto parece el nombre de una persona.
 *
 * Es deliberadamente estricto: lo que se cuele aquí acaba impreso en el
 * mensaje que lee el guardia de la caseta, así que ante la duda se descarta.
 */
export function pareceNombre(linea) {
  const limpio = limpiarEspacios(linea);
  if (limpio.length < 3 || limpio.length > 60) return false;
  // Sin dígitos ni símbolos: los nombres no los llevan.
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(limpio)) return false;
  if (ETIQUETA_DE_OTRO_CAMPO.test(limpio)) return false;
  if (ENCABEZADO_DE_PERSONAS.test(limpio)) return false;
  if (ARRANQUE_DE_FRASE.test(limpio)) return false;

  const palabras = limpio.split(/[\s.]+/).filter(Boolean);
  if (palabras.length > 6) return false; // una frase, no un nombre

  // Una palabra suelta de una letra delata prosa ("a entrar Ana Ruiz"), salvo
  // que sea una inicial, que va en mayúscula ("Ana R. Ruiz").
  if (palabras.some(p => p.length < 2 && p !== p.toUpperCase())) return false;

  // Renglones de una credencial: "CALIFORNIA DRIVER LICENSE" pasaría todos los
  // filtros anteriores porque son puras letras.
  if (palabras.some(p => PALABRAS_NO_NOMBRE.has(normalizar(p)))) return false;

  return palabras.some(p => p.length >= 3);
}

/**
 * Convierte un pegado de varias líneas en una lista de nombres.
 *
 * Cubre el caso más común junto con las fotos: el huésped escribe a quién
 * lleva, o la clienta copia los nombres de otro lado. Quita viñetas,
 * numeración y encabezados, y capitaliza para que entren al mensaje ya
 * presentables.
 */
export function nombresDeLista(texto) {
  const vistos = new Set();

  return (texto || '')
    .split(/[\n;]/)
    .map(linea => limpiarEspacios(linea.replace(VINETA, '')))
    // El renglón de otro campo se descarta entero, antes de quitarle nada.
    .filter(linea => !ETIQUETA_DE_OTRO_CAMPO.test(linea))
    .map(linea => limpiarEspacios(linea.replace(ENCABEZADO_DE_PERSONAS, '')))
    .filter(pareceNombre)
    .map(capitalizarNombre)
    .filter(nombre => (vistos.has(nombre) ? false : vistos.add(nombre)));
}

// Verbos con los que la gente enumera a sus acompañantes dentro de una frase.
const ANUNCIA_ACOMPANANTES = /\b(?:somos|seremos|vamos|van|entran|entramos|ingresan|se\s+hospedan|iremos|llegamos|llegan)\b\s*:?\s*/gi;

/**
 * Saca los nombres escritos dentro de una frase: "Hola, somos Ana Ruiz y
 * Luis Díaz". No todos responden con una lista ordenada, y este es el segundo
 * modo más común.
 *
 * Exige que al menos una palabra venga con mayúscula inicial. Sin eso, "somos
 * muy puntuales" pasaría todos los demás filtros y se convertiría en un
 * huésped inexistente.
 */
export function nombresEnFrase(texto) {
  const original = texto || '';
  const vistos = new Set();
  const salida = [];

  ANUNCIA_ACOMPANANTES.lastIndex = 0;
  let anuncio;
  while ((anuncio = ANUNCIA_ACOMPANANTES.exec(original)) !== null) {
    const resto = original
      .slice(anuncio.index + anuncio[0].length)
      .split(/[.\n]/)[0]
      // "Van a entrar Ana Ruiz": el relleno entre el verbo y el primer nombre
      // se lo llevaría pegado y arruinaría esa primera coincidencia.
      .replace(/^\s*(?:a\s+)?(?:entrar|ingresar|llegar|estar|ser|pasar|hospedarse|quedarse)\s+/i, '');

    for (const trozo of resto.split(/\s*[,:]\s*|\s+y\s+|\s+e\s+/i)) {
      const candidato = limpiarEspacios(trozo).replace(/[!?¡¿:;]+$/, '');
      if (!pareceNombre(candidato)) continue;
      // En prosa, un nombre va con mayúscula; una palabra común, no.
      if (!/(^|\s)[A-ZÁÉÍÓÚÜÑ]/.test(candidato)) continue;

      const nombre = capitalizarNombre(candidato);
      if (!vistos.has(nombre)) {
        vistos.add(nombre);
        salida.push(nombre);
      }
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Placas vehiculares
// ---------------------------------------------------------------------------

// Cada patrón describe la forma esperada como secuencia de 'L' (letra) y
// 'D' (dígito), junto con dónde van los guiones.
const FORMATOS_PLACA = [
  { forma: 'LLLDDDL', guiones: [3, 6], etiqueta: 'Particular (estándar actual)' },
  { forma: 'LLLDDDD', guiones: [3], etiqueta: 'Particular' },
  { forma: 'LLLDDLL', guiones: [3, 5], etiqueta: 'Particular' },
  { forma: 'DDDLLL', guiones: [3], etiqueta: 'Particular (formato previo)' },
  { forma: 'LLLDDD', guiones: [3], etiqueta: 'Particular / carga' },
  { forma: 'LLDDDDD', guiones: [2], etiqueta: 'Servicio público / federal' },
  { forma: 'DDDLL', guiones: [3], etiqueta: 'Motocicleta' },
  { forma: 'LLLDD', guiones: [3], etiqueta: 'Motocicleta' },
  { forma: 'DLLLDDD', guiones: [1, 4], etiqueta: 'California (EE.UU.)' },
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

// Máximo de caracteres que aceptamos corregir en una placa. Sin este límite,
// cualquier número de 7 cifras de una credencial se "corrige" hasta parecer una
// placa válida — el error más peligroso posible, porque manda datos inventados
// al equipo de seguridad.
const MAX_CORRECCIONES = 2;

/** Intenta encajar un token en algún formato, con un tope de correcciones. */
function encajarEnFormato(token, permitirCorreccion) {
  const exacto = FORMATOS_PLACA.find(f => f.forma === formaDe(token));
  if (exacto) {
    return { placas: formatearPlaca(token, exacto.guiones), tipo: exacto.etiqueta, correcciones: 0 };
  }
  if (!permitirCorreccion) return null;

  for (const f of FORMATOS_PLACA) {
    if (f.forma.length !== token.length) continue;
    let correcciones = 0;
    const corregido = [...token].map((c, i) => {
      const nuevo = f.forma[i] === 'D' ? aDigito(c) : aLetra(c);
      if (nuevo !== c) correcciones++;
      return nuevo;
    }).join('');
    if (formaDe(corregido) === f.forma && correcciones <= MAX_CORRECCIONES) {
      return { placas: formatearPlaca(corregido, f.guiones), tipo: f.etiqueta, correcciones };
    }
  }
  return null;
}

// Palabras que anteceden a las placas cuando el huésped las escribe.
const ANCLA_PLACAS = /\b(PLACAS?|PLATES?|PLATE\s*NUMBER|MATRICULA|LICENSE\s*PLATE|NUMERO\s*DE\s*PLACAS?)\b\s*[:.#-]?\s*/g;

// Señales de que el texto viene de una identificación y no de un mensaje. En
// ese caso exigimos que las placas vengan ancladas a una palabra clave.
const RE_TEXTO_DE_DOCUMENTO = /DRIVER\s*LICEN[SC]E|IDENTIFICATION\s*CARD|INSTITUTO\s*NACIONAL|CREDENCIAL\s*PARA\s*VOTAR|PASSPORT|CLAVE\s*DE\s*ELECTOR/;

/**
 * Busca placas en el texto.
 *
 * Dos modos, según de dónde venga el texto:
 *
 * - **Anclado**: hay una palabra como "placas:" antes del dato. Es el caso
 *   real más común, porque el huésped las escribe en el chat. Alta confianza,
 *   y aceptamos espacios internos ("ABC 123 D").
 * - **Suelto**: solo se permite cuando el texto NO parece una identificación,
 *   y exige coincidencia exacta con un formato, sin correcciones. Así una foto
 *   de la placa sí funciona, pero los números de una licencia no se convierten
 *   en placas fantasma.
 */
// Cuánto texto miramos después de la palabra ancla. Tiene que alcanzar para
// saltar un paréntesis explicativo y llegar al renglón siguiente, porque las
// plantillas suelen poner la etiqueta y el dato en líneas distintas.
const VENTANA_TRAS_ANCLA = 90;

// Palabras que anuncian una placa de muestra, no la del huésped. Sin esto, una
// plantilla que diga "placas (ejemplo: ABC-123-D)" haría que la placa del
// ejemplo llegara al mensaje de seguridad cuando el huésped responde citándola.
const ANUNCIA_UN_EJEMPLO = /^(EJEMPLO|EJEMPLOS|EJEM|EJ|EXAMPLE|EG|FORMATO|ASI|MUESTRA)$/;

export function extraerPlacas(texto) {
  const t = normalizar(texto);
  const resultados = [];

  // --- Modo anclado ---
  ANCLA_PLACAS.lastIndex = 0;
  let ancla;
  let huboAncla = false;
  while ((ancla = ANCLA_PLACAS.exec(t)) !== null) {
    huboAncla = true;
    const inicio = ancla.index + ancla[0].length;
    const ventana = t.slice(inicio, inicio + VENTANA_TRAS_ANCLA);

    // Partimos en trozos alfanuméricos y probamos también uniendo hasta tres
    // seguidos, para aceptar placas escritas separadas: "ABC 123 D".
    const piezas = ventana.split(/[^A-Z0-9-]+/).filter(Boolean);

    let encontrada = null;
    for (let i = 0; i < piezas.length && !encontrada; i++) {
      if (i > 0 && ANUNCIA_UN_EJEMPLO.test(piezas[i - 1].replace(/-/g, ''))) continue;

      // De más trozos a menos: "ABC 123 D" es la placa completa, mientras que
      // quedarse con "ABC 123" daría un formato válido pero incompleto.
      for (let n = Math.min(3, piezas.length - i); n >= 1; n--) {
        const crudo = piezas.slice(i, i + n).join(' ');
        const token = crudo.replace(/[\s-]/g, '');
        if (token.length < 5 || token.length > 7) continue;

        const encaje = encajarEnFormato(token, true);
        if (encaje) {
          encontrada = {
            ...encaje,
            confianza: encaje.correcciones === 0 ? 'alta' : 'media',
            crudo,
            anclado: true,
          };
          break;
        }
      }
    }

    if (encontrada) resultados.push(encontrada);
  }

  if (resultados.length > 0) return deduplicar(resultados);

  // El campo estaba etiquetado y no traía una placa válida — por ejemplo,
  // cuando el huésped devuelve la plantilla sin llenarla. La respuesta correcta
  // es "no hay placa", no salir a buscarla por otro lado y traer la de muestra.
  if (huboAncla) return [];

  // --- Modo suelto: solo si el texto no es una identificación ---
  if (RE_TEXTO_DE_DOCUMENTO.test(t)) return [];

  const candidatos = t
    .replace(/[^A-Z0-9\n\-\s]/g, ' ')
    .split(/\s+/)
    .map(x => x.replace(/-/g, ''))
    .filter(x => x.length >= 5 && x.length <= 7 && /^[A-Z0-9]+$/.test(x) && /\d/.test(x) && /[A-Z]/.test(x));

  for (const token of candidatos) {
    const encaje = encajarEnFormato(token, false); // sin correcciones
    if (encaje) {
      resultados.push({ ...encaje, confianza: 'media', crudo: token, anclado: false });
    }
  }

  return deduplicar(resultados);
}

function deduplicar(resultados) {
  const vistos = new Set();
  return resultados
    .sort((a, b) => (a.confianza === 'alta' ? 0 : 1) - (b.confianza === 'alta' ? 0 : 1))
    .filter(r => (vistos.has(r.placas) ? false : vistos.add(r.placas)));
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

/**
 * Analiza el texto completo del OCR y arma el registro de una persona.
 * Devuelve además una lista de avisos para que la UI señale exactamente qué
 * campos necesitan ojo humano, en lugar de pedir revisar todo.
 */
export function analizarTexto(texto) {
  const avisos = [];
  const datos = {
    nombre: '', tipoDocumento: '', numeroDocumento: '', curp: '',
    fechaNacimiento: '', sexo: '', nacionalidad: '', placas: '', tipoPlaca: '',
    vehiculo: '', sinAuto: false, remitente: '',
  };

  // --- Documento de identidad ---

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

  const licencia = !mrz && extraerLicenciaUSA(texto);
  if (licencia) {
    datos.tipoDocumento = 'Licencia';
    datos.nombre = licencia.completo;
    datos.numeroDocumento = licencia.numero;
    datos.fechaNacimiento = licencia.fechaNacimiento;
    if (licencia.estado) datos.nacionalidad = 'USA';
    if (!licencia.apellido || !licencia.nombres) {
      avisos.push('De la licencia solo se leyó parte del nombre — complétalo a mano.');
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

  // --- Contexto del chat ---

  const remitente = extraerRemitenteChat(texto);
  if (remitente) {
    datos.remitente = remitente.nombre;
    // Si no se pudo leer el documento, el nombre del chat es mejor que nada.
    if (!datos.nombre) {
      datos.nombre = remitente.nombre;
      avisos.push(`No se leyó el documento; se tomó "${remitente.nombre}" del chat. Verifícalo.`);
    }
  }

  datos.sinAuto = detectarSinAuto(texto);

  const vehiculo = extraerVehiculo(texto);
  if (vehiculo) datos.vehiculo = vehiculo.vehiculo;

  // --- Placas ---

  const placas = extraerPlacas(texto);
  if (placas.length > 0) {
    datos.placas = placas[0].placas;
    datos.tipoPlaca = placas[0].tipo;
    if (placas[0].correcciones > 0) {
      avisos.push(`Las placas se corrigieron de "${placas[0].crudo}" — confírmalas.`);
    }
    if (!placas[0].anclado) {
      avisos.push('Las placas se dedujeron sin una etiqueta que las anuncie — verifícalas.');
    }
    if (placas.length > 1) {
      avisos.push(`Se detectó más de una placa posible: ${placas.map(p => p.placas).join(', ')}`);
    }
  }

  // --- Presentación ---

  // Nombre y vehículo viajan al mensaje de seguridad tal cual, así que se
  // entregan ya presentables en vez de gritados como los imprime la
  // credencial o como los normalizamos para analizarlos.
  if (datos.nombre) datos.nombre = capitalizarNombre(datos.nombre);
  if (datos.vehiculo) datos.vehiculo = formatearVehiculo(datos.vehiculo);

  // --- Avisos finales ---

  if (!datos.nombre) avisos.push('No se pudo leer el nombre — captúralo a mano.');
  if (!datos.placas && !datos.sinAuto) {
    avisos.push('No se detectaron placas. Si no traen coche, marca la casilla.');
  }

  return { datos, avisos, placasAlternativas: placas.slice(1).map(p => p.placas) };
}

// ---------------------------------------------------------------------------
// Entrada única
// ---------------------------------------------------------------------------

/** ¿La primera palabra del nombre coincide con la de otro? */
function mismaPersona(a, b) {
  const pila = s => normalizar(s).split(' ').filter(Boolean)[0] || '';
  return pila(a) === pila(b);
}

/**
 * Procesa de una sola pasada lo que la clienta pega o fotografía, sin que
 * tenga que elegir entre modos.
 *
 * De un mensaje de chat saca la lista de acompañantes, las placas, el vehículo
 * y el aviso de que no llevan coche. De la lectura de una credencial saca a la
 * persona con su documento. Distinguir los dos casos es necesario porque los
 * renglones de una credencial ("CALIFORNIA DRIVER LICENSE") parecen nombres si
 * se los mira uno por uno.
 *
 * @returns {{personas: Array, vehiculo: Object, avisos: string[], esDocumento: boolean}}
 */
export function procesarMensaje(texto) {
  const { datos, avisos } = analizarTexto(texto);
  const esDocumento = RE_TEXTO_DE_DOCUMENTO.test(normalizar(texto));

  // De una credencial sale una persona con su documento; de un mensaje escrito,
  // la lista completa de quienes van a entrar — ya venga en renglones o dentro
  // de una frase.
  let personas = [];
  if (!esDocumento) {
    const nombres = nombresDeLista(texto);
    personas = (nombres.length ? nombres : nombresEnFrase(texto))
      .map(nombre => ({ nombre }));
  }

  if (personas.length === 0 && datos.nombre) {
    personas = [{
      nombre: datos.nombre,
      tipoDocumento: datos.tipoDocumento,
      numeroDocumento: datos.numeroDocumento,
      curp: datos.curp,
    }];
  }

  // Quien escribe por Airbnb es quien reservó, así que encabeza la lista: es
  // el "Responsable" del mensaje a seguridad y ahorra un toque.
  if (datos.remitente && personas.length > 1) {
    const i = personas.findIndex(p => mismaPersona(p.nombre, datos.remitente));
    if (i > 0) personas.unshift(...personas.splice(i, 1));
  }

  const propios = [];
  if (personas.length === 0) {
    propios.push('No se reconoció ningún nombre en ese texto — agrégalos a mano.');
  }

  return {
    personas,
    vehiculo: { placas: datos.placas, vehiculo: datos.vehiculo, sinAuto: datos.sinAuto },
    // Los avisos sobre el nombre solo aplican al caso de una credencial; en un
    // mensaje escrito estorban, porque ahí los nombres vienen de la lista.
    avisos: esDocumento
      ? avisos
      : [...propios, ...avisos.filter(a => !a.includes('nombre'))],
    esDocumento,
  };
}
