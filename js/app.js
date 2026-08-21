// app.js — Orquestación de la interfaz.

import { reconocerVarias } from './ocr.js';
import { analizarTexto, validarCurp, nombresDeLista } from './parsers.js';
import {
  PLANTILLA_POR_DEFECTO, mensajeDeReserva, enlaceWhatsApp, copiarAlPortapapeles,
  resumenDelDia, aCSV, hoyISO,
} from './format.js';
import {
  guardarRegistro, listarRegistros, borrarRegistro, borrarTodo,
  purgarAntiguos, leerAjustes, guardarAjustes,
} from './store.js';

const $ = id => document.getElementById(id);

let siguienteId = 1;

/**
 * Reserva vacía. Una reserva agrupa a todas las personas que entran juntas.
 *
 * La unidad y las fechas quedan vacías a propósito: no son datos que el
 * huésped mande, sino que ya vienen de Airbnb. Poner la fecha de hoy por
 * omisión metería en el mensaje a seguridad un dato que nadie escribió.
 */
function reservaVacia() {
  return {
    propiedad: '',
    fechaInicio: '',
    fechaFin: '',
    placas: '',
    vehiculo: '',
    sinAuto: false,
    codigo: '',
    personas: [],
  };
}

// Estado en memoria. Las imágenes viven solo aquí y se descartan al terminar:
// nunca tocan disco ni la base de datos.
const estado = {
  imagenes: [],
  reserva: reservaVacia(),
  ajustes: leerAjustes(),
  registros: [],
};

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------

let temporizadorBrindis;
function avisar(mensaje) {
  const brindis = $('brindis');
  brindis.textContent = mensaje;
  brindis.classList.add('visible');
  clearTimeout(temporizadorBrindis);
  temporizadorBrindis = setTimeout(() => brindis.classList.remove('visible'), 2800);
}

function mostrarVista(nombre) {
  document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
  $(`vista-${nombre}`).classList.add('activa');
  document.querySelectorAll('.pestana').forEach(p => {
    p.classList.toggle('activa', p.dataset.vista === nombre);
  });
  if (nombre === 'registro') refrescarRegistro();
}

document.querySelectorAll('.pestana').forEach(p => {
  p.addEventListener('click', () => mostrarVista(p.dataset.vista));
});

// ---------------------------------------------------------------------------
// Personas de la reserva
// ---------------------------------------------------------------------------

function agregarPersona(datos = {}) {
  const persona = {
    id: siguienteId++,
    nombre: datos.nombre || '',
    tipoDocumento: datos.tipoDocumento || '',
    numeroDocumento: datos.numeroDocumento || '',
    curp: datos.curp || '',
    // La primera persona capturada es, por defecto, quien reservó.
    esResponsable: estado.reserva.personas.length === 0,
  };
  estado.reserva.personas.push(persona);
  dibujarPersonas();
  actualizarVistaPrevia();
  return persona;
}

function quitarPersona(id) {
  const { personas } = estado.reserva;
  const i = personas.findIndex(p => p.id === id);
  if (i === -1) return;

  const eraResponsable = personas[i].esResponsable;
  personas.splice(i, 1);
  // Si se fue quien reservó, el primero de la lista toma su lugar.
  if (eraResponsable && personas.length) personas[0].esResponsable = true;

  dibujarPersonas();
  actualizarVistaPrevia();
}

function marcarResponsable(id) {
  for (const p of estado.reserva.personas) p.esResponsable = p.id === id;
  dibujarPersonas();
  actualizarVistaPrevia();
}

function dibujarPersonas() {
  const contenedor = $('listaPersonas');
  contenedor.textContent = '';

  for (const persona of estado.reserva.personas) {
    const fila = document.createElement('div');
    fila.className = 'persona';

    // Selector de responsable.
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'responsable';
    radio.checked = persona.esResponsable;
    radio.title = 'Marcar como responsable de la reserva';
    radio.addEventListener('change', () => marcarResponsable(persona.id));

    const centro = document.createElement('div');
    centro.className = 'persona-centro';

    const entrada = document.createElement('input');
    entrada.type = 'text';
    entrada.value = persona.nombre;
    entrada.placeholder = 'Nombre completo';
    entrada.autocomplete = 'off';
    entrada.className = persona.nombre ? '' : 'revisar';
    entrada.addEventListener('input', () => {
      persona.nombre = entrada.value;
      entrada.classList.toggle('revisar', !entrada.value.trim());
      actualizarVistaPrevia();
    });

    centro.append(entrada);

    // Detalle del documento, solo si el OCR alcanzó a leerlo.
    const detalle = [persona.tipoDocumento, persona.numeroDocumento].filter(Boolean).join(' ');
    if (detalle) {
      const meta = document.createElement('div');
      meta.className = 'persona-meta';
      meta.textContent = detalle;
      centro.append(meta);
    }

    const rol = document.createElement('span');
    rol.className = 'persona-rol';
    rol.textContent = persona.esResponsable ? 'Responsable' : 'Acompañante';

    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'persona-quitar';
    quitar.textContent = '✕';
    quitar.title = 'Quitar de la reserva';
    quitar.addEventListener('click', () => quitarPersona(persona.id));

    fila.append(radio, centro, rol, quitar);
    contenedor.append(fila);
  }
}

$('btnAgregarManual').addEventListener('click', () => {
  agregarPersona();
  // El campo recién creado es el último input de la lista.
  const entradas = $('listaPersonas').querySelectorAll('input[type="text"]');
  entradas[entradas.length - 1]?.focus();
});

// ---------------------------------------------------------------------------
// Datos de la reserva
// ---------------------------------------------------------------------------

const CAMPOS_RESERVA = {
  campoPropiedad: 'propiedad',
  campoFechaInicio: 'fechaInicio',
  campoFechaFin: 'fechaFin',
  campoPlacas: 'placas',
  campoVehiculo: 'vehiculo',
  campoCodigo: 'codigo',
};

for (const [id, clave] of Object.entries(CAMPOS_RESERVA)) {
  $(id).addEventListener('input', e => {
    estado.reserva[clave] = clave === 'placas'
      ? e.target.value.toUpperCase()
      : e.target.value;
    if (clave === 'placas') e.target.value = estado.reserva.placas;
    actualizarVistaPrevia();
  });
}

$('campoSinAuto').addEventListener('change', e => {
  estado.reserva.sinAuto = e.target.checked;
  aplicarSinAuto();
  actualizarVistaPrevia();
});

/** Cuando no traen coche, los campos de placas y vehículo estorban. */
function aplicarSinAuto() {
  const desactivar = estado.reserva.sinAuto;
  for (const id of ['campoPlacas', 'campoVehiculo']) {
    $(id).disabled = desactivar;
    $(id).closest('.campo').classList.toggle('inactivo', desactivar);
  }
}

function volcarReservaEnFormulario() {
  for (const [id, clave] of Object.entries(CAMPOS_RESERVA)) {
    $(id).value = estado.reserva[clave] || '';
  }
  $('campoSinAuto').checked = estado.reserva.sinAuto;
  aplicarSinAuto();
}

function actualizarVistaPrevia() {
  const plantilla = estado.ajustes.plantilla || PLANTILLA_POR_DEFECTO;
  const mensaje = mensajeDeReserva(estado.reserva, plantilla);
  $('vistaPrevia').textContent = mensaje || '(agrega los datos de la reserva)';
}

// ---------------------------------------------------------------------------
// Pegar texto del chat
// ---------------------------------------------------------------------------
//
// Es el camino principal y el más exacto: el texto copiado del chat de Airbnb
// llega sin errores, mientras que en una foto hay que adivinar cada letra.

const campoPegado = $('campoPegado');

function refrescarBotonesPegado() {
  const vacio = campoPegado.value.trim() === '';
  $('btnLeerPegado').disabled = vacio;
  $('btnLeerNombres').disabled = vacio;
}

campoPegado.addEventListener('input', refrescarBotonesPegado);

$('btnLeerPegado').addEventListener('click', () => {
  const texto = campoPegado.value.trim();
  if (!texto) return;

  const { datos, avisos } = analizarTexto(texto);

  agregarPersona(datos);
  aplicarDatosDeReserva(datos);
  mostrarAvisos(avisos, datos);

  campoPegado.value = '';
  refrescarBotonesPegado();
  avisar(`Agregado: ${datos.nombre || 'persona sin nombre'}`);
});

$('btnLeerNombres').addEventListener('click', () => {
  const nombres = nombresDeLista(campoPegado.value);

  if (nombres.length === 0) {
    avisar('No se reconoció ningún nombre en ese texto.');
    return;
  }
  for (const nombre of nombres) agregarPersona({ nombre });

  campoPegado.value = '';
  refrescarBotonesPegado();
  avisar(`${nombres.length} persona(s) agregada(s).`);
});

// ---------------------------------------------------------------------------
// Carga de imágenes
// ---------------------------------------------------------------------------

function agregarImagenes(archivos) {
  const nuevas = [...archivos].filter(a => a.type.startsWith('image/'));
  if (nuevas.length === 0) {
    avisar('Ese archivo no es una imagen.');
    return;
  }
  for (const archivo of nuevas) {
    estado.imagenes.push({ archivo, url: URL.createObjectURL(archivo), rotacion: 0 });
  }
  $('bloqueFoto').open = true;
  dibujarMiniaturas();
}

function quitarImagen(indice) {
  URL.revokeObjectURL(estado.imagenes[indice].url);
  estado.imagenes.splice(indice, 1);
  dibujarMiniaturas();
}

function limpiarImagenes() {
  estado.imagenes.forEach(i => URL.revokeObjectURL(i.url));
  estado.imagenes = [];
  dibujarMiniaturas();
}

function dibujarMiniaturas() {
  const contenedor = $('miniaturas');
  contenedor.textContent = '';

  estado.imagenes.forEach((img, i) => {
    const caja = document.createElement('div');
    caja.className = 'miniatura';

    const vista = document.createElement('img');
    vista.src = img.url;
    vista.alt = `Imagen ${i + 1}`;
    vista.style.transform = `rotate(${img.rotacion}deg)`;

    const acciones = document.createElement('div');
    acciones.className = 'miniatura-acciones';

    const girar = document.createElement('button');
    girar.type = 'button';
    girar.textContent = '↻';
    girar.title = 'Girar 90° (el motor ya detecta la orientación solo)';
    girar.addEventListener('click', e => {
      e.preventDefault();
      img.rotacion = (img.rotacion + 90) % 360;
      dibujarMiniaturas();
    });

    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.textContent = '✕';
    quitar.title = 'Quitar';
    quitar.addEventListener('click', e => {
      e.preventDefault();
      quitarImagen(i);
    });

    acciones.append(girar, quitar);
    caja.append(vista, acciones);
    contenedor.append(caja);
  });

  $('btnLeer').disabled = estado.imagenes.length === 0;
}

$('entradaArchivos').addEventListener('change', e => {
  agregarImagenes(e.target.files);
  e.target.value = ''; // permite volver a elegir el mismo archivo
});

const zona = $('zonaSoltar');
zona.addEventListener('click', () => $('entradaArchivos').click());
zona.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('entradaArchivos').click();
  }
});
['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => {
  e.preventDefault();
  zona.classList.add('encima');
}));
['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => {
  e.preventDefault();
  zona.classList.remove('encima');
}));
zona.addEventListener('drop', e => agregarImagenes(e.dataTransfer.files));

/**
 * Ctrl+V en cualquier parte de la página. Es lo más rápido cuando trabaja
 * desde la computadora: copia del chat de Airbnb, cambia de pestaña y pega,
 * sin tener que apuntarle a ninguna caja.
 *
 * Si el cursor ya está dentro de un campo, no nos metemos: ahí el pegado
 * normal del navegador es lo que la persona espera.
 */
document.addEventListener('paste', e => {
  const dentroDeCampo = e.target instanceof HTMLInputElement
    || e.target instanceof HTMLTextAreaElement;
  if (dentroDeCampo) return;

  const archivos = [...(e.clipboardData?.files || [])];
  if (archivos.length) {
    agregarImagenes(archivos);
    avisar(`${archivos.length} imagen(es) pegada(s).`);
    return;
  }

  const texto = e.clipboardData?.getData('text')?.trim();
  if (texto) {
    e.preventDefault();
    $('bloqueTexto').open = true;
    campoPegado.value = campoPegado.value.trim()
      ? `${campoPegado.value.trim()}\n${texto}`
      : texto;
    refrescarBotonesPegado();
    campoPegado.scrollIntoView({ behavior: 'smooth', block: 'center' });
    avisar('Texto pegado — toca «Leer datos».');
  }
});

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

$('btnLeer').addEventListener('click', async () => {
  const boton = $('btnLeer');
  boton.disabled = true;
  $('progreso').classList.remove('oculto');
  $('avisos').textContent = '';

  const actualizarProgreso = (p, texto) => {
    $('barraRelleno').style.width = `${Math.round((p || 0) * 100)}%`;
    $('textoProgreso').textContent = texto || '';
  };

  try {
    actualizarProgreso(0, 'Preparando el motor de lectura…');
    const { texto, textoAmpliado } = await reconocerVarias(estado.imagenes, {
      alProgresar: actualizarProgreso,
    });

    $('textoCrudo').textContent = texto || '(sin texto)';

    // El analizador recibe todas las variantes de lectura; la vista de texto
    // crudo muestra solo la mejor, que es la legible para una persona.
    const { datos, avisos } = analizarTexto(textoAmpliado);

    agregarPersona(datos);
    aplicarDatosDeReserva(datos);
    mostrarAvisos(avisos, datos);

    limpiarImagenes();
  } catch (error) {
    console.error(error);
    avisar(error.message || 'No se pudo leer la imagen.');
  } finally {
    $('progreso').classList.add('oculto');
    boton.disabled = estado.imagenes.length === 0;
  }
});

/**
 * Algunos datos que salen de la foto pertenecen a la reserva, no a la persona:
 * las placas, el vehículo y el aviso de que no traen coche suelen venir en el
 * texto del chat. Solo se rellenan si el campo está vacío, para no pisar lo
 * que la clienta ya haya escrito a mano.
 */
function aplicarDatosDeReserva(datos) {
  if (datos.sinAuto && !estado.reserva.placas) {
    estado.reserva.sinAuto = true;
  }
  if (datos.placas && !estado.reserva.placas) {
    estado.reserva.placas = datos.placas;
    estado.reserva.sinAuto = false;
  }
  if (datos.vehiculo && !estado.reserva.vehiculo) {
    estado.reserva.vehiculo = datos.vehiculo;
  }
  volcarReservaEnFormulario();
  actualizarVistaPrevia();
}

function mostrarAvisos(avisos, datos) {
  const caja = $('avisos');
  caja.textContent = '';

  const lista = document.createElement('ul');

  // Confirmación positiva de lo que sí quedó verificado.
  if (datos.curp) {
    const v = validarCurp(datos.curp);
    if (v.valido) {
      const li = document.createElement('li');
      li.className = 'aviso-ok';
      li.textContent = `CURP válido (${v.fechaNacimiento}, ${v.sexo}) — verificado con su dígito de control.`;
      lista.append(li);
    }
  }

  for (const aviso of avisos) {
    const li = document.createElement('li');
    li.textContent = aviso;
    lista.append(li);
  }

  if (lista.children.length) caja.append(lista);
}

// ---------------------------------------------------------------------------
// Acciones de envío
// ---------------------------------------------------------------------------

function mensajeActual() {
  return mensajeDeReserva(estado.reserva, estado.ajustes.plantilla || PLANTILLA_POR_DEFECTO);
}

$('btnCopiar').addEventListener('click', async () => {
  const ok = await copiarAlPortapapeles(mensajeActual());
  avisar(ok ? 'Mensaje copiado — ya puedes pegarlo.' : 'No se pudo copiar.');
});

$('btnWhatsApp').addEventListener('click', () => {
  window.open(enlaceWhatsApp(mensajeActual(), estado.ajustes.telefonoSeguridad), '_blank');
});

$('btnGuardar').addEventListener('click', async () => {
  if (estado.reserva.personas.length === 0) {
    avisar('Agrega al menos una persona antes de guardar.');
    return;
  }
  await guardarRegistro({ ...estado.reserva });
  avisar('Reserva guardada en el registro.');
});

$('btnNuevo').addEventListener('click', reiniciarReserva);

function reiniciarReserva() {
  // Liberamos las imágenes de memoria: es el momento en que la foto de la
  // identificación deja de existir en la aplicación.
  limpiarImagenes();

  estado.reserva = reservaVacia();
  volcarReservaEnFormulario();
  dibujarPersonas();
  actualizarVistaPrevia();

  campoPegado.value = '';
  refrescarBotonesPegado();

  $('avisos').textContent = '';
  $('textoCrudo').textContent = '';
  $('bloqueFoto').open = false;
  $('bloqueTexto').open = true;
  $('bloqueAirbnb').open = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Registro e historial
// ---------------------------------------------------------------------------

async function refrescarRegistro() {
  estado.registros = await listarRegistros();
  dibujarLista();
  dibujarResumen();
}

function dibujarLista() {
  const filtro = $('campoBuscar').value.trim().toLowerCase();
  const contenedor = $('listaRegistros');
  contenedor.textContent = '';

  const visibles = estado.registros.filter(r => {
    if (!filtro) return true;
    const campos = [r.propiedad, r.placas, r.codigo, ...(r.personas || []).map(p => p.nombre)];
    return campos.some(v => (v || '').toLowerCase().includes(filtro));
  });

  for (const registro of visibles) {
    const personas = registro.personas || [];
    const responsable = personas.find(p => p.esResponsable) || personas[0];

    const fila = document.createElement('div');
    fila.className = 'registro';

    const datos = document.createElement('div');
    datos.className = 'registro-datos';

    const titulo = document.createElement('div');
    titulo.className = 'registro-nombre';
    titulo.textContent = responsable?.nombre || 'Sin nombre';

    const meta = document.createElement('div');
    meta.className = 'registro-meta';
    const trozos = [
      registro.propiedad,
      registro.fechaInicio,
      personas.length > 1 ? `${personas.length} personas` : null,
      registro.sinAuto ? 'sin auto' : registro.placas,
    ].filter(Boolean);
    for (const trozo of trozos) {
      const span = document.createElement('span');
      span.textContent = trozo;
      meta.append(span);
    }

    datos.append(titulo, meta);

    const acciones = document.createElement('div');
    acciones.className = 'registro-acciones';

    const copiar = document.createElement('button');
    copiar.type = 'button';
    copiar.textContent = 'Copiar';
    copiar.addEventListener('click', async () => {
      const plantilla = estado.ajustes.plantilla || PLANTILLA_POR_DEFECTO;
      const ok = await copiarAlPortapapeles(mensajeDeReserva(registro, plantilla));
      avisar(ok ? 'Copiado.' : 'No se pudo copiar.');
    });

    const eliminar = document.createElement('button');
    eliminar.type = 'button';
    eliminar.textContent = 'Borrar';
    eliminar.addEventListener('click', async () => {
      if (!confirm(`¿Borrar la reserva de ${responsable?.nombre || 'esta unidad'}?`)) return;
      await borrarRegistro(registro.id);
      await refrescarRegistro();
      avisar('Registro borrado.');
    });

    acciones.append(copiar, eliminar);
    fila.append(datos, acciones);
    contenedor.append(fila);
  }
}

$('campoBuscar').addEventListener('input', dibujarLista);

function dibujarResumen() {
  $('vistaResumen').textContent = resumenDelDia(estado.registros, $('campoFechaResumen').value);
}

$('campoFechaResumen').addEventListener('input', dibujarResumen);

$('btnCopiarResumen').addEventListener('click', async () => {
  const ok = await copiarAlPortapapeles($('vistaResumen').textContent);
  avisar(ok ? 'Resumen copiado.' : 'No se pudo copiar.');
});

$('btnWhatsAppResumen').addEventListener('click', () => {
  window.open(
    enlaceWhatsApp($('vistaResumen').textContent, estado.ajustes.telefonoSeguridad),
    '_blank',
  );
});

$('btnExportar').addEventListener('click', () => {
  // El BOM hace que Excel abra el CSV con los acentos correctos.
  const blob = new Blob(['﻿', aCSV(estado.registros)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `registro-accesos-${hoyISO()}.csv`;
  enlace.click();
  URL.revokeObjectURL(url);
});

$('btnBorrarTodo').addEventListener('click', async () => {
  if (!confirm('Esto borra TODO el historial y no se puede deshacer. ¿Continuar?')) return;
  await borrarTodo();
  await refrescarRegistro();
  avisar('Historial borrado.');
});

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function cargarAjustesEnFormulario() {
  const a = estado.ajustes;
  $('campoPlantilla').value = a.plantilla || PLANTILLA_POR_DEFECTO;
  $('campoPropiedades').value = (a.propiedades || []).join('\n');
  $('campoRetencion').value = a.diasRetencion ?? 30;
  $('campoTelefono').value = a.telefonoSeguridad || '';
  actualizarListaPropiedades();
}

function actualizarListaPropiedades() {
  const lista = $('listaPropiedades');
  lista.textContent = '';
  for (const propiedad of estado.ajustes.propiedades || []) {
    const opcion = document.createElement('option');
    opcion.value = propiedad;
    lista.append(opcion);
  }
}

function persistirAjustes(parcial) {
  estado.ajustes = { ...estado.ajustes, ...parcial };
  guardarAjustes(parcial);
}

$('campoPlantilla').addEventListener('input', e => {
  persistirAjustes({ plantilla: e.target.value });
  actualizarVistaPrevia();
});

$('btnRestablecerPlantilla').addEventListener('click', () => {
  $('campoPlantilla').value = PLANTILLA_POR_DEFECTO;
  persistirAjustes({ plantilla: null });
  actualizarVistaPrevia();
  avisar('Plantilla restablecida.');
});

$('campoPropiedades').addEventListener('input', e => {
  const propiedades = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
  persistirAjustes({ propiedades });
  actualizarListaPropiedades();
});

$('campoRetencion').addEventListener('input', e => {
  persistirAjustes({ diasRetencion: Number(e.target.value) || 0 });
});

$('campoTelefono').addEventListener('input', e => {
  persistirAjustes({ telefonoSeguridad: e.target.value });
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function iniciar() {
  $('campoFechaResumen').value = hoyISO();

  cargarAjustesEnFormulario();
  volcarReservaEnFormulario();
  dibujarPersonas();
  actualizarVistaPrevia();

  // La purga automática corre al abrir: así la retención se cumple sola.
  try {
    const borrados = await purgarAntiguos(estado.ajustes.diasRetencion);
    if (borrados > 0) avisar(`Se borraron ${borrados} registro(s) por antigüedad.`);
  } catch (error) {
    console.error('No se pudo aplicar la retención:', error);
  }

  await refrescarRegistro();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Sin service worker la app sigue funcionando, solo pierde el modo offline.
    });
  }
}

iniciar();
