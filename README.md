# Registro de Acceso — Reservas

Captura los datos de los huéspedes (nombre y placas) a partir de las fotos que
mandan por el chat de Airbnb, y genera el mensaje listo para el grupo de
seguridad del edificio.

**Todo el procesamiento ocurre en el dispositivo.** No hay servidor, no hay
cuenta, no hay API key y no hay costo por uso. La foto de la identificación
nunca sale de la computadora o el celular donde se abre la aplicación.

---

## El problema que resuelve

El flujo manual toma unos 5 minutos por reserva:

1. El huésped manda foto de su identificación por el chat de Airbnb
2. Se transcribe el nombre y las placas a un bloc de notas
3. Se reescribe con formato y se pega en el grupo de WhatsApp de seguridad

Con esta herramienta son unos 30 segundos: se sube la foto, se revisa lo que
leyó el OCR y se toca **Copiar** o **WhatsApp**.

---

## Puesta en marcha

Se necesita [Node.js](https://nodejs.org) instalado (solo para servir los
archivos; la aplicación en sí es HTML y JavaScript sin compilación).

```bash
npm run vendorizar   # una sola vez: descarga el motor de OCR (~35 MB) a vendor/
npm start            # abre http://localhost:5173
```

El paso `vendorizar` es lo que permite que la aplicación funcione sin internet
y sin contactar ningún servidor externo. Si se omite, la primera lectura
descarga el motor desde un CDN público y el service worker lo guarda en caché
para los usos siguientes.

> **No abras `index.html` con doble clic.** El protocolo `file://` impide que
> funcionen los módulos de JavaScript y el OCR. Usa siempre `npm start`.

### Instalarla en el celular

Con el servidor corriendo, abre la dirección desde el celular (mismo Wi-Fi) y
usa **Añadir a pantalla de inicio**. Queda como una app: abre a pantalla
completa y funciona sin conexión.

Para usarla fuera de la red local, publica la carpeta en cualquier hosting
estático (GitHub Pages, Netlify, Cloudflare Pages — todos con plan gratuito).
Sigue sin haber backend: el hosting solo entrega archivos, el procesamiento
sigue siendo local.

---

## Cómo se usa

**1 · Fotos** — Sube la identificación y, si vinieron aparte, la foto de las
placas. Se puede arrastrar, elegir del carrete o pegar con `Ctrl+V`. El botón
`↻` gira las fotos que llegaron de lado.

**2 · Revisa** — El OCR llena los campos. Los que necesitan atención salen
resaltados en ámbar con el motivo arriba. Se corrige lo que haga falta.

**3 · Envía** — `📋 Copiar` deja el mensaje en el portapapeles.
`💬 Abrir WhatsApp` abre la app con el mensaje ya escrito.

> WhatsApp **no permite** que un enlace apunte a un grupo específico: es una
> limitación de la plataforma, no de esta herramienta. El botón abre WhatsApp
> con el texto listo y se elige el grupo de seguridad. Son dos toques y cero
> escritura.

**Registro** — Historial con búsqueda, exportación a CSV y un **resumen del
día**: una sola lista con todas las entradas de la fecha, que suele ser lo que
más le sirve al equipo en la caseta.

**Ajustes** — Plantilla del mensaje, lista de propiedades, teléfono de
seguridad y política de retención.

---

## Verificaciones automáticas que hace la app

El OCR se equivoca; lo que evita que sus errores lleguen a seguridad son estas
comprobaciones deterministas:

- **Dígito verificador del CURP** — El CURP trae un carácter de control
  calculado a partir de los otros 17. Solo 1 de cada 10 valores posibles
  valida, así que un CURP que pasa esta prueba está bien leído casi con
  certeza. Se muestra en vivo: `✓ válido · 15/03/1995 · Mujer`.

- **Cruce nombre ↔ CURP** — Las primeras 4 letras del CURP son las iniciales
  de los apellidos y el nombre. Si el nombre leído no concuerda, la app avisa
  que uno de los dos está mal. (Contempla la regla de RENAPO que salta MARIA y
  JOSE, y las partículas tipo *DE LA*.)

- **MRZ de pasaportes** — Las dos líneas con `<<<` siguen el estándar ICAO 9303
  y cada campo trae su propio dígito verificador. Es la lectura más confiable
  que existe, y la app dice exactamente qué campo falló si alguno no cuadra.

- **Formatos de placas** — Se contrastan contra los patrones mexicanos
  conocidos. Si la lectura no encaja en ninguno, se corrigen las confusiones
  típicas del OCR (`O`↔`0`, `I`↔`1`, `S`↔`5`) en las posiciones donde el patrón
  exige letra o dígito, y se marca para confirmación.

---

## Qué tan preciso es

En fotos limpias y bien iluminadas la extracción es fiable. En fotos de celular
tomadas de reojo, con reflejo del holograma o dobladas, la precisión baja
bastante — es la limitación real de Tesseract frente a un modelo de visión.

**El diseño asume esto**: el OCR *pre-llena* y la persona *confirma*. Aunque
solo acierte la mitad de los campos, se pasa de teclear cuatro a corregir uno,
y la persona ya está viendo la foto de todos modos.

Si en la práctica la precisión resulta insuficiente, hay dos rutas de mejora:

| Opción | Costo | Precisión | Sigue siendo local |
|---|---|---|---|
| Tesseract (actual) | $0 | media | sí |
| Modelo de visión local vía [Ollama](https://ollama.com) | $0 + GPU decente | alta | sí |
| Claude Opus 5 con visión | ~$0.02 USD por foto | muy alta | no |

La arquitectura está preparada para el cambio: solo se sustituye el motor en
[js/ocr.js](js/ocr.js). El resto —validaciones, plantillas, registro— no se
toca, porque `analizarTexto()` recibe texto sin importar de dónde venga.

---

## Privacidad

Se manejan datos personales de identificación, así que las decisiones de diseño
van en esa dirección:

- **Las fotos nunca se guardan.** Viven en memoria durante la captura y se
  liberan al tocar *Empezar otro*. No se escriben a disco ni a la base de datos.
- **Solo se guarda el texto extraído**, en el navegador del dispositivo
  (IndexedDB). No hay servidor donde pueda filtrarse.
- **Borrado automático** por antigüedad, configurable (30 días por defecto), que
  se ejecuta solo al abrir la app.

### Recomendación para el uso real

Manda a seguridad **el nombre y las placas, no la imagen de la identificación**.
Una foto de INE reenviada a un grupo de WhatsApp queda replicada en el teléfono
de cada guardia, indefinidamente y fuera de todo control. La plantilla por
defecto ya está diseñada así.

Para cumplir con la LFPDPPP hace falta además un aviso de privacidad al huésped
que indique qué datos se recaban, para qué, quién los recibe y por cuánto
tiempo se conservan. Eso va en el mensaje de Airbnb, junto con la solicitud de
documentos.

---

## Estructura

```
index.html                    interfaz completa (3 pestañas)
css/styles.css                estilos, móvil primero, claro y oscuro
js/
  app.js                      orquestación y estado
  ocr.js                      Tesseract WASM + preprocesado en canvas
  parsers.js                  CURP, MRZ, clave de elector, placas  ← lógica pura
  format.js                   plantillas, enlace de WhatsApp, CSV
  store.js                    IndexedDB y ajustes
scripts/
  vendorizar-ocr.mjs          descarga el motor de OCR a vendor/
  generar-iconos.mjs          genera los PNG del PWA
test/                         pruebas de parsers.js y format.js
sw.js                         service worker (modo sin conexión)
```

`parsers.js` y `format.js` no tocan el DOM ni la red: son funciones puras, y
por eso son las que están cubiertas por pruebas.

```bash
npm test    # 36 pruebas
```

---

## Siguientes pasos posibles

- **Formulario para el huésped** — Un enlace único por reserva que el huésped
  abre y llena él mismo. Elimina la transcripción por completo; el trabajo lo
  hace quien tiene los datos. Reutiliza los mismos parsers.
- **Motor de visión local** vía Ollama, si la precisión de Tesseract se queda
  corta.
- **Lectura del código de barras PDF417** del reverso de la INE, que contiene
  los datos ya digitalizados y evitaría el OCR del frente.
