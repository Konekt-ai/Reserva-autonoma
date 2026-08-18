// store.js — Persistencia local. Nada de esto sale del dispositivo.
//
// Decisión de diseño deliberada: NUNCA se guarda la imagen de la
// identificación. Se extraen los datos, se usan y la foto se descarta al
// cerrar la pantalla. Lo que queda es texto, que es lo mínimo necesario para
// que seguridad haga su trabajo — y lo que menos expone al huésped si el
// equipo se pierde o se lo roban.

const BD_NOMBRE = 'reserva-autonoma';
// v2: el registro pasó de una persona por fila a una reserva con varias
// personas, y el índice de fecha cambió de 'checkin' a 'fechaInicio'.
const BD_VERSION = 2;
const ALMACEN = 'registros';
const CLAVE_AJUSTES = 'reserva-autonoma:ajustes';

let bdPromise = null;

function abrirBD() {
  if (bdPromise) return bdPromise;

  bdPromise = new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(BD_NOMBRE, BD_VERSION);

    solicitud.onupgradeneeded = evento => {
      const bd = solicitud.result;
      const almacen = bd.objectStoreNames.contains(ALMACEN)
        ? evento.target.transaction.objectStore(ALMACEN)
        : bd.createObjectStore(ALMACEN, { keyPath: 'id', autoIncrement: true });

      // Índice viejo del modelo de una persona por registro.
      if (almacen.indexNames.contains('checkin')) almacen.deleteIndex('checkin');
      if (!almacen.indexNames.contains('fechaInicio')) almacen.createIndex('fechaInicio', 'fechaInicio');
      if (!almacen.indexNames.contains('capturadoEn')) almacen.createIndex('capturadoEn', 'capturadoEn');
    };

    solicitud.onsuccess = () => resolver(solicitud.result);
    solicitud.onerror = () => rechazar(solicitud.error);
  });

  return bdPromise;
}

function transaccion(modo, operacion) {
  return abrirBD().then(bd => new Promise((resolver, rechazar) => {
    const tx = bd.transaction(ALMACEN, modo);
    const solicitud = operacion(tx.objectStore(ALMACEN));
    tx.oncomplete = () => resolver(solicitud?.result);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error);
  }));
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

/** Guarda un registro nuevo y devuelve su id. */
export function guardarRegistro(registro) {
  return transaccion('readwrite', almacen => almacen.add({
    ...registro,
    capturadoEn: new Date().toISOString(),
  }));
}

/** Actualiza un registro existente (debe traer su id). */
export function actualizarRegistro(registro) {
  return transaccion('readwrite', almacen => almacen.put(registro));
}

/** Lista todos los registros, del más reciente al más antiguo. */
export async function listarRegistros() {
  const todos = await transaccion('readonly', almacen => almacen.getAll());
  return (todos || []).sort((a, b) => (b.capturadoEn || '').localeCompare(a.capturadoEn || ''));
}

export function borrarRegistro(id) {
  return transaccion('readwrite', almacen => almacen.delete(id));
}

export function borrarTodo() {
  return transaccion('readwrite', almacen => almacen.clear());
}

/**
 * Aplica la política de retención: elimina lo capturado hace más de N días.
 * Se ejecuta al abrir la app, de modo que la purga ocurre sola y la clienta
 * no tiene que acordarse — que es justamente donde fallan estas políticas.
 */
export async function purgarAntiguos(diasRetencion) {
  if (!diasRetencion || diasRetencion <= 0) return 0;

  const limite = new Date();
  limite.setDate(limite.getDate() - diasRetencion);
  const limiteISO = limite.toISOString();

  const todos = await listarRegistros();
  const caducados = todos.filter(r => (r.capturadoEn || '') < limiteISO);
  for (const r of caducados) await borrarRegistro(r.id);
  return caducados.length;
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

export const AJUSTES_POR_DEFECTO = {
  plantilla: null,        // null = usa PLANTILLA_POR_DEFECTO de format.js
  propiedades: [],        // lista de departamentos/torres para el desplegable
  telefonoSeguridad: '',  // opcional: abre el chat directo en vez del selector
  diasRetencion: 30,      // borrado automático
  binarizarSiempre: false,
};

export function leerAjustes() {
  try {
    const crudo = localStorage.getItem(CLAVE_AJUSTES);
    return { ...AJUSTES_POR_DEFECTO, ...(crudo ? JSON.parse(crudo) : {}) };
  } catch {
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(ajustes) {
  localStorage.setItem(CLAVE_AJUSTES, JSON.stringify({ ...leerAjustes(), ...ajustes }));
}
