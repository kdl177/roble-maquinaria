/* ROBLE Maquinaria — shell del portal (cabecera, tira de vendedores, tres columnas, pie) y plantillas de anuncio/vendedor. */
window.ML = (function () {
  'use strict';
  // Si /api/maquinaria.js fallara, las páginas pintan vacías pero no se rompen (como roble.js con ROBLE_DATA).
  const R = window.ROBLE, D = window.ML_DATA || { categorias: [], vendedores: [], anuncios: [], paises: [], tiposVendedor: [], paquetes: [], fotos: {} }, esc = R.esc, icon = R.icon;
  const cat = id => D.categorias.find(c => c.id === id) || null;
  const vend = id => D.vendedores.find(v => v.id === Number(id)) || null;
  const anuncio = id => D.anuncios.find(a => a.id === Number(id)) || null;
  const anunciosDe = vid => D.anuncios.filter(a => a.vendedor_id === Number(vid) && a.estadoPub === 'publicado');
  const TIPO = Object.fromEntries(D.tiposVendedor);
  const pais = Object.fromEntries(D.paises);
  const ESTADO = { nueva: 'Nueva', usada: 'Segunda mano', '': 'Sin especificar' };
  const fmtPrecio = a => a.precio ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(a.precio) : 'A consultar';
  const catsAZ = () => [...D.categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const FOTOS = D.fotos || {};
  const foto = key => FOTOS[key] ? 'assets/' + FOTOS[key].file : null;
  /* Variantes clave, clave-2, clave-3…: la semilla (id del anuncio o del vendedor) las reparte para que dos anuncios de la misma categoría no repitan imagen. */
  const variantes = key => [key, key + '-2', key + '-3', key + '-4'].filter(k => FOTOS[k]);
  /* El anuncio n-ésimo de su categoría (por id) recibe la variante n % total: se reparten sin repetir y la ficha enseña la misma que la tarjeta. */
  const fotoCat = (id, seed) => { const v = variantes(id); if (!v.length) return null; let n = D.anuncios.filter(a => a.cat === id).map(a => a.id).sort((a, b) => a - b).indexOf(Number(seed)); if (n < 0) n = Number(seed) || 0; return foto(v[n % v.length]); };
  const fotoSm = key => FOTOS[key] ? 'assets/' + FOTOS[key].file.replace(/fotos\//, 'fotos/sm/') : null;
  const sm = src => src ? src.replace(/\/fotos\/(?!sm\/)/, '/fotos/sm/') : src;
  const fotoVend = v => { let k = [...new Set(anunciosDe(v.id).flatMap(a => variantes(a.cat)))]; if (!k.length) k = Object.keys(FOTOS).filter(x => cat(x.replace(/-\d$/, ''))); return k.length ? foto(k[(Number(v.id) || 0) % k.length]) : null; };
  const extras = () => { try { return JSON.parse(localStorage.getItem('roble_ml_v1') || '{}'); } catch (e) { return {}; } };
  const saveExtras = x => { try { localStorage.setItem('roble_ml_v1', JSON.stringify(x)); } catch (e) {} };
  const solicitudes = () => extras().solicitudes || [];
  const addSolicitud = s => { const x = extras(); x.solicitudes = [s, ...(x.solicitudes || [])]; saveExtras(x); };
  const now = () => new Date().toISOString();
  /* Los anuncios, vendedores y precios vienen solo de la API: nada de parches del navegador (eran del prototipo). */
  (function merge() {
    D.anuncios.forEach(a => { if (!a.estadoPub) a.estadoPub = 'publicado'; });
    D.anuncios.forEach(a => { if (D.vendedores.some(v => v.id === a.vendedor_id)) return; const e = (R.D.empresas || []).find(x => x.id === a.vendedor_id); D.vendedores.push({ id: a.vendedor_id, nombre: e ? e.nombre : a.vendedor, tipos: [], ciudad: e ? e.ciudad || '' : '', region: e ? e.region || '' : '', pais: a.pais || (e ? e.pais : 'ES'), desc: e ? e.desc || '' : '', web: e ? e.web || '' : '', telefono: e ? e.telefono || '' : '', anio: e ? e.anio || null : null, destacado: false, servicios: [], derivado: true }); });
    D.categorias.forEach(c => c.anuncios = D.anuncios.filter(a => a.cat === c.id && a.estadoPub === 'publicado').length);
  })();
  const publicados = () => D.anuncios.filter(a => a.estadoPub === 'publicado');
  const store = {
    log(texto, tipo) { const x = extras(); x.log = [{ fecha: now(), texto, tipo: tipo || 'info' }, ...(x.log || [])].slice(0, 80); saveExtras(x); },
    logs: () => extras().log || [],
    /* Guardadas: siempre en localStorage, para que funcione sin cuenta y pinte
       al instante. Con sesión, además se copia al servidor (/api/guardadas) y
       al entrar se funde lo de aquí con lo de la cuenta. La fuente local manda
       en pantalla; la de servidor es la que viaja entre dispositivos. */
    favoritos: () => extras().favoritos || [],
    esFav: id => (extras().favoritos || []).includes(Number(id)),
    toggleFav(id) {
      const x = extras(); id = Number(id); x.favoritos = x.favoritos || [];
      const i = x.favoritos.indexOf(id); if (i >= 0) x.favoritos.splice(i, 1); else x.favoritos.unshift(id);
      const on = i < 0;
      if (auth.listo && auth.user) {
        // favSync: lo que ya está en la cuenta. Así, al entrar, solo se sube lo guardado sin sesión.
        x.favSync = (x.favSync || []).filter(k => k !== id); if (on) x.favSync.unshift(id);
        fetch('/api/guardadas?id=' + id, { method: on ? 'PUT' : 'DELETE', credentials: 'same-origin' }).catch(() => {});
      }
      saveExtras(x);
      return on;
    },
    /* Al saber que hay sesión: sube SOLO lo guardado sin cuenta (lo que ya se sincronizó no se reenvía: si se quitó
       desde otro dispositivo, no vuelve), baja lo de la cuenta y deja en localStorage lo que diga el servidor. Si
       en este navegador había otra cuenta, sus guardadas se descartan antes. Devuelve si cambió algo, para repintar. */
    async sincronizaFav() {
      if (!auth.listo || !auth.user) return false;
      const x = extras(), uid = auth.user.id; let cambio = false;
      if (x.favUser && x.favUser !== uid) { x.favoritos = []; x.favSync = []; x.favUser = uid; saveExtras(x); cambio = true; }
      const antes = (x.favoritos || []).slice(), nuevos = antes.filter(id => !(x.favSync || []).includes(id));
      try {
        const r = nuevos.length
          ? await fetch('/api/guardadas', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: nuevos }) })
          : await fetch('/api/guardadas', { credentials: 'same-origin', cache: 'no-store' });
        if (!r.ok) return cambio;
        const { ids } = await r.json();
        x.favoritos = ids; x.favSync = ids.slice(); x.favUser = uid; saveExtras(x);
        return cambio || ids.length !== antes.length || ids.some((v, k) => v !== antes[k]);
      } catch (e) { return cambio; }
    },
    pedidos: () => extras().pedidos || [],
    setPedido(id, patch) { const x = extras(); const p = (x.pedidos || []).find(p => p.id === id); if (p) Object.assign(p, patch); saveExtras(x); },
    setSolicitud(id, patch) { const x = extras(); const s = (x.solicitudes || []).find(s => s.id === id); if (s) Object.assign(s, patch); saveExtras(x); },
    saldo(vid) { const comprados = store.pedidos().filter(p => p.vendedor_id === Number(vid) && p.estado === 'pagado').reduce((a, p) => a + p.anuncios, 0); const usados = D.anuncios.filter(a => a.vendedor_id === Number(vid) && a.origen === 'panel').length; return { comprados, usados, disponibles: Math.max(0, comprados - usados) }; },
    /* La sesión viene SIEMPRE del servidor (/api/auth, cookie HttpOnly), nunca
       de localStorage: lo que hay en el navegador lo puede escribir cualquiera.
       Misma forma que antes para que panel y admin cambien lo mínimo:
       vendedor_id es la empresa activa según la membresía en servidor. */
    session: () => {
      if (!auth.listo || !auth.user) return null;
      const u = auth.user, c = auth.current;
      return { email: u.email, nombre: u.name, rol: u.legacyRole, admin: !!u.isAdmin,
               vendedor_id: c ? c.id : null, empresa_nombre: c ? c.name : null, rol_empresa: c ? c.role : null,
               empresas: auth.companies, permisos: auth.permissions };
    },
    reset() { try { localStorage.removeItem('roble_ml_v1'); } catch (e) {} },
  };

  /* Identidad desde el servidor. ready espera al DOM y a /api/auth; si la
     petición falla (sin red, fichero local, servidor sin API), resuelve igual
     con usuario nulo para que las páginas pinten la puerta de acceso y no se
     queden en blanco. */
  const auth = { user: null, companies: [], current: null, permissions: [], listo: false };
  const domListo = new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r());
  auth.ready = Promise.all([domListo,
    fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) { auth.user = j.user; auth.companies = j.companies || []; auth.current = j.currentCompany; auth.permissions = j.permissions || []; } })
      .catch(() => {}),
  ]).then(() => { auth.listo = true; return auth; });
  // Al salir, las guardadas de la cuenta se van con ella: el siguiente en este navegador no las hereda.
  const salir = destino => { const x = extras(); delete x.favoritos; delete x.favSync; delete x.favUser; saveExtras(x);
    return fetch('/api/sesion', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}).finally(() => { location.href = destino || 'index.html'; }); };
  const elegirEmpresa = id => fetch('/api/auth?empresa=' + encodeURIComponent(id), { method: 'POST', credentials: 'same-origin' })
    .then(r => r.ok).catch(() => false);

  /* Siempre a WhatsApp. Con número, al chat de ROBLE; sin él, WhatsApp abre con el mensaje escrito y se elige el contacto. */
  const wa = texto => `https://wa.me/${D.whatsapp || ''}?text=${encodeURIComponent(texto)}`;
  const waAttrs = () => ' target="_blank" rel="noopener"';
  /* Un paquete se pide por WhatsApp o por Gmail: el botón «Pedir» del paquete abre las dos opciones. */
  const gmail = (asunto, texto) => `https://mail.google.com/mail/?view=cm&fs=1${D.correo ? '&to=' + encodeURIComponent(D.correo) : ''}&su=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
  const pedirPaquete = (n, quien, destacado) => {
    const unidad = n === 1 ? 'anuncio' : 'anuncios';
    const texto = `Hola, ${quien ? `soy ${quien} y ` : ''}quiero el paquete de ${n} ${unidad} en ROBLE Maquinaria.`;
    return `<details class="pedir"><summary class="btn ${destacado ? 'btn-ink' : ''} btn-block">Pedir</summary><div class="pedir-opciones"><a class="btn btn-whatsapp" href="${wa(texto)}"${waAttrs()}>${icon('whatsapp', 'i-16')} WhatsApp</a><a class="btn" href="${gmail(`Paquete de ${n} ${unidad} — ROBLE Maquinaria`, texto)}" target="_blank" rel="noopener">${icon('mail', 'i-16')} Gmail</a></div></details>`;
  };

  function header(section, dir) {
    const nav = [['index.html', 'Inicio', 'index'], ['buscar.html', 'Máquinas', 'buscar'], ['vendedores.html', 'Vendedores', 'vendedores'], ['directorio.html', 'Directorio', 'directorio'], ['guias.html', 'Guías', 'guias'], ['vender.html', 'Vender', 'vender']];
    const feat = D.vendedores.filter(v => v.destacado).concat(D.vendedores.filter(v => !v.destacado)).slice(0, 4);
    return `<a class="skip" href="#main">Saltar al contenido</a>
    <div class="ml-header">
      <header class="site-header cab-oscura"><div class="wrap">
        <a class="brand" href="index.html" aria-label="ROBLE Maquinaria, inicio"><img class="brand-mark" src="assets/img/mark-white.svg" alt="" width="28" height="28"><img class="brand-word" src="assets/img/wordmark-white.svg" alt="ROBLE" width="95" height="15">${dir ? '' : '<span class="brand-tag">Maquinaria</span>'}</a>
        <nav class="nav" aria-label="Principal">${nav.map(([h, l, id]) => `<a href="${h}" ${id === section ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
        <form class="hsearch search" action="${dir ? 'empresas.html' : 'buscar.html'}" role="search"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg><input class="input" type="search" name="q" placeholder="${dir ? 'Buscar empresas' : 'Buscar máquinas'}" aria-label="${dir ? 'Buscar empresas en ROBLE' : 'Buscar máquinas en ROBLE'}"></form>
        <div class="header-actions"><a class="btn btn-ghost btn-icon" href="favoritos.html" aria-label="Máquinas guardadas" title="Guardadas">${icon('star')}</a><a class="btn" id="cuenta-btn" data-cuenta href="acceso.html">Acceder</a></div>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-panel" aria-label="Abrir menú"><svg class="i i-24" aria-hidden="true"><use href="#i-menu"/></svg></button>
      </div></header>
      <div class="sponsors"><div class="wrap"><span class="label">${feat.some(v => v.destacado) ? 'Vendedores destacados' : 'Vendedores'}</span>${feat.map(v => `<a class="sponsor" href="vendedor.html?id=${v.id}">${R.tpl.logoTile(v)}${esc(v.nombre)}${v.destacado ? '<span class="featured"></span>' : ''}</a>`).join('')}<a class="sponsor" href="vendedores.html" style="border-style:dashed">Ver todos ${icon('arrow-right', 'i-16')}</a></div></div>
    </div>`;
  }
  function sidebarDir(current, ads) {
    ads = ads || [];
    const S = (R.D.sectores && R.D.sectores.length ? R.D.sectores : D.sectores) || [];
    return `<aside class="ml-side" aria-label="Sectores del directorio">${ads.length ? `<section class="side-ads side-ads-top" aria-label="Anunciantes"><h2>Anunciantes</h2>${ads[0]}</section>` : ''}<details ${matchMedia('(max-width: 800px)').matches ? '' : 'open'}><summary>Sectores del directorio ${icon('chevron-down')}</summary><div>
      <h2>Directorio del sector <a class="link" href="directorio.html" style="font-weight:500;text-transform:none;letter-spacing:0;font-family:var(--font)">Ver todo</a></h2><nav class="catlist">${S.map(s => `<a href="sector.html?s=${s.id}" ${s.id === current ? 'aria-current="page"' : ''}>${esc(s.corto)}<span class="n">${(R.D.lite || !(R.D.empresas && R.D.empresas.length) ? s.empresas : R.empresasDe(s.id).length) || ''}</span></a>`).join('')}</nav>
      <h2>Búsqueda</h2><nav class="catlist"><a href="empresas.html">Todas las empresas</a><a href="productos.html">Todos los productos</a><a href="empresas.html?plan=premium">Empresas destacadas</a></nav>
      <h2>Maquinaria</h2><nav class="catlist"><a href="buscar.html">Máquinas en venta</a><a href="vendedores.html">Vendedores</a><a href="solicitudes.html">Solicitudes de maquinaria</a><a href="favoritos.html">Mis máquinas guardadas</a></nav>
      <h2>Empresas</h2><nav class="catlist"><a href="para-empresas.html">Dar de alta mi empresa</a><a href="vender.html">Anunciar máquinas</a><a href="paquetes.html">Comprar paquetes por WhatsApp</a></nav>
    </div></details>${ads.length > 1 ? `<section class="side-ads" aria-label="Más anunciantes">${ads.slice(1).join('')}${ctaBanner()}</section>` : ''}</aside>`;
  }
  /* El cliente organiza ROBLE en sus 38 apartados: el portal de máquinas usa el mismo lateral que el directorio. */
  function sidebar(ads) { return sidebarDir(undefined, ads); }
  function anunciantes(opts) {
    opts = opts || {};
    const cfg = extras().banners; const base = (cfg && cfg.length ? cfg.map(id => vend(id)).filter(Boolean) : D.vendedores.filter(v => v.destacado).concat(D.vendedores.filter(v => !v.destacado))).filter(v => (!v.derivado || anunciosDe(v.id).length) && v.id !== opts.excluir);
    let items = [], title = 'Vendedores destacados';
    if (opts.cat && cat(opts.cat)) { const ids = new Set(publicados().filter(a => a.cat === opts.cat).map(a => a.vendedor_id)); items = base.filter(v => ids.has(v.id)).map(tpl.banner); }
    if (opts.sector && R.sector(opts.sector)) { const emps = (R.D.empresas || []).filter(e => e.plan === 'premium' && e.id !== opts.excluir && (e.sectores || [e.sector]).includes(opts.sector)).slice(0, 3); items = emps.map(tpl.bannerEmp); if (items.length) title = 'Destacadas · ' + R.sector(opts.sector).corto; }
    const usados = new Set(items.map(h => (h.match(/id=(\d+)/) || [])[1]).filter(Boolean).map(Number));
    [...base].sort((a, b) => (anunciosDe(b.id).length > 0) - (anunciosDe(a.id).length > 0)).forEach(v => { if (items.length < 7 && !usados.has(v.id)) { items.push(tpl.banner(v)); usados.add(v.id); } });
    return { title, items: items.slice(0, 7) };
  }
  const ctaBanner = () => `<a class="banner-cta" href="${wa('Hola, me interesa un banner en ROBLE Maquinaria.')}"${waAttrs()}>Tu banner aquí</a>`;
  function aside(A) {
    return `<aside class="ml-aside" aria-label="${esc(A.title)}"><h2>${esc(A.title)}</h2>${A.items.slice(0, 4).join('')}${ctaBanner()}</aside>`;
  }
  function footer() {
    return `<footer class="site-footer ml-footer" style="margin-top:0"><div class="wrap">
      <div class="footer-top">
        <div class="footer-brand"><img class="brand-word" src="assets/img/wordmark-white.svg" alt="ROBLE" width="127" height="20"><p>Maquinaria para la madera y directorio profesional del sector. Fabricantes, distribuidores y servicios de España.</p></div>
        <div class="footer-col"><span class="label">Directorio</span><ul><li><a href="directorio.html">Los ${(R.D.sectores && R.D.sectores.length ? R.D.sectores : D.sectores || []).length || 38} sectores</a></li><li><a href="empresas.html">Empresas</a></li><li><a href="productos.html">Productos</a></li><li><a href="para-empresas.html">Dar de alta mi empresa</a></li></ul></div>
        <div class="footer-col"><span class="label">Maquinaria</span><ul><li><a href="buscar.html">Máquinas en venta</a></li><li><a href="paquetes.html">Paquetes de anuncios</a></li><li><a href="vendedores.html">Por vendedor</a></li><li><a href="solicitudes.html">Solicitudes</a></li></ul></div>
        <div class="footer-col"><span class="label">Empresas</span><ul>${D.tiposVendedor.map(([id, l]) => `<li><a href="vendedores.html?tipo=${id}">${l}</a></li>`).join('')}<li><a href="vender.html">Vender máquinas</a></li><li><a href="panel/index.html">Panel de vendedor</a></li></ul></div>
        <div class="footer-col"><span class="label">ROBLE</span><ul><li><a href="guias.html">Guías de compra</a></li><li><a href="admin/index.html">Administración</a></li><li><a href="contacto.html">Contacto</a></li><li><a href="creditos.html">Créditos de las fotos</a></li><li><a href="legal.html">Aviso legal</a></li><li><a href="legal.html#privacidad">Privacidad</a></li><li><a href="legal.html#cookies">Cookies</a></li></ul></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} ROBLE</span></div>
    </div></footer>`;
  }
  const tpl = {
    banner(v) {
      const f = fotoVend(v); const n = anunciosDe(v.id).length;
      return `<a class="banner ${f ? '' : 'no-photo'}" href="vendedor.html?id=${v.id}">${f ? `<img src="${sm(f)}" srcset="${sm(f)} 640w, ${f} 1200w" sizes="(min-width: 801px) 1200px, 50vw" alt="" loading="lazy" decoding="async" fetchpriority="low" width="640" height="359">` : `<span class="bg">${icon('s-maquinaria')}</span>`}<span class="head">${R.tpl.logoTile(v)}${v.destacado ? '<span class="featured">Destacado</span>' : ''}</span><span class="foot"><b>${esc(v.nombre)}</b><span>${v.tipos.map(t => TIPO[t]).filter(Boolean).join(' · ')}${v.region ? ' · ' + esc(v.region) : ''}</span><span class="cta">${n ? `${n} ${n === 1 ? 'máquina' : 'máquinas'}` : 'Ver ficha'} ${icon('arrow-right')}</span></span></a>`;
    },
    bannerEmp(e) {
      const v = vend(e.id), f = v ? fotoVend(v) : null, s = R.sector(e.sector), n = R.productosDe(e.id).length;
      return `<a class="banner ${f ? '' : 'no-photo'}" href="empresa.html?id=${e.id}">${f ? `<img src="${sm(f)}" srcset="${sm(f)} 640w, ${f} 1200w" sizes="(min-width: 801px) 1200px, 50vw" alt="" loading="lazy" decoding="async" fetchpriority="low" width="640" height="359">` : `<span class="bg">${icon('s-' + (s ? s.id : 'maquinaria'))}</span>`}<span class="head">${R.tpl.logoTile(e)}${e.plan === 'premium' ? '<span class="featured">Destacada</span>' : ''}</span><span class="foot"><b>${esc(e.nombre)}</b><span>${esc([s ? s.corto : '', R.zona(e)].filter(Boolean).join(' · '))}</span><span class="cta">${n ? n + (n === 1 ? ' producto' : ' productos') : 'Ver ficha'} ${icon('arrow-right')}</span></span></a>`;
    },
    vendPlate: v => `<a class="vend-plate" href="vendedor.html?id=${v.id}"><div class="top">${R.tpl.logoTile(v)}<div><b>${esc(v.nombre)}</b><span class="m">${anunciosDe(v.id).length} máquinas${v.region ? ' · ' + esc(v.region) : ''}</span></div></div>${v.desc ? `<p>${esc(v.desc)}</p>` : ''}<div class="tags">${v.tipos.filter(t => TIPO[t]).map(t => `<span class="tag">${TIPO[t]}</span>`).join('')}${v.destacado ? '<span class="tag tag-red">Destacado</span>' : ''}</div></a>`,
    vendCard: v => `<a class="vend-plate ${fotoVend(v) ? 'has-photo' : ''}" href="vendedor.html?id=${v.id}">${fotoVend(v) ? `<div class="cover"><img src="${sm(fotoVend(v))}" alt="" loading="lazy" width="640" height="359"></div>` : ''}<div class="top">${R.tpl.logoTile(v)}<div><b>${esc(v.nombre)}</b><span class="m">${esc([v.ciudad, v.region].filter(Boolean).join(', ') || 'España')}</span></div></div>${v.desc ? `<p>${esc(v.desc)}</p>` : ''}<div class="tags">${v.tipos.filter(t => TIPO[t]).map(t => `<span class="tag">${TIPO[t]}</span>`).join('')}<span class="tag">${anunciosDe(v.id).length} máquinas</span></div></a>`,
    acard(a) {
      const c = cat(a.cat); const v = vend(a.vendedor_id);
      const fc = a.fotos[0] || fotoCat(a.cat, a.id);
      return `<article class="acard"><div class="media ${fc ? 'has-photo' : ''}">${icon('s-maquinaria')}<span class="label">${esc(c ? c.nombre : '')}</span>${a.destacado ? '<span class="featured">Destacado</span>' : ''}${a.estado && ESTADO[a.estado] ? `<span class="tag estado">${ESTADO[a.estado]}</span>` : ''}${fc ? `<img src="${esc(a.fotos[0] ? fc : sm(fc))}" alt="" loading="lazy" width="640" height="480">${a.fotos[0] ? '' : '<span class="orient">Imagen orientativa</span>'}` : ''}<button type="button" class="fav ${store.esFav(a.id) ? 'is-on' : ''}" data-fav="${a.id}" aria-label="${store.esFav(a.id) ? 'Quitar de guardadas' : 'Guardar máquina'}" aria-pressed="${store.esFav(a.id)}">${icon('star')}</button></div>
        <div class="body"><h2 class="title"><a href="anuncio.html?id=${a.id}">${esc(a.titulo)}</a></h2><div class="meta">${a.marca ? `<span>${esc(a.marca)}</span>` : ''}${a.anio ? `<span>${a.anio}</span>` : ''}<span>${esc(a.zona || pais[a.pais] || '')}</span></div>${a.desc ? `<p class="desc">${esc(a.desc)}</p>` : ''}
        <div class="foot"><span class="seller">${v ? R.tpl.logoTile(v) : ''}<span>${esc(a.vendedor)}</span></span><span class="price ${a.precio ? '' : 'ask'}">${fmtPrecio(a)}</span></div></div></article>`;
    },
    empCard(e) {
      const s = R.sector(e.sector), z = R.zona(e), n = e.nProductos != null ? e.nProductos : R.productosDe(e.id).length, v = vend(e.id), f = v ? fotoVend(v) : null, prem = e.plan === 'premium';
      return `<a class="vend-plate ${f ? 'has-photo' : ''}" href="empresa.html?id=${e.id}">${f ? `<div class="cover"><img src="${sm(f)}" alt="" loading="lazy" decoding="async" fetchpriority="low" width="640" height="359"></div>` : ''}<div class="top">${R.tpl.logoTile(e)}<div><b>${esc(e.nombre)}</b><span class="m">${esc(z || pais[e.pais] || '')}</span></div></div>${e.desc ? `<p>${esc(e.desc)}</p>` : ''}<div class="tags">${s ? `<span class="tag">${esc(s.corto)}</span>` : ''}${n ? `<span class="tag">${n} ${n === 1 ? 'producto' : 'productos'}</span>` : ''}${v && anunciosDe(v.id).length ? `<span class="tag">${anunciosDe(v.id).length} ${anunciosDe(v.id).length === 1 ? 'máquina' : 'máquinas'}</span>` : ''}${prem ? '<span class="tag tag-red">Destacada</span>' : ''}</div></a>`;
    },
    stile(s) {
      const f = foto('s-' + s.id), n = R.D.lite ? s.empresas : R.empresasDe(s.id).length;
      return `<a class="ctile is-sector ${f ? 'has-photo' : ''}" href="sector.html?s=${s.id}">${f ? `<img src="${sm(f)}" alt="" loading="lazy" width="640" height="480">` : ''}<span class="n"><span class="sq"></span></span>${icon('s-' + s.id, 'i-24')}<b>${esc(s.corto)}</b><span class="c">${n} ${n === 1 ? 'empresa' : 'empresas'}</span></a>`;
    },
    ctile: c => `<a class="ctile ${c.anuncios ? '' : 'is-empty'} ${fotoCat(c.id) ? 'has-photo' : ''}" href="categoria.html?c=${c.id}">${fotoCat(c.id) ? `<img src="${sm(fotoCat(c.id))}" alt="" loading="lazy" decoding="async" fetchpriority="low" width="640" height="480">` : ''}<span class="n">${c.anuncios ? '<span class="sq"></span>' : ''}</span>${icon('s-maquinaria', 'i-24')}<b>${esc(c.nombre)}</b><span class="c">${c.anuncios ? c.anuncios + (c.anuncios === 1 ? ' anuncio' : ' anuncios') : 'sin anuncios'}</span></a>`,
  };

  function buscar(o) {
    const q = R.norm(o.q || '').trim();
    return publicados().filter(a => (!o.cat || a.cat === o.cat) && (!o.estado || a.estado === o.estado) && (!o.vendedor || a.vendedor_id === Number(o.vendedor)) && (!o.pais || a.pais === o.pais) && (!o.marca || R.norm(a.marca) === R.norm(o.marca)) && (!o.anioMin || (a.anio && a.anio >= o.anioMin)) && (!o.anioMax || (a.anio && a.anio <= o.anioMax)) && (!o.precioMax || (a.precio && a.precio <= o.precioMax)) && (!q || R.norm(a.titulo).includes(q) || R.norm(a.desc).includes(q) || R.norm(a.vendedor).includes(q) || R.norm(a.marca).includes(q) || R.norm((cat(a.cat) || {}).nombre).includes(q)))
      .sort((a, b) => b.destacado - a.destacado || a.titulo.localeCompare(b.titulo, 'es'));
  }

  function galeria(media, fotos, titulo) {
    if (!media || !fotos || !fotos.length) return;
    const n = fotos.length; let i = 0, lb = null, last = null, x0 = null;
    const alt = k => `${titulo}, foto ${k + 1} de ${n}`;
    media.classList.add('gal'); media.querySelectorAll('img, .orient').forEach(x => x.remove());
    media.insertAdjacentHTML('beforeend', `<button type="button" class="gal-main" aria-label="Ampliar foto"><img src="${esc(fotos[0])}" alt="${esc(alt(0))}" width="1200" height="900" fetchpriority="high"></button>${n > 1 ? `<button type="button" class="gal-nav prev" aria-label="Foto anterior">${icon('chevron-left')}</button><button type="button" class="gal-nav next" aria-label="Foto siguiente">${icon('chevron-right')}</button><span class="gal-count" aria-live="polite">1 / ${n}</span>` : ''}`);
    if (n > 1) media.insertAdjacentHTML('afterend', `<div class="thumbs" role="group" aria-label="Fotos de la máquina">${fotos.map((f, k) => `<button type="button" data-k="${k}" aria-label="Ver foto ${k + 1}" ${k === 0 ? 'aria-current="true"' : ''}><img src="${esc(f)}" alt="" loading="lazy" width="96" height="72"></button>`).join('')}</div>`);
    const thumbs = n > 1 ? media.nextElementSibling : null, img = media.querySelector('.gal-main img'), count = media.querySelector('.gal-count');
    const go = k => {
      i = (k + n) % n; img.src = fotos[i]; img.alt = alt(i); if (count) count.textContent = `${i + 1} / ${n}`;
      if (thumbs) thumbs.querySelectorAll('button').forEach((b, j) => { if (j === i) { b.setAttribute('aria-current', 'true'); thumbs.scrollTo({ left: b.offsetLeft - thumbs.clientWidth / 2 + b.clientWidth / 2, behavior: 'smooth' }); } else b.removeAttribute('aria-current'); });
      if (lb) { const li = lb.querySelector('img'); li.src = fotos[i]; li.alt = alt(i); const lc = lb.querySelector('.lb-count'); if (lc) lc.textContent = `${i + 1} / ${n}`; }
    };
    const swipe = el => { el.addEventListener('pointerdown', e => { x0 = e.clientX; }); el.addEventListener('pointerup', e => { if (x0 == null || n < 2) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { el.dataset.swiped = '1'; go(i + (dx < 0 ? 1 : -1)); } }); };
    const close = () => { lb.classList.remove('is-open'); document.body.style.overflow = ''; if (last) last.focus(); };
    const open = () => {
      last = document.activeElement;
      if (!lb) {
        document.body.insertAdjacentHTML('beforeend', `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Fotos de ${esc(titulo)}"><button type="button" class="lb-btn lb-close" aria-label="Cerrar">${icon('x')}</button>${n > 1 ? `<button type="button" class="lb-btn lb-nav prev" aria-label="Foto anterior">${icon('chevron-left')}</button><button type="button" class="lb-btn lb-nav next" aria-label="Foto siguiente">${icon('chevron-right')}</button><span class="lb-count"></span>` : ''}<img alt=""></div>`);
        lb = document.body.lastElementChild;
        lb.querySelector('.lb-close').addEventListener('click', close);
        lb.addEventListener('click', e => { if (e.target === lb) close(); });
        if (n > 1) { lb.querySelector('.prev').addEventListener('click', () => go(i - 1)); lb.querySelector('.next').addEventListener('click', () => go(i + 1)); swipe(lb.querySelector('img')); }
        lb.addEventListener('keydown', e => {
          if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft' && n > 1) go(i - 1); else if (e.key === 'ArrowRight' && n > 1) go(i + 1);
          else if (e.key === 'Tab') { const f = [...lb.querySelectorAll('button')], k = f.indexOf(document.activeElement); e.preventDefault(); f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
        });
      }
      lb.classList.add('is-open'); document.body.style.overflow = 'hidden'; go(i); lb.querySelector('.lb-close').focus();
    };
    media.querySelector('.gal-main').addEventListener('click', e => { if (e.currentTarget.dataset.swiped) { delete e.currentTarget.dataset.swiped; return; } open(); });
    if (n > 1) {
      media.querySelector('.prev').addEventListener('click', () => go(i - 1)); media.querySelector('.next').addEventListener('click', () => go(i + 1));
      thumbs.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) go(Number(b.dataset.k)); });
      media.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === 'ArrowRight') go(i + 1); });
      swipe(media.querySelector('.gal-main'));
    }
  }

  function barraMovil(o) {
    if (!o.watch || !matchMedia('(max-width: 700px)').matches) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="mbar" role="region" aria-label="Acciones de contacto">${o.fav ? `<button type="button" class="fav ${store.esFav(o.fav) ? 'is-on' : ''}" data-fav="${o.fav}" aria-label="${store.esFav(o.fav) ? 'Quitar de guardadas' : 'Guardar máquina'}" aria-pressed="${store.esFav(o.fav)}">${icon('star')}</button>` : ''}<button type="button" class="btn btn-primary btn-lg">${esc(o.label)}</button></div>`);
    const bar = document.body.lastElementChild; bar.querySelector('.btn').addEventListener('click', o.onClick);
    const io = new IntersectionObserver(([e]) => { const on = !e.isIntersecting; bar.classList.toggle('is-on', on); document.body.classList.toggle('has-mbar', on); }); io.observe(o.watch);
    return { watch(el) { io.disconnect(); if (el) io.observe(el); } };
  }

  function contacto(o) {
    let el = document.getElementById('contact-drawer');
    if (!el) {
      document.body.insertAdjacentHTML('beforeend', `<aside class="drawer" id="contact-drawer" role="dialog" aria-modal="true" aria-labelledby="cd-title"><div class="drawer-head"><h2 id="cd-title">Contactar</h2><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Cerrar">${icon('x')}</button></div><form class="drawer-body" id="contact-form" novalidate><p class="small muted" id="cd-intro"></p>
        <div class="form-row"><div class="field"><label for="c-nombre">Tu nombre <span class="req">*</span></label><input class="input" id="c-nombre" name="nombre" required autocomplete="name"><span class="field-error">Necesitamos tu nombre.</span></div><div class="field"><label for="c-empresa">Tu empresa</label><input class="input" id="c-empresa" name="empresa" autocomplete="organization"></div></div>
        <div class="form-row"><div class="field"><label for="c-email">Correo <span class="req">*</span></label><input class="input" id="c-email" name="email" type="email" required autocomplete="email"><span class="field-error">Falta el correo. Lo necesitamos para que te respondan.</span></div><div class="field"><label for="c-tel">WhatsApp <span class="req">*</span></label><input class="input" id="c-tel" name="telefono" type="tel" required inputmode="tel" autocomplete="tel" placeholder="612 34 56 78" pattern="[+0-9][0-9 ().-]{7,}"><span class="field-error">Falta tu WhatsApp. Es por donde te responden.</span></div></div>
        <div class="field"><label for="c-ciudad">Ciudad</label><input class="input" id="c-ciudad" name="ciudad" autocomplete="address-level2"></div>
        <div class="field"><label for="c-msg">Mensaje <span class="req">*</span></label><textarea class="textarea" id="c-msg" name="mensaje" required></textarea><span class="field-error">Cuéntales qué necesitas, aunque sean dos líneas.</span></div>
        <label class="check"><input type="checkbox" id="c-priv"> Acepto la <a href="legal.html#privacidad" style="text-decoration:underline;text-underline-offset:2px">política de privacidad</a></label>
        <p class="field-hint">Tu mensaje va directamente a la empresa, que te responde por WhatsApp. ROBLE no lo publica.</p></form>
        <div class="drawer-foot"><span class="small muted">Respuesta en horario laboral</span><div class="row"><button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" type="submit" form="contact-form">Enviar</button></div></div></aside>`);
      el = document.getElementById('contact-drawer');
    }
    const dr = R.drawer('contact-drawer'), f = document.getElementById('contact-form');
    document.getElementById('cd-intro').textContent = o.intro || '';
    document.getElementById('c-msg').value = o.mensaje || '';
    f.onsubmit = ev => {
      ev.preventDefault(); if (!R.validate(f)) return;
      if (!document.getElementById('c-priv').checked) { R.toast('Necesitamos que aceptes la política de privacidad.', 'error'); document.getElementById('c-priv').focus(); return; }
      /* El mensaje se guarda en el servidor (tabla de contactos de la empresa)
         y se le avisa por correo; nada queda en localStorage. */
      // El botón de enviar vive fuera del <form>, asociado por el atributo form.
      const boton = document.querySelector('button[form="' + f.id + '"]') || f.querySelector('button[type=submit]'); if (boton) boton.disabled = true;
      fetch('/api/contactos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        destino_id: o.empresa_id, producto: o.producto || '', nombre: f.nombre.value.trim(), empresa: f.empresa.value.trim(),
        email: f.email.value.trim(), telefono: f.telefono.value.trim(), ciudad: f.ciudad.value.trim(), mensaje: f.mensaje.value.trim() }) })
        .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { R.toast(j.error || 'No hemos podido enviar tu mensaje.', 'error'); return; } dr.close(); f.reset(); R.toast('Mensaje enviado. La empresa te escribe por WhatsApp.'); })
        .catch(() => R.toast('Sin conexión con el servidor. Inténtalo de nuevo.', 'error'))
        .finally(() => { if (boton) boton.disabled = false; });
    };
    dr.open();
  }

  tpl.pack = ([n, precio], i, quien) => `<div class="pack ${i === 2 ? 'is-best' : ''}"><span class="n">${n}<small>${n === 1 ? 'anuncio' : 'anuncios'}</small></span><span class="price">${precio ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(precio) : 'A consultar'}</span><span class="per">${precio ? (precio / n).toFixed(2).replace('.', ',') + ' € por anuncio' : ''}${i === 2 ? (precio ? ' · ' : '') + 'el más elegido' : ''}</span>${pedirPaquete(n, quien, i === 2)}</div>`;

  /* Efectos (10-10): aparición escalonada al entrar en pantalla, cabecera con sombra al hacer scroll y
     contadores del hero. Con «reducir movimiento» no se hace nada; sin JavaScript no se oculta nada
     (las reglas CSS cuelgan de html.js y de [data-reveal], que solo pone este código). */
  function efectos(pre) {
    document.documentElement.classList.add('js');
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;   // con «reducir movimiento»: solo fundidos (CSS), sin contadores ni título por palabras
    /* HTML generado: las animaciones de entrada empezaron con el primer pintado. Al repintar, --ya las adelanta lo
       ya transcurrido para que sigan donde iban en vez de volver a empezar (ml-visual.css). */
    if (pre) { const fcp = performance.getEntriesByName('first-contentful-paint')[0]; document.documentElement.style.setProperty('--ya', Math.round(performance.now() - (fcp ? fcp.startTime : 0)) + 'ms'); }
    const SEL = '.section-head, .banner-cta, .acard, .ctile, .vend-plate, .pcard, .banner, .pack, .gcard, .paso, .razon, .plan, .dtile, .sector-row, .stile, .cred, .plate, .result';
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target; io.unobserve(el); el.classList.add('is-in');
      el.addEventListener('transitionend', ev => { if (ev.target === el && ev.propertyName === 'opacity') { el.removeAttribute('data-reveal'); el.style.removeProperty('--d'); } }, { once: true });
    }), { rootMargin: '0px 0px -4% 0px', threshold: 0.05 });
    /* Hero: título palabra a palabra y contadores. Se pintan después de shell(), así que se adornan al aparecer. */
    const adorna = root => {
      if (quieto || !root.querySelectorAll) return;
      // Con HTML generado, las cifras ya se veían: no se cuentan desde cero (el título sí se parte; --ya lo sigue).
      if (pre) root.querySelectorAll('.cnt:not([data-contado])').forEach(el => { el.dataset.contado = 'fin'; if (el.dataset.n) el.textContent = el.dataset.n; });
      root.querySelectorAll('.hero-photo .h1').forEach(h => { if (h.querySelector('.w')) return; h.innerHTML = h.textContent.trim().split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' '); });
      if (!pre) root.querySelectorAll('.cnt:not([data-contado])').forEach(el => {
        el.dataset.contado = '1';
        const fin = Number(el.dataset.n || el.textContent) || 0, t0 = performance.now(), dur = 1100;
        const paso = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(fin * e); if (k < 1) requestAnimationFrame(paso); else el.dataset.contado = 'fin'; };
        requestAnimationFrame(paso);
      });
    };
    const marca = root => {
      adorna(root);
      /* Las primeras fotos de cada bloque pintado (las que caen en el primer pantallazo) no se difieren: el elemento
         más grande del directorio era una foto lazy y Lighthouse lo penaliza (LCP 3,7 s). El observador corre antes
         del primer pintado, así que cambiar loading aquí llega a tiempo. */
      if (root.querySelectorAll) [...root.querySelectorAll('img[loading="lazy"]')].slice(0, 6).forEach(i => { i.loading = 'eager'; });
      const lista = root.matches && root.matches(SEL) ? [root] : [];
      lista.push(...root.querySelectorAll(SEL));
      lista.forEach(el => {
        if (el.dataset.reveal || el.classList.contains('is-in')) return;
        if (pre && el.getBoundingClientRect().top < innerHeight) return;   // ya se veía antes del JS: no se oculta para volver a aparecer
        const i = [...el.parentElement.children].indexOf(el);
        el.dataset.reveal = '1'; el.style.setProperty('--d', Math.min(i, 9) * 55 + 'ms'); io.observe(el);
      });
    };
    marca(document);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) marca(n); }))).observe(document.getElementById('main'), { childList: true, subtree: true });
    const h = document.querySelector('.site-header'); const sombra = () => h && h.classList.toggle('is-scrolled', scrollY > 8);
    addEventListener('scroll', sombra, { passive: true }); sombra();
  }

  function shell(section, opts) {
    opts = opts || {};
    const main = document.getElementById('main');
    const pre = main.hasAttribute('data-prerender');
    if (pre) document.querySelectorAll('body > a.skip, body > .ml-header, body > footer.site-footer').forEach(e => e.remove());
    document.body.insertAdjacentHTML('afterbegin', header(section, !!opts.dir));
    main.classList.add('wrap', 'ml-layout');
    const A = anunciantes(opts);
    main.innerHTML = (opts.dir ? sidebarDir(opts.sector, A.items.slice(4)) : sidebar(A.items.slice(4))) + `<div class="ml-main" id="content"></div>` + aside(A);
    document.body.insertAdjacentHTML('beforeend', footer());
    R.header(); R.dropdowns();
    efectos(pre);
    // El lateral nace cerrado en móvil y sin su summary en escritorio: al crecer la ventana hay que abrirlo.
    matchMedia('(max-width: 800px)').addEventListener('change', e => { if (!e.matches) document.querySelectorAll('.ml-side details').forEach(d => { d.open = true; }); });
    /* La cabecera se pinta antes de que /api/auth conteste: el botón de cuenta
       se actualiza al saber si hay sesión (si no, parecía que se había cerrado). */
    auth.ready.then(() => {
      // [data-cuenta] y no el id: el menú móvil es un clon de la cabecera sin ids.
      const s = store.session(); if (!s) return;
      document.querySelectorAll('[data-cuenta]').forEach(b => { b.href = s.admin ? '/admin' : 'panel/index.html'; b.textContent = s.admin ? 'Administración' : 'Mi panel'; });
    });
    /* Con sesión, las guardadas de la cuenta llegan después del primer pintado:
       se funden y se repintan solo las estrellas, sin volver a montar la página. */
    auth.ready.then(() => store.sincronizaFav()).then(cambio => {
      if (!cambio) return;
      document.querySelectorAll('[data-fav]').forEach(x => {
        const on = store.esFav(x.dataset.fav);
        x.classList.toggle('is-on', on); x.classList.toggle('btn-ink', on && x.classList.contains('btn')); x.setAttribute('aria-pressed', String(on));
        if (x.classList.contains('btn')) x.innerHTML = icon('star') + (on ? ' Guardada' : ' Guardar'); else x.setAttribute('aria-label', on ? 'Quitar de guardadas' : 'Guardar máquina');
      });
      document.dispatchEvent(new CustomEvent('roble:guardadas'));
    });
    document.addEventListener('click', e => { const b = e.target.closest('[data-fav]'); if (!b) return; e.preventDefault(); e.stopPropagation(); const on = store.toggleFav(b.dataset.fav); document.querySelectorAll('[data-fav="' + b.dataset.fav + '"]').forEach(x => { x.classList.toggle('is-on', on); x.classList.toggle('btn-ink', on && x.classList.contains('btn')); x.setAttribute('aria-pressed', String(on)); if (x.classList.contains('btn')) x.innerHTML = icon('star') + (on ? ' Guardada' : ' Guardar'); else x.setAttribute('aria-label', on ? 'Quitar de guardadas' : 'Guardar máquina'); }); R.toast(on ? 'Guardada en tus máquinas' : 'Quitada de guardadas'); });
    return document.getElementById('content');
  }

  return { contacto, galeria, barraMovil, D, cat, vend, anuncio, anunciosDe, publicados, TIPO, ESTADO, pais, fmtPrecio, catsAZ, tpl, buscar, shell, solicitudes, addSolicitud, foto, fotoCat, fotoVend, fotoSm, sm, FOTOS, store, extras, saveExtras, auth, salir, elegirEmpresa, wa, waAttrs, gmail };
})();
