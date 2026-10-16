> **Nota (26-09-2026):** `assets/data.js`, `assets/data-home.js` y `assets/ml-data.js` ya no existen. Las páginas cargan `/api/datos.js` (y `?home=1` la portada), que sirve el directorio en vivo desde la base de datos con la misma forma, y `/api/maquinaria.js` los anuncios de maquinaria. Lo que sigue sobre esos extractos es historia. Detalle en `hardening.md`, apartado 8.

# ROBLE — contexto del proyecto

Todo lo que hace falta saber para retomar el trabajo sin releer el historial. Estado a 2026-09-22.

---

## 1. Qué es

**ROBLE** es la web del sector de la madera y el mueble en España, con vistas a Portugal, Italia y
Francia. Tiene dos mitades unidas en un solo sitio:

- **Portal de maquinaria** (la entrada): anuncios de máquinas nuevas y de segunda mano, publicados por
  fabricantes, distribuidores y servicios técnicos. Estructura copiada de macchine-legno.com.
- **Directorio del sector**: empresas, productos y 14 sectores, de la materia prima a la feria.

Quien entra es un profesional con prisa: un carpintero, un fabricante de mueble, un comprador. Busca
una máquina o un proveedor concreto y quiere el contacto rápido.

El negocio vive de fichas destacadas, paquetes de anuncios y banners laterales. **Los precios y los
pagos los lleva otra persona: fuera de este trabajo.** Aquí solo estética y funcionalidad.

---

## 2. Dónde está cada cosa

Repositorio: `https://github.com/kdl177/roble-web` (privado, cuenta `kdl177`). Raíz local:
`C:\Users\<usuario>\SIMBAI\Proyecto Carpinteria\MaqDeMad\`.

| Carpeta | Qué es | Estado |
|---|---|---|
| `roble-ml/` | **La web nueva. Aquí se trabaja.** | Activa |
| `Proyectos/` | Web en producción (verde y crema, con servidor real) | No se toca |
| `roble-v2/` | Prototipo anterior del directorio | Solo histórico |
| `brand/` | Manual de marca, logos y tokens | Referencia |
| `Workflows-n8n/` | 7 flujos de automatización | 4 sin activar |

| Web | Proyecto de Vercel | Dirección | Cómo se despliega |
|---|---|---|---|
| Producción | `maqdemad` | `maqdemad.vercel.app` | **Solo** `git push` a `master`. Nunca la CLI de Vercel: ya tumbó la web varias veces |
| Nueva | `roble-maquinaria` | `roble-maquinaria.vercel.app` | `cd roble-ml && vercel deploy --prod --scope simbai` |

La web nueva lleva `noindex` por cabecera hasta el lanzamiento. Producción sigue intacta y verificada.

**Git:** una rama por sesión, el merge lo hace el propietario. El trabajo actual está en
`claude/roble-ml-arquitectura` (20 commits, subida a GitHub). El correo de los commits debe ser
`234013956+kdl177@users.noreply.github.com` o Vercel bloquea el despliegue.

---

## 3. La marca

Idea: **la placa de características**, la chapa remachada que lleva toda máquina. Sobria, precisa,
dice la verdad. Personalidad: precisa, recia, franca, de oficio.

| Papel | Color | Uso |
|---|---|---|
| Tinta | `#121212` | Texto, logo, superficies oscuras |
| Cal | `#F6F4EF` | Fondo de página |
| Rojo piloto | `#D4271B` | Una acción por pantalla, destacados, errores. Menos del 2 % de la superficie |
| Papel | `#FFFFFF` | Tarjetas y campos |
| Latón | `#7D5A1A` | Estado pendiente y sello de verificada |

Tipografías: **Archivo** (titulares y texto) e **IBM Plex Mono** (referencias, cifras, estados).
Formas a escuadra, radios de 3 a 6 px. Sin verde: los estados son cuadrados de color.

**Prohibido:** árboles, hojas, serruchos, vetas de madera como textura, degradados, sombras
llamativas, emojis (iconos SVG siempre), look de startup genérica.

Manual completo en `brand/brand-book.html`. Tokens en `brand/tokens.css`.

---

## 4. Cómo está construida

HTML, CSS y JavaScript a pelo. Sin framework, sin compilación. Cada página carga sus datos y se
dibuja sola en el navegador.

```
roble-ml/
  *.html            24 páginas públicas
  panel/            panel de empresa (6 páginas + panel.js)
  admin/            administración de maquinaria (6 páginas + 2 js)
  admin-directorio/ administración del directorio (9 páginas)
  assets/
    roble.css       tokens, base y componentes compartidos
    ml.css          estructura de tres columnas del portal
    ml-visual.css   capa visual (fotos, ajustes) — corrige a ml.css
    roble.js        iconos, datos del directorio, búsqueda, plantillas
    ml.js           todo lo del portal: shell, tarjetas, galería, almacén
    data.js         directorio: 154 empresas, 465 productos (200 KB)
    ml-data.js      maquinaria: 76 categorías, 31 anuncios, 12 vendedores
    data-home.js    extracto de 6 KB solo para la portada
    faq-sectores.js 69 preguntas frecuentes por sector
    ml-guias.js     3 guías de compra
  docs/             documentación (no se despliega)
```

**Lo esencial de `ml.js`:** `ML.shell(seccion, { dir, cat, sector })` monta cabecera, barra lateral,
columna de banners y pie, y devuelve el contenedor central. Todas las páginas empiezan igual.

API pública de `ML`: `contacto, galeria, barraMovil, cat, vend, anuncio, anunciosDe, publicados,
fmtPrecio, catsAZ, tpl, buscar, shell, solicitudes, foto, fotoCat, fotoVend, fotoSm, store`.

**Maquetación:** tres columnas. Izquierda las 76 categorías (o los 14 sectores en el directorio),
centro el contenido, derecha los banners de vendedores. Contenedor de 1.480 px. Anuncios a dos
columnas. En móvil todo se apila y la barra lateral nace cerrada.

---

## 5. Los datos

| Qué | Cuántos | De dónde |
|---|---|---|
| Empresas | 154 | Reales, captadas del sector. 9 marcadas como prueba |
| Productos | 465 | Reales, sin fotos |
| Sectores / subsectores | 14 / 123 | Reales |
| Categorías de maquinaria | 76 | Fijas |
| Anuncios | 31 | Derivados de empresas reales. **Ninguno con foto propia ni precio** |
| Vendedores | 12 | Empresas del directorio con máquinas |

**Regla de oro: no inventar datos.** Lo que no consta se dice «a consultar». Las fotos de categoría
son de Wikimedia Commons, con licencia y créditos, y van marcadas «imagen orientativa». Los precios
de paquetes son `[PRECIO]`.

**Un vendedor no es una entidad aparte:** es una empresa del directorio con al menos una máquina
publicada. Si publica su primera máquina, aparece sola en Vendedores y gana su página.

**Hoy todo se guarda en el navegador**, en cinco almacenes: `roble_ml_v1` (portal), `roble_admin_v1`
(directorio), `roble_leads` (contactos), `roble_altas`, `roble_session`. La web pública aplica esos
cambios al cargar. Es lo que hace que los circuitos funcionen de punta a punta en el prototipo.

---

## 6. Qué funciona ya

**Público:** portada, buscador de máquinas con nueve filtros, 76 categorías, ficha de anuncio con
galería ampliable, vendedores, directorio, 14 sectores con preguntas frecuentes, buscador de
empresas, ficha de empresa, buscador de productos, ficha de producto, guías, guardados y alertas,
solicitudes, repuestos, alta de empresa, contacto, legal y 404.

**Panel de empresa** (cualquiera de las 154): resumen, máquinas, productos, contactos, paquetes y
perfil. El perfil guarda a la vez en el directorio y en el portal.

**Administración:** maquinaria (anuncios, solicitudes, vendedores y banners, paquetes, contactos) y
directorio (altas, empresas, productos, categorías, contenidos, usuarios, configuración).

**Circuitos probados de punta a punta:**
1. Alta de empresa → moderación → aparece en la web.
2. Panel → ficha pública, al momento.
3. Paquete → saldo → anuncio → moderación → la empresa se convierte en vendedor.
4. Contacto desde ficha, producto o anuncio → panel de la empresa y administración.
5. Categoría vacía → alerta → demanda registrada, que el admin ve como argumento de venta.

**Calidad:** Lighthouse móvil con rendimiento entre 80 y 98, accesibilidad, buenas prácticas y SEO en
100. Sin saltos de maquetación, sin enlaces rotos (2.014 comprobados), a 390, 768, 1.024, 1.440 y
1.920 px.

---

## 7. Qué falta

**Decidido:** la web nueva sustituye a producción, conservando su servidor.

**Pendiente de decidir:**
- ~~Cómo se pinta el HTML~~ (decidido el 14-10): las 9 páginas fijas se generan antes con
  `npm run prerender` (`hardening.md` §43). Las fichas con `?id` siguen en el navegador hasta que se decidan las URL
  limpias.
- URLs limpias. Hay propuesta escrita: el identificador al final, por ejemplo
  `/empresas/airmatic-madera-173/`.

**Por hacer, en orden:**
1. Conectar la web a la API: los cinco almacenes del navegador pasan a base de datos. El contrato de
   `/api/maquinaria` ya está escrito en `docs/api-maquinaria.md`.
2. Sesión real ligada a la empresa y permisos.
3. Fotos propias de anuncios y productos.
4. Activar los cuatro flujos de n8n (dependen del punto 1).
5. Retirar las 9 empresas de prueba.
6. Portugués, italiano y francés.

Lista completa con diez bloques en `docs/arquitectura.md`.

---

## 8. Cómo trabajar aquí

**Antes de tocar nada:** `git status`. Si hay cambios que no son míos, parar y avisar. Hay varias
sesiones sobre el mismo repositorio.

**Reglas que no se rompen:**
- No inventar datos de cliente. Sin dato: `[TU TELÉFONO]`, «a consultar».
- No emojis en la web: iconos SVG.
- No tocar `Proyectos/` ni usar la CLI de Vercel en el proyecto `maqdemad`.
- No hablar de precios ni de pagos: los lleva otra persona.
- Editar antes que crear archivos. No refactorizar lo que no se toca.

**Antes de desplegar:** `npm run prerender` (regenera el HTML de las 9 páginas fijas) y commit de los HTML.

**Antes de entregar:** comprobar a 390 y 1.440 px como mínimo, que no haya desbordes ni errores de
consola, y que los enlaces no se rompan. Con cambios de maquetación, medir también Lighthouse.

**Patrones a respetar:**
- Una sola acción roja por pantalla.
- Los datos, en monoespaciada.
- Nada de rejillas de tres tarjetas iguales con icono y texto.
- Las fotos mandan: es lo que pidió el cliente.

**Documentos de referencia** en `roble-ml/docs/`: `arquitectura.md` (qué falta),
`redirecciones.md` (sustitución de producción y URLs), `api-maquinaria.md` (contrato del servidor),
`ecosistema.md` (cómo se alimentan las piezas), `mejoras-y-fallos.md` (historial de correcciones).
