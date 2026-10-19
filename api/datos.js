/* Datos del directorio en vivo, con la misma forma que tenía assets/data.js.
 *
 *   GET /api/datos.js         → window.ROBLE_DATA = { generado, sectores, sectoresAlias, empresas, productos }
 *   GET /api/datos.js?home=1  → extracto para la portada: totales, sectores con
 *                               recuento y las tres empresas destacadas
 *
 * Es un script, no JSON: las páginas lo cargan con <script src> antes de
 * roble.js y todo el código del cliente sigue leyendo window.ROBLE_DATA de
 * forma síncrona, sin cambios. Se cachea en el borde de Vercel un minuto y se
 * sirve la copia anterior mientras se regenera, así la base se consulta como
 * mucho una vez por minuto, y un fallo puntual no deja la web sin datos.
 *
 * La clasificación en sectores es la misma que usaba el directorio anterior
 * (sector libre + categorías, emparejados con los 14 ids oficiales). Solo se
 * publica lo que ya era público: nunca el correo de la cuenta, solo el de
 * contacto si la empresa lo puso.
 */

// Fecha AAAA-MM-DD en hora de Madrid: en UTC, lo creado entre las 0:00 y las 2:00 salía con el día anterior.
const dia = d => d ? new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : null;
const { db, init } = require('./_esquema');
const { usuarioDeSesion, esAdmin } = require('./auth');
const { empresasDe } = require('./_permisos');
const SECTORES = require('./_sectores.json');
/* Los 14 sectores antiguos → los 38 de ahora. Las empresas tienen escrito el
   NOMBRE del sector antiguo (texto libre); sin este mapa ninguna encajaría. */
const MAPA = require('./_sectores-mapa.json');

const normaliza = txt => String(txt || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function sectorId(texto) {
  const norm = normaliza(texto);
  if (!norm) return null;
  // Primero lo antiguo: id viejo escrito como categoría, o nombre viejo en `sector`.
  if (MAPA.ids[norm]) return MAPA.ids[norm];
  const viejo = Object.keys(MAPA.nombres).find(n => normaliza(n) === norm);
  if (viejo) return MAPA.nombres[viejo];
  const exacto = SECTORES.find(s => s.id === norm || normaliza(s.nombre) === norm || normaliza(s.corto) === norm);
  if (exacto) return exacto.id;
  const parcial = SECTORES.find(s => norm.startsWith(s.id) || s.id.startsWith(norm) || normaliza(s.nombre) === norm);
  return parcial ? parcial.id : null;
}

/* Apartados 1 y 2 del cliente: maquinaria nueva y de ocasión. Las empresas tienen
   escrito «maquinaria» sin más; lo que dicen de sí mismas decide. Quien habla de
   ocasión, usada o segunda mano entra en ocasión; si además fabrica, vende nueva o
   es distribuidor oficial, sigue también en nueva. */
const OCASION = /ocasion|usad[ao]s?\b|segunda mano|reacondicionad/;
const NUEVA = /nuev[ao]|fabrica|distribuidor oficial/;

function sectoresDe(e) {
  const ids = new Set();
  const suelto = sectorId(e.sector);
  if (suelto) ids.add(suelto);
  for (const c of String(e.categorias || '').split(/\n+/)) { const id = sectorId(c); if (id) ids.add(id); }
  if (ids.has('maquinaria')) {
    const t = normaliza([e.empresa, e.descripcion, e.descripcion_larga, e.servicios].join(' ')).replace(/-/g, ' ');
    if (OCASION.test(t)) { ids.add('maquinaria-ocasion'); if (!NUEVA.test(t)) ids.delete('maquinaria'); }
  }
  return [...ids];
}

const lineas = txt => String(txt || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
const esDemo = e => /\.example\b/i.test(e.web || '') || /\.example\b/i.test(e.email_contacto || '');

function aEmpresa(e, nProductos) {
  const sectores = sectoresDe(e);
  return {
    id: e.id,
    nombre: e.empresa,
    sector: sectores[0] || null,
    sectores,
    ciudad: e.ciudad || '',
    region: e.region || '',
    pais: 'ES',
    desc: e.descripcion || '',
    web: e.web || '',
    plan: e.plan && e.plan !== 'gratuito' ? 'premium' : 'base',
    demo: esDemo(e),
    logo: e.logo || null,
    servicios: lineas(e.servicios),
    desc_larga: e.descripcion_larga || '',
    anio: e.anio || null,
    empleados: e.empleados || '',
    ambito: e.ambito || '',
    telefono: e.telefono || '',
    email: e.email_contacto || '',
    horario: e.horario || '',
    direccion: e.direccion || '',
    linkedin: e.linkedin || '',
    instagram: e.instagram || '',
    nProductos: nProductos || 0,
    // Moderación (tabla empresas): la web pública solo muestra las activas.
    estado: e.estado_mod || 'activa',
    origen: e.origen || 'legacy',
    alta: dia(e.alta),
    motivo: e.motivo || '',
  };
}

function aProducto(p) {
  return {
    id: p.id,
    titulo: p.titulo,
    desc: p.descripcion || '',
    sector: sectorId(p.sector) || p.sector || null,
    sub: p.subsector || '',
    fotos: lineas(p.fotos),
    destacado: !!p.destacado,
    empresa_id: p.user_id,
    empresa: p.empresa || '',
    // El driver devuelve Date para timestamptz; String(Date) daría "Sat Sep 05".
    fecha: dia(p.creada),
  };
}

/* opc.todas: administración, todas las empresas y el correo de la cuenta.
   opc.propias: ids de las empresas del usuario, visibles para él aunque no
   estén activas (su panel). Sin opciones: solo las activas. */
async function datos(opc = {}) {
  await init();
  const sql = db();
  const [filasE, filasP] = await Promise.all([
    sql`
      SELECT u.id, u.email AS cuenta, em.estado AS estado_mod, em.origen, em.creada AS alta, em.motivo,
             empresa, sector, categorias, region, ciudad, web, descripcion, plan, logo,
             servicios, descripcion_larga, anio, empleados, ambito, telefono, email_contacto,
             horario, direccion, linkedin, instagram
      FROM usuarios u LEFT JOIN empresas em ON em.id = u.id
      WHERE rol = 'empresa' AND eliminada IS NULL AND empresa IS NOT NULL AND TRIM(empresa) <> ''
      ORDER BY (plan <> 'gratuito') DESC, empresa ASC`,
    sql`
      SELECT p.id, p.titulo, p.descripcion, p.sector, p.subsector, p.fotos, p.destacado, p.creada,
             p.user_id, u.empresa
      FROM productos p JOIN usuarios u ON u.id = p.user_id
      WHERE u.rol = 'empresa' AND u.eliminada IS NULL
      ORDER BY p.destacado DESC, (u.plan <> 'gratuito') DESC, p.creada DESC`,
  ]);

  const porEmpresa = {};
  for (const p of filasP) porEmpresa[p.user_id] = (porEmpresa[p.user_id] || 0) + 1;

  const propias = new Set(opc.propias || []);
  const empresas = filasE.map(e => Object.assign(aEmpresa(e, porEmpresa[e.id]), opc.todas ? { cuenta: e.cuenta } : {}))
    .filter(e => opc.todas || propias.has(e.id) || (e.estado === 'activa' && !e.demo));
  const visibles = new Set(empresas.map(e => e.id));
  const productos = filasP.filter(p => visibles.has(p.user_id)).map(aProducto);

  // Ids antiguos → nuevos, para que un enlace guardado a sector.html?s=viejo siga abriendo algo.
  const sectoresAlias = Object.fromEntries(Object.entries(MAPA.ids).filter(([a, b]) => a !== b));

  const sectores = SECTORES.map(s => ({
    ...s,
    empresas: empresas.filter(e => e.sectores.includes(s.id)).length,
    productos: productos.filter(p => p.sector === s.id).length,
  }));

  return { generado: new Date().toISOString(), sectores, sectoresAlias, empresas, productos };
}

/* Qué ve quien pide el panel: la administración, todo; un miembro, además de
   las activas, sus propias empresas. Sin ?panel, la versión pública cacheada. */
async function alcance(req) {
  if (req.query?.panel === undefined) return {};
  const u = await usuarioDeSesion(req).catch(() => null);
  if (!u) return {};
  if (esAdmin(u.email)) return { todas: true };
  return { propias: (await empresasDe(u.id)).map(e => e.id) };
}

module.exports = async function handler(req, res) {
  try {
    const d = await datos(await alcance(req));
    let salida = d;
    if (req.query?.home !== undefined) {
      /* La portada solo necesita totales, sectores con recuento y tres destacadas
         reales: primero las de plan de pago que no sean de demostración (hoy,
         una), y se completa hasta tres con las reales que más productos tienen. */
      const reales = d.empresas.filter(e => !e.demo);
      const premium = reales.filter(e => e.plan === 'premium');
      const resto = reales.filter(e => e.plan !== 'premium').sort((a, b) => b.nProductos - a.nProductos);
      const destacadas = [...premium, ...resto].slice(0, 3);
      salida = {
        generado: d.generado, lite: true,
        total: { empresas: d.empresas.length, productos: d.productos.length },
        sectores: d.sectores.map(s => ({ ...s, sub: [] })),
        sectoresAlias: d.sectoresAlias,
        empresas: destacadas,
        productos: [],
      };
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // El panel (?panel=1) lee siempre en fresco: quien acaba de guardar tiene
    // que ver su cambio al instante. La web pública se sirve de la caché.
    res.setHeader('Cache-Control', req.query?.panel !== undefined
      ? 'no-store'
      : 'public, max-age=0, must-revalidate');
    // El navegador pregunta siempre; la CDN guarda un minuto. Antes la CDN podía servir la copia
    // vieja hasta 10 min tras desplegar y el navegador la guardaba sin caducidad («public» a secas).
    if (req.query?.panel === undefined) res.setHeader('Vercel-CDN-Cache-Control', 'max-age=60, stale-while-revalidate=30');
    res.status(200).send('window.ROBLE_DATA=' + JSON.stringify(salida) + ';');
  } catch (err) {
    console.error(JSON.stringify({ evt: 'datos_error', msg: err.message }));
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // Sin datos, las páginas pintan vacías pero no se rompen (roble.js tiene su respaldo).
    res.status(500).send('window.ROBLE_DATA=null;');
  }
};

module.exports.datos = datos;
module.exports.alcance = alcance;
