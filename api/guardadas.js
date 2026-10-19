/* Máquinas guardadas de quien tiene sesión.
 *
 *   GET    /api/guardadas            → { ids: [producto_id, ...] }, la más reciente primero
 *   PUT    /api/guardadas?id=N       → guarda (repetir no duplica)
 *   DELETE /api/guardadas?id=N       → quita
 *   POST   /api/guardadas { ids }    → funde lo que había en el navegador al entrar
 *
 * Cada fila es de un usuario: aquí no hay empresa ni permisos por rol, solo
 * «esta sesión» y nada más. Un id que no exista no da error: la clave foránea
 * a productos lo rechaza y se responde 404, igual que si fuera de otro.
 *
 * Sin sesión responde 401 y el navegador sigue con localStorage, como hasta
 * ahora: guardar nunca pide cuenta.
 */

const { db, init } = require('./_esquema');
const { usuarioDeSesion } = require('./auth');
const { cuerpo } = require('./sesion');

const MAX = 200;   // tope por usuario; nadie guarda doscientas máquinas a mano

/* Un id de producto válido, o null. */
const idDe = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

async function lista(sql, userId) {
  const filas = await sql`
    SELECT producto_id FROM maquinas_guardadas
    WHERE user_id = ${userId} ORDER BY creada DESC LIMIT ${MAX}`;
  return filas.map(f => f.producto_id);
}

/* Inserta una. Devuelve 'nueva', 'repetida' o null si el producto no existe. */
async function guarda(sql, userId, productoId) {
  try {
    const filas = await sql`
      INSERT INTO maquinas_guardadas (user_id, producto_id)
      VALUES (${userId}, ${productoId})
      ON CONFLICT (user_id, producto_id) DO NOTHING
      RETURNING producto_id`;
    return filas.length ? 'nueva' : 'repetida';
  } catch (e) {
    // 23503 = viola la clave foránea: ese producto no existe.
    if (e.code === '23503' || /foreign key/i.test(e.message || '')) return null;
    throw e;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const usuario = await usuarioDeSesion(req);
    if (!usuario) { res.status(401).json({ error: 'Tienes que haber iniciado sesión.' }); return; }
    await init();
    const sql = db();

    if (req.method === 'GET') {
      res.status(200).json({ ids: await lista(sql, usuario.id) });
      return;
    }

    if (req.method === 'PUT' || req.method === 'DELETE') {
      const id = idDe(req.query?.id);
      if (!id) { res.status(400).json({ error: 'Falta la máquina.' }); return; }
      if (req.method === 'DELETE') {
        await sql`DELETE FROM maquinas_guardadas WHERE user_id = ${usuario.id} AND producto_id = ${id}`;
        res.status(200).json({ ok: true });
        return;
      }
      const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM maquinas_guardadas WHERE user_id = ${usuario.id}`;
      if (n >= MAX) { res.status(409).json({ error: `Ya tienes ${MAX} máquinas guardadas. Quita alguna.` }); return; }
      if (!(await guarda(sql, usuario.id, id))) { res.status(404).json({ error: 'Esa máquina ya no existe.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'POST') {
      // Al entrar: lo del navegador se suma a lo de la cuenta, sin pisar nada.
      // Los ids que ya no existan se saltan sin error, para no abortar el resto.
      const ids = [...new Set((cuerpo(req).ids || []).map(idDe).filter(Boolean))].slice(0, MAX);
      let anadidas = 0;
      if (ids.length) {
        /* Una sentencia para todas (antes, una por id: hasta 200 inserciones en cada página con sesión). El JOIN con
           productos deja fuera los ids que ya no existen sin violar la clave foránea; el LIMIT respeta el tope. */
        const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM maquinas_guardadas WHERE user_id = ${usuario.id}`;
        const nuevas = await sql`
          INSERT INTO maquinas_guardadas (user_id, producto_id)
          SELECT ${usuario.id}::int, p.id FROM productos p WHERE p.id = ANY(${ids}::int[])
          ORDER BY array_position(${ids}::int[], p.id) LIMIT ${Math.max(0, MAX - n)}
          ON CONFLICT (user_id, producto_id) DO NOTHING
          RETURNING producto_id`;
        anadidas = nuevas.length;
      }
      res.status(200).json({ ids: await lista(sql, usuario.id), anadidas });
      return;
    }

    res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error(JSON.stringify({ evt: 'guardadas_error', msg: err.message }));
    res.status(500).json({ error: 'No hemos podido guardar la máquina. Inténtalo de nuevo.' });
  }
};
