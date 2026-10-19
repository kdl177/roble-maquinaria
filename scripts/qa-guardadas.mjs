/* Banco de /api/guardadas con la base y la sesión SIMULADAS: no toca Neon.
 *
 * Lo que decide aquí la seguridad es más simple que en el panel: cada fila es
 * de una sesión y de nadie más. Se comprueba que sin sesión no se puede nada,
 * que cada usuario solo ve y toca lo suyo, que un producto inexistente da 404
 * (la clave foránea lo rechaza) sin tumbar la petición, que guardar dos veces
 * no duplica, que el tope frena, y que al entrar la fusión suma sin pisar.
 *
 * Uso:  node scripts/qa-guardadas.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/* ── Base simulada ────────────────────────────────────────────────────────
   Productos que existen: 100, 200, 300. Filas por usuario, como la tabla. */
const EXISTEN = new Set([100, 200, 300]);
const filas = new Map();   // user_id -> [producto_id, ...] (más reciente primero)
const de = u => filas.get(u) || [];
function sqlFalso(strings, ...v) {
  const t = strings.join('?').replace(/\s+/g, ' ');
  if (/FROM information_schema\.tables/.test(t)) return Promise.resolve([]);
  if (/SELECT producto_id FROM maquinas_guardadas/.test(t)) return Promise.resolve(de(v[0]).map(producto_id => ({ producto_id })));
  if (/COUNT\(\*\)::int AS n FROM maquinas_guardadas/.test(t)) return Promise.resolve([{ n: de(v[0]).length }]);
  if (/INSERT INTO maquinas_guardadas .*ANY\(/.test(t)) {       // la fusión: todas en una sentencia
    const [u, arr] = v, out = [];
    for (const p of arr) { if (!EXISTEN.has(p) || de(u).includes(p)) continue; filas.set(u, [p, ...de(u)]); out.push({ producto_id: p }); }
    return Promise.resolve(out);
  }
  if (/INSERT INTO maquinas_guardadas/.test(t)) {
    const [u, p] = v;
    if (!EXISTEN.has(p)) { const e = new Error('violates foreign key constraint'); e.code = '23503'; return Promise.reject(e); }
    if (de(u).includes(p)) return Promise.resolve([]);          // ON CONFLICT DO NOTHING: RETURNING vacío
    filas.set(u, [p, ...de(u)]);
    return Promise.resolve([{ producto_id: p }]);               // RETURNING con la fila nueva
  }
  if (/DELETE FROM maquinas_guardadas/.test(t)) { const [u, p] = v; filas.set(u, de(u).filter(x => x !== p)); return Promise.resolve([]); }
  throw new Error('consulta no simulada: ' + t.slice(0, 80));
}
const esquema = require('../api/_esquema.js');
esquema.db = () => sqlFalso;
esquema.init = async () => {};
for (const k of Object.keys(require.cache)) if (/[\\/]api[\\/](auth|sesion|guardadas)\.js$/.test(k)) delete require.cache[k];
const auth = require('../api/auth.js');
const USUARIOS = { 1: { id: 1, email: 'ana@x.es' }, 2: { id: 2, email: 'luis@x.es' } };
auth.usuarioDeSesion = async req => USUARIOS[req.usuario] || null;
for (const k of Object.keys(require.cache)) if (/[\\/]api[\\/]guardadas\.js$/.test(k)) delete require.cache[k];
const guardadas = require('../api/guardadas.js');

function res() { const r = { code: 0, body: null, h: {} }; r.setHeader = (k, x) => { r.h[k] = x; }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; }
const req = (usuario, method, query = {}, body = {}) => ({ usuario, method, query, body, headers: {} });
let fallos = 0, total = 0;
async function caso(t, rq, esperado, cuerpoOk) {
  total++; const r = res(); await guardadas(rq, r);
  const ok = r.code === esperado && (!cuerpoOk || cuerpoOk(r.body));
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${t.padEnd(58)} -> ${r.code}${ok ? '' : '  (esperado ' + esperado + ') ' + JSON.stringify(r.body)}`);
}
const ids = b => b && Array.isArray(b.ids) ? b.ids.join(',') : '?';

console.log('\n/api/guardadas');
await caso('sin sesión: 401', req(null, 'GET'), 401);
await caso('sin sesión, PUT: 401', req(null, 'PUT', { id: 100 }), 401);
await caso('vacío al principio: 200, []', req(1, 'GET'), 200, b => ids(b) === '');
await caso('guarda 100: 200', req(1, 'PUT', { id: 100 }), 200);
await caso('guarda 200: 200', req(1, 'PUT', { id: 200 }), 200);
await caso('lista: la más reciente primero (200,100)', req(1, 'GET'), 200, b => ids(b) === '200,100');
await caso('guardar 100 otra vez no duplica', req(1, 'PUT', { id: 100 }), 200);
await caso('sigue habiendo dos', req(1, 'GET'), 200, b => b.ids.length === 2);
await caso('producto inexistente (999): 404, no rompe', req(1, 'PUT', { id: 999 }), 404);
await caso('id no numérico: 400', req(1, 'PUT', { id: 'abc' }), 400);
await caso('id negativo: 400', req(1, 'PUT', { id: -5 }), 400);
await caso('sin id: 400', req(1, 'PUT'), 400);
await caso('otro usuario no ve nada de Ana', req(2, 'GET'), 200, b => ids(b) === '');
await caso('otro usuario quita 100: 200 pero no toca a Ana', req(2, 'DELETE', { id: 100 }), 200);
await caso('Ana sigue con sus dos', req(1, 'GET'), 200, b => b.ids.length === 2);
await caso('Ana quita 200: 200', req(1, 'DELETE', { id: 200 }), 200);
await caso('queda solo 100', req(1, 'GET'), 200, b => ids(b) === '100');
await caso('fusión al entrar: [300, 100, 999, "x"] suma 300, salta 999', req(1, 'POST', {}, { ids: [300, 100, 999, 'x'] }), 200,
  b => b.anadidas === 1 && b.ids.length === 2 && b.ids.includes(300) && b.ids.includes(100));
await caso('fusión sin cuerpo: 200 y no cambia', req(1, 'POST', {}, {}), 200, b => b.anadidas === 0 && b.ids.length === 2);
await caso('método no permitido: 405', req(1, 'PATCH', { id: 100 }), 405);

// tope: se llena a 200 por debajo y el siguiente PUT debe frenar
{ filas.set(2, Array.from({ length: 200 }, (_, i) => 1000 + i)); EXISTEN.add(300);
  await caso('con 200 guardadas, la siguiente: 409', req(2, 'PUT', { id: 300 }), 409); }

console.log(`\n${total - fallos}/${total} comprobaciones correctas.`);
if (fallos) process.exit(1);
