/* Banco de /api/sesion con la base SIMULADA: no toca Neon.
 *
 * Lo que comprueba es lo que corrigió la revisión del 16-10: que entrar tarda lo mismo exista o no el correo
 * (el hash falso tiene formato bcrypt de verdad), que una cuenta de empresa sin ficha no entra (pendiente), que
 * el alta crea cuenta, ficha y membresía en UNA sentencia, y que /api/registro y /api/password llegan a sesion
 * por ?via= y responden como antes.
 *
 * Uso:  node scripts/qa-sesion.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const HASH_ANA = bcrypt.hashSync('contraseña-ana', 10);
const USUARIOS = [{ id: 7, email: 'ana@x.es', password_hash: HASH_ANA, rol: 'empresa', nombre: 'Ana' },
                  { id: 8, email: 'sinficha@x.es', password_hash: HASH_ANA, rol: 'empresa', nombre: 'Sin ficha' }];
const EMPRESAS = { 7: { estado: 'activa' } };   // la 8 no tiene ficha: un alta que se quedó a medias
const SENTENCIAS = [];
function sqlFalso(strings, ...v) {
  const t = strings.join('?').replace(/\s+/g, ' '); SENTENCIAS.push(t);
  if (/FROM information_schema\.tables/.test(t)) return Promise.resolve([]);
  if (/SELECT id, password_hash, rol FROM usuarios WHERE email = \?/.test(t)) return Promise.resolve(USUARIOS.filter(u => u.email === v[0]));
  if (/SELECT estado FROM empresas WHERE id = \?/.test(t)) return Promise.resolve(EMPRESAS[v[0]] ? [EMPRESAS[v[0]]] : []);
  if (/SELECT id FROM usuarios WHERE email = \?/.test(t)) return Promise.resolve(USUARIOS.filter(u => u.email === v[0]).map(u => ({ id: u.id })));
  if (/INSERT INTO sesiones/.test(t)) return Promise.resolve([]);
  if (/INSERT INTO auditoria/.test(t)) return Promise.resolve([]);
  if (/WITH u AS \( INSERT INTO usuarios .* INSERT INTO empresas .* INSERT INTO membresias/.test(t)) {
    const u = { id: 99, email: v[0], nombre: v[2], rol: v[3], empresa: v[4] }; USUARIOS.push({ ...u, password_hash: v[1] }); EMPRESAS[99] = { estado: 'pendiente' };
    return Promise.resolve([u]);
  }
  if (/FROM sesiones s JOIN usuarios u/.test(t)) return Promise.resolve([]);
  throw new Error('consulta no simulada: ' + t.slice(0, 90));
}
const esquema = require('../api/_esquema.js');
esquema.db = () => sqlFalso;
esquema.init = async () => {};
esquema.registra = async () => {};   // la auditoría usa su propia conexión: aquí no hay base
for (const k of Object.keys(require.cache)) if (/[\\/]api[\\/](auth|sesion|_registro|_password|_permisos)\.js$/.test(k)) delete require.cache[k];
const sesion = require('../api/sesion.js');

function res() { const r = { code: 0, body: null, h: {} }; r.setHeader = (k, x) => { r.h[k] = x; }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; }
const req = (method, query = {}, body = {}, ip = '1.2.3.4') => ({ method, query, body, headers: { 'x-forwarded-for': ip } });
let fallos = 0, total = 0;
async function caso(t, rq, esperado, cuerpoOk) {
  total++; const r = res(); await sesion(rq, r);
  const ok = r.code === esperado && (!cuerpoOk || cuerpoOk(r.body, r));
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${t.padEnd(62)} -> ${r.code}${ok ? '' : '  (esperado ' + esperado + ') ' + JSON.stringify(r.body)}`);
  return r;
}
async function tiempo(rq) { const t0 = performance.now(); await sesion(rq, res()); return performance.now() - t0; }

console.log('\n/api/sesion');
await caso('entrar bien: 200 y cookie', req('POST', {}, { email: 'ana@x.es', password: 'contraseña-ana' }), 200, (b, r) => b.ok && /roble_sesion=/.test(r.h['Set-Cookie']));
await caso('contraseña mal: 401', req('POST', {}, { email: 'ana@x.es', password: 'otra' }, '9.9.9.1'), 401);
await caso('correo inexistente: 401 con el mismo mensaje', req('POST', {}, { email: 'nadie@x.es', password: 'otra' }, '9.9.9.2'), 401, b => /incorrectos/.test(b.error));
await caso('cuenta de empresa SIN ficha: 403 pendiente, sin cookie', req('POST', {}, { email: 'sinficha@x.es', password: 'contraseña-ana' }, '9.9.9.3'), 403, (b, r) => b.codigo === 'no_autorizada' && !r.h['Set-Cookie']);
// Tiempos: el hash falso tiene que costar lo mismo que uno real (bcrypt coste 10). Varias pasadas y mediana.
const med = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const conCuenta = [], sinCuenta = [];
for (let i = 0; i < 5; i++) { conCuenta.push(await tiempo(req('POST', {}, { email: 'ana@x.es', password: 'otra' }, '7.7.7.' + i))); sinCuenta.push(await tiempo(req('POST', {}, { email: 'nadie' + i + '@x.es', password: 'otra' }, '8.8.8.' + i))); }
{ total++; const a = med(conCuenta), b = med(sinCuenta), ok = b > a * 0.5 && a > 20;
  if (!ok) fallos++; console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${'sin cuenta tarda como con cuenta (mediana)'.padEnd(62)} -> ${Math.round(a)} ms frente a ${Math.round(b)} ms`); }

console.log('\n/api/registro (via sesion)');
await caso('sin datos: 400 del validador de registro', req('POST', { via: 'registro' }, {}), 400, b => /email/.test(b.error));
await caso('correo repetido: 409', req('POST', { via: 'registro' }, { email: 'ana@x.es', password: 'contraseña-larga', nombre: 'Ana', rol: 'empresa' }, '5.5.5.1'), 409);
await caso('comprador: 400, solo empresas', req('POST', { via: 'registro' }, { email: 'c@x.es', password: 'contraseña-larga', nombre: 'C', rol: 'comprador' }, '5.5.5.2'), 400);
SENTENCIAS.length = 0;
await caso('alta válida: 201 pendiente, sin cookie', req('POST', { via: 'registro' }, { email: 'nueva@x.es', password: 'contraseña-larga', nombre: 'Nu', rol: 'empresa', empresa: 'Nueva SL' }, '5.5.5.3'), 201, (b, r) => b.pendiente === true && !r.h['Set-Cookie']);
{ total++; const una = SENTENCIAS.filter(t => /INSERT INTO (usuarios|empresas|membresias)/.test(t)); const ok = una.length === 1 && /WITH u AS/.test(una[0]);
  if (!ok) fallos++; console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${'cuenta, ficha y membresía en UNA sentencia'.padEnd(62)} -> ${una.length} sentencia(s) con INSERT`); }
await caso('la cuenta recién creada no entra (pendiente)', req('POST', {}, { email: 'nueva@x.es', password: 'contraseña-larga' }, '5.5.5.4'), 403);

console.log('\n/api/password (via sesion)');
await caso('olvidé sin correo: 400 o 503 sin clave de correo', req('POST', { via: 'password', a: 'olvide' }, {}), process.env.RESEND_API_KEY ? 400 : 503);
await caso('acción desconocida: 400', req('POST', { via: 'password', a: 'x' }, {}), 400);
await caso('método no permitido en sesion: 405', req('GET'), 405);

console.log(`\n${total - fallos}/${total} comprobaciones correctas.`);
if (fallos) process.exit(1);
