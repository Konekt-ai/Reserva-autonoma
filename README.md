# Registro de Acceso — Reservas

Convierte lo que los huéspedes mandan por el chat de Airbnb — texto o fotos —
en el mensaje que el equipo de seguridad del edificio espera recibir.

**Todo el procesamiento ocurre en el dispositivo.** No hay servidor, no hay
cuenta, no hay API key y no hay costo por uso. La foto de la identificación
nunca sale de la computadora o el celular donde se abre la aplicación.

---

## Qué produce

Entrada: el texto copiado del chat de Airbnb, o fotos (capturas del chat,
credenciales, o la pantalla de un celular mostrando una identificación).

Salida, lista para copiar o mandar por WhatsApp:

```
Departamento 606 Torre 2
Fechas: 16-17 agosto
Responsable: Ana Ruiz
Otros huéspedes:
Luis Ruiz
Diego Andres Castillo
Placas: No traen auto
```

El formato es configurable en **Ajustes**; el de arriba es el que ya se usaba
a mano, para que el equipo de seguridad no tenga que acostumbrarse a nada.

---

## Dos formas de capturar

**Pegar texto (principal).** Se copia el mensaje del chat de Airbnb y se pega
en la aplicación — con `Ctrl+V` en cualquier parte de la página, sin apuntarle
a ninguna caja. El texto copiado llega sin errores, así que este camino es
mucho más exacto que la foto: no hay ninguna letra que adivinar. De ahí salen
las placas, el vehículo, el aviso de que no llevan coche y el nombre de quien
escribe.

Hay dos botones porque son dos cosas distintas:

- **Leer datos** — analiza el mensaje del huésped y agrega una persona.
- **Solo son nombres** — trata cada renglón como una persona distinta. Sirve
  para la lista de acompañantes; entiende viñetas, numeración y encabezados
  como «Otros huéspedes:», y descarta lo que claramente no es un nombre.

**Leer desde foto (respaldo).** Para cuando solo llega la imagen de la
identificación. Usa OCR local; la orientación se detecta sola.

## Qué documentos entiende

Medido contra fotos reales de huéspedes, no contra casos ideales:

- **Licencias de conducir de Estados Unidos** — etiquetas `LN`/`FN`, número de
  licencia, fecha de nacimiento. Es lo que más llega en la práctica.
- **Credenciales INE** — nombre en tres renglones, CURP, clave de elector.
- **Pasaportes** — vía la MRZ (las dos líneas con `<<<`), que trae dígitos
  verificadores por campo.
- **Capturas del chat de Airbnb** — de ahí salen datos que no están en ningún
  documento: quién reservó, las placas cuando el huésped las escribe
  (`"Nissan Versa 2022, placas: ABC 123 D"`) y el aviso de que no llevan coche
  (`"we won't be bringing a car"`, `"no traen auto"`).

La orientación se detecta sola: las credenciales fotografiadas de lado se leen
igual que las derechas.

---

## Puesta en marcha

Se necesita [Node.js](https://nodejs.org) instalado (solo para servir los
archivos; la aplicación en sí es HTML y JavaScript sin compilación).

```bash
npm install          # solo si vas a correr las pruebas de navegador
npm start            # abre http://localhost:5173
```

El motor de OCR ya viene en `vendor/` dentro del repositorio, así que no hay
nada que descargar. Si alguna vez hay que actualizarlo o cambiar de idioma:

```bash
npm run vendorizar   # rehace vendor/ (~25 MB)
```

Tener el motor versionado es lo que permite que la aplicación funcione sin
internet y sin contactar ningún servidor externo. Si `vendor/` faltara, la
primera lectura lo descargaría de un CDN público y el service worker lo
guardaría en caché para los usos siguientes.

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

## Publicarla en Vercel

El proyecto es estático: no hay build ni backend. Vercel solo entrega archivos,
y el procesamiento sigue ocurriendo en el dispositivo de quien la usa.

1. En [vercel.com](https://vercel.com) → **Add New… → Project** e importa el
   repositorio de GitHub.
2. En **Framework Preset** elige **Other**. Deja Build Command e Install Command
   vacíos y Output Directory en `.` — [vercel.json](vercel.json) ya lo declara,
   así que normalmente lo detecta solo.
3. **Deploy.**

Si el repositorio es privado (que es como debe estar, porque el historial tocó
datos de huéspedes), Vercel pide autorizar su aplicación de GitHub para leerlo.
Eso es normal y no lo hace público.

### Qué configura `vercel.json`

- **`sw.js` e `index.html` sin caché.** Es lo que permite que una versión nueva
  llegue a quien ya tiene la app instalada. Sin esto, el service worker seguiría
  sirviendo la versión vieja para siempre.
- **`vendor/` cacheado un año como inmutable.** Son 25 MB de binarios que nunca
  cambian; se descargan una vez y ya.
- **Encabezados de seguridad**: `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` y un `Permissions-Policy` que deja la cámara
  disponible para tomar la foto y apaga micrófono y ubicación.

### Después del primer despliegue, comprueba dos cosas

1. **Que el OCR funcione**, leyendo una identificación cualquiera. Si falla al
   cargar el motor, revisa en la pestaña Red del navegador que
   `/vendor/lang/spa.traineddata.gz` responda `200` y **sin** encabezado
   `Content-Encoding`.
2. **Que se instale en el celular**: abrir la URL y usar «Añadir a pantalla de
   inicio». Con HTTPS —que Vercel da por omisión— también funcionan el botón de
   copiar y el modo sin conexión, que sobre `http://` quedan limitados.

### Nota sobre privacidad al publicarla

La URL de Vercel es pública para quien la conozca. La app no expone datos por sí
sola —todo vive en el navegador de cada quien— pero cualquiera con el enlace
puede abrirla y usarla. Si eso incomoda, Vercel permite protegerla con
contraseña en Settings → Deployment Protection.

---

## Cómo se usa

**1 · Datos de la reserva** — Unidad, fechas y vehículo. Si el huésped avisó
que no lleva coche, la casilla se marca sola al leer la captura del chat.

**2 · Personas que ingresan** — Una reserva agrupa a todas las personas que
entran juntas. Cada texto pegado o foto leída agrega una persona a la lista.
El botón de radio marca quién es el **responsable**; el resto quedan como
acompañantes. También se puede agregar a alguien a mano.

**3 · Mensaje** — `📋 Copiar` deja el texto en el portapapeles.
`💬 Abrir WhatsApp` abre la app con el mensaje ya escrito.

> WhatsApp **no permite** que un enlace apunte a un grupo específico: es una
> limitación de la plataforma, no de esta herramienta. El botón abre WhatsApp
> con el texto listo y se elige el grupo de seguridad. Son dos toques y cero
> escritura.

**Registro** — Historial con búsqueda, exportación a CSV (una fila por
persona) y un **resumen del día**: una sola lista con todas las entradas de la
fecha, que suele ser lo que más le sirve al equipo en la caseta.

---

## Precisión real

Medida sobre siete fotos reales de huéspedes — comprimidas por WhatsApp, de
360 a 960 px de ancho, algunas fotografiadas de la pantalla de otro celular:

| Dato | Resultado |
|---|---|
| Número de documento correcto | 5 / 6 |
| Nombre completo y exacto | 3 / 7 |
| Nombre exacto o parcial | 6 / 7 |
| Nombre **incorrecto** | 0 / 7 |
| Placas inventadas | 0 / 7 |
| "No traen auto" detectado | 7 / 7 |

Estas cifras son con el motor en español solamente. Agregar inglés sube un
nombre de parcial a exacto y un documento más, pero cuesta 10 MB de descarga y
más del doble de tiempo en cada lectura — ver `IDIOMAS` en
[js/ocr.js](js/ocr.js) para el detalle y cómo revertirlo.

Las dos últimas filas importan más que las demás. **La herramienta prefiere
dejar un campo vacío antes que llenarlo con algo que no leyó bien**, porque un
nombre o unas placas equivocadas en el mensaje a seguridad son peores que un
hueco que la persona completa en cinco segundos.

Esa decisión tiene una historia concreta: en la primera versión, el número de
licencia `5550448` se "corregía" hasta convertirse en las placas `SSS-044-B`,
que nadie había escrito nunca. Hoy las placas solo se aceptan si vienen
anunciadas por una palabra como *placas:* o si el texto no es una
identificación, y las correcciones de OCR tienen un tope de dos caracteres.

---

## Verificaciones automáticas

El OCR se equivoca; lo que evita que sus errores lleguen a seguridad son estas
comprobaciones deterministas:

- **Dígito verificador del CURP** — El CURP trae un carácter de control
  calculado a partir de los otros 17. Solo 1 de cada 10 valores posibles
  valida, así que un CURP que pasa esta prueba está bien leído casi con
  certeza.

- **Cruce nombre ↔ CURP** — Las primeras 4 letras del CURP son las iniciales
  de los apellidos y el nombre. Si el nombre leído no concuerda, la app avisa
  que uno de los dos está mal. (Contempla la regla de RENAPO que salta MARIA y
  JOSE, y las partículas tipo *DE LA*.)

- **MRZ de pasaportes** — Estándar ICAO 9303, con dígito verificador por campo.
  Es la lectura más confiable que existe, y la app dice exactamente qué campo
  falló si alguno no cuadra.

- **Formatos de placas** — Se contrastan contra los patrones mexicanos
  conocidos, con las salvaguardas descritas arriba.

- **Filtro de nombres** — Descarta fragmentos como `SEN E` o etiquetas de la
  credencial (`CLASS`, `NONE`, `END`) que el OCR produce con fotos muy
  comprimidas.

---

## Si la precisión no alcanza

La arquitectura está preparada para cambiar de motor: solo se sustituye
[js/ocr.js](js/ocr.js). El resto —validaciones, plantillas, registro— no se
toca, porque `analizarTexto()` recibe texto sin importar de dónde venga.

| Opción | Costo | Precisión | Sigue siendo local |
|---|---|---|---|
| Tesseract (actual) | $0 | media | sí |
| Modelo de visión local vía [Ollama](https://ollama.com) | $0 + GPU decente | alta | sí |
| Claude Opus 5 con visión | ~$0.02 USD por foto | muy alta | no |

La palanca más barata, sin embargo, no es técnica: **pedir los datos escritos**
en vez de fotografiados. Un mensaje escrito se copia y se pega, y entonces no
hay OCR de por medio ni nada que pueda leerse mal.

---

## La plantilla de Airbnb

La precisión depende mucho de cómo esté redactada la respuesta automática que
se le manda al huésped. La clienta observó, con razón, que **para el huésped es
más fácil mandar solo las fotos** — entre más se le pida, menos responde. Así
que esta versión mantiene la foto como lo principal y pide por escrito
únicamente lo que de verdad necesita serlo:

```
Hola {Guest first name}, gracias por tu reserva.

Para tu acceso al edificio necesito:

1) Foto de identificación de cada persona que se hospeda
2) Nombre completo de cada una
3) Placas del auto, escritas (ejemplo: ABC-123-D).
   Si no traen auto, avísame.

Estos datos se comparten únicamente con el personal de seguridad del
edificio para autorizar tu acceso, y se eliminan después de tu estancia.
```

Las placas son el punto clave: fotografiadas fallan seguido, escritas se leen
prácticamente siempre. El último párrafo es el aviso de privacidad que pide la
ley para tratar identificaciones.

### Si se prefiere una respuesta más estructurada

Cuando el huésped es cooperativo, una plantilla en forma de formulario deja los
datos listos para pegar de un solo golpe:

```
Nombre completo de cada persona que ingresa:
1.
2.
3.

Placas del auto (escríbelas, ejemplo: ABC-123-D):

Auto (marca, modelo y color):
```

La lista numerada se convierte en personas con el botón *Solo son nombres*.

**El ejemplo de placa no envenena el dato.** Los huéspedes suelen responder
citando la plantilla completa, así que el `ABC-123-D` viaja en el texto. El
analizador reconoce que va precedido de «ejemplo:» y lo ignora; si el huésped
devuelve la plantilla sin llenar, el campo queda vacío en vez de copiar la
muestra. Hay pruebas de regresión para esto en
[test/documentos-reales.test.mjs](test/documentos-reales.test.mjs).

También conviene **programar la plantilla** para que salga sola al confirmarse
la reserva, en vez de mandarla a mano.


---

## Privacidad

Se manejan datos personales de identificación, así que las decisiones de diseño
van en esa dirección:

- **Las fotos nunca se guardan.** Viven en memoria durante la captura y se
  liberan en cuanto se agrega la persona a la reserva. No se escriben a disco
  ni a la base de datos.
- **Solo se guarda el texto extraído**, en el navegador del dispositivo
  (IndexedDB). No hay servidor donde pueda filtrarse.
- **Borrado automático** por antigüedad, configurable (30 días por defecto),
  que se ejecuta solo al abrir la app.

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
  ocr.js                      Tesseract WASM, rotación automática, preprocesado
  parsers.js                  licencias, INE, MRZ, placas, contexto del chat
  format.js                   plantillas, rango de fechas, WhatsApp, CSV
  store.js                    IndexedDB y ajustes
scripts/
  vendorizar-ocr.mjs          descarga el motor de OCR a vendor/
  generar-iconos.mjs          genera los PNG del PWA
test/
  parsers.test.mjs            CURP, MRZ, formatos de placas
  documentos-reales.test.mjs  texto real del OCR de las fotos de huéspedes
  format.test.mjs             composición del mensaje y del resumen
sw.js                         service worker (modo sin conexión)
```

`parsers.js` y `format.js` no tocan el DOM ni la red: son funciones puras, y
por eso son las que están cubiertas por pruebas.

```bash
npm test    # 75 pruebas
```

`documentos-reales.test.mjs` merece una nota: sus casos son transcripciones
literales de lo que Tesseract devolvió con las fotos reales, ruido incluido.
Fijan el comportamiento frente al material que de verdad llega, y cada bug
corregido dejó ahí su prueba de regresión.

---

## Siguientes pasos posibles

- **Formulario para el huésped** — Un enlace único por reserva que el huésped
  abre y llena él mismo, subiendo su identificación y escribiendo sus placas.
  Elimina la transcripción por completo; el trabajo lo hace quien tiene los
  datos. Reutiliza los mismos parsers.
- **Motor de visión local** vía Ollama, si la precisión de Tesseract se queda
  corta.
- **Lectura del código PDF417** del reverso de las licencias estadounidenses y
  de la INE, que contiene los datos ya digitalizados y evitaría el OCR.
