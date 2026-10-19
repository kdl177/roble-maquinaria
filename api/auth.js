/* API de identidad de la web nueva.
 *
 * GET  /api/auth?me            → quién soy, mis empresas, la actual y mis permisos
 * POST /api/auth?empresa=<id>  → cambiar de empresa activa
 *
 * NO implementa registro ni login: reutiliza los del sistema existente
 * (/login.html, /api/login). Lee la cookie 'roble_sesion' y la tabla sesiones.
 * No duplica usuarios ni contraseñas, y no escribe en ninguna tabla legacy.
 */

const { db, init, registra } = require('./_esquema');
const { empresasDe, permisosDe, membresia } = require('./_permisos');

const COOKIE = 'roble_sesion';          // el mismo del sistema existente
const COOKIE_EMPRESA = 'roble_empresa'; // cuál tengo seleccionada

/* Administración. No existe en usuarios (solo 'empresa' y 'comprador') ni en
   el sistema actual, que protege su admin con una clave compartida. Aquí la
   lista de correos con acceso vive en ROBLE_ADMIN_EMAILS (Vercel), separada
   por comas. Vacía o ausente: nadie es administrador. Se decide en servidor. */
const ADMINS = new Set(
  String(process.env.ROBLE_ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));
const esAdmin = email => ADMINS.has(String(email || '').toLowerCase().trim());

/* Nadie entra hasta que administración lo autoriza: la ficha de su empresa tiene que estar en
   activa o borrador (se autoriza desde Moderación). Administración entra siempre. */
const SIN_PASO = {
  pendiente: 'Tu cuenta está pendiente de autorización por el equipo de ROBLE. Te avisaremos por correo.',
  rechazada: 'Esta cuenta no ha sido autorizada.',
  suspendida: 'Esta cuenta está suspendida.',
};
async function puertaCerrada(userId, email, rol) {
  if (esAdmin(email)) return null;
  const [e] = await db()`SELECT estado FROM empresas WHERE id = ${userId}`;
  // Una cuenta de empresa sin ficha (un alta que se quedó a medias) no ha pasado por moderación: pendiente.
  if (!e) return rol === 'empresa' ? SIN_PASO.pendiente : null;
  return SIN_PASO[e.estado] || null;
}

function lee(req, nombre) {
  const raw = req.headers?.cookie || '';
  for (const trozo of raw.split(';')) {
    const [k, ...v] = trozo.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

/* Resuelve la sesión leyendo las tablas del sistema existente. Solo SELECT. */
async function usuarioDeSesion(req) {
  const token = lee(req, COOKIE);
  if (!token) return null;
  await init();
  const filas = await db()`
    SELECT u.id, u.email, u.nombre, u.rol, u.empresa, em.estado AS estado_empresa
    FROM sesiones s JOIN usuarios u ON u.id = s.user_id LEFT JOIN empresas em ON em.id = u.id
    WHERE s.token = ${token} AND s.expira > now() AND u.eliminada IS NULL`;
  const u = filas[0]; if (!u) return null;
  if (!esAdmin(u.email) && (SIN_PASO[u.estado_empresa] || (u.rol === 'empresa' && !u.estado_empresa))) return null;
  delete u.estado_empresa;
  return u;
}

function cookieEmpresa(id) {
  return `${COOKIE_EMPRESA}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

async function identidad(req) {
  const usuario = await usuarioDeSesion(req);
  if (!usuario) return { user: null, companies: [], currentCompany: null, permissions: [] };

  const empresas = await empresasDe(usuario.id);
  const pedida = Number(lee(req, COOKIE_EMPRESA)) || null;
  // La cookie solo es una preferencia: solo vale si hay membresía de verdad.
  const actual = empresas.find(e => e.id === pedida) || empresas[0] || null;

  let verificado = false;
  try {
    const v = await db()`SELECT 1 FROM emails_verificados WHERE user_id = ${usuario.id}`;
    verificado = v.length > 0;
  } catch (e) { /* la tabla puede no existir todavía */ }

  return {
    user: {
      id: usuario.id,
      email: usuario.email,
      name: usuario.nombre,
      legacyRole: usuario.rol,
      emailVerified: verificado,
      isAdmin: esAdmin(usuario.email),
    },
    companies: empresas.map(e => ({ id: e.id, name: e.nombre, status: e.estado, role: e.rol })),
    currentCompany: actual ? { id: actual.id, name: actual.nombre, status: actual.estado, role: actual.rol } : null,
    permissions: actual ? permisosDe(actual.rol) : [],
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      res.status(200).json(await identidad(req));
      return;
    }

    if (req.method === 'POST' && req.query?.empresa !== undefined) {
      const usuario = await usuarioDeSesion(req);
      if (!usuario) { res.status(401).json({ error: 'Tienes que haber iniciado sesión.' }); return; }
      const id = Number(req.query.empresa);
      const m = await membresia(usuario.id, id);
      if (!m) { res.status(404).json({ error: 'Esa empresa no existe o no tienes acceso.' }); return; }
      res.setHeader('Set-Cookie', cookieEmpresa(id));
      await registra({ user_id: usuario.id, empresa_id: id, accion: 'empresa.seleccionar', ip: req.headers['x-forwarded-for'] || null });
      res.status(200).json(await identidad(req));
      return;
    }

    res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error(JSON.stringify({ evt: 'auth_error', msg: err.message }));
    res.status(500).json({ error: 'No se ha podido leer la sesión.' });
  }
};

module.exports.usuarioDeSesion = usuarioDeSesion;
module.exports.identidad = identidad;
module.exports.leeCookie = lee;
module.exports.esAdmin = esAdmin;
module.exports.puertaCerrada = puertaCerrada;
module.exports.COOKIE = COOKIE;
