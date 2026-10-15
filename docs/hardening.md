# Auditoría de seguridad y calidad — 22 de septiembre de 2026

Estado auditado: commit `c97eddf`, desplegado en `roble-maquinaria.vercel.app`.
Correcciones en `7582e54`.

Ninguna operación sobre datos reales. La base de producción (Neon) no se ha
tocado: todo lo que necesitaba una base de datos se probó contra un Postgres
local, sobre una réplica del esquema que se borró al terminar.

---

## 1. Inventario de la API

Un solo endpoint HTTP nuevo. Los módulos con guion bajo **no** son alcanzables
por web (Vercel no los despliega como funciones): comprobado, devuelven 404.

| Ruta | Método | Autenticación | Permisos | Tablas | Respuesta sin permiso |
|---|---|---|---|---|---|
| `/api/auth` | GET | opcional | ninguno | `sesiones`, `usuarios` (SELECT), `membresias`, `empresas`, `emails_verificados` | `{user:null, companies:[]}` |
| `/api/auth?empresa=<id>` | POST | **obligatoria** | membresía activa en esa empresa | las mismas + `auditoria` (INSERT) | 401 sin sesión · 404 si no es suya |

`/api/auth` GET devuelve quién eres, tus empresas, la activa y tus permisos.
POST cambia de empresa activa y **solo** acepta un `empresa` con el que tengas
membresía activa: el identificador que llega del navegador nunca se acepta sin
comprobarlo. El 404 es el mismo tanto si la empresa no existe como si no es
tuya, para no revelar qué empresas hay.

Módulos internos, no expuestos: `_esquema`, `_permisos`, `_invitaciones`,
`_migracion`, `_auditoria`, `_conexion`.

---

## 2. Problemas corregidos

### 2.1 `/api/auth` creaba tablas en producción — el más grave

`init()` ejecutaba los `CREATE TABLE` y lo llamaba un endpoint **público**. En
cuanto hubiera cadena de conexión, cualquier visita anónima con una cookie
habría creado las seis tablas de identidad en producción: sin auditoría previa,
sin backup y sin que nadie lo decidiera.

Ahora `init()` solo comprueba que existan y falla con un mensaje claro. El
esquema se crea a mano y de forma deliberada:

```bash
node api/_esquema.js           # dice qué falta, no toca nada
node api/_esquema.js --crear   # las crea
```

### 2.2 Panel de administración sin credenciales

`/admin/index.html?demo` fabricaba una sesión de administrador. Reproducido en
el sitio desplegado antes de corregirlo. Quitado de `admin.js` y `ml-admin.js`.

### 2.3 IDOR en el panel de vendedor

`/panel/index.html?demo=173` abría el panel como ese vendedor, cambiando el
número en la barra de direcciones. Quitado.

### 2.4 Escalada a administrador por el correo

Cualquier dirección acabada en `@roble.es` daba rol `admin`, decidido en el
navegador con una expresión regular. Ya no se concede ahí.

### 2.5 La validación de formularios ignoraba la mitad de las reglas

`validate()` solo miraba «obligatorio» y el formato del correo, así que
`minlength`, `pattern`, `min` y `max` eran decorado: una contraseña de tres
caracteres pasaba pese al `minlength="8"`. Se delega en `checkValidity()` del
navegador. Afectaba a **todos** los formularios.

### 2.6 Nombres de categoría cortados en móvil

«Centros de mecanizado CNC» se leía «de mecanizado CNC». El título va anclado
abajo en posición absoluta y sobresalía 19 px por encima de una tarjeta con
`overflow: hidden`. El primer arreglo (recortar a dos líneas) dejaba «Centros
de…», que no dice qué categoría es, así que se corrigió la causa: dos columnas
en móvil y tarjeta más alta.

---

## 3. Verificado

### Identidad — `scripts/qa-identidad.mjs`, 30 comprobaciones

Contra Postgres local. Cubre: sesión válida, caducada, token inventado y sin
token · usuario sin empresa, con una y con varias · membresía revocada ·
**aislamiento entre empresas**: un usuario no alcanza datos de otra ni para ver
ni para editar · los tres roles · empresa suspendida (solo lectura) · cascadas
al borrar usuario y empresa, sin huérfanos · rechazo de membresía duplicada,
rol inventado y usuario inexistente.

Incluye una comprobación que **falla si sus consultas dejan de coincidir** con
`api/_permisos.js`, para que la prueba no quede en verde ejerciendo código
viejo.

### Migración, ensayada sobre réplica local

5 de 7 cuentas migradas conservando su id exacto; las 2 excluidas con su motivo
(comprador, borrada lógicamente). Repetible sin duplicar, reversible, y los
datos legacy intactos después de revertir. Las reseñas siguieron apuntando a la
empresa correcta.

### Cookies y terceros

La web **no usa ninguna cookie ni almacenamiento** al navegar: medido en
navegador tras visitar cinco páginas. Los únicos terceros son
`fonts.googleapis.com` y `fonts.gstatic.com` (CSS y fuentes). No hay analítica,
ni píxeles, ni rastreo. Por eso esta web no necesita hoy banner de
consentimiento; lo necesitará el día que se añada analítica o incrustaciones.

### Web y SEO

36 combinaciones de página y tamaño (móvil 390, tablet 768, escritorio 1440) sin
desbordes, sin páginas vacías, sin imágenes rotas y sin errores de JavaScript.
17 páginas recorridas sin un solo enlace interno roto. `canonical` y Open Graph
en las 20 páginas indexables y ausentes en las cuatro `noindex`. Todos los
campos de formulario tienen nombre accesible; un `h1` por página; `lang="es"`.

### Cabeceras

`Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`,
`Referrer-Policy`, `Strict-Transport-Security` y `X-Content-Type-Options`,
activas y comprobadas en el sitio desplegado.

---

## 4. Riesgos que siguen abiertos

### 4.1 El acceso sigue siendo un prototipo

`acceso.html` no valida contraseñas: abre el panel de demostración con datos de
ejemplo. Escribiendo `roble_session` a mano en la consola del navegador se
sigue viendo la interfaz del panel.

**Por qué no es hoy una fuga de datos:** la web no llama a ninguna API (cero
`fetch` en todo el código), los paneles pintan datos del propio navegador del
visitante y `ml-data.js` no contiene correos ni teléfonos. Quien falsifique la
sesión ve su propio `localStorage`, vacío. `robots.txt` bloquea `/admin/` y
`/panel/`.

**Cuándo pasa a ser grave:** el día que los paneles lean datos reales. Ese día
la sesión tiene que venir de `/api/auth` y cada dato pedirse al servidor, que
comprueba la membresía. La ocultación en el navegador no es una defensa.

### 4.2 `script-src 'unsafe-inline'`

Toda la web se renderiza con scripts inline (`ML.shell`, `Panel.shell`). Sin
`'unsafe-inline'` las páginas se quedan en blanco: comprobado. Quitarlo exige
mover ese JavaScript a ficheros propios. Producción tiene la misma concesión.

### 4.3 `usuarios.eliminada` no la crea ningún archivo del repositorio

Producción la usa para el borrado lógico, pero se añadió a mano en la base de
datos. La auditoría y la migración la verifican antes de contar o migrar, y se
detienen con un mensaje claro si falta.

---

## 5. El modelo de datos

### La decisión deliberada: `empresas.id = usuarios.id`

Las empresas conservan el identificador de la cuenta que las originó. **No es
una casualidad ni una simplificación: es la decisión que evita corromper
datos.**

`favoritos`, `resenas` y `conversaciones` tienen cada una dos columnas que
apuntan a `usuarios(id)`, unas veces como persona y otras como empresa:

| Tabla | Columna «persona» | Columna «empresa» |
|---|---|---|
| `favoritos` | `usuario_id` | `empresa_id` |
| `resenas` | `autor_id` | `empresa_id` |
| `conversaciones` | `comprador_id` | `empresa_id` |

Renumerar las empresas obligaría a reescribir la columna «empresa» de las tres
tablas sin tocar la de «persona». Un error ahí **reatribuye reseñas y
conversaciones en silencio**: nadie se entera hasta que un cliente ve una reseña
que no es suya. Copiando el identificador, no se reescribe ni una fila: cero
renumeración, cero riesgo.

Coste: los identificadores de empresa no son correlativos y comparten espacio
con los de usuario. Es un precio barato.

### Tablas nuevas

| Tabla | Clave primaria | Claves foráneas | Únicos | Al borrar |
|---|---|---|---|---|
| `empresas` | `id` (copiado de `usuarios`) | `revisada_por → usuarios` | — | `SET NULL` |
| `membresias` | `id` | `user_id → usuarios`, `empresa_id → empresas` | `(user_id, empresa_id)` | `CASCADE` |
| `invitaciones` | `id` | `empresa_id → empresas`, `invitada_por → usuarios` | `token_hash` | `CASCADE` / `SET NULL` |
| `verificaciones_email` | `id` | `user_id → usuarios` | `token_hash` | `CASCADE` |
| `emails_verificados` | `user_id` | `user_id → usuarios` | `user_id` (es la PK) | `CASCADE` |
| `auditoria` | `id` | `user_id → usuarios`, `empresa_id → empresas` | — | `SET NULL` |

`emails_verificados` sustituye a una columna `usuarios.email_verificado`: así no
se modifica ninguna tabla existente.

Relaciones: `usuarios 1:N membresias N:1 empresas`. Tras la migración inicial la
correspondencia es 1:1 (una empresa por cuenta, misma identidad), pero el modelo
ya admite varias personas por empresa y varias empresas por persona.

**La ausencia de fila en `emails_verificados` significa «cuenta antigua», no
«cuenta no válida»:** unas 130 de las 154 fichas tienen correo generado
`@directorio.roble.es`, que no es un buzón real. Migran sin verificar y la
verificación no bloquea el acceso; limita acciones sensibles.

---

## 6. El orden que no se salta

```
DRY RUN → INFORME → BACKUP → MIGRACIÓN → VERIFICACIÓN
```

1. `powershell -File roble-ml/auditar.ps1` — auditoría de solo lectura.
2. Revisar bloqueantes. Si hay alguno, parar.
3. Copia de seguridad **y comprobarla restaurándola** (`docs/backup.md`).
4. `node api/_esquema.js --crear` — crea las seis tablas.
5. `node api/_migracion.js` — simulacro, no escribe.
6. `node api/_migracion.js --confirmar` — migra.
7. Las cuatro comprobaciones automáticas. Si falla una, `--revertir`.

Revertir solo borra filas de las tablas nuevas: ni un dato existente se toca.

### Ejecutado el 25 de septiembre de 2026

Con aprobación expresa del propietario, y en este orden:

| Paso | Resultado |
|---|---|
| Auditoría (24-09) | 156 migrables, 2 compradores, 130 correos generados, 0 bloqueantes |
| Backup verificado (24-09) | `backups/20260924-2357/`, 12/12 tablas coinciden tras restaurar |
| `node api/_esquema.js --crear` | 6 tablas, 9 claves foráneas, ninguna tabla existente tocada |
| `node api/_migracion.js` (simulacro) | 156 candidatas, 0 sin nombre, 130 correo generado |
| `node api/_migracion.js --confirmar` | 156 empresas, 156 membresías; 4/4 comprobaciones |
| Verificación independiente | 16/16: `empresas.id = usuarios.id` en todas, 2 compradores sin empresa, `usuarios` 158 filas y 33 columnas, `productos` 465 |

Lo que salió mal por el camino y quedó corregido antes de escribir nada:
`db()` cogía «la primera variable acabada en `_DATABASE_URL`» y en este equipo
existe también la de la base local; ahora exige `ROBLE_DATABASE_URL` y que sea
Neon. El pooler de Neon contamina sesiones de `pg_dump`/`pg_restore` (ver
`docs/backup.md`); el driver HTTP que usan los scripts de migración no tiene
ese problema.

**Credencial de la app (25-09-2026, después de migrar):** rol `roble_app`
creado por SQL con privilegios mínimos (`scripts/credencial-app.mjs`): lee
`usuarios` y `sesiones`, escribe solo en las seis tablas de identidad, y no
tiene acceso a `productos`, `facturas` ni `conversaciones` — comprobado
conectando como ese rol. No se creó desde la consola de Neon porque un rol de
consola pertenece a `neon_superuser` y puede escribir en todo. Su cadena está
en `roble-maquinaria` como `ROBLE_DATABASE_URL` (production); la contraseña
no se imprimió ni se guardó en ningún sitio; rotación con `--rotar`.

Tras el despliegue, `/api/auth` en el sitio real: GET sin cookie y con cookie
inventada → 200 `user:null`; POST sin sesión → 401. Ningún 500.

**Paneles conectados (25-09-2026, `43e8ccd`).** La sesión ya no se lee de
`localStorage`: viene siempre de `/api/auth` y las 21 páginas de panel, admin y
admin-directorio arrancan después de conocerla (`ML.auth.ready` /
`Admin.ready`). Esto cierra el riesgo 4.1: forjar `roble_session` en el
navegador ya no muestra nada, porque nadie lo lee. `api/sesion.js` entra y sale
con el mismo mecanismo y la misma tabla `sesiones` que el sistema actual (una
sola fuente de verdad; continuidad de sesión al sustituir la web en el mismo
dominio); `roble_app` recibió `INSERT`/`DELETE` en `sesiones`, nunca `UPDATE`.
Probado en el sitio real: credenciales falsas → 401, cuerpo vacío → 400, salir →
200 con la cookie retirada, método inválido → 405, quinto fallo → 429; puertas
del panel y de los dos admin sin errores de JS ni violaciones de CSP.

**Administrador:** `/api/auth` devuelve `isAdmin` según `ROBLE_ADMIN_EMAILS`
(Vercel, correos separados por comas). Sin configurar, nadie es administrador y
los dos admin permanecen cerrados. Es la decisión pendiente del propietario.

**Decisión del propietario (25-09-2026):** no rotar `neondb_owner`. Queda como
credencial de producción (`maqdemad`); nada del proyecto nuevo la usa y no
está guardada en ningún archivo, historial ni variable de este equipo.

`ROBLE_ADMIN_EMAILS` quedó configurada el 25-09-2026 con un correo de prueba del
propietario, para que vea los paneles de administración. Para cambiarla:
`vercel env rm ROBLE_ADMIN_EMAILS production -y` y `vercel env add ...` desde
`roble-ml/`, y redesplegar.

**Alta de cuenta en el sitio nuevo (25-09-2026, `298a733`).** "Crear cuenta"
redirigía a la web actual y el propietario lo rechazó. `api/registro.js` da de
alta con las mismas reglas y el mismo coste de bcrypt que producción, sobre la
misma tabla `usuarios` (la cuenta vale en los dos sitios), y crea la ficha de
identidad: `empresas` con el mismo id que la cuenta, origen `alta`, estado
`pendiente`, y membresía de propietario. `roble_app` recibió `INSERT` en
`usuarios` y uso de su secuencia; nunca `UPDATE` ni `DELETE`. Probado en el
sitio real sin crear cuentas: 405, y los cuatro 400 con su mensaje.

**Recuperación de contraseña en el sitio nuevo (25-09-2026, `7fa19e3`).**
`api/password.js` replica el mecanismo de producción sobre la misma tabla
`recuperaciones` (hash del código, una hora, un uso, misma respuesta exista o
no la cuenta, cierre de todas las sesiones al cambiarla). `api/_correo.js`
envía con Resend; `RESEND_API_KEY` quedó en `roble-maquinaria` mediante
`scripts/variable-vercel.mjs` (lee `SECRETO.txt`, ignorado por git, y lo borra).
`roble_app` recibió `SELECT/INSERT/UPDATE` en `recuperaciones` (nunca `DELETE`)
y `UPDATE` **solo de la columna** `password_hash` de `usuarios`, comprobado por
columna (`email` y `rol` siguen sin poder actualizarse). Con esto **nada del
sitio nuevo enlaza ya a la web actual.** Probado en el sitio real: 405, 503
sin clave, 400 con código falso y con contraseña corta, 400 con acción
desconocida.

**Decisión del propietario (25-09-2026):** pidió borrar la web actual de
Vercel y GitHub; se rechazó porque es la web en producción de los clientes,
aloja los pagos (`checkout.js`, `webhook.js`, que lleva otra persona) y la
sustitución ordenada ya está planificada (`docs/redirecciones.md`).

El propietario comprobó el envío real: le llegó el código y entró.

---

## 7. Retirada de la web antigua (26 de septiembre de 2026)

El propietario pidió borrar la web anterior y no conservar nada de ella. Se le
expusieron las consecuencias (web de los clientes, pagos de Stripe que lleva
otra persona, recuperación de contraseña) y lo confirmó de forma explícita,
autorizando la CLI de Vercel sobre `maqdemad` solo para borrarlo. Orden seguido:

1. La web nueva se dejó lista para quedarse sola: sin `X-Robots-Tag: noindex` y
   con las 103 redirecciones 301 de rutas antiguas en `vercel.json`
   (`ca8b33a`). Verificado desplegado antes de tocar nada.
2. `vercel project rm maqdemad`. Con él se fueron sus despliegues, sus
   variables y `checkout.js`/`webhook.js`: **los pagos de Stripe ya no existen
   y hay que rehacerlos en la web nueva cuando toque** (otra persona).
3. `maqdemad.vercel.app` quedó como dominio del proyecto `roble-maquinaria`:
   los enlaces antiguos siguen funcionando, cada ruta antigua salta a su
   página nueva, y la canónica apunta a `roble-maquinaria.vercel.app`.
4. `Proyectos/` salió del repositorio (`381c051`); `master` avanzó a la rama
   (avance rápido) y ya contiene solo `roble-ml/`; la etiqueta
   `produccion-retirada-2026-09-25` marca el último estado (c9ef035) sin
   conservar copia en el árbol. La carpeta local se borró.
5. La base de datos Neon **no se tocó**: usuarios, empresas, productos y
   sesiones siguen ahí y los usa la web nueva.

Lo que la web nueva todavía no tiene y la antigua sí tenía: `/api/directorio`
en vivo (el directorio nuevo lee un extracto estático, `assets/data.js`), los
pagos, el asistente y el panel de solicitudes de producción.

---

## 8. Datos reales en el directorio y el panel (26 de septiembre de 2026, `ccf058e`)

Las páginas cargaban un extracto estático del 16-09 (`assets/data.js`, 154
empresas) y la portada otro con tres destacadas inventadas (`.example`). Ahora
cargan `/api/datos.js`, que construye `window.ROBLE_DATA` desde `usuarios` y
`productos` con exactamente la misma forma, así que `roble.js`, el directorio y
el panel de empresa pasan a datos reales sin cambiar su código: 156 empresas y
465 productos. Se cachea en el borde un minuto con *stale-while-revalidate*: la
base se consulta como mucho una vez por minuto y un fallo puntual no deja la
web sin datos. `?home=1` da el extracto de portada (4,6 KB) con tres destacadas
reales. La clasificación en sectores es la del directorio anterior, copiada del
historial. Solo se publica lo que ya era público: nunca el correo de la cuenta.
`roble_app` recibió `SELECT` en `productos`; la CSP admite las fotos alojadas
en `*.public.blob.vercel-storage.com` (13 productos las tienen y las bloqueaba).

---

## 9. Editar desde el panel (26 de septiembre de 2026, `4f1e74d`)

El panel leía datos reales pero guardaba en `localStorage`. Ahora guarda en el
servidor: `api/empresa.js` (GET y PATCH de la ficha propia) y
`api/productos.js` (POST, PATCH y DELETE de los propios). La autorización la
decide `exige()` contra la membresía (`empresa.ver/editar`,
`productos.crear/editar/borrar`); para editar o borrar un producto se mira
primero de quién es — nunca se confía en un `empresa_id` del navegador — y un
producto ajeno responde el mismo 404 que uno inexistente. El administrador
puede con cualquier empresa. Todo queda en `auditoria`, sin datos personales.

Solo se escriben columnas de ficha en `usuarios` y el nombre se sincroniza en
`empresas`; `roble_app` recibió `UPDATE` por columna de esas y
lectura/escritura en `productos`, comprobado por columna que `email`, `rol`,
`plan` y `stripe_*` siguen sin poder actualizarse. `destacado` no se edita
desde el panel; el campo «borrador» desapareció porque la base no lo tiene.
El panel carga `/api/datos.js?panel=1` sin caché para ver su cambio al
instante; la web pública lo ve en menos de un minuto.

`scripts/qa-panel-api.mjs`: 25 comprobaciones con base y sesión simuladas
(sin sesión 401; lector 403 sin escribir; no miembro 404; `empresa_id`
manipulado 404; producto ajeno por id 404; admin puede; validaciones 400 antes
de escribir). En el sitio real, sin sesión, los cinco métodos responden 401 y
nada se escribe. **Falta la prueba del camino feliz con una cuenta real**, que
hace el propietario desde su panel.

---

## 10. Anuncios de maquinaria con datos reales (26 de septiembre de 2026, `520f5e1`)

Era el último bloque no real: 36 páginas cargaban `assets/ml-data.js`, un
extracto del 17-09 con 31 máquinas y 12 vendedores fijos. Ahora cargan
`/api/maquinaria.js`, que deriva los anuncios de `/api/datos.js` con la misma
forma: **un anuncio es un producto del sector Maquinaria y un vendedor es una
empresa de ese sector**. Caché de borde de un minuto; `?panel=1` sin caché.
Lo fijo (taxonomía de 76 categorías, fotos por categoría, países, tipos,
paquetes) vive en `api/_maquinaria.json`.

Comprobado contra la base: mismos 12 vendedores y 31 anuncios que el extracto,
cero diferencias de categoría, mismo vendedor destacado (plan de pago) y los
mismos 11 anuncios destacados, que ahora salen del flag real de `productos`.
El tipo de vendedor se deduce de lo que la empresa dice de sí misma: a dos que
no lo dicen, el extracto se lo atribuía a mano y aquí no se les atribuye nada.
Marca, modelo, año, estado y precio no existen en la base y siguen vacíos
(«a consultar»). Para publicar una máquina se añade un producto del sector
Maquinaria desde el panel. `ml.js` tenía un fallo latente (sin respaldo si
`ML_DATA` llegaba nulo, un fallo de la API rompía la página): corregido.

**Con esto, ya no queda ningún dato de prototipo en la web pública.** Sigue
siendo de prototipo, en `localStorage`, lo que no tiene tabla detrás: contactos
(leads) y pedidos de paquetes del panel, alertas y favoritos del visitante, y
los paneles de administración.

---

## 11. Contactos reales (27 de septiembre de 2026, `f2a6a6d`)

Los contactos vivían en `localStorage` del visitante: nadie los veía. Ahora los
dos formularios de contacto (el común de `ml.js` y el propio de `anuncio.html`)
envían a `POST /api/contacto`, que guarda en `solicitudes` — la misma tabla del
sistema actual, `tipo = consulta-empresa`, `destino_id` = la empresa — y avisa
por correo a la empresa si tiene un correo real (nunca a los generados
`@directorio.roble.es`). «Sobre qué» no tiene columna: va como primera línea
del mensaje y el panel la separa al leer. Antispam: cinco mensajes por hora e
IP y trampa `_honey`. No se auditan: son datos personales de terceros.

El panel lee `GET /api/contactos?empresa=` (`contactos.ver`; el lector también)
y cambia el estado con `PATCH` (`contactos.gestionar`; el lector no); se mira
primero a qué empresa pertenece la solicitud y un contacto ajeno responde el
mismo 404 que uno inexistente. Los estados de la tabla
(`nueva/en-curso/aceptada/descartada`) se traducen a los del panel
(`nuevo/en-curso/cerrado`) para no tocar las filas existentes. El campo de
notas desaparece: no hay columna. `roble_app` recibió `SELECT/INSERT/UPDATE` en
`solicitudes`, nunca `DELETE`.

Banco `scripts/qa-panel-api.mjs`: 40 casos. En el sitio real, sin crear nada:
400 por correo, mensaje o empresa inexistente; `_honey` 200 sin guardar; 405;
y 401 en el panel sin sesión. **Falta el camino feliz con una cuenta real** (el
propietario se escribe a sí mismo desde su ficha y lo ve en su panel).

### 11.1 La venta va por WhatsApp (27 de septiembre de 2026)

Decisión del usuario: toda la venta se cierra por WhatsApp. Quien escribe
sobre un anuncio o desde una ficha **tiene que dejar su WhatsApp**; el dueño lo
recibe en su panel y le escribe desde allí.

- Formularios (`ml.js` y `anuncio.html`): el campo «Teléfono» pasa a
  «WhatsApp *», obligatorio, con aviso si falta. Sin él no sale la petición.
- `POST /api/contacto` lo exige y lo normaliza al formato de `wa.me`
  (`telefonoWhatsApp`): 9 cifras españolas → `+34…`; `0034`/`+` respetados;
  otro país solo con prefijo; entre 10 y 15 cifras o 400. Se guarda en
  `solicitudes.telefono` como `+34612345678`.
- `GET /api/contactos` devuelve `whatsapp` (cifras listas para `wa.me`),
  también para los contactos antiguos cuyo teléfono se pueda interpretar.
- Panel Contactos: botón «Escribir por WhatsApp» (enlace `wa.me` con saludo
  ya escrito, en pestaña nueva) en la tabla y en el detalle; el correo queda
  como secundario. El aviso por correo a la empresa lleva el mismo enlace.
- Banco: 47 casos (WhatsApp normalizado, con prefijo, ausente, corto, y el
  límite de 5 mensajes por hora e IP que antes no se probaba).

Sigue en `localStorage`, por no tener tabla: pedidos de paquetes del panel,
alertas y favoritos del visitante, y los paneles de administración. Fuera de
alcance: `conversaciones`/`mensajes` (mensajería con sesión del sitio antiguo,
5 y 3 filas).

---

## 12. «Mis anuncios» del panel, real (28 de septiembre de 2026)

La última página del panel de empresa que guardaba en `localStorage`. Un
anuncio ES un producto del sector Maquinaria, así que crear, editar y borrar
van a `/api/productos` (membresía comprobada en servidor, tope de 60, fotos
solo `https://`), sin endpoint nuevo ni privilegios nuevos para `roble_app`.

- La categoría se guarda en `subsector` con su nombre exacto; `catDe` en
  `/api/maquinaria.js` la reconoce tal cual (las 76, comprobado en el banco).
  Al editar sin cambiar la categoría se conserva el subsector original.
- `/api/maquinaria.js` cuenta como vendedor a toda empresa con un anuncio de
  maquinaria, aunque su sector no lo diga: un anuncio nuevo nunca desaparece.
- Se publica al guardar: no hay columna de estado ni cola de revisión.
- El formulario pide solo lo que tiene columna: título, categoría,
  descripción y fotos. Marca, modelo y año van en el título; estado y precio,
  en la descripción.
- Fuera del formulario, por ser de pagos (otra persona): el saldo de
  paquetes y el interruptor «Destacar».

Banco: 48 casos. Navegador (sesión simulada): lista, formulario, POST, PATCH
conservando el subsector, DELETE, nada en `localStorage`, sin errores.

---

## 13. Administración contra la base (28 de septiembre de 2026)

**Hallazgo:** la tabla `empresas` ya tenía estado de moderación (`pendiente`,
`activa`, `borrador`, `rechazada`, `suspendida`) y el alta la crea
`pendiente`, pero la web pública no lo miraba: un alta nueva salía publicada
al momento, sin revisar. Ahora:

- `/api/datos.js` y `/api/maquinaria.js` públicos solo muestran empresas
  `activa` (y sus productos). Con `?panel=1`, la administración ve todas con
  estado, origen, fecha de alta y correo de la cuenta; un miembro ve además
  sus propias empresas aunque no estén activas. El correo de cuenta nunca va
  en la versión pública. Al desplegar: 156 activas antes y después, ninguna
  oculta (no había altas pendientes).
- `PATCH /api/admin?empresa=N { estado, motivo }`: solo administración
  (quien no lo es recibe 404), guarda quién y cuándo revisó y lo audita
  (`empresa.moderada`). Sin privilegios nuevos para `roble_app`.
- `GET /api/contactos?todas=1`: todos los contactos, solo administración.
- `admin/admin.js`: el almacén del panel escribe en servidor (optimista, y si
  falla avisa y recarga). Empresas: ficha por `/api/empresa`, estado por
  `/api/admin`. Productos y anuncios de maquinaria: `/api/productos` (editar,
  crear, eliminar). Contactos: estado por `/api/contactos`. Altas = empresas
  con origen `alta`; aprobar = pasar a `activa`.
- Quitado de la interfaz lo que no tiene columna o es de pagos: crear y
  eliminar empresas (se dan de alta ellas mismas; para retirar, borrador o
  rechazo), plan, destacar, publicar/despublicar anuncios, borrar contactos,
  y las colas de moderación de productos, imágenes y usuarios.
- Categorías, usuarios, contenidos, configuración, solicitudes, vendedores y
  paquetes siguen locales y lo dicen con un aviso «Solo en este navegador».

Banco: 60 casos (moderación y visibilidad nuevos). Navegador con sesión de
administración simulada: 16 comprobaciones, y sin regresiones en panel y
formularios de contacto.

**Pendiente:** subida directa de fotos (hoy URLs `https://`); campos propios
de máquina (marca, modelo, año, estado) si se quieren, que exigen columnas
nuevas; sin dominio verificado en Resend, `onboarding@resend.dev` solo puede
escribir al correo de la cuenta de Resend (para cualquier usuario hacen falta
el dominio y `REMITENTE_EMAIL`); `APP_URL` si la web cambia de dominio.

---

## 14. Camino feliz de sesión, probado en vivo (29 de septiembre de 2026)

Hasta ahora solo estaban probados los caminos de fallo (401/400/405/429). El
propietario autorizó probar el camino feliz contra producción con su cuenta.

**Recuperación de contraseña, de punta a punta.** `POST /api/password?a=olvide`
con el correo de la cuenta → 200 genérico; el código llegó por Resend desde
`onboarding@resend.dev` (el correo de la cuenta es el mismo de Resend, que es
la única dirección a la que puede escribir sin dominio verificado).
`?a=nueva` con ese código → 200, `Set-Cookie roble_sesion` HttpOnly, Secure,
SameSite=Lax, 30 días. Primera confirmación de que el envío de correo funciona
en producción, no solo en el banco.

**Entrada.** `POST /api/sesion` con la contraseña nueva → 200 con la identidad
completa: `isAdmin: true`, una empresa (id 36, `activa`, rol propietario) y los
17 permisos de propietario. `GET /api/auth` con esa cookie devuelve lo mismo.
El id 36 es la cuenta que la auditoría del 24-09 señaló como empresa que
además aparecía como compradora: legítima, como se concluyó entonces.

**Panel y administración con sesión real.** `GET /api/empresa?id=36` y
`GET /api/contactos?empresa=36` → 200 (ficha correcta; sin contactos todavía).
Administración: `GET /api/contactos?todas=1` y `GET /api/datos?panel=1` → 200.
Sin cookie, los mismos endpoints → 401.

**Salida.** `DELETE /api/sesion` → 200; después, `/api/auth` devuelve
`user: null` y `/api/contactos?todas=1` devuelve 401: la fila de `sesiones` se
borra de verdad, no solo la cookie.

Nota: la ficha de otra empresa (`?id=40`) responde 200 porque la cuenta es
administración, que por diseño ve cualquier ficha. El aislamiento entre
empresas sin privilegios lo cubre `scripts/qa-panel-api.mjs`; `exige()` no
acepta ningún `empresa_id` del navegador sin membresía activa.

**Consecuencia para el propietario:** la contraseña de su cuenta cambió en esta
prueba. Conviene que la cambie por una suya desde «He olvidado mi contraseña».

---

## 15. Subida de fotos al almacén (29 de septiembre de 2026)

Hasta ahora las fotos eran direcciones `https://` escritas a mano. El panel ya
decía «La subida directa se activa al conectar el almacenamiento»: esto la
activa.

**Cómo va.** Dos pasos: `POST /api/subir` comprueba la sesión y la membresía y
firma un permiso de un solo uso; después el navegador hace `PUT` directo a
`blob.vercel-storage.com`. El archivo NO pasa por la función, así que no le
aplica el límite de tamaño del cuerpo de una función serverless.

**La barrera.** La ruta la propone el navegador, así que el servidor la
comprueba en vez de confiar en ella: tiene que ser exactamente
`fotos/<empresa>/<nombre>.<jpg|jpeg|png|webp|avif>`, y la empresa sale de ahí,
no de un campo aparte que podría no coincidir con la carpeta. Sobre esa
empresa se exige `productos.editar` (el administrador puede con cualquiera).
Sin esa comprobación, cualquiera con sesión escribiría en la carpeta de otra
empresa. Se rechazan `..`, carpetas anidadas, barra inicial, empresa no
numérica, sin extensión, y `.svg` y `.html` (pueden llevar script).
Tope de 8 MB por foto y 60 subidas por hora y usuario.

**Sin librería en el navegador.** `@vercel/blob` pesa 88 KB en cliente y
cargarlo por CDN habría obligado a abrir `script-src` a un tercero. El
protocolo son dos peticiones, así que `assets/subir.js` las hace a mano con
`XMLHttpRequest` (que además da progreso). En la CSP solo se añade
`connect-src https://blob.vercel-storage.com`, para el PUT; `img-src` ya
permitía el almacén.

**Degrada solo.** Sin `BLOB_READ_WRITE_TOKEN`, `/api/subir` responde 503 antes
de tocar sesión o base, y el botón no aparece: el campo sigue siendo el
textarea de direcciones de siempre. Así la web funciona igual antes y después
de conectar el almacén.

Banco: `scripts/qa-subir.mjs`, 17 rutas (la expresión se lee del propio
`api/subir.js`, así que el banco falla si allí cambia sin actualizarse).
Comprobados además 405, 401 y el 503 sin almacén.

**Pendiente:** conectar el almacén `roble-fotos` (ya existe, 18 archivos de la
web antigua, región iad1) al proyecto `roble-maquinaria` desde el panel de
Vercel: la CLI no tiene `connect`. Al conectarlo aparece
`BLOB_READ_WRITE_TOKEN` y la subida se enciende sola. Sin probar en vivo
todavía. No se borra ninguna foto hasta que el propietario lo confirme sobre
el contenido real.

---

## 16. La subida de fotos funciona en producción (2 de octubre de 2026)

Tres días de pelea con la credencial del almacén, resueltos. Lo que pasó, por
si vuelve a pasar:

**Lo que no funcionó.** Conectar un store desde el panel de Vercel dejó la
configuración a medias dos veces: un token en minúsculas que no autenticaba
ni para listar, y después el modo OIDC (`BLOB_STORE_ID` +
`BLOB_WEBHOOK_PUBLIC_KEY`) sin `VERCEL_OIDC_TOKEN`. Comprobado desde dentro
de la función: **Vercel no inyecta el token OIDC en funciones serverless
clásicas** (CommonJS en `api/`), solo en Next.js y Fluid. `vercel env pull`
sí lo trae para local, lo que despista. Y el store `equiposimbai` se creó
PRIVADO: la subida funcionaba pero la foto daba 403, y el acceso no se puede
cambiar después de crear.

**Lo que funcionó.** `vercel blob create-store roble-fotos-web --access public
--yes` desde la CLI: crea el almacén público, lo conecta y escribe
`BLOB_READ_WRITE_TOKEN` en los tres entornos de una vez. Antes hubo que
borrar la variable del mismo nombre que había a mano (la CLI no la pisa) y
las dos de OIDC, que la librería prefiere y apuntaban al store privado.

**Estado.** Un solo store conectado, `roble-fotos-web` (público, iad1), con
`BLOB_READ_WRITE_TOKEN` como única variable del Blob. El endpoint usa el
camino de token; el de OIDC queda en el código por si Vercel lo inyecta
algún día.

**Probado en producción con la cuenta 178 (sin privilegios):** permiso para
su carpeta → sí; carpeta ajena → «no existe o no tienes acceso»; `.svg`,
`..` y rutas fuera de `fotos/` → «nombre no válido»; sin sesión → 401. Subida
real de 41 KB → URL `public.blob.vercel-storage.com`, HTTP 200 e
`image/jpeg`. La foto de prueba se borró después; el store queda a cero.

**Pendiente de limpieza en el panel** (la CLI no desconecta stores):
`equiposimbai` (privado, con una foto de prueba mía de 40 KB) y `roble-fotos`
(el viejo, vacío) siguen existiendo en el equipo. Se pueden borrar. La cuenta
de prueba 178 («Taller de prueba (borrar)», estado `pendiente`) también.

**Añadido el mismo día: el botón, probado en navegador.** Todo lo anterior
era con la librería oficial desde Node, que no aplica CORS. En Chromium
headless (`scripts/e2e-subir.py`) el PUT a mano de `assets/subir.js` fallaba:
el almacén no admite la cabecera `x-add-random-suffix` desde un navegador. No
hacía falta: el sufijo aleatorio y los límites ya van dentro del token que
firma el servidor, igual que hace la librería en modo cliente (solo manda
`x-content-type` y `x-vercel-blob-access`). Quitada la cabecera, los seis
pasos pasan: sesión, formulario, botón visible, subida a URL pública,
anuncio guardado con la miniatura del almacén en la fila, borrado. El banco
pide las credenciales por variables de entorno (`ROBLE_E2E_EMAIL`,
`ROBLE_E2E_PASSWORD`); la cuenta 178, pendiente de moderación, sirve para
eso y por ello se queda.

---

## 17. Lo que se decidió no construir (2 de octubre de 2026)

**Secciones del admin que siguen en localStorage.** Se revisaron las siete de
`LOCALES` en `admin/admin.js` para ver cuáles merecían tabla. Ninguna:

- Categorías, contenidos y configuración: configuración estática que vive en
  JSON del repo y cambia con un commit. Una tabla y un CRUD para eso es más
  código que valor.
- Paquetes, y los banners de «Vendedores y banners»: son pagos, los lleva
  otra persona.
- Solicitudes de maquinaria («demanda de compradores»): una idea del
  prototipo sin equivalente en el sistema real. Los contactos de verdad ya
  van por `solicitudes` y se ven en Contactos.
- Usuarios: la tabla existe, pero en toda la base hay dos compradores, y
  Empresas ya enseña el correo de cada cuenta con `?panel=1`.

El aviso «Solo en este navegador» sigue diciendo la verdad en esas páginas.
Si un día hace falta alguna, la primera sería Usuarios, y de solo lectura.

**Correo a cualquier usuario (Resend).** Sigue dependiendo de un dominio
verificado. ROBLE no tiene; el único del equipo de Vercel es `simbai.es`, con
DNS en un registrador externo. Hace falta decidir qué dominio firma los
correos del cliente y añadir los registros TXT y MX allí. El código espera
`REMITENTE_EMAIL` y `APP_URL`; no hay nada más que escribir.

**Campos de máquina.** Propuesta y script en `docs/campos-maquina.md` y
`api/_migracion-maquina.js`, pendientes de aprobación. No se escribe el
código que usa las columnas hasta que existan.

---

## 18. Máquinas guardadas con cuenta (3 de octubre de 2026)

La página de guardadas decía «crea una cuenta para tenerlas en todos tus
dispositivos» y la cuenta no lo hacía: todo vivía en localStorage. Ahora la
promesa es cierta.

**Tabla propia.** `maquinas_guardadas (user_id, producto_id, creada)`, clave
primaria sobre el par, y las dos claves foráneas con borrado en cascada: si
desaparece el producto o la cuenta, la fila se va con ellos. No se reutiliza
la `favoritos` del sistema actual: su `empresa_id` apunta a `usuarios`, o
sea, guarda EMPRESAS, y un anuncio es un producto. Meter ids de producto ahí
violaría la clave o señalaría a la empresa equivocada.

**Endpoint.** `/api/guardadas`: GET (lista, la más reciente primero), PUT y
DELETE por `?id=`, y POST con `{ ids }` que funde lo del navegador con lo de
la cuenta al entrar. Cada fila es de una sesión y de nadie más: aquí no hay
empresa ni rol. Un producto que no existe lo rechaza la clave foránea y se
responde 404 sin tumbar nada; en la fusión se salta y sigue. Tope de 200 por
usuario. `anadidas` cuenta filas insertadas de verdad (`RETURNING`), no
intentos.

**Navegador.** No cambia ninguna página: `store.favoritos/esFav/toggleFav`
siguen leyendo localStorage, que manda en pantalla y pinta al instante, y
guardar nunca pide cuenta. Con sesión, `toggleFav` copia cada cambio al
servidor; y como `/api/auth` contesta después del primer pintado, al llegar
se llama a `sincronizaFav()` (sube lo local, baja la unión) y se repintan
solo las estrellas ya en pantalla, sin volver a montar la página. Un evento
`roble:guardadas` avisa a quien liste (favoritos.html repinta).

Banco: `scripts/qa-guardadas.mjs`, 21 casos sin Neon (401, aislamiento entre
usuarios, 404 por clave foránea, no duplica, fusión, tope, 405). El de panel
sigue en 60/60.

**Orden de despliegue, y por qué importa.** `init()` NO crea tablas: comprueba
que existan las de `TABLAS` y, si falta alguna, lanza error en TODOS los
endpoints. Añadir `maquinas_guardadas` a esa lista y desplegar antes de
crearla habría tumbado sesión, registro, contactos, todo. Por eso el commit
`3af86aa` NO está desplegado. Con la cadena del propietario en
`ROBLE_DATABASE_URL`:

1. `node api/_esquema.js --crear` → crea solo la que falta (`IF NOT EXISTS`).
2. `node scripts/credencial-app.mjs --solo-privilegios` → GRANT a `roble_app`
   sobre la tabla nueva (ya está en `LECTURA_ESCRITURA`). Sin esto, 500 por
   permisos en `/api/guardadas`.
3. Desplegar.

Las dos primeras son de solo añadir: no tocan ninguna tabla existente.

**Desplegado y probado el 3 de octubre.** Con la cadena del propietario:
`--crear` creó solo `maquinas_guardadas` (sin tocar nada existente) y
`--solo-privilegios` dio a `roble_app` SELECT, INSERT, UPDATE y DELETE sobre
ella. Comprobado antes de crear que era la base de ROBLE: rol `neondb_owner`,
`usuarios` 160, `productos` 465, `empresas` 158. La cadena se borró del disco
al terminar (y la carpeta del Escritorio, que estaba en OneDrive).

En producción con la cuenta 178: lista vacía → guardar dos → repetir una no
duplica → la más reciente primero → producto inexistente 404 → fusión con un
id malo lo salta (`anadidas: 0`) → quitar → vacía. La cuenta de
administración no ve nada de la 178.

**El plan de Vercel admite doce funciones.** `/api/guardadas` era la
decimotercera y el primer despliegue falló («No more than 12 Serverless
Functions… Hobby plan»); producción se quedó en la versión anterior, sin
daño. Las trece se usaban, así que se fundieron las dos que eran la misma
tabla: el POST público del formulario de contacto pasa de `/api/contacto` a
`/api/contactos`, atendido antes de pedir sesión; la lógica sigue entera en
`api/_contacto.js`, que no se despliega. La ruta vieja da 404; las dos
llamadas del front cambiaron. Bancos 60/60 y 21/21.

Para la próxima función nueva hay que fundir otra o pasar al plan Pro. Las
candidatas naturales a fundirse: `registro` con `sesion` (alta y entrada son
la misma cuenta), y `admin` con `empresa` (moderación y ficha, misma tabla).

---

## 19. Los 38 apartados del cliente sustituyen a los 14 sectores (3 de octubre de 2026)

El cliente mandó su lista de apartados en una captura. No era «cambiar una
lista»: los 14 ids antiguos estaban atados a cinco sitios, y las 156
empresas tienen escrito el NOMBRE del sector antiguo como texto libre; sin
puente, el directorio se habría vaciado.

**Lo que decidió el propietario.** (1) Cada sector antiguo va al nuevo MÁS
GENERAL que lo absorbe; ninguna empresa se pierde, y las que estaban en un
cajón amplio («mueble por producto») quedan en el general («mueble de
hogar») hasta que afinen desde el panel. No se adivina qué fabrica nadie.
(2) Los apartados 1 y 2 (maquinaria nueva / de ocasión) se funden en
`maquinaria`, el id que une directorio y portal de anuncios, donde cada
anuncio ya dice si es nueva o usada. Quedan 37.

**Las cinco piezas.**
- `api/_sectores.json`: 37 sectores, misma forma. Las subcategorías se
  reparten desde las antiguas, sin inventar ninguna. Diez ids se conservan
  (los sectores que siguen siendo el general); los sectores FINOS nacen con
  id propio: si «Mesas» hubiera heredado `mueble-por-producto`, el
  emparejador habría metido ahí a todas las empresas de mueble.
- `api/_sectores-mapa.json`: ids viejos → nuevos (cuatro cambian:
  tableros-superficies→paneles-decorativos, mueble-por-producto→
  mueble-por-ambiente, tapiceria-complementos→sofas, servicios-profesionales
  →carpinteros) y 32 textos de `sector` tal como los tienen escritos las
  empresas (nombre largo, corto y cuatro variantes sueltas).
- `datos.js`: `sectorId()` mira primero el mapa; expone `sectoresAlias` al
  front. `roble.js`: `R.sector(id)` resuelve un id antiguo, así que un enlace
  guardado o indexado a `sector.html?s=viejo` sigue abriendo el sucesor.
- FAQ: 14 claves → 13 (69 preguntas; dos sectores antiguos se reúnen en
  mueble de hogar). `vercel.json`: 22 de las 80 redirecciones de sector
  reescritas; todas apuntan a ids que existen.
- Iconos: 27 nuevos en `ICONS` (24 dibujados con el trazo de la casa, 3
  heredados del sector absorbido, asignados DESPUÉS del literal porque dentro
  de él `ICONS` aún no existe). `icon()` cae a `building` si un sector no
  tiene símbolo, para la próxima vez.

**Comprobado sin Neon.** Las 156 empresas del volcado pasadas por el
`sectorId()` nuevo: 0 sin sector (al principio eran 2, por variantes cortas
que faltaban en el mapa). 24 de 37 sectores quedan sin empresa hasta que
afinen; es verdad, no un fallo. Siete alias resuelven. Bancos 60/60 y 21/21.

---

## 20. Las empresas, colocadas en los 37 sectores; y un vacío que llevaba desde el 26-09 (4 de octubre de 2026)

**Reclasificación.** 130 de 156 empresas tienen correo generado y no pueden
entrar al panel, así que «que afinen ellas» no iba a ocurrir. El propietario
pidió rellenar los sectores. `api/_reclasifica.js` lee lo que cada empresa
escribió en su descripción y servicios y la coloca donde dice que está:
«muebles de cocina y baño» entra en cocina y baño (hasta cinco sectores, el
de más coincidencias como principal); «mobiliario a medida» sin más se queda
en su general. Las reglas se escribieron leyendo las 156 descripciones, no
al revés, y se afinaron con lo que el simulacro enseñó: «poliuretano» en
tapicería es espuma y no barniz; «tiendas online» es logística y no
amueblar tiendas; una fábrica de puertas no es un almacén de puertas.

Ejecutado el 4-10 con la cadena del propietario (recogida de una carpeta del
Escritorio, movida fuera de OneDrive, borrada al terminar), tras comprobar
en solo lectura que era la base de ROBLE: **146 actualizadas**, 12 sin regla
que se quedan en su general, 146 filas en auditoría con el antes
(`empresa.reclasificada`; `--revertir` lo deshace desde ahí). Solo tocó
`sector` y `categorias`, con el rol del propietario porque la cadena de
`roble_app` está cifrada en Vercel. Resultado en producción: **28 de 37
sectores con empresas, 156 de 156 con sector**. Los 9 vacíos (canapés,
colchones, mueble juvenil, somieres, patas, herramientas, consumibles de
casas, almacenes de puertas, puertas de cocina) no tienen a nadie en la base
que los mencione: se llenarán con altas, no con invenciones. Banco:
`scripts/qa-reclasifica.mjs`, 15 casos.

**El vacío.** Al comprobar en navegador, `sector.html?s=sofas` decía «0
empresas» mientras la API traía 13. No era caché ni la reclasificación:
`roble.js` aplicaba el parche local del admin y filtraba las empresas por
`estado === 'publicada'`, el nombre del prototipo (commit del 20-09). Desde
que el directorio lee Neon (26-09), la base manda `'activa'`, así que **todas
las páginas de sector del directorio público llevaban ocho días listando
cero empresas**. Los recuentos de la portada salen de otra cuenta y lo
taparon. Ahora se admiten los dos nombres y cualquier otro estado sigue
fuera. Comprobado en navegador: sofás 13, baño 12, mesas 4, directorio con
37 baldosas, y el enlace antiguo `?s=tapiceria-complementos` abre sofás.

Lección: comprobar la web con el navegador, no solo la API. La API estaba
bien y la web no, y la diferencia solo se vio al contar tarjetas en pantalla.

## 21. Respuesta a la auditoría externa de roble-web (4 de octubre de 2026) — reconstruido

*El texto original de las secciones 21 y 22 se perdió el 7 de octubre con la carpeta de C: (ver §25). Esto es un
resumen hecho de memoria y del código desplegado; el detalle vive en los diffs de producción.*

El usuario entregó una auditoría línea a línea. Se contrastó cada punto con el código real y se arregló lo que era
cierto: la redirección `buscar.html?q=` → `empresas.html` que secuestraba el buscador de máquinas (fuera de
`vercel.json`); CSP con `img-src https:` y `form-action` para el formulario externo; una cuenta eliminada ya no
resuelve sesión (`auth.js`, `u.eliminada IS NULL`); el correo de administración no puede registrarse desde la web
(`registro.js`); el aviso de contacto se espera dentro de `try/catch` (`_contacto.js`); un contacto descartado no
vuelve a aceptado (`contactos.js`); la web pública no enseña empresas de demostración (`datos.js`); aviso por correo
a la empresa al aprobarla o rechazarla (`_correo.js` → `avisaModeracion`, `admin.js`); 12 funciones justas para el
plan Hobby. Lo que la auditoría afirmaba y no era cierto en el código se anotó como tal y no se tocó.

## 22. Lunes 5: lo que mentía, y cinco revisiones antes de entregar (5 de octubre de 2026) — reconstruido

Reparto lunes-jueves con entrega el jueves 8. El lunes: datos que mentían en pantalla (contadores, «Verificada»,
estados muertos), `canon()`/`noindex()` en `roble.js`, sugerencias del buscador a sus páginas reales, 404 que
carga desde rutas anidadas, sitemap generado por `scripts/sitemap.mjs`, `robots.txt` solo con admin y panel,
textos de 9-10 px subidos, foco visible, limpieza de datos por la API (fotos muertas del Blob, `hwdl` a borrador,
«Taller de prueba» rechazada). Cada bloque se revisó cinco veces línea a línea (diff por palabras, scripts
inline, `node --check`, bancos QA y 33 comprobaciones en producción: `scratchpad/verifica-lunes.py`).

## 23. Martes 6: técnico sin dependencias, pasada visual completa y recorrido de extremo a extremo (6 de octubre de 2026)

El usuario pidió terminar el trabajo del reparto (§22) de una vez y sin preguntas a mitad. Todo lo de abajo
está desplegado y comprobado en producción.

**Técnico (sin pedir nada a nadie):**
- Los filtros que siempre daban cero se ocultan cuando ningún anuncio tiene el dato: marca, estado, año,
  precio y país en `buscar.html`; el segmento Nuevas/Segunda mano en `categoria.html`; los enlaces
  «Segunda mano»/«Nueva» del lateral y del pie; el país en `empresas.html` y `vendedores.html` (todas son de
  España). El selector del hero de portada pasa de estado (muerto) a categoría (útil).
- «Últimas máquinas publicadas» ordena por fecha. «Similares» del producto, por subsector real o, si no hay,
  por sector. Las destacadas del directorio ya no salen vacías (premium y, de relleno, las de más productos).
- `acceso.html` y `legal.html` llevan la misma cabecera que el resto (nav completa, buscador de máquinas, estrella
  de guardadas, distintivo «Maquinaria» con su estilo) y el pie de legal sin enlaces muertos.
- CSS: menú móvil con scroll propio; foco visible en los menús y sobre fondos oscuros; rejilla de productos a una
  columna por debajo de 400 px; textos de 9-10 px subidos a 11 px (quedan los decorativos: iniciales de logotipo y
  etiquetas sobre foto). Nav del admin en varias filas en vez de desbordar. Carrusel de subsectores con degradado
  al borde. Tablas del admin con foco de teclado (`tabindex`).
- `404.html` con `<base href="/">`: en rutas anidadas (`/directorio/x/`) ya carga logos y fotos.
- El lateral de categorías se abre al pasar de móvil a escritorio (antes quedaba cerrado y sin control).
- Pie sin «Portugal, Italia y Francia» ni el selector de idioma falso; año calculado.
- Datos: las 9 fotos de productos que apuntaban al almacén Blob borrado (CNC Levante y Carpintería San Millán)
  se vaciaron por la API; eran los únicos productos con foto y todos daban 404. `hwdl` (la empresa de pruebas
  de SIMBAI) pasa a borrador: sigue en su panel pero no en la web pública. «Taller de prueba (borrar)»
  rechazada; «herrajes» se deja pendiente para enseñar la moderación.
- Placa del anuncio solo con filas que tienen dato (antes cinco «A consultar» seguidos). Textos de «Vender» y
  «Para empresas» alineados con lo que el formulario pide de verdad (37 sectores, sin marca/modelo/año).

**Pasada visual (43 páginas × 390 y 1280 px, capturas + axe + desbordes + errores):** cero errores de
consola en las 86 vistas; cero violaciones serias de axe en las páginas públicas; los únicos «desbordes»
que quedan son contenedores con scroll a propósito (chips en móvil, tablas del admin dentro de `.table-wrap`).
Textos por debajo de 11 px: de 1.980 a 1.056 ocurrencias, todas decorativas.

**Recorrido de extremo a extremo en producción (`scratchpad/e2e.py`, 25/25):** entrar por la web → editar
la descripción en el perfil y verla guardada → crear producto y verlo en «Mis productos» → crear máquina,
pedir token, subir foto al Blob, guardarla y verla en «Mis anuncios» → contacto desde la web → aparece en
«Contactos» del panel → cerrarlo → guardar una máquina con la cuenta, verla en favoritos y quitarla con la
estrella (local + servidor) → moderación y admin de anuncios con sesión → borrar lo creado y restaurar la
descripción. Sin errores de consola. El script limpia sus restos si se corta a medias.

**Revisiones:** diff por palabras de los 21 ficheros, scripts inline y `node --check`, bancos QA 113/113,
las 33 comprobaciones de §22 (32 aplicables) en verde tras cada despliegue, dos pasadas automáticas
completas y el recorrido E2E.

**Queda igual, a sabiendas (demo):** `solicitudes.html` y los paquetes del panel guardan en el navegador;
`script-src 'unsafe-inline'`; fuentes desde Google; los flujos n8n; las dos URLs por máquina
(`anuncio.html` y `producto.html`).

## 24. Fotos distintas en toda la web (6 de octubre de 2026, noche)

El usuario pidió «llenar la web entera de fotos diferentes, no la misma». Hasta ahora había 24 fotos de categoría y
una de portada: los 31 anuncios de las 6 categorías con oferta repetían la misma imagen, los 13 vendedores
enseñaban casi todos la de seccionadoras, y los 37 sectores del directorio y las 52 categorías restantes iban sin foto.

**Fotos:** 100 nuevas de Wikimedia Commons (CC BY, CC BY-SA, CC0 o dominio público; nada anterior a 2000, ni
grabados, ni dibujos), en `assets/img/fotos/<clave>.jpg` a 1200 px (q82) y `sm/` a 640 px (q70). Claves:
- las 52 categorías de maquinaria que no tenían foto;
- dos variantes extra (`-2`, `-3`) para las seis categorías con anuncios;
- los 37 sectores del directorio, como `s-<id>`.
Cada una está en `assets/img/fotos/creditos.json` (título, licencia, autor, enlace) y en `api/_maquinaria.json` →
`fotos` (crédito ya montado), que es lo que llega al navegador en `ML_DATA.fotos`.

Cómo se eligieron: `scratchpad/fotos_commons.py` y `fotos3.py` sacan candidatas por categorías de Commons y por
búsqueda libre (inglés y alemán, con filtro de relevancia porque la búsqueda de Commons devuelve conciertos para
«edge banding»), filtran por licencia, tamaño y proporción, y montan hojas de contacto; la elección final es a mano,
clave a clave, en `fotos_descarga.py` → `SEL`/`SEL3`, con comprobación de duplicados antes de descargar.
Ocho claves sin foto específica usan una pariente cercana (p. ej. espigadoras → seccionadora de tablero, tecnología
y software → interfaz de CAD). Son orientativas y se marcan como tales.

**Frontend:**
- `ML.fotoCat(cat, semilla)`: entre `clave`, `clave-2`, `clave-3` elige por la posición del anuncio dentro de su
  categoría (ordenados por id), así se reparten sin repetir y un anuncio enseña siempre la misma foto en tarjeta,
  ficha y panel. Los anuncios no publicados (solo en el panel) caen a `id % n`.
- `ML.fotoVend(v)`: reparte entre todas las variantes de las categorías del vendedor según `v.id`; un vendedor sin
  anuncios recibe una foto de categoría orientativa en vez de quedarse sin portada.
- Las losetas de sector (`directorio.html`, portada) usan `s-<id>`; antes solo «maquinaria» tenía foto. La página de
  sector lleva portada con su crédito.
- `creditos.html` (nueva, en el pie y en el sitemap) lista las 125 fotos por categoría y sector con autor, licencia y
  enlace a Commons. La portada ya no lleva la lista entera de créditos en una línea.

**Comprobado en producción (06-10 noche, `scratchpad/fotos_check.py`):** 8 anuncios de seccionadoras con 3 fotos
distintas, 37 losetas de sector con 37 fotos distintas, 125 créditos con enlace, ninguna foto rota, cero errores de
consola; las 33 comprobaciones de §22 (32 aplicables) y el recorrido E2E 25/25 en verde. Está desplegado todo
menos el reparto por posición y la foto del vendedor sin anuncios (ml.js), que se reaplicaron en §25 y quedan por
desplegar.

## 25. 7 de octubre: la carpeta de C: se borró y el repositorio se reconstruyó

A las 20:49 otra sesión de Claude Code, encargada desde el 30-09 de mover `C:\Users\<usuario>\SIMBAI` al NVMe
(`D:\SIMBAI`), ejecutó `rmdir /s /q` sobre C: dando por hecho que la copia de D: estaba al día. La copia de D: era
un espejo del 4 de octubre a las 20:14. Todo lo cambiado en C: entre esa hora y el 7-10 se perdió sin papelera,
incluido este repositorio con sus commits del 5 y 6 de octubre (el remoto de GitHub se quedó en `b01b5d7`).

Reconstrucción, en `D:\SIMBAI\Proyecto Carpinteria\MaqDeMad\roble-ml` (rama `reconstruccion-20261007`):
1. Base: la copia del 4-10 (commit `21d682e`, con su `.git`). Copia de seguridad previa en `D:\SIMBAI-copia-seguridad-20261007`.
2. Todo lo que Vercel sirve como estático es el fuente byte a byte (comprobado con tres ficheros sin cambios), así que
   se bajó del despliegue de producción: 239 ficheros nuevos o cambiados (201 fotos, 38 páginas y scripts), 92
   iguales. Lo que no se sirve: `api/`, `docs/` (`.vercelignore`), `package.json`, `vercel.json`, `.gitignore`.
3. `api/*.js`: se reaplicaron a mano los ocho cambios del 5-6 de octubre (§21) sobre la versión del 4-10, con
   `scratchpad/reaplica_api.py`; `avisaModeracion` se reescribió con el mismo contrato. `api/_maquinaria.json` se
   completó con lo que sirve producción (125 fotos, `whatsapp`). En `vercel.json` se reaplicaron los dos cambios de
   §21 (fuera la redirección de `buscar.html?q=`; CSP con `img-src https:` y `form-action` para formsubmit).
4. `docs/`: §23 se recuperó entero de una copia en el scratchpad; §21, §22 y §24 se reescribieron de memoria.

A las 21:25 la otra sesión volvió a copiar `D:\SIMBAI` a `C:\Users\<usuario>\SIMBAI` (los 393 ficheros de roble-ml son
idénticos en los dos sitios, comprobado con `robocopy /L`). Desde entonces se trabaja otra vez en C: y D: queda de respaldo.

Pendiente para dar la reconstrucción por exacta: bajar del panel de Vercel el código fuente del último despliegue
(pestaña *Source*; incluye `api/` y `vercel.json`) y compararlo con esta rama. Hasta entonces no se despliega desde aquí.

**Cierre (7-10, noche).** El fuente del último despliegue se bajó con `vercel api` (`/v6/deployments/<id>/files`,
script `scratchpad/fuente_vercel.py`) y se comparó con la rama: de 39 ficheros de servidor y configuración solo
diferían 4 (`api/_correo.js`, `api/admin.js`, `api/registro.js`, `package.json`) en comentarios, orden y el texto del
aviso de moderación. Se tomaron tal cual de producción: la rama es ahora exacta. Rama subida a `kdl177/roble-web`.
Desplegado el retoque de fotos (reparto por posición, foto para el vendedor sin anuncios). En producción: fotos 0
fallos (encoladoras ya con 3 fotos distintas, 13 vendedores con foto), comprobaciones de §22 33/33, E2E 25/25, QA 113/113.

## 26. Los 38 apartados del cliente, exactos (8 de octubre de 2026)

El cliente mandó su lista de 38 apartados y pidió que el directorio use solo esos. Ya coincidían 37 de 38 por nombre;
la diferencia era que «1-Maquinaria para la madera nueva» y «2-Maquinaria para la madera de ocasión» estaban unidos.
- `api/_sectores.json`: `maquinaria` pasa a ser «Maquinaria para la madera nueva» (n.º 1, mismo id: no cambian URLs ni
  anuncios) y entra `maquinaria-ocasion` (n.º 2); el resto sube un número, con la numeración del documento del cliente.
- `api/datos.js`: las empresas solo tienen escrito «maquinaria». Las que hablan de ocasión, usada, segunda mano o
  reacondicionada en su propia ficha entran en ocasión; si además fabrican, venden nueva o son distribuidor oficial,
  siguen también en nueva. Hoy: 12 en nueva, 3 en ocasión (Maquinaria Usada Sur solo en ocasión; Milano y Hersan en
  las dos). `sectorId` reconoce el nombre exacto antes que el prefijo, para que «…de ocasión» no caiga en nueva.
- `api/maquinaria.js`: los vendedores de ocasión siguen en el portal (13 de 13).
- Foto `s-maquinaria-ocasion` (Commons, CC BY-SA 3.0) con su crédito; sitemap con 38 sectores; textos «37» → «38».
- Los subsectores (las fichas dentro de cada sector) se mantienen: no son sectores y los usan los formularios de alta
  y de productos.
Comprobado en producción: fotos 0 fallos, 33/33, E2E 25/25, QA 113/113.

## 27. Fuera las 76 categorías de máquinas de la parte pública (8 de octubre de 2026)

El cliente vio el lateral del portal de máquinas (las 76 categorías, «Accesorios» y «Repuestos y recambios») y dijo que
no son sus apartados. Ahora la única clasificación pública son sus 38:
- `ML.shell` usa en todas las páginas el lateral de los 38 (`sidebar()` → `sidebarDir()`); `api/maquinaria.js` manda
  también los 38 con su recuento, porque las páginas del portal no cargan `datos.js`.
- Portada: fuera «Las categorías principales» y el selector de categoría del buscador; la sección del directorio
  enseña los 38 con su foto. Buscar: sin filtro de categoría. Pie: sin «Categorías» ni «Repuestos».
- `categorias.html` → 301 a `directorio.html`; `categoria.html` y `repuestos.html` → 301 a `buscar.html`. Fuera del sitemap.
- Ficha del anuncio: el tipo de máquina se queda como texto («Tipo de máquina»), sin enlace; migas a «Maquinaria».
- Se mantiene, como dato y no como apartado, el «tipo de máquina» de cada anuncio: elige su foto orientativa y es el
  desplegable del formulario de anuncios del panel y de solicitudes.
Comprobado en producción: 33/33 (dos comprobaciones nuevas: redirección y lateral con 38), fotos 0 fallos, E2E 25/25.

## 28. Los nombres exactos del cliente y fuera los subsectores (8 de octubre de 2026)

El cliente vio el lateral con los nombres cortos («Técnicos», «Software», «Ferias», «Tableros»…) y dijo que no son los
suyos. Ahora cada sector se llama, en todas partes, exactamente como en su documento «CONTENIDO – APARTADOS», letra
por letra y con sus mayúsculas («Maquinaria para la Madera nueva», «Fabricantes de Tablero Aglomerado y MDF»…):
`api/_sectores.json` → `nombre` = `corto` = texto del cliente (lista literal en `scratchpad/nombres_exactos.py`).
Las empresas guardan sus sectores por id, así que nada se desclasifica.
- Fuera los subsectores (etiquetas dentro de cada sector, no estaban en su lista): `sub: []`; la página de sector ya no
  pinta la fila de etiquetas; fuera el campo «Subsector» del alta de empresa y del formulario de productos del panel (un
  producto que ya tenía subsector lo conserva al editarlo). Tarjeta y ficha de producto enseñan el sector del cliente.
- Nombres largos enteros: losetas de sector hasta 6 líneas, etiquetas de sector que parten línea, etiqueta de la
  tarjeta de producto sin recorte.
- De paso: la rejilla de productos en móvil salía a 3 columnas de 108 px porque una regla de `ml-visual.css` anulaba la
  de roble.css; ahora 2 columnas por debajo de 1100 px y 1 por debajo de 400 (como se quiso en §23).
Comprobado en producción a 390 y 1280 px (`scratchpad/nombres_check.py`, 31/31): lateral, losetas de portada y
directorio, desplegable del alta = las 38 cadenas del cliente en su orden, ningún nombre recortado, sin desbordes, sin
errores de consola. Además 33/33, fotos 0 fallos, E2E 25/25, QA 113/113.

## 29. Anuncios más grandes y en los dos laterales (8 de octubre de 2026)

Petición del cliente: «que los anuncios de los laterales sean más grandes y pon también en el otro lado».
- Tamaño: los anuncios de los laterales pasan de 3:4 a 2:3 (300 × 450 px; antes 300 × 400) y, desde 1400 px de
  ancho, las dos columnas laterales pasan a 340 px (anuncios de 340 × 510). Logotipo, nombre y llamada más grandes.
- Lateral izquierdo: un anuncio encima de los 38 sectores («Anunciantes») y dos más debajo de la lista, con su
  «Tu banner aquí». El lateral derecho sigue con cuatro. `ML.anunciantes()` arma una sola lista sin repetidos (7 como
  mucho): los 4 primeros a la derecha y el resto a la izquierda; primero los vendedores con máquinas, y si alguno no
  tiene, la llamada dice «Ver ficha» en vez de «0 máquinas».
- El lateral izquierdo deja de ser una caja con scroll propio (si no, los anuncios quedaban escondidos dentro).
- Móvil: anuncios a dos columnas.
- Foto `escuadradoras-y-sierras-circulares-3`: la anterior traía un cuadro pixelado que en un anuncio grande se
  notaba; ahora una sierra de mesa Mafell (Commons, CC BY-SA 3.0), con su crédito.
Comprobado en producción: 7 páginas × 1920/1280/390 px sin repetidos, sin «0 máquinas» y sin desbordes; 33/33,
fotos 0 fallos, nombres 31/31, E2E 25/25, QA 113/113.

## 30. Los anuncios llenan los dos lados de la pantalla (8 de octubre de 2026)

Petición del cliente: «haz más anchos los anuncios de los lados, que ocupen el lado derecho entero».
- En escritorio (>1100 px) las páginas del portal y del directorio dejan el encajonado de 1480 px: el centro crece
  hasta 780 px y las dos columnas laterales se reparten el resto (`minmax(300px, 1fr)`), hasta el borde de la
  pantalla. Tope de 2200 px para monitores enormes. La cabecera se ensancha igual para que todo quede alineado.
  Medido: a 1920 px cada lateral mide 506 px (antes 340) y el derecho llega al borde; a 1440 px, 300 px sin hueco.
- Desde 1500 px los anuncios pasan a 4:5 con logotipo, nombre y llamada más grandes; desde 2000 px, cuadrados.
- Fotos: desde 801 px los anuncios cargan la versión de 1200 px (`srcset`); con la de 640 px recortada en vertical
  se veía borrosa. Ampliación real máxima medida: ×0,96 a 2560 px, ×0,94 a 1920 (antes ×1,2 y ×1,25).
Comprobado en producción a 2560/1920/1440/1280/1024/390 px sin desbordes; 33/33, fotos 0 fallos, nombres 31/31,
E2E 25/25, QA 113/113.

## 31. Cabecera que se ve más (8 de octubre de 2026)

Petición del cliente: «la parte de arriba, ponla para que se vea más». La cabecera de todas las páginas públicas
(las del portal por `ML.shell` y las fijas de `acceso.html` y `legal.html`, clase `cab-oscura`) pasa a barra negra
con filo rojo de 3 px y sombra; alto 76 px (60 en móvil, antes 64/56); logotipo blanco más grande (símbolo 38 px,
palabra 20 px); menú a 16 px en seminegrita; buscador de 46 px; «Acceder» en rojo; estrella y botón de menú en claro.
El menú desplegable del móvil sigue claro. Comprobado a 1920/1280/390 px en cuatro páginas: axe sin violaciones en
la cabecera, sin desbordes, sin errores de consola; 33/33, fotos 0 fallos, nombres 31/31, E2E 25/25.

## 32. Auditoría continua, ronda 1 (8 de octubre de 2026)

Pasada visual completa (`scratchpad/visual.py`, 43 páginas × 390/1280/1920 px, axe, desbordes, consola) y revisión
de las capturas a ojo. Arreglado y desplegado:
- Portada: los números del lateral de sectores salían mal (1 o nada) porque contaba sobre las 3 empresas del
  extracto de portada; ahora usa el total de cada sector.
- Ficha de vendedor: fuera la etiqueta «✓ Verificado», que salía en cualquier vendedor sin que nadie lo verifique.
- Anuncios laterales: el vendedor o la empresa ya no se anuncian en su propia ficha; el título del lateral ya no
  enseña nombres de categoría («Con escuadradoras…»).
- Ficha de producto: fuera la fila «Subsector». Acceso: «76 categorías» → «38 sectores». Solicitudes y ficha de
  vendedor: «Categoría» → «Tipo de máquina». Sector sin empresas: texto sin «subsector», con enlace al alta.
- Placa de datos: un valor largo pasa a la línea de abajo en vez de partir palabras («Escuadrador/as»).
- Iniciales de logotipo sin signos («E(» → «EG»). Crédito de la portada de sector legible sobre fotos claras.
- Alta de empresa: el desplegable de sector a ancho completo (compartía fila con el subsector retirado).
- Cabecera entre 1025 y 1400 px: el menú cede sitio y el buscador no se queda en «Buscar máq»; acceso y aviso
  legal con la cabecera igual de ancha y la etiqueta «Maquinaria» con su estilo.
- Accesibilidad: créditos con nombre en los 38 enlaces de foto (axe link-name), tabla de permisos del admin con
  foco de teclado, etiquetas-enlace y «¿Has olvidado la contraseña?» a 24 px de alto, textos de 10 px a 11.
- Productos sin foto en móvil sin el hueco de 270 px. Créditos en móvil: nombre y autor en líneas separadas.
- Fuera `categorias.html`, `categoria.html` y `repuestos.html` (ya redirigían).
Comprobado: 33/33, fotos 0 fallos, nombres 31/31, E2E 25/25, sin errores de consola.

## 33. Cuenta de demostración y repositorio público (9 de octubre de 2026)

- Auditoría: los enlaces de nombre en las tablas del administrador medían 14 px de alto; ahora 24. `backups/` entra
  en `.gitignore` (nunca estuvo versionado; así sigue).
- Cuenta de empresa de demostración `empresa@carpinteriademo.es` → «Carpintería Demo ROBLE» (id 180), con ficha
  rellena, en estado pendiente a propósito para enseñar la moderación desde el panel de administración. El primer
  intento (id 179) quedó rechazado. Contraseña entregada al propietario fuera del repositorio.
- Repositorio público para el socio: `kdl177/roble-maquinaria`, instantánea de un solo commit (sin historial, sin
  `.env`, sin `backups/`, rutas locales redactadas en `docs/`) con README. El trabajo sigue en `kdl177/roble-web`.

## 34. Autorización previa, correo pendiente y zona de paquetes (9 de octubre de 2026)

Tres peticiones del cliente, desplegadas:
- **Nadie entra sin autorización de administración.** `api/auth.js` → `puertaCerrada(userId, email)`: la ficha de la
  empresa tiene que estar en `activa` o `borrador`; `pendiente`, `rechazada` o `suspendida` no entran (403 con el
  motivo) y su sesión, si la tuvieran, deja de valer (`usuarioDeSesion` hace el mismo filtro con un LEFT JOIN a
  `empresas`). Administración entra siempre. `api/registro.js` ya no abre sesión al crear una cuenta de empresa:
  devuelve `{ pendiente: true }` y `acceso.html` enseña «Cuenta creada. El equipo de ROBLE tiene que autorizarla».
  La autorización es el botón «Autorizar y publicar» de Moderación (`/api/admin` → `activa`). El alta solo ofrece
  cuentas de empresa (fuera «Buscar y guardar»): una cuenta sin empresa no tendría a quién pedir la autorización.
- **Correo de contacto pendiente de rellenar:** `contacto.html` enseña `[CORREO DE CONTACTO]` (clase `.pend`, ahora
  global en `ml-visual.css`), el formulario ya no apunta a formsubmit y al enviar avisa de que está pendiente de
  configurar; el valor por defecto de la configuración del admin queda vacío.
- **Zona de paquetes por WhatsApp:** `paquetes.html` (paquetes, tres pasos, banners), sección en la portada, enlace en
  el lateral («Comprar paquetes por WhatsApp»), en el pie y desde `vender.html`; en el sitemap. Mientras el número no
  esté en `api/_maquinaria.json` → `whatsapp`, la página enseña `[NÚMERO POR RELLENAR]` y los botones caen a contacto.
Comprobado en producción a 1280 y 390 px: la cuenta pendiente recibe el 403 y el aviso, el alta no ofrece comprador,
el correo sale como pendiente y el envío avisa, 6 paquetes con botón de WhatsApp, portada/lateral/pie enlazan, sin
errores de consola; QA 113/113. Las comprobaciones que entran como administración (33 de §22 y E2E) no se han
podido pasar: la contraseña de la cuenta de administración ya no es la que tenía (cambiada después de entregarla).

## 35. «Pedir» un paquete: WhatsApp o Gmail (9 de octubre de 2026)

El cliente no quería el botón de WhatsApp suelto en la cabecera de la página de paquetes: el botón va en cada
paquete y, al pulsarlo, ofrece las dos vías. `ML.tpl.pack(paquete, i, quien)` es la única plantilla de paquete
(portada, `paquetes.html`, `vender.html` y `panel/paquetes.html`); su botón «Pedir» es un `<details>` que al abrirse
se convierte en dos enlaces: WhatsApp (`ML.wa`, con el mensaje del paquete y el nombre de la empresa en el panel) y
Gmail (`ML.gmail`: `mail.google.com/mail/?view=cm` con asunto y cuerpo; el destinatario sale de
`api/_maquinaria.json` → `correo`, hoy vacío y marcado como `[CORREO DE CONTACTO]`). Sin JavaScript propio y
accesible con teclado. Comprobado a 1920/1280/390 px en las tres páginas públicas: cada paquete con «Pedir», las
dos opciones al pulsar, nada se sale de la tarjeta, sin errores; QA 113/113.

## 36. Última revisión antes de entregar al socio (10 de octubre de 2026)

- Repaso línea a línea de los cambios del 8 al 10 (`api/auth.js`, `api/sesion.js`, `api/registro.js`, `assets/ml.js`,
  páginas de acceso, contacto y paquetes). Un hueco cerrado: `/api/registro` seguía aceptando `rol: 'comprador'`,
  y una cuenta así (sin empresa) habría entrado sin pasar por la autorización; ahora solo se crean cuentas de empresa.
- Pasada visual completa (25 páginas públicas × 390/1280/1920 px): sin desbordes, sin violaciones de axe, sin errores
  de consola. Los únicos avisos eran enlaces dentro de texto corrido con 14-20 px de alto (créditos, «Crear cuenta»,
  «aviso legal»…): un relleno vertical de 5 px en los enlaces en línea los sube a 24 px sin mover el texto. Las
  iniciales de los logotipos a 9-10 px se quedan: son decorativas.
- WhatsApp siempre abre WhatsApp (`https://wa.me/?text=…` sin número; con número, al chat). Pedir un paquete abre las
  dos vías, WhatsApp y Gmail, desde el propio paquete.
- Las comprobaciones que entran como administración (33 de §22, E2E, páginas privadas de la pasada visual) siguen sin
  poder pasarse: la contraseña de administración cambió el 09-10 y no está en ningún sitio al alcance de las pruebas.

## 37. Efectos visuales (10 de octubre de 2026)

El cliente pidió «efectos o cosas visuales orientadas a la estética». Sobrios, sin librerías (la CSP solo permite
scripts propios) y sin tocar la paleta:
- Aparición escalonada al entrar en pantalla de tarjetas y losetas (anuncios, sectores, vendedores, productos,
  paquetes, guías, créditos, placa del anuncio): `efectos()` en `assets/ml.js`, al final de `shell()`, marca los
  elementos con `data-reveal` y un retardo según su posición en la fila; un IntersectionObserver añade `is-in`; un
  MutationObserver sobre `#main` cubre lo que las páginas pintan después (filtros, paginación). Al terminar la
  transición se quita la marca para que el hover no herede el retardo.
- Hover: la foto se acerca despacio (anuncios, vendedores, banners, productos, guías), la tarjeta se eleva, y los
  enlaces «Ver todas» subrayan con barrido. Botones con respuesta al pulsar.
- Portada: zoom lento de la foto del hero (22 s) y los tres números del hero cuentan desde cero. Página de sector:
  la portada se descubre de izquierda a derecha. Cuadritos rojos de los rótulos aparecen escalando. Entrada suave de
  cada página. Cabecera con sombra cuando se ha bajado.
- Todo dentro de `@media (prefers-reduced-motion: no-preference)` y colgando de `html.js`: con «reducir movimiento»
  no se mueve nada y sin JavaScript no se oculta nada.
Comprobado en producción (`scratchpad/efectos_check.py`, 11 páginas × 1280/390 px): lo que está en pantalla se ve al
momento, tras recorrer la página no queda nada oculto, los resultados tras filtrar aparecen, los contadores terminan en
el valor real, la cabecera cambia al bajar, con reducir movimiento no hay marcas y todo está visible, sin errores de
consola ni desbordes. Suites públicas (paquetes, nombres, fotos, rejilla) sin fallos.

**v2 (10-10, tarde).** El cliente no notaba la primera versión («no veo los cambios»; el servidor servía todo).
Ahora se ve: entrada de 34 px con escala desde .96, hover con elevación de 6 px, sombra larga y foto al 108 %;
hero con zoom del 116 %, barrido de luz y título palabra a palabra, buscador después; raya roja que crece bajo el
título de cada sección; subrayado rojo en el menú; «Destacado» con latido; botones primarios con sombra roja al
pasar. Con «reducir movimiento» queda solo el fundido de aparición. El hero y los contadores se adornan cuando la
página los pinta (MutationObserver), no solo al arrancar: la v1 no los animaba nunca. `efectos_check.py` ahora exige
que el contador haya corrido (`data-contado=fin`), el título por palabras y la raya bajo el título.

## 38. Bucle de revisión, iteración 1: `roble.js` y `ml.js` línea a línea (10 de octubre de 2026)

- **Datos fantasma del navegador.** Las páginas públicas seguían fundiendo lo que hubiera en `localStorage` de la
  época del prototipo: empresas y productos añadidos o «borrados» (`roble_admin_v1`), anuncios locales, parches con
  `_deleted`, nombres de vendedor y hasta precios de los paquetes (`roble_ml_v1`). En el navegador de quien usó el
  prototipo (el cliente) podían verse empresas o anuncios que no existen, faltar reales o salir otro precio. Fuera:
  el público ve solo la API. Se quedan en local lo que es local a propósito: guardadas, solicitudes, el registro
  de actividad y el orden de banners del admin. Comprobado con un navegador «envenenado»
  (`scratchpad/local_check.py`): nada fantasma aparece, lo real sigue, guardadas sigue funcionando.
- Métodos muertos del almacén local fuera (`addAnuncio`, `setAnuncio`, `delAnuncio`, `setVendedor`, alertas,
  `addPedido`). El perfil del panel ya no tiene el campo «Tipo de vendedor»: solo se guardaba en ese navegador; los
  tipos los deduce el servidor de la descripción.
- Escape: ciudad y región en la tarjeta de vendedor (`vendCard`) y el nombre del administrador en su panel. Un tipo
  de vendedor desconocido ya no pinta «undefined». Rastreo automático de campos sin escapar en todas las plantillas:
  el resto son títulos de documento, `textContent` o toasts, que no interpretan HTML.

## 39. Bucle de revisión, iteración 2: páginas públicas y API línea a línea (11 de octubre de 2026)

Revisadas las páginas públicas (`buscar`, `vendedor`, `empresa`, `producto`, `sector`, `solicitudes`, `empresas`,
`productos`, `vendedores`, `favoritos`, `anuncio`, `guia(s)`, `para-empresas`, `creditos`, `404`, `acceso`) y la API
(`empresa`, `productos`, `contactos`, `guardadas`, `subir`, `password`, `_permisos`, `_contacto`): la API no tenía
nada que corregir. Lo arreglado:

- **Enlaces a la web de la empresa.** La web la escribe la propia empresa y las fichas la enlazaban tal cual
  (`href="${esc(web)}"`): escapada contra HTML pero no contra `javascript:` ni texto suelto, y la API solo valida
  http(s) en las ediciones nuevas. `ROBLE.webHref()` enlaza solo http(s), pone `https://` a un dominio a secas y
  descarta lo demás; `webTexto()` lo pinta sin esquema. Lo usan `empresa.html` (incluido el `url` del ld+json) y
  `vendedor.html`. Hoy las 122 webs de la base llevan esquema: no cambia nada visible, cierra la puerta.
- **vendedor.html** se caía con un tipo de vendedor desconocido (`ML.TIPO[t].toLowerCase()`): tipos filtrados; país
  con reserva; año máximo del filtro = año actual en vez de `2026` fijo. En la primera versión la constante `tipos`
  quedó declarada después de usarse («Cannot access before initialization», la página entera en blanco): lo cazó
  `revision2_check.py` en producción y se corrigió en el mismo tick.
- **anuncio.html**: tipos del vendedor sin «undefined». **buscar.html**: el selector «Vendedor» lista solo los que
  tienen anuncios publicados (antes, 150 nombres de los que la mayoría devolvía cero). **404.html**: dos enlaces iban
  al mismo `directorio.html`; el segundo va ahora a `empresas.html`.
- **para-empresas.html**: la ficha de alta se guardaba en `localStorage` (`roble_altas`) y decía «la revisamos en 48
  horas»: nunca llegaba a nadie. Ahora lleva a `acceso.html?crear` con nombre y correo puestos (la pestaña «crear»
  los lee de la URL); la cuenta queda pendiente de autorización (§34) y la ficha se completa desde el panel.

Comprobado en producción con `revision2_check.py` (10 OK), `local_check.py`, `efectos_check.py`, `pedir_check.py`,
`fotos_check.py`, `nombres_check.py`, `packs_check.py` y `visual.py` (público): 0 fallos. QA local 113/113.

## 40. Bucle de revisión, iteración 3: panel, admin y resto de la API (13 de octubre de 2026)

Revisados `panel/*.html`, `panel/panel.js`, `admin/*.html`, `admin/admin.js`, `admin/ml-admin.js`, los nueve
`admin-directorio/*.html` (métodos de `Admin.Store` cotejados uno a uno) y `api/admin.js`, `_esquema.js`,
`_correo.js`. La API y el panel de empresa no tenían nada que corregir. En el admin de maquinaria:

- **La portada del admin (`admin/index.html`) se caía entera**: llamaba a `S.alertas()`, que la iteración 1 quitó
  del almacén local (§38) junto con `setVendedor`. Al administrador le salía la cabecera y nada más. Fuera la tarjeta
  «Demanda sin oferta» y el contador de alertas: nunca hubo alertas en la base, eran del prototipo.
- **`admin/vendedores.html`**: el interruptor «Destacado» llamaba a `S.setVendedor` (error en consola y nada
  guardado). El destacado lo gestiona pagos: el interruptor avisa y vuelve a lo que hay, como ya hacían plan y
  destacado en el admin del directorio (`dePagos`). Tipos de vendedor sin «undefined».
- **`admin/leads.html`**: la columna «Máquina» enlazaba a `anuncio.html?id=undefined` (el contacto no trae
  `producto_id`); ahora es texto.

Lección: al borrar un método hay que buscar sus llamadas en las tres zonas (público, panel, admin), no solo en los
archivos que se están tocando. Las páginas de administración no se pueden probar en producción sin la contraseña
nueva de administrador: comprobación por sintaxis, por rastreo de llamadas y cargando las páginas sin sesión (sin
errores JS).

## 41. Bucle de revisión, iteración 4 y cierre: `ml.js` entero y la API de identidad (13 de octubre de 2026)

Revisados `assets/ml.js` línea a línea (almacén, identidad, cabecera, columnas, plantillas, galería, barra móvil,
contacto, efectos, shell) y `api/auth.js`, `sesion.js`, `registro.js`, `_invitaciones.js`. La API de identidad no
tenía nada que corregir (`_invitaciones.js` no lo usa ningún endpoint: es módulo interno, no cuenta como función).
En `ml.js` y `anuncio.html`:

- Un estado de máquina que no sea `nueva`/`usada`/vacío pintaba «undefined» en la tarjeta, la ficha y la meta
  descripción. Guardado con `a.estado && ESTADO[a.estado]` (el vacío sigue sin pintarse: la API manda `''`).
- La tira de la cabecera decía «Vendedores destacados» aunque rellenara con vendedores sin destacar; ahora dice
  «Vendedores» cuando ninguno lo es.

**Cierre del bucle (iteraciones 1–4, §38–§41).** Revisado todo lo que se sirve: `roble.js`, `ml.js`, las 24 páginas
públicas, el panel, los dos admins y los 22 archivos de `api/`. Fallos reales encontrados y corregidos: 14 (tres
de ellos tiraban una página entera: `vendedor.html` con tipo desconocido, `admin/index.html` y el interruptor de
destacado). Mejoras: 9. Todo desplegado y comprobado en producción con las suites del scratchpad; QA local 113/113.
Queda sin probar en producción lo que necesita sesión de administración (contraseña nueva pendiente).
## 42. Revisión técnica final (13 de octubre de 2026)

Repaso de lo que las iteraciones 1 y 2 no cubrieron: `auth`, `sesion`, `registro`, `admin`, `datos`, `maquinaria`,
`_esquema`, `_invitaciones`, `_correo`, los paneles privados (`panel/`, `admin/`, `admin-directorio/`), `vercel.json`
y lo que el despliegue sirve. Las plantillas de los paneles escapan todo lo que llega del servidor (tablas, cajones,
avisos); la autorización sigue decidiéndose en servidor contra la membresía. Arreglado:

- **El aviso de «subida terminada» del almacén recibía 401.** Lo manda Vercel Blob, sin cookie, firmado con
  `x-vercel-signature`; `/api/subir` pedía sesión antes de dárselo a la librería, así que `onUploadCompleted` no se
  ejecutaba nunca y ninguna foto subida quedaba en auditoría (`foto.subida`). Comprobado en producción: un aviso sin
  firma devolvía «Tienes que haber iniciado sesión». Ahora ese evento pasa sin sesión y lo autentica la firma (la
  comprueba `handleUpload`); pedir permiso de subida sigue exigiendo sesión, membresía y el límite por hora.
- **Se servían en público `scripts/`, `backup.ps1` y `auditar.ps1`** (200 en producción). Sin secretos, pero
  describen la base, el rol `roble_app` y sus privilegios. Fuera del despliegue en `.vercelignore`; ninguna función
  los usa.
- **Cuentas eliminadas** (`usuarios.eliminada`): entrar y recuperar la contraseña no las filtraban. Entrar abría una
  sesión que `usuarioDeSesion` ya no aceptaba (el panel decía «Entra»); ahora 401 como cualquier fallo.
- **Cambio de contraseña de una cuenta pendiente, rechazada o suspendida** abría sesión y mandaba al panel, que la
  rechazaba (§34). Ahora cambia la contraseña, no abre sesión y responde `{ ok, aviso }`; `acceso.html` enseña el
  aviso y vuelve a «Entrar».
- **Exportación CSV del admin** (empresas y contactos): nombre, empresa y mensaje los escribe cualquiera desde el
  formulario público; una celda que empezara por `=`, `+`, `-` o `@` la ejecutaba Excel como fórmula. Se antepone
  un apóstrofo.
- **Moderación**: el enlace «Web» del cajón usaba la web tal cual; ahora `ROBLE.webHref()` como las fichas públicas
  (§39): un `javascript:` sale como texto, un dominio a secas lleva `https://`.
- Subida de fotos en el admin: un error llamaba a `status()` (el pintor de etiquetas) en vez de `R.toast()` y no
  avisaba. CSP: fuera `formsubmit.co` de `form-action` (no se usa desde §34).

Comprobado: QA local 113/113; banco simulado de los cambios 10/10 (aviso firmado → 200 y auditoría; sin firma o
firma falsa → 400; permiso sin sesión → 401; cuenta eliminada → 401; contraseña de cuenta pendiente sin cookie y
de cuenta activa con cookie; CSV); en Chromium, moderación con una alta `javascript:` (sin enlace) y otra con
dominio a secas (`https://`), y el aviso en `acceso.html`, sin errores de JavaScript.

- **SEO: canonical doble en las fichas.** `anuncio`, `empresa`, `sector`, `producto`, `vendedor` y `guia` llevaban en el
  HTML un canonical fijo SIN `?id` y `R.canon()` lo cambiaba después: para quien no ejecuta JavaScript (Bing, rastreadores
  de IA) y para Google si se queda con el del HTML, las 671 fichas del sitemap apuntaban a una sola URL. Fuera el fijo;
  `R.canon()` crea la etiqueta si no existe. Comprobado en Chromium: un solo canonical, con su `?id`, en las seis.

- **Tipografías desde el propio dominio.** Las 44 páginas cargaban Archivo e IBM Plex Mono de Google Fonts: cada visita
  mandaba la IP a Google (EE. UU.) y el aviso de privacidad no lo decía (riesgo RGPD, hay sentencias en la UE por
  esto), y eran dos orígenes de terceros más en la carga. Ahora `assets/fonts/` (woff2, latin y latin-ext, licencia
  OFL), declaradas al principio de `roble.css`, con precarga de la Archivo latina; fuera `fonts.googleapis.com` y
  `fonts.gstatic.com` de la CSP. Comprobado en Chromium en portada, ficha, acceso, panel y admin (con `<base>`): las
  dos familias cargadas, cero peticiones a Google, sin errores.
- **«Ver una ficha de ejemplo»** (`para-empresas.html`) iba a `empresa.html?id=15`, que ya no existe («Esa empresa ya
  no está»). Ahora apunta a la misma empresa que la página enseña de ejemplo; sin datos, al listado.
- Rastreo de producción (13-10): 23 páginas renderizadas a 390 px sin errores ni desbordes; 698 URL (enlaces y
  sitemap) en 200; las 683 del sitemap con id existente; ese era el único enlace a un id inexistente.

- **Desbordes horizontales que ya estaban en producción.** (1) La barra oscura de maquinaria no cabe entera hasta
  ~1180 px: entre 870 y 1170 «Acceder» quedaba fuera de la pantalla (iPad en horizontal, portátiles pequeños). En
  ese tramo usa ahora el menú desplegable del móvil (`ml-visual.css`, solo `.cab-oscura`); a 1181 vuelve la barra
  completa. (2) Portada, rejilla «Quién vende» (`.dgrid`, 4 × `1fr`) entre 820 y 940 px: `minmax(0, 1fr)` y 2
  columnas hasta 960. (3) `panel/paquetes.html` a 390 px: `.packs` a 3 columnas sin condición en `ml-visual.css`
  pisaba las reglas de móvil de `ml.css` fuera de `.ml-main`; las 3 columnas, solo desde 901 px.
  Barrido después: 23 páginas públicas × 35 anchos (360-1920) sin desbordes ni errores; panel de empresa (6
  páginas, sesión simulada) a 390 y 1280 sin desbordes ni errores; menú desplegable a 1024 con buscador y «Acceder».
- Medida A/B de las tipografías propias (Lighthouse móvil en local, 2 pasadas, commit anterior frente a este):
  primer pintado 0,4-0,6 s antes en portada, directorio y ficha; la nota de rendimiento no se mueve fuera del ruido.

- **El latido de «Destacado» repintaba la página sin parar.** `.featured` animaba `box-shadow` en bucle infinito: con la
  página quieta, 1.000-1.400 ms de cada 5 s del hilo principal (~25 %) y ~60 recálculos de estilo por segundo, en
  escritorio y sin límite de tiempo (en móvil, batería y respuesta al toque). Ahora anima la opacidad de un anillo
  fijo en `::after`, que va por la tarjeta gráfica: 7-11 ms por 5 s y 0 recálculos. Mismo aspecto (capturas en el
  punto álgido idénticas a producción; posición de las 29 etiquetas de 4 páginas idéntica). Carga con efectos en
  móvil simulado (CPU ×4): trabajo del hilo principal en sector 3,0 → 1,8 s, directorio 2,6 → 1,9 s.
- **SEO, detalles:** portada con `WebSite` + `SearchAction` (`buscar.html?q=`, comprobado: devuelve resultados);
  `paquetes.html` sin `og:image` ni `twitter:card` (es la que se comparte por WhatsApp): añadidos. Las fichas de
  anuncio y producto declaran `Product` sin `offers`: Search Console lo marcará «no válido para resultados
  enriquecidos». Es inofensivo y rellenarlo exigiría inventar precios: se deja.
- Páginas privadas con sesión simulada: panel de empresa (6) y administración (13) a 390 y 1280 px sin desbordes ni
  errores, todas con `noindex`; axe sin fallos graves ni críticos (solo `region`, moderado: el aviso «Solo en este
  navegador» queda fuera de los puntos de referencia).

**Sigue abierto (no se arregla aquí):**
- Los límites de intentos (entrar, alta, contraseña, contacto, subida) viven en memoria por instancia: frenan lo
  casual, no un ataque repartido. Lo de verdad es un contador en base (tabla nueva, se crea a mano como el esquema).
- **Rendimiento móvil** (Lighthouse 13, producción, 13-10): portada 81, anuncio 76, empresa 85, sector 64 (LCP 3,4-4,8 s,
  TBT hasta 730 ms en sector); accesibilidad, buenas prácticas y SEO 100. La causa es que cada página baja y procesa el
  directorio entero (`/api/datos.js`, 230 KB) y pinta en el navegador. Lo de verdad es la decisión pendiente de
  `contexto.md` §7: generar el HTML antes (o un endpoint por ficha).
- **Correo saliente, por comprobar en Vercel.** `RESEND_API_KEY` está puesta (`olvide` responde 200), pero si
  `REMITENTE_EMAIL` no es de un dominio verificado en Resend, el remitente por defecto `onboarding@resend.dev` solo
  puede escribir a la cuenta dueña de Resend: códigos de contraseña, avisos de contacto y de moderación no llegarían
  a nadie más (falla en silencio, queda `correo_fallo` en los logs). `vercel.app` no se puede verificar: hace falta
  dominio propio. Las plantillas de correo (`_correo.js`) aún usan la paleta verde y crema de la web antigua.
- Textos pendientes del propietario visibles en producción: `[RAZÓN SOCIAL]` y `[DOMICILIO]` en `legal.html`
  (obligatorios por la LSSI antes de abrir), `[CORREO DE CONTACTO]` en contacto y paquetes, `[NÚMERO POR RELLENAR]`
  (WhatsApp) en paquetes.
- Sin `/llms.txt` (en MaqDeMad se decidió tenerlo para que la IA cite el directorio).
- `script-src 'unsafe-inline'`: las páginas llevan su script en línea; la defensa contra XSS es el escape. Sacar los
  scripts a archivos permitiría quitarlo.
- La cuenta de pruebas 178 está pendiente y desde §34 no puede entrar: `e2e-subir.py` ya no pasa con ella. Hace
  falta una cuenta de pruebas autorizada.
- Categorías, usuarios, contenidos, configuración, solicitudes, vendedores y pedidos del admin siguen siendo solo
  del navegador (lo avisa la propia página).

## 43. Correo sin dominio propio: envío por SMTP (15 de octubre de 2026)

Resend no exige plan de pago para escribir a cualquiera (gratis: 3.000 al mes, 100 al día); exige verificar un dominio
propio, y `vercel.app` no se puede. Hasta tenerlo, con `onboarding@resend.dev` solo llega correo a la cuenta dueña de
Resend: códigos de contraseña, avisos de contacto y de moderación no le llegaban a nadie más. `api/_correo.js` admite
ahora SMTP (`nodemailer`): con `SMTP_USER` y `SMTP_PASS` puestas en Vercel se envía por SMTP —por defecto Gmail con
contraseña de aplicación, 500 al día— y si no, por Resend como antes. Al verificar el dominio se quitan las dos
variables y vuelve a Resend sin tocar código.

Comprobado: envío real de `enviaCodigo` por Gmail SMTP y recepción en la bandeja (texto y HTML, remitente «ROBLE»);
sin variables responde `sin-clave`; con solo `RESEND_API_KEY` va a Resend como antes; QA local 113/113.
