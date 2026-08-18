// app.js — Orquestación de la interfaz.

import { reconocerVarias } from './ocr.js';
import { analizarTexto, validarCurp } from './parsers.js';
import {
  PLANTILLA_POR_DEFECTO, renderizar, enlaceWhatsApp, copiarAlPortapapeles,
  resumenDelDia, aCSV, fechaISOaLocal,
} from './format.js';
import {
  guardarRegistro, listarRegistros, borrarRegistro, borrarTodo,
  purgarAntiguos, leerAjustes, guardarAjustes,
} from './store.js';

const $ = id => document.getElementById(id);

// Estado en memoria. Las imágenes viven solo aquí y se descartan al terminar:
// nunca tocan disco ni la base de datos.
const estado = {
  imagenes: [],       // { archivo, url, rotacion }
  textoCrudo: '',
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
  temporizadorBrindis = setTimeout(() => brindis.classList.remove('visible'), 2600);
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
  dibujarMiniaturas();
}

function quitarImagen(indice) {
  URL.revokeObjectURL(estado.imagenes[indice].url);
  estado.imagenes.splice(indice, 1);
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
    girar.title = 'Girar 90°';
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

// Pegar con Ctrl+V: es lo más rápido cuando trabaja desde la computadora.
document.addEventListener('paste', e => {
  const archivos = [...(e.clipboardData?.files || [])];
  if (archivos.length) {
    agregarImagenes(archivos);
    avisar(`${archivos.length} imagen(es) pegada(s).`);
  }
});

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

$('btnLeer').addEventListener('click', async () => {
  const boton = $('btnLeer');
  boton.disabled = true;
  $('progreso').classList.remove('oculto');

  const actualizarProgreso = (p, texto) => {
    $('barraRelleno').style.width = `${Math.round((p || 0) * 100)}%`;
    $('textoProgreso').textContent = texto || '';
  };

  try {
    actualizarProgreso(0, 'Preparando el motor de lectura…');
    const { texto } = await reconocerVarias(estado.imagenes, { alProgresar: actualizarProgreso });

    estado.textoCrudo = texto;
    $('textoCrudo').textContent = texto || '(sin texto)';

    const { datos, avisos } = analizarTexto(texto);
    llenarFormulario(datos);
    mostrarAvisos(avisos);

    $('tarjetaDatos').classList.remove('oculto');
    $('tarjetaMensaje').classList.remove('oculto');
    actualizarVistaPrevia();
    $('tarjetaDatos').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    avisar(error.message || 'No se pudo leer la imagen.');
    // Aun con el OCR caído, la captura manual debe seguir siendo posible.
    $('tarjetaDatos').classList.remove('oculto');
    $('tarjetaMensaje').classList.remove('oculto');
  } finally {
    $('progreso').classList.add('oculto');
    boton.disabled = false;
  }
});

function llenarFormulario(datos) {
  $('campoNombre').value = datos.nombre || '';
  $('campoTipoDocumento').value = datos.tipoDocumento || '';
  $('campoNumeroDocumento').value = datos.numeroDocumento || '';
  $('campoCurp').value = datos.curp || '';
  $('campoPlacas').value = datos.placas || '';
  revisarCurp();
}

function mostrarAvisos(avisos) {
  const caja = $('avisos');
  caja.textContent = '';
  if (!avisos.length) return;

  const lista = document.createElement('ul');
  for (const aviso of avisos) {
    const li = document.createElement('li');
    li.textContent = aviso;
    lista.append(li);
  }
  caja.append(lista);

  // Resaltamos los campos citados para dirigir la vista al problema.
  const texto = avisos.join(' ').toLowerCase();
  $('campoNombre').classList.toggle('revisar', texto.includes('nombre'));
  $('campoPlacas').classList.toggle('revisar', texto.includes('placa'));
  $('campoCurp').classList.toggle('revisar', texto.includes('curp'));
}

// ---------------------------------------------------------------------------
// Formulario y vista previa
// ---------------------------------------------------------------------------

const CAMPOS = [
  'campoNombre', 'campoTipoDocumento', 'campoNumeroDocumento', 'campoCurp',
  'campoPlacas', 'campoVehiculo', 'campoPropiedad', 'campoPersonas',
  'campoCheckin', 'campoCheckout', 'campoReserva',
];

function datosDelFormulario() {
  return {
    nombre: $('campoNombre').value.trim(),
    tipoDocumento: $('campoTipoDocumento').value.trim(),
    numeroDocumento: $('campoNumeroDocumento').value.trim(),
    curp: $('campoCurp').value.trim().toUpperCase(),
    placas: $('campoPlacas').value.trim().toUpperCase(),
    vehiculo: $('campoVehiculo').value.trim(),
    propiedad: $('campoPropiedad').value.trim(),
    personas: $('campoPersonas').value.trim(),
    checkin: fechaISOaLocal($('campoCheckin').value),
    checkout: fechaISOaLocal($('campoCheckout').value),
    reserva: $('campoReserva').value.trim(),
  };
}

function mensajeActual() {
  const plantilla = estado.ajustes.plantilla || PLANTILLA_POR_DEFECTO;
  return renderizar(plantilla, datosDelFormulario());
}

function actualizarVistaPrevia() {
  $('vistaPrevia').textContent = mensajeActual() || '(completa los datos)';
}

/** Valida el CURP en vivo: el dígito verificador nos dice si está bien escrito. */
function revisarCurp() {
  const valor = $('campoCurp').value.trim().toUpperCase();
  const estadoCurp = $('estadoCurp');

  if (!valor) {
    estadoCurp.textContent = '';
    estadoCurp.className = '';
    $('campoCurp').classList.remove('revisar');
    return;
  }

  const r = validarCurp(valor);
  if (r.valido) {
    estadoCurp.textContent = `✓ válido · ${r.fechaNacimiento} · ${r.sexo}`;
    estadoCurp.className = 'ok';
    $('campoCurp').classList.remove('revisar');
  } else {
    estadoCurp.textContent = '✕ no válido';
    estadoCurp.className = 'mal';
    $('campoCurp').classList.add('revisar');
  }
}

CAMPOS.forEach(id => {
  $(id).addEventListener('input', () => {
    actualizarVistaPrevia();
    if (id === 'campoCurp') revisarCurp();
  });
});

// ---------------------------------------------------------------------------
// Acciones de envío
// ---------------------------------------------------------------------------

$('btnCopiar').addEventListener('click', async () => {
  const ok = await copiarAlPortapapeles(mensajeActual());
  avisar(ok ? 'Mensaje copiado — ya puedes pegarlo.' : 'No se pudo copiar.');
});

$('btnWhatsApp').addEventListener('click', () => {
  window.open(enlaceWhatsApp(mensajeActual(), estado.ajustes.telefonoSeguridad), '_blank');
});

$('btnGuardar').addEventListener('click', async () => {
  const datos = datosDelFormulario();
  if (!datos.nombre) {
    avisar('Falta el nombre para poder guardar.');
    return;
  }
  await guardarRegistro(datos);
  avisar('Guardado en el registro.');
});

$('btnNuevo').addEventListener('click', reiniciarCaptura);

function reiniciarCaptura() {
  // Liberamos las imágenes de memoria: es el momento en que la foto de la
  // identificación deja de existir en la aplicación.
  estado.imagenes.forEach(i => URL.revokeObjectURL(i.url));
  estado.imagenes = [];
  estado.textoCrudo = '';

  dibujarMiniaturas();
  CAMPOS.forEach(id => {
    const el = $(id);
    el.value = id === 'campoPersonas' ? '1' : '';
    el.classList.remove('revisar');
  });
  $('avisos').textContent = '';
  $('textoCrudo').textContent = '';
  $('estadoCurp').textContent = '';
  $('tarjetaDatos').classList.add('oculto');
  $('tarjetaMensaje').classList.add('oculto');
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
    return [r.nombre, r.placas, r.propiedad, r.reserva]
      .some(v => (v || '').toLowerCase().includes(filtro));
  });

  for (const registro of visibles) {
    const fila = document.createElement('div');
    fila.className = 'registro';

    const datos = document.createElement('div');
    datos.className = 'registro-datos';

    const nombre = document.createElement('div');
    nombre.className = 'registro-nombre';
    nombre.textContent = registro.nombre || 'Sin nombre';

    const meta = document.createElement('div');
    meta.className = 'registro-meta';
    for (const parte of [registro.propiedad, registro.placas, registro.checkin].filter(Boolean)) {
      const span = document.createElement('span');
      span.textContent = parte;
      meta.append(span);
    }

    datos.append(nombre, meta);

    const acciones = document.createElement('div');
    acciones.className = 'registro-acciones';

    const copiar = document.createElement('button');
    copiar.type = 'button';
    copiar.textContent = 'Copiar';
    copiar.addEventListener('click', async () => {
      const plantilla = estado.ajustes.plantilla || PLANTILLA_POR_DEFECTO;
      const ok = await copiarAlPortapapeles(renderizar(plantilla, registro));
      avisar(ok ? 'Copiado.' : 'No se pudo copiar.');
    });

    const eliminar = document.createElement('button');
    eliminar.type = 'button';
    eliminar.textContent = 'Borrar';
    eliminar.addEventListener('click', async () => {
      if (!confirm(`¿Borrar el registro de ${registro.nombre}?`)) return;
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
  const fecha = fechaISOaLocal($('campoFechaResumen').value);
  $('vistaResumen').textContent = resumenDelDia(estado.registros, fecha);
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
  enlace.download = `registro-accesos-${new Date().toISOString().slice(0, 10)}.csv`;
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
  const hoyISO = new Date().toISOString().slice(0, 10);
  $('campoCheckin').value = hoyISO;
  $('campoFechaResumen').value = hoyISO;

  cargarAjustesEnFormulario();

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
