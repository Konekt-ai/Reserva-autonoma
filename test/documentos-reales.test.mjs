// Pruebas contra el tipo de texto que Tesseract produce con las fotos reales
// que llegan por el chat de Airbnb: ruido, etiquetas pegadas al dato, líneas
// partidas. Conservan la ESTRUCTURA exacta de la salida del OCR, que es lo que
// se está probando, pero con nombres, domicilios, fechas y números de
// documento sustituidos: son datos personales de huéspedes y no tienen por qué
// vivir en el historial del repositorio.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extraerLicenciaUSA, extraerPlacas, detectarSinAuto, extraerVehiculo,
  extraerRemitenteChat, analizarTexto, capitalizarNombre,
  nombresDeLista, pareceNombre, formatearVehiculo, procesarMensaje, nombresEnFrase,
} from '../js/parsers.js';

// Captura del chat de Airbnb: Ana avisa que no llevan coche, con su licencia.
const OCR_CHAT_SIN_AUTO = `Ana - Booker 3:39 PM
Hello, yes please see the ID of the people going. Also, we won't be
bringing a car.
California DRIVER LICENSE — ¿q
ps 7
Dn A1234567 — - cusse
¿ Eee 10/15/2028 END NONE
LNRUIZ
FN ANA
1000 MAIN ST
SPRINGFIELD, CA 90210`;

// Licencia comercial fotografiada desde la pantalla de un celular.
const OCR_LICENCIA_PANTALLA = `California El
COMMERCIAL DRIVER LICENSE
Ue 0. B7654321
B exe 09/08/2030
pos 02/20/1995
cass A
END NONE
RSTR 24
LN RUIZ
FN LUIS
1000 MAIN ST
SPRINGFIELD, CA 90210`;

// Tarjeta sostenida en la mano y girada; el OCR ensucia bastante.
const OCR_LICENCIA_GIRADA = `E. H DRIVER LICENSE RAL
California= ==
i us
ou C2468135 e
ex? 06/21 12031 END NONE
LNCASTILLO &
. EN DIEGO ANDRES
500 OAK ST APT 2
SACRAMENTO, CA 95811`;

// Captura del chat donde las placas vienen escritas, no en el documento.
const OCR_CHAT_CON_PLACAS = `O Carlos >
B% Translation off
Carlos - Booker 10:31 PM
Hola buenas noches, claro que si!
Nissan Versa 2022, placas: ABC 123 D`;

// ---------------------------------------------------------------------------
// Licencias de Estados Unidos
// ---------------------------------------------------------------------------

test('lee apellido, nombre y número de una licencia de California', () => {
  const r = extraerLicenciaUSA(OCR_LICENCIA_PANTALLA);
  assert.equal(r.apellido, 'RUIZ');
  assert.equal(r.nombres, 'LUIS');
  assert.equal(r.completo, 'LUIS RUIZ');
  assert.equal(r.numero, 'B7654321');
  assert.equal(r.estado, 'CALIFORNIA');
});

test('tolera que el OCR pegue la etiqueta al apellido ("LNRUIZ")', () => {
  const r = extraerLicenciaUSA(OCR_CHAT_SIN_AUTO);
  assert.equal(r.apellido, 'RUIZ');
  assert.equal(r.nombres, 'ANA');
  assert.equal(r.numero, 'A1234567');
});

test('tolera que lea "FN" como "EN"', () => {
  const r = extraerLicenciaUSA(OCR_LICENCIA_GIRADA);
  assert.equal(r.nombres, 'DIEGO ANDRES');
  assert.equal(r.apellido, 'CASTILLO');
  assert.equal(r.numero, 'C2468135');
});

test('no confunde etiquetas de la credencial con un nombre', () => {
  const r = extraerLicenciaUSA(`California DRIVER LICENSE
LN CLASS
FN NONE
DL A1234567`);
  assert.equal(r.apellido, '');
  assert.equal(r.nombres, '');
  assert.equal(r.numero, 'A1234567');
});

test('rechaza fragmentos de una letra que produce el OCR ("SEN E")', () => {
  // Este texto salió de una foto de 370x486 px; sin el filtro, "SEN E"
  // acababa en el mensaje a seguridad como si fuera un nombre.
  const r = extraerLicenciaUSA(`DRIVER LICENSE California
OH! CARL
"EN Sen e € z
ou C2468135`);
  assert.notEqual(r.nombres, 'SEN E');
  assert.equal(r.numero, 'C2468135');
});

test('devuelve null cuando el texto no es una licencia', () => {
  assert.equal(extraerLicenciaUSA('INSTITUTO NACIONAL ELECTORAL\nNOMBRE\nGARCIA'), null);
});

// ---------------------------------------------------------------------------
// Placas — el punto donde un error es más caro
// ---------------------------------------------------------------------------

test('lee las placas escritas en el chat, con espacios de por medio', () => {
  const r = extraerPlacas(OCR_CHAT_CON_PLACAS);
  assert.equal(r[0].placas, 'ABC-123-D');
  assert.equal(r[0].anclado, true);
  assert.equal(r[0].confianza, 'alta');
});

test('acepta las placas ya escritas con guiones', () => {
  assert.equal(extraerPlacas('placas: ABC-123-D')[0].placas, 'ABC-123-D');
});

test('entiende la palabra en inglés', () => {
  assert.equal(extraerPlacas('plate number ABC123D')[0].placas, 'ABC-123-D');
});

// Estas cuatro pruebas cubren el peor error posible de la herramienta: mandar
// a seguridad unas placas que nadie escribió nunca. Antes, el número de
// licencia "5550448" se "corregía" hasta convertirse en "SSS-044-B".
test('NO inventa placas a partir del número de una licencia', () => {
  for (const [etiqueta, texto] of Object.entries({
    sinAuto: OCR_CHAT_SIN_AUTO, pantalla: OCR_LICENCIA_PANTALLA, girada: OCR_LICENCIA_GIRADA,
  })) {
    assert.deepEqual(extraerPlacas(texto), [], `inventó placas en el caso ${etiqueta}`);
  }
});

test('NO inventa placas a partir de un código postal o un domicilio', () => {
  assert.deepEqual(extraerPlacas('DRIVER LICENSE\n1000 MAIN ST\nSPRINGFIELD, CA 90210'), []);
});

test('sí acepta una placa suelta cuando el texto no es una identificación', () => {
  // Caso real: el huésped manda la foto de la placa del coche.
  const r = extraerPlacas('ABC123D');
  assert.equal(r[0].placas, 'ABC-123-D');
  assert.equal(r[0].anclado, false);
});

test('una placa suelta debe encajar exacta, sin correcciones inventadas', () => {
  // "ABCG1OD" no es ninguna placa; sin ancla no se le permite corregir.
  assert.deepEqual(extraerPlacas('ABCG1OD'), []);
});

test('con ancla sí corrige confusiones del OCR, pero con tope', () => {
  const r = extraerPlacas('placas: ABCO2OD'); // O donde van 6 y 0
  assert.ok(r.length > 0, 'debió corregir una placa anclada');
  assert.equal(r[0].confianza, 'media');
});

// ---------------------------------------------------------------------------
// Contexto del chat
// ---------------------------------------------------------------------------

test('detecta que no llevan coche, en inglés', () => {
  assert.equal(detectarSinAuto(OCR_CHAT_SIN_AUTO), true);
});

test('detecta que no llevan coche, en español', () => {
  for (const frase of ['No traen auto', 'vamos sin coche', 'no llevamos carro', 'No traemos vehiculo']) {
    assert.equal(detectarSinAuto(frase), true, `no detectó: "${frase}"`);
  }
});

test('no confunde un mensaje que sí menciona coche', () => {
  assert.equal(detectarSinAuto(OCR_CHAT_CON_PLACAS), false);
});

test('extrae marca, modelo y año del mensaje', () => {
  assert.equal(extraerVehiculo(OCR_CHAT_CON_PLACAS).vehiculo, 'NISSAN VERSA 2022');
});

test('NO inventa un vehículo desde el domicilio de la licencia', () => {
  // "SACRAMENTO" contiene "RAM": sin límites de palabra aparecía un vehículo
  // fantasma llamado "RAMENTO".
  assert.equal(extraerVehiculo(OCR_LICENCIA_GIRADA), null);
});

test('identifica quién escribe en el chat de Airbnb', () => {
  assert.equal(extraerRemitenteChat(OCR_CHAT_CON_PLACAS).nombre, 'Carlos');
  assert.equal(extraerRemitenteChat(OCR_CHAT_SIN_AUTO).nombre, 'Ana');
});

// ---------------------------------------------------------------------------
// Análisis completo
// ---------------------------------------------------------------------------

test('de la captura de Ana saca nombre, documento y que no traen coche', () => {
  const { datos } = analizarTexto(OCR_CHAT_SIN_AUTO);
  assert.equal(datos.nombre, 'Ana Ruiz');
  assert.equal(datos.numeroDocumento, 'A1234567');
  assert.equal(datos.tipoDocumento, 'Licencia');
  assert.equal(datos.sinAuto, true);
  assert.equal(datos.placas, '');
});

test('de la captura de Carlos saca placas y vehículo, sin documento legible', () => {
  const { datos } = analizarTexto(OCR_CHAT_CON_PLACAS);
  assert.equal(datos.placas, 'ABC-123-D');
  assert.equal(datos.vehiculo, 'Nissan Versa 2022');
  assert.equal(datos.sinAuto, false);
  assert.equal(datos.nombre, 'Carlos'); // tomado del chat, no del documento
});

test('avisa cuando el nombre vino del chat y no de una identificación', () => {
  const { avisos } = analizarTexto(OCR_CHAT_CON_PLACAS);
  assert.ok(
    avisos.some(a => a.includes('No se leyó el documento')),
    `faltó el aviso de verificación: ${JSON.stringify(avisos)}`,
  );
});

test('no pide confirmar placas cuando el mensaje dice que no traen coche', () => {
  const { avisos } = analizarTexto(OCR_CHAT_SIN_AUTO);
  assert.ok(
    !avisos.some(a => a.includes('No se detectaron placas')),
    `pidió placas de más: ${JSON.stringify(avisos)}`,
  );
});

// ---------------------------------------------------------------------------
// Presentación del nombre
// ---------------------------------------------------------------------------

test('las credenciales gritan el nombre; el mensaje no debe hacerlo', () => {
  assert.equal(capitalizarNombre('DIEGO ANDRES CASTILLO'), 'Diego Andres Castillo');
  assert.equal(capitalizarNombre('MARIA FERNANDA LOPEZ RUIZ'), 'Maria Fernanda Lopez Ruiz');
});

test('las partículas de apellido van en minúscula, salvo al inicio', () => {
  assert.equal(capitalizarNombre('CARLOS DE LA TORRE'), 'Carlos de la Torre');
  assert.equal(capitalizarNombre('DE LA TORRE CARLOS'), 'De la Torre Carlos');
});

test('analizarTexto entrega el nombre ya capitalizado', () => {
  assert.equal(analizarTexto(OCR_LICENCIA_PANTALLA).datos.nombre, 'Luis Ruiz');
  assert.equal(analizarTexto(OCR_LICENCIA_GIRADA).datos.nombre, 'Diego Andres Castillo');
});

// ---------------------------------------------------------------------------
// Texto pegado del chat — el camino principal, más exacto que la foto
// ---------------------------------------------------------------------------

test('un pegado con placas y vehículo llena la reserva sin OCR de por medio', () => {
  const { datos } = analizarTexto(
    'Hola buenas noches, claro que sí!\nNissan Versa 2022, placas: ABC 123 D',
  );
  assert.equal(datos.placas, 'ABC-123-D');
  assert.equal(datos.vehiculo, 'Nissan Versa 2022');
});

test('un pegado que avisa que no llevan coche marca la casilla', () => {
  assert.equal(analizarTexto('Hola! No traemos auto, llegamos en taxi.').datos.sinAuto, true);
});

test('convierte una lista pegada en varias personas', () => {
  const pegado = `Otros huéspedes:
- ana ruiz
- LUIS RUIZ
3) Diego Andres Castillo`;
  assert.deepEqual(nombresDeLista(pegado), ['Ana Ruiz', 'Luis Ruiz', 'Diego Andres Castillo']);
});

test('ignora los encabezados y las etiquetas del propio mensaje', () => {
  const pegado = `Departamento 606 Torre 2
Fechas: 16-17 agosto
Responsable: Ana Ruiz
Placas: No traen auto`;
  // Ninguna de esas líneas es una persona: llevan dígitos o son etiquetas.
  assert.deepEqual(nombresDeLista(pegado), ['Ana Ruiz']);
});

test('descarta renglones con números, símbolos o frases largas', () => {
  const pegado = `Ana Ruiz
Depa 606
hola buenas noches como estas espero que muy bien gracias
correo@ejemplo.com
Luis Díaz`;
  assert.deepEqual(nombresDeLista(pegado), ['Ana Ruiz', 'Luis Díaz']);
});

test('no repite un nombre que venga dos veces', () => {
  assert.deepEqual(nombresDeLista('Ana Ruiz\nANA RUIZ\nana ruiz'), ['Ana Ruiz']);
});

test('acepta nombres de una sola palabra y con acentos', () => {
  assert.deepEqual(nombresDeLista('Carlos\nJosé Ángel Peña'), ['Carlos', 'José Ángel Peña']);
});

test('pareceNombre rechaza lo que no debe llegar al mensaje de seguridad', () => {
  for (const basura of ['', 'ab', '606', 'Torre 2', 'placas: ABC123D', '1000 MAIN ST']) {
    assert.equal(pareceNombre(basura), false, `dejó pasar: "${basura}"`);
  }
});

test('el vehículo se entrega presentable, sin arruinar las marcas que son siglas', () => {
  assert.equal(formatearVehiculo('NISSAN VERSA 2022'), 'Nissan Versa 2022');
  assert.equal(formatearVehiculo('BMW SERIE 3'), 'BMW Serie 3');
  assert.equal(formatearVehiculo('vw jetta 2019'), 'VW Jetta 2019');
});

// ---------------------------------------------------------------------------
// Respuestas a la plantilla de Airbnb
// ---------------------------------------------------------------------------
//
// La plantilla incluye un ejemplo de formato de placa. Los huéspedes suelen
// responder citando la plantilla completa, así que el ejemplo viaja en el
// texto y no debe confundirse jamás con la placa real.

const RESPUESTA_A_PLANTILLA = `Nombre completo de cada persona que ingresa:
1. Ana Ruiz
2. Luis Ruiz
3. Diego Andres Castillo

Placas del auto (escríbelas, ejemplo: ABC-123-D):
XKM-482-P

Auto (marca, modelo y color):
Nissan Versa 2022 blanco`;

test('toma la placa real y NO la del ejemplo de la plantilla', () => {
  const r = extraerPlacas(RESPUESTA_A_PLANTILLA);
  assert.equal(r[0].placas, 'XKM-482-P', `tomó la del ejemplo: ${JSON.stringify(r)}`);
  assert.ok(!r.some(p => p.placas === 'ABC-123-D'), 'la placa de muestra se coló');
});

test('encuentra la placa aunque venga en el renglón de abajo', () => {
  assert.equal(extraerPlacas('Placas:\nABC 123 D')[0].placas, 'ABC-123-D');
});

test('acepta la placa escrita en trozos separados', () => {
  assert.equal(extraerPlacas('placas ABC 123 D')[0].placas, 'ABC-123-D');
});

test('ignora la muestra con otras formas de anunciarla', () => {
  for (const anuncio of ['ejemplo:', 'ej:', 'example:', 'formato:', 'así:']) {
    const r = extraerPlacas(`Placas (${anuncio} ABC-123-D):\nABC-123-D`);
    assert.equal(r[0].placas, 'ABC-123-D', `falló con "${anuncio}"`);
  }
});

test('si el huésped solo cita el ejemplo sin llenar nada, no inventa una placa', () => {
  assert.deepEqual(extraerPlacas('Placas del auto (escríbelas, ejemplo: ABC-123-D):'), []);
});

test('la respuesta completa a la plantilla se procesa de un solo pegado', () => {
  const { datos } = analizarTexto(RESPUESTA_A_PLANTILLA);
  assert.equal(datos.placas, 'XKM-482-P');
  assert.equal(datos.vehiculo, 'Nissan Versa 2022');

  assert.deepEqual(nombresDeLista(RESPUESTA_A_PLANTILLA),
    ['Ana Ruiz', 'Luis Ruiz', 'Diego Andres Castillo']);
});

test('detecta la respuesta de quien no lleva coche', () => {
  const { datos } = analizarTexto(`Nombre completo:
1. Sofia Herrera

Placas del auto (escríbelas, ejemplo: ABC-123-D):
No traemos auto`);
  assert.equal(datos.sinAuto, true);
  assert.equal(datos.placas, '');
});

// ---------------------------------------------------------------------------
// Entrada única: un solo pegado resuelve el caso completo
// ---------------------------------------------------------------------------

test('la respuesta a la plantilla se resuelve de un pegado, sin elegir modo', () => {
  const r = procesarMensaje(RESPUESTA_A_PLANTILLA);
  assert.deepEqual(r.personas.map(p => p.nombre),
    ['Ana Ruiz', 'Luis Ruiz', 'Diego Andres Castillo']);
  assert.equal(r.vehiculo.placas, 'XKM-482-P');
  assert.equal(r.vehiculo.vehiculo, 'Nissan Versa 2022');
  assert.equal(r.vehiculo.sinAuto, false);
  assert.equal(r.esDocumento, false);
});

test('una plantilla a medio llenar pasa con lo que haya', () => {
  const r = procesarMensaje(`Nombre completo de cada persona que ingresa:
1. Ana Ruiz
2.
3.

Placas del auto (escríbelas, ejemplo: ABC-123-D):

Auto (marca, modelo y color):`);
  assert.deepEqual(r.personas.map(p => p.nombre), ['Ana Ruiz']);
  assert.equal(r.vehiculo.placas, '', 'no debió copiar la placa del ejemplo');
  assert.equal(r.vehiculo.sinAuto, false);
});

test('quien no lleva coche queda marcado sin tocar nada', () => {
  const r = procesarMensaje(`Nombre completo:
1. Ana Ruiz
2. Luis Ruiz

No traemos auto`);
  assert.equal(r.personas.length, 2);
  assert.equal(r.vehiculo.sinAuto, true);
});

test('un mensaje suelto, sin plantilla, también funciona', () => {
  const r = procesarMensaje('Hola! Somos Ana Ruiz y Luis Ruiz.\nplacas: ABC-123-D');
  assert.equal(r.vehiculo.placas, 'ABC-123-D');
  assert.ok(r.personas.length >= 1, `no reconoció a nadie: ${JSON.stringify(r.personas)}`);
});

test('de una credencial sale una persona con su documento, no renglones sueltos', () => {
  const r = procesarMensaje(OCR_LICENCIA_PANTALLA);
  assert.equal(r.esDocumento, true);
  assert.equal(r.personas.length, 1);
  assert.equal(r.personas[0].nombre, 'Luis Ruiz');
  assert.equal(r.personas[0].numeroDocumento, 'B7654321');
  // "CALIFORNIA DRIVER LICENSE" son puras letras: sin la distinción de origen
  // se colarían como si fueran huéspedes.
  assert.ok(!r.personas.some(p => /LICENSE|CALIFORNIA/i.test(p.nombre)));
});

test('quien escribe por Airbnb encabeza la lista', () => {
  const r = procesarMensaje(`Luis Ruiz · Booker
10:31 PM
Van a entrar:
Ana Ruiz
Luis Ruiz
Diego Andres Castillo`);
  assert.equal(r.personas[0].nombre, 'Luis Ruiz',
    `el que reservó debía ir primero: ${r.personas.map(p => p.nombre).join(', ')}`);
});

test('sin nada reconocible avisa en vez de inventar', () => {
  const r = procesarMensaje('ok gracias');
  assert.equal(r.personas.length, 0);
  assert.ok(r.avisos.some(a => a.includes('No se reconoció')));
});

test('un mensaje escrito no arrastra los avisos propios de una credencial', () => {
  const r = procesarMensaje('1. Ana Ruiz\n2. Luis Ruiz\nNo traemos auto');
  assert.ok(!r.avisos.some(a => a.includes('captúralo a mano')),
    `aviso fuera de lugar: ${JSON.stringify(r.avisos)}`);
});

test('reconoce nombres escritos dentro de una frase', () => {
  const r = procesarMensaje('Hola! Somos Ana Ruiz y Luis Díaz.\nplacas: ABC-123-D');
  assert.deepEqual(r.personas.map(p => p.nombre), ['Ana Ruiz', 'Luis Díaz']);
  assert.equal(r.vehiculo.placas, 'ABC-123-D');
});

test('la frase acepta comas y varias personas', () => {
  assert.deepEqual(
    nombresEnFrase('Van a entrar Ana Ruiz, Luis Díaz y Sofia Herrera.'),
    ['Ana Ruiz', 'Luis Díaz', 'Sofia Herrera'],
  );
});

test('NO convierte una frase común en un huésped', () => {
  // Sin exigir mayúscula inicial, "muy puntuales" acabaría en el mensaje.
  for (const frase of ['somos muy puntuales', 'vamos a llegar tarde', 'van a ser dos noches']) {
    assert.deepEqual(nombresEnFrase(frase), [], `inventó a alguien en: "${frase}"`);
  }
});

test('la lista en renglones tiene prioridad sobre la frase', () => {
  const r = procesarMensaje(`Somos tres personas
1. Ana Ruiz
2. Luis Díaz`);
  assert.deepEqual(r.personas.map(p => p.nombre), ['Ana Ruiz', 'Luis Díaz']);
});
