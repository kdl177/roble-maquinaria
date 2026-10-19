# ROBLE Maquinaria

Portal de maquinaria para la madera y directorio profesional del sector (38 apartados). Web estática + funciones
serverless en Vercel + Postgres (Neon).

Producción: https://roble-maquinaria.vercel.app

## Qué hay

| Carpeta | Qué es |
|---|---|
| `*.html` | Páginas públicas. Cada una monta la cabecera, los laterales y el pie con `ML.shell()` (`assets/ml.js`). |
| `assets/` | `roble.js` (directorio, búsqueda, plantillas), `ml.js` (portal de máquinas, anuncios, sesión), CSS y fotos. |
| `api/` | Funciones serverless (CommonJS). 12 justas para el plan Hobby de Vercel. `_*.js` y `_*.json` son módulos y datos, no rutas. |
| `panel/` | Panel de empresa: ficha, productos, anuncios de máquinas, contactos. |
| `admin-directorio/`, `admin/` | Administración: moderación de empresas, anuncios, usuarios. Solo para los correos de `ROBLE_ADMIN_EMAILS`. |
| `scripts/` | Bancos de pruebas (`npm test`), generador del sitemap, utilidades. |
| `docs/` | `hardening.md` es el diario técnico completo (decisiones, incidentes, verificaciones). Empieza por `contexto.md`. |

## Datos

- `api/datos.js` → `window.ROBLE_DATA`: sectores, empresas y productos del directorio (lee la base; la web pública
  solo ve empresas activas).
- `api/maquinaria.js` → `window.ML_DATA`: anuncios de máquinas, vendedores, fotos orientativas y los 38 sectores.
- Los 38 sectores, con el nombre literal del cliente, están en `api/_sectores.json`. Las empresas guardan sus
  sectores por id, así que renombrar no desclasifica.
- Fotos orientativas: `assets/img/fotos/` (1200 px) y `sm/` (640 px), con autoría en `creditos.json` y en
  `creditos.html`.

## Variables de entorno (en Vercel, nunca en el repositorio)

| Variable | Para qué |
|---|---|
| `ROBLE_DATABASE_URL` | Postgres (Neon). Rol `roble_app`, mínimos privilegios. |
| `ROBLE_ADMIN_EMAILS` | Correos con acceso a la administración, separados por comas. |
| `RESEND_API_KEY` | Correos transaccionales (códigos, avisos). Sin ella, la web funciona y no envía correos. |
| `SMTP_USER`, `SMTP_PASS` | Alternativa a Resend mientras no haya dominio propio verificado: cuenta SMTP (por defecto Gmail, con contraseña de aplicación; 500 correos al día). Si están puestas, se envía por SMTP. `SMTP_HOST`/`SMTP_PORT` opcionales. |

El almacén de fotos de anuncios es un Blob de Vercel ligado al proyecto.

## Trabajar en local

```bash
npm install
npm test            # 113 comprobaciones de la API y los paneles, sin base de datos
npm run sitemap     # regenera sitemap.xml leyendo producción
npx vercel dev      # sirve la web y las funciones con las variables del proyecto
```

Despliegue: `npx vercel deploy --prod` desde esta carpeta (proyecto `roble-maquinaria`).

## Reglas de la casa

- La parte pública solo enseña los 38 apartados del cliente, con su nombre exacto. Sin subsectores ni categorías.
- Los paquetes de anuncios y los banners se piden por WhatsApp (`api/_maquinaria.json` → `whatsapp`).
- Nada de datos inventados: si falta un dato, se deja en blanco o se marca `[PENDIENTE]`.
- Antes de dar algo por hecho: `npm test`, y en producción los recorridos de `docs/hardening.md` §22-§23.
