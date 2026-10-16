"""Genera el HTML de las páginas fijas antes de desplegar.

Las páginas pintan en el navegador tras cargar /api/datos.js y /api/maquinaria.js; en móvil eso es el LCP entero.
Este script abre cada página con Playwright (archivos locales, la API de producción), espera a que pinte y vuelca
cabecera, <main> y pie dentro del propio archivo, entre <!--prerender--> y <!--/prerender-->. Al cargar, ML.shell()
quita lo pre-pintado y vuelve a pintar con datos frescos (mismo markup: sin salto).

    python scripts/prerender.py            → las páginas de PAGINAS
    python scripts/prerender.py index      → solo una

Se lanza con `npm run prerender` antes de `vercel deploy` (no se llama «build»: Vercel lo ejecutaría en su
máquina, sin Python ni Playwright, y el despliegue fallaría). Las fichas con ?id no se generan: Vercel no sirve un archivo
por consulta y cambiar las URL no es cosa de este script.
"""
import http.server, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://roble-maquinaria.vercel.app'
PAGINAS = ['index', 'directorio', 'buscar', 'empresas', 'vendedores', 'productos', 'guias', 'paquetes', 'vender']
INICIO, FIN = '<!--prerender-->', '<!--/prerender-->'
PLACEHOLDER = '<main id="main"></main>'

LIMPIA = """() => {
  const partes = ['body > a.skip', 'body > .ml-header', 'main#main', 'body > footer.site-footer'].map(s => document.querySelector(s)).filter(Boolean);
  const out = partes.map(p => p.cloneNode(true));
  const main = out.find(e => e.id === 'main'); if (main) main.setAttribute('data-prerender', '');
  out.forEach(root => {
    root.querySelectorAll('[data-reveal]').forEach(e => { e.removeAttribute('data-reveal'); e.style.removeProperty('--d'); if (!e.getAttribute('style')) e.removeAttribute('style'); });
    root.querySelectorAll('.is-in, .is-scrolled, .is-open').forEach(e => e.classList.remove('is-in', 'is-scrolled', 'is-open'));
    // El título del hero se queda partido en palabras: así anima desde el primer pintado, sin esperar al JS.
    root.querySelectorAll('.cnt').forEach(c => { if (c.dataset.n) c.textContent = c.dataset.n; delete c.dataset.contado; });
    root.querySelectorAll('.nav-panel, .lightbox, .mbar, #roble-toast, .toast').forEach(e => e.remove());
    root.querySelectorAll('[aria-expanded]').forEach(e => e.setAttribute('aria-expanded', 'false'));
    root.querySelectorAll('img[loading="eager"]').forEach(i => i.removeAttribute('loading'));
  });
  return out.map(e => e.outerHTML).join('\\n');
}"""


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def servidor():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', 0), lambda *a: Silencioso(*a, directory=RAIZ))
    srv.handle_error = lambda *a: None   # el navegador corta conexiones al cerrar; no es un fallo
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def inyecta(html, bloque):
    bloque = f'{INICIO}\n{bloque}\n{FIN}'
    if INICIO in html:
        return re.sub(re.escape(INICIO) + r'.*?' + re.escape(FIN), lambda m: bloque, html, count=1, flags=re.S)
    assert html.count(PLACEHOLDER) == 1, 'falta <main id="main"></main>'
    return html.replace(PLACEHOLDER, bloque)


def main(paginas):
    srv, puerto = servidor()
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
        errores = []; pg.on('pageerror', lambda e: errores.append(str(e)[:120]))
        # La API, de producción: los archivos locales no la tienen.
        pg.route('**/api/**', lambda route: route.fulfill(response=route.fetch(url=API + '/api/' + route.request.url.split('/api/', 1)[1])))
        for nombre in paginas:
            ruta = os.path.join(RAIZ, nombre + '.html'); fuente = open(ruta, encoding='utf-8').read()
            # Se pinta siempre desde el placeholder limpio, no sobre lo ya generado.
            limpio = re.sub(re.escape(INICIO) + r'.*?' + re.escape(FIN), PLACEHOLDER, fuente, count=1, flags=re.S)
            tmp = os.path.join(RAIZ, f'.prerender-{nombre}.html'); open(tmp, 'w', encoding='utf-8', newline='').write(limpio)
            try:
                pg.goto(f'http://127.0.0.1:{puerto}/.prerender-{nombre}.html', wait_until='networkidle'); pg.wait_for_timeout(900)
                bloque = pg.evaluate(LIMPIA)
            finally:
                os.remove(tmp)
            assert 'id="content"' in bloque and len(bloque) > 2000, f'{nombre}: no pintó'
            salida = inyecta(fuente, bloque)
            open(ruta, 'w', encoding='utf-8', newline='').write(salida)
            print(f'{nombre}.html: {len(bloque) // 1024} KB pre-pintados')
        b.close()
    srv.shutdown()
    if errores: print('ERRORES JS:', errores); sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1:] or PAGINAS)
