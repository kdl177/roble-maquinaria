/* Alta de cuenta en la web nueva.
 *
 *   POST /api/registro  { email, password, nombre, rol: 'empresa', empresa }   → 201 { ok, pendiente: true }
 *   (la URL la reescribe vercel.json a /api/sesion?via=registro: módulo interno, no cuenta como función)
 *
 * Mismas reglas, mismo coste de bcrypt y misma tabla `usuarios` que el sistema
 * actual: la cuenta creada aquí vale en los dos sitios. Además crea la ficha de
 * identidad: una empresa con el MISMO id que la cuenta (como en la migración:
 * una empresa por cuenta, sin renumerar nada), origen 'alta' y estado
 * 'pendiente', y la membresía de propietario. Solo cuentas de empresa: la
 * autorización de administración (Moderación) se hace sobre la empresa.
 *
 * No manda correo: el sistema actual tampoco lo hace en el alta normal.
 */

const bcrypt = require('bcryptjs');
const { db, init, registra } = require('./_esquema');
const { esAdmin } = require('./auth');
const { cuerpo } = require('./sesion');

const COSTE_BCRYPT = 10;                            // el mismo que producción
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;    // el mismo que producción

/* ponytail: límite en memoria por instancia, como el de sesión y como el del
   sistema actual. Se vacía en cada arranque en frío. */
const MAX_ALTAS_HORA = 5;
const ALTAS = new Map();
function demasiadas(ip) {
  const ahora = Date.now();
  const r = ALTAS.get(ip);
  if (!r || ahora - r.desde > 3600e3) { ALTAS.set(ip, { desde: ahora, n: 1 }); return false; }
  r.n++;
  return r.n > MAX_ALTAS_HORA;
}

// Las mismas comprobaciones que validaAlta() en producción.
function valida({ email, password, nombre, rol }) {
  const e = [];
  if (!email || !RE_EMAIL.test(email)) e.push('El email no es válido.');
  if (!password || password.length < 8) e.push('La contraseña debe tener al menos 8 caracteres.');
  if (password && password.length > 200) e.push('La contraseña es demasiado larga.');
  if (!nombre) e.push('Falta tu nombre.');
  if (rol !== 'empresa') e.push('Solo se pueden crear cuentas de empresa.');   // 10-10: toda cuenta pasa por la autorización de administración, y eso se hace sobre la empresa
  return e;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (demasiadas(ip)) {
    res.status(429).json({ error: 'Demasiados registros seguidos. Inténtalo dentro de un rato.' });
    return;
  }

  const b = cuerpo(req);
  const email = String(b.email || '').toLowerCase().trim();
  const password = String(b.password || '');
  const nombre = String(b.nombre || '').trim().slice(0, 80);
  const rol = b.rol;
  const empresa = b.empresa ? String(b.empresa).trim().slice(0, 120) || null : null;

  const errores = valida({ email, password, nombre, rol });
  if (errores.length) { res.status(400).json({ error: errores[0], errores }); return; }
  // Un correo de ROBLE_ADMIN_EMAILS sin cuenta sería administrador en cuanto alguien lo registrase.
  if (esAdmin(email)) { res.status(400).json({ error: 'Ese correo no puede registrarse desde aquí.' }); return; }

  try {
    await init();
    const sql = db();

    const existe = await sql`SELECT id FROM usuarios WHERE email = ${email}`;
    if (existe.length) { res.status(409).json({ error: 'Ya hay una cuenta con ese email.', codigo: 'duplicado' }); return; }

    const hash = await bcrypt.hash(password, COSTE_BCRYPT);
    /* Cuenta, ficha de empresa y membresía en UNA sentencia: o se crean las tres o ninguna. Antes eran tres
       inserciones sueltas y, si fallaba la segunda, quedaba una cuenta sin ficha que entraba sin pasar por
       moderación (ahora además auth.js la trata como pendiente). */
    const [u] = await sql`
      WITH u AS (
        INSERT INTO usuarios (email, password_hash, nombre, rol, empresa)
        VALUES (${email}, ${hash}, ${nombre}, ${rol}, ${empresa})
        RETURNING id, email, nombre, rol, empresa),
      e AS (
        INSERT INTO empresas (id, nombre, estado, origen)
        SELECT id, ${empresa || nombre}, 'pendiente', 'alta' FROM u
        ON CONFLICT (id) DO NOTHING),
      m AS (
        INSERT INTO membresias (user_id, empresa_id, rol, estado)
        SELECT id, id, 'propietario', 'activa' FROM u
        ON CONFLICT (user_id, empresa_id) DO NOTHING)
      SELECT id, email, nombre, rol, empresa FROM u`;
    await registra({ user_id: u.id, empresa_id: u.id, accion: 'cuenta.alta', datos: { rol }, ip });

    // La cuenta existe, pero no abre sesión: entra cuando administración la autorice desde Moderación.
    res.status(201).json({ ok: true, pendiente: true });
  } catch (err) {
    // Dos altas simultáneas con el mismo correo: la segunda choca con el UNIQUE.
    if (err.code === '23505' || /duplicate key/i.test(err.message || '')) {
      res.status(409).json({ error: 'Ya hay una cuenta con ese email.', codigo: 'duplicado' });
      return;
    }
    console.error(JSON.stringify({ evt: 'registro_error', msg: err.message }));
    res.status(500).json({ error: 'No hemos podido crear la cuenta. Inténtalo de nuevo.' });
  }
};
