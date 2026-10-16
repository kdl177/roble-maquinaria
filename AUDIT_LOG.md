# Registro de auditorías (Lighthouse, móvil, producción)

## Iteración 2026-10-13 22:05
Antes:   Perf 89 | A11y 100 | BP 100 | SEO 100   (LCP 3,4 s · TBT 170 ms · CLS 0,007)
Después: Perf 82–90 (dos pasadas; la variación es del propio Lighthouse) | A11y 100 | BP 100 | SEO 100   (LCP 3,4–3,6 s)
Hecho:
- Caché de un año e `immutable` para `/assets/img/` (antes una semana). Los nombres de archivo no cambian; si cambia una foto, cambia el archivo.
- Comprobado y descartado: WebP del hero solo ahorra un 10 % (foto con grano), no compensa un `<picture>` más preload nuevo. El preload del hero ya lleva `fetchpriority="high"`. El resto de imágenes ya van a calidad 72 progresiva.
Pendiente:
- LCP: el hero lo pinta JavaScript tras cargar `api/datos.js`, `api/maquinaria.js`, `roble.js` y `ml.js` (retardo de render ≈ 430 ms en la traza, 3,4 s con la emulación móvil). La única palanca real es pintar el hero en el HTML estático antes del JS, pero exige reproducir la cabecera y la rejilla de tres columnas para no provocar un salto de diseño (CLS): no es un cambio pequeño. Se deja para una iteración propia, con captura antes/después.
- `ml-visual.css` sin minificar (2 KB): sin impacto en puntuación.
- Fuente Archivo variable (88 KB): recortar los ejes cambiaría pesos usados en el diseño; no se toca.
ESTADO: SEGUIR (Perf < 95 solo por el LCP; el resto ya está al máximo)

## Iteración 2026-10-14 00:40
Antes:   portada Perf 98 | A11y 100 | BP 100 | SEO 100 (LCP 2,2 s) · sector 95 (LCP 2,9 s) · anuncio 90 (LCP 3,5 s). La portada ha subido de 89 a 98 con las tipografías propias de la revisión del socio (§42).
Después: portada 98 · sector 95 · anuncio 90 (LCP 3,5 s: igual; el tiempo lo manda la espera del JS, no los bytes).
Hecho:
- Ficha de anuncio: la foto de categoría bajaba a 1200 px (332 KB) en cualquier pantalla. Ahora `srcset` con la variante `sm` (640 px): en móvil y en la columna de la ficha carga la pequeña (~40 KB); la grande solo si el vendedor sube foto propia (externa, sin variantes).
- Portada de sector: mismo `srcset`; a 390 px carga `sm/`, a 1280 la de 1200 px (la portada ocupa la columna de 780 px).
- `ML.sm()` exportado para poder derivar la variante pequeña de una ruta.
Pendiente:
- LCP de la ficha de anuncio (3,5 s): la imagen se descubre cuando el JS pinta la ficha (retardo de carga 300 ms en la traza). No se puede precargar: depende del `?id`. La salida es la misma que la del hero: HTML generado antes (contexto.md §7).
- Falta medir buscar, empresas y directorio en la siguiente iteración.
ESTADO: SEGUIR

## Iteración 2026-10-14 01:10
Antes:   buscar 99 · empresas 98 · vendedores 97 · directorio 89 (LCP 3,7 s, el elemento era una foto de sector con loading="lazy") | A11y 100 | BP 100 | SEO 100 en todas
Después: directorio 88–89 (LCP 3,5–3,6 s). Sin cambio real: el tiempo lo manda la espera del JS, no la carga diferida.
Hecho:
- Las seis primeras fotos de cada bloque que pinta el JS ya no van con `loading="lazy"` (el elemento más grande de la página no debe diferirse). Se hace en `marca()` de `ml.js`, antes del primer pintado; en directorio 7 fotos pasan a eager, 32 siguen lazy. Sin errores JS, efectos 0 fallos.
Pendiente:
- Todas las páginas medidas: portada 98, buscar 99, empresas 98, vendedores 97, sector 95, directorio 89, anuncio 90. Las dos que no llegan a 95 comparten causa: pintan en el navegador tras cargar los datos, y Lighthouse (móvil, CPU ×4) lo cuenta como LCP. La salida es generar el HTML antes (contexto.md §7), decisión pendiente del propietario; no es una edición pequeña.
- Fotos `sm/` de sectores de 65–88 KB (materias primas, mesas, carpintería): ya van a calidad 72 progresiva; bajar más tocaría el aspecto.
ESTADO: SEGUIR solo si se decide generar el HTML antes; sin esa decisión no quedan mejoras pequeñas.

## Iteración 2026-10-15 — HTML generado antes (decisión del propietario, 14-10)
Antes:   portada 98 (otra pasada 89) · directorio 89 · buscar 99 · empresas 98 · vendedores 97 | A11y 100 | BP 100 | SEO 100
Después: portada 92–96 · directorio 95 · buscar 95 · empresas 97 · vendedores 96 | A11y 100 | BP 100 | SEO 100
Hecho:
- `scripts/prerender.py` + `npm run prerender`: las 9 páginas fijas llegan pintadas en el HTML (detalle en hardening §43).
- `ML.shell()` repinta encima con datos frescos; los efectos no se reinician (`--ya`) y `#main` ya no hace fundido si llegó pintado.
- Dependencia: Playwright para Python, ya instalado en este equipo (lo usan las comprobaciones); no se añade nada al proyecto.
Pendiente:
- Las fichas con `?id` (anuncio 90, sector 95) siguen pintándose en el navegador: generarlas exige URL limpias (contexto.md §7, sin decidir).
- La nota de la portada oscila 92–96 entre pasadas; el LCP es la foto del hero (Slow 4G simulado).
ESTADO: LIMPIO para lo que se puede hacer sin cambiar las URL.
