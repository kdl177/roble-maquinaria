/* Recuperación de contraseña en la web nueva.
 *
 *   (la URL la reescribe vercel.json a /api/sesion?via=password: módulo interno, no cuenta como función)
 *   POST /api/password?a=olvide  { email }                  → código por correo (una hora, un uso)
 *   POST /api/password?a=nueva   { email, codigo, nueva }   → cambia la contraseña y abre sesión
 *
 * Mismo mecanismo y misma tabla `recuperaciones` que el sistema actual: se
 * guarda solo el hash del código, nunca el código; la respuesta a «olvidé» es
 * la misma exista o no la cuenta; al cambiarla se cierran todas las sesiones.
 * El rol de la app solo puede actualizar la columna password_hash de usuarios.
 *
 * Sin RESEND_API_KEY no se puede enviar el código: se responde 503 y se dice.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, init, registra } = require('./_esquema');
const { abreSesion, cookieSesion, cuerpo } = require('./sesion');
const { puertaCerrada } = require('./auth');
const { hayCorreo, enviaCodigo } = require('./_correo');

const COSTE_BCRYPT = 10;   // el mismo que producción

/* ponytail: límites en memoria por instancia, como en producción. Recuperar
   contraseña es justo lo que intentaría alguien por fuerza bruta: se limita
   fuerte. */
const LIMITES = new Map();
function pasado(clave, max, ventanaMs) {
  const ahora = Date.now();
  const r = LIMITES.get(clave);
  if (!r || ahora - r.desde > ventanaMs) { LIMITES.set(clave, { desde: ahora, n: 1 }); return false; }
  r.n++;
  return r.n > max;
}

async function olvide(req, res, ip) {
  if (pasado('olv:' + ip, 5, 3600e3)) {
    res.status(429).json({ error: 'Has hecho demasiadas peticiones. Inténtalo dentro de un rato.' });
    return;
  }
  if (!hayCorreo()) {
    res.status(503).json({ error: 'La recuperación de contraseña aún no está activa en esta web.' });
    return;
  }
  const email = String(cuerpo(req).email || '').toLowerCase().trim();
  if (!email) { res.status(400).json({ error: 'Falta el correo.' }); return; }

  await init();
  const sql = db();
  const filas = await sql`SELECT id FROM usuarios WHERE email = ${email} AND eliminada IS NULL`;
  // Misma respuesta exista o no la cuenta: el formulario no revela correos.
  if (filas.length) {
    const codigo = crypto.randomBytes(5).toString('hex').toUpperCase();
    const hash = await bcrypt.hash(codigo, COSTE_BCRYPT);
    const expira = new Date(Date.now() + 3600e3);
    await sql`UPDATE recuperaciones SET usada = now() WHERE user_id = ${filas[0].id} AND usada IS NULL`;
    await sql`INSERT INTO recuperaciones (user_id, codigo, expira) VALUES (${filas[0].id}, ${hash}, ${expira.toISOString()})`;
    const env = await enviaCodigo({ email, codigo });
    if (!env.enviado) console.error(JSON.stringify({ evt: 'recup_no_enviado', motivo: env.motivo || env.error }));
    await registra({ user_id: filas[0].id, accion: 'password.codigo_pedido', datos: { enviado: !!env.enviado }, ip });
  }
  res.status(200).json({ ok: true });
}

async function nueva(req, res, ip) {
  if (pasado('cod:' + ip, 10, 900e3)) {
    res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    return;
  }
  const b = cuerpo(req);
  const email = String(b.email || '').toLowerCase().trim();
  const codigo = String(b.codigo || '').trim().toUpperCase();
  const clave = String(b.nueva || '');
  if (clave.length < 8) { res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres.' }); return; }
  if (clave.length > 200) { res.status(400).json({ error: 'La contraseña nueva es demasiado larga.' }); return; }

  await init();
  const sql = db();
  const generico = { error: 'El código no es válido o ha caducado.' };
  const usuarios = await sql`SELECT id, rol FROM usuarios WHERE email = ${email} AND eliminada IS NULL`;
  if (!usuarios.length) { res.status(400).json(generico); return; }

  const pendientes = await sql`
    SELECT id, codigo FROM recuperaciones
    WHERE user_id = ${usuarios[0].id} AND usada IS NULL AND expira > now()
    ORDER BY creada DESC LIMIT 5`;
  let valida = null;
  for (const r of pendientes) {
    if (await bcrypt.compare(codigo, r.codigo)) { valida = r; break; }
  }
  if (!valida) { res.status(400).json(generico); return; }

  const hash = await bcrypt.hash(clave, COSTE_BCRYPT);
  await sql`UPDATE usuarios SET password_hash = ${hash} WHERE id = ${usuarios[0].id}`;
  await sql`UPDATE recuperaciones SET usada = now() WHERE id = ${valida.id}`;
  // Quien tuviera la cuenta abierta con la contraseña vieja queda fuera.
  await sql`DELETE FROM sesiones WHERE user_id = ${usuarios[0].id}`;
  await registra({ user_id: usuarios[0].id, accion: 'password.cambiada', ip });

  // Una cuenta pendiente, rechazada o suspendida cambia la contraseña pero no entra (§34).
  const cierre = await puertaCerrada(usuarios[0].id, email, usuarios[0].rol);
  if (cierre) { res.status(200).json({ ok: true, aviso: cierre }); return; }

  const { token, expira } = await abreSesion(usuarios[0].id);
  res.setHeader('Set-Cookie', cookieSesion(token, expira));
  res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  const accion = String(req.query?.a || '').toLowerCase();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  try {
    if (accion === 'olvide') return await olvide(req, res, ip);
    if (accion === 'nueva') return await nueva(req, res, ip);
    res.status(400).json({ error: 'Acción desconocida.' });
  } catch (err) {
    console.error(JSON.stringify({ evt: 'password_error', accion, msg: err.message }));
    res.status(500).json({ error: 'No se ha podido procesar la petición.' });
  }
};
