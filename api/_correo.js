/* Envío de correo con Resend, igual que el sistema actual.
 *
 * Variables en Vercel (roble-maquinaria):
 *   RESEND_API_KEY   — la clave de https://resend.com. Sin ella no se envía
 *                      nada y se devuelve { enviado: false }.
 *   REMITENTE_EMAIL  — remitente con dominio verificado en Resend. Sin dominio
 *                      propio, el único permitido es onboarding@resend.dev, que
 *                      SOLO puede escribir al correo con el que se registró la
 *                      cuenta de Resend.
 *   APP_URL          — dirección pública de esta web, para los enlaces de los
 *                      correos. Por defecto, la de Vercel.
 *
 * Sin dominio propio, Resend solo escribe a su propia cuenta. Mientras tanto se
 * puede enviar por SMTP (por ejemplo, una cuenta de Gmail del proyecto con
 * contraseña de aplicación: 500 correos al día). Si SMTP_USER y SMTP_PASS están
 * puestas, se usa SMTP y no Resend; al tener dominio verificado, se quitan.
 *   SMTP_USER, SMTP_PASS — cuenta y contraseña de aplicación.
 *   SMTP_HOST, SMTP_PORT — por defecto smtp.gmail.com y 465.
 */

const REMITENTE = process.env.REMITENTE_EMAIL || 'Roble <onboarding@resend.dev>';
const APP_URL = (process.env.APP_URL || 'https://roble-maquinaria.vercel.app').replace(/\/+$/, '');

const haySmtp = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
const hayCorreo = () => haySmtp() || Boolean(process.env.RESEND_API_KEY);

let transporte = null;
async function enviaSmtp({ para, asunto, html, texto }) {
  if (!transporte) {
    const puerto = Number(process.env.SMTP_PORT) || 465;
    transporte = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port: puerto, secure: puerto === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  try {
    // Gmail firma con la cuenta autenticada: el remitente es esa cuenta, con el nombre de ROBLE.
    await transporte.sendMail({ from: { name: 'ROBLE', address: process.env.SMTP_USER }, to: para, subject: asunto, html, text: texto });
    return { enviado: true };
  } catch (err) {
    console.error(JSON.stringify({ evt: 'correo_smtp_error', msg: err.message }));
    return { enviado: false, motivo: 'smtp' };
  }
}

async function envia({ para, asunto, html, texto }) {
  if (!hayCorreo()) return { enviado: false, motivo: 'sin-clave' };
  if (haySmtp()) return enviaSmtp({ para, asunto, html, texto });
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: REMITENTE, to: Array.isArray(para) ? para : [para], subject: asunto, html, text: texto }),
    });
    if (!r.ok) {
      const detalle = await r.text();
      console.error(JSON.stringify({ evt: 'correo_fallo', estado: r.status, detalle: detalle.slice(0, 300) }));
      return { enviado: false, motivo: 'error-' + r.status };
    }
    return { enviado: true };
  } catch (err) {
    console.error(JSON.stringify({ evt: 'correo_error', msg: err.message }));
    return { enviado: false, motivo: 'excepcion' };
  }
}

const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function plantilla(titulo, cuerpoHtml) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;
    padding:28px 24px;color:#1A1A1A;background:#F7F3EC">
    <div style="font-size:19px;font-weight:600;color:#2D3A2E;margin-bottom:18px">Roble</div>
    <h1 style="font-size:19px;margin:0 0 14px">${esc(titulo)}</h1>
    ${cuerpoHtml}
    <p style="font-size:12px;color:#837B70;margin-top:26px;border-top:1px solid #E6DFD3;padding-top:14px">
      Roble — directorio del sector de la madera y la carpintería.</p>
  </div>`;
}

/* Código para cambiar la contraseña. El enlace lleva a esta web. */
async function enviaCodigo({ email, codigo }) {
  const enlace = `${APP_URL}/acceso.html?p=codigo`;
  return envia({
    para: email,
    asunto: 'Tu código para cambiar la contraseña',
    texto: `Tu código es: ${codigo}\n\nCaduca dentro de una hora.\n\n` +
           `Escríbelo aquí: ${enlace}\n\n` +
           `Si no has pedido cambiar la contraseña, ignora este mensaje: tu cuenta sigue igual.`,
    html: plantilla('Tu código para cambiar la contraseña',
      `<p style="font-size:14px;line-height:1.6;color:#55504A">Escribe este código en la web:</p>
       <p style="font-family:ui-monospace,Menlo,monospace;font-size:26px;letter-spacing:5px;
          background:#fff;border:1.5px solid #D2C8B8;border-radius:8px;padding:16px;
          text-align:center;margin:0 0 16px">${esc(codigo)}</p>
       <p style="font-size:13px;color:#837B70">Caduca dentro de una hora.</p>
       <p><a href="${enlace}"
          style="display:inline-block;background:#2D3A2E;color:#fff;text-decoration:none;
          padding:11px 20px;border-radius:6px;font-size:14px">Cambiar la contraseña</a></p>
       <p style="font-size:13px;color:#837B70;line-height:1.6">
         Si no has pedido cambiarla, ignora este mensaje: tu cuenta sigue igual.</p>`),
  });
}

/* Aviso a la empresa de que alguien le ha escrito desde su ficha o un anuncio. */
async function avisaContacto({ para, empresa, nombre, email, whatsapp, mensaje, producto }) {
  const wa = whatsapp ? `https://wa.me/${whatsapp}` : '';
  const asunto = producto ? `Nuevo contacto sobre «${producto}»` : 'Nuevo contacto desde tu ficha de ROBLE';
  const enlace = `${APP_URL}/panel/leads.html`;
  return envia({
    para,
    asunto,
    texto: `${nombre} te ha escrito${producto ? ` sobre «${producto}»` : ''}.\n\n${mensaje}\n\n` +
           `Correo: ${email}${wa ? `\nWhatsApp: +${whatsapp} → ${wa}` : ''}\n\n` +
           `Escríbele por WhatsApp. Lo tienes también en tu panel: ${enlace}`,
    html: plantilla(asunto,
      `<p style="font-size:14px;line-height:1.6"><b>${esc(nombre)}</b> te ha escrito${producto ? ` sobre <b>${esc(producto)}</b>` : ''}.</p>
       <p style="font-size:14px;line-height:1.6;color:#55504A;background:#fff;border:1px solid #E6DFD3;border-radius:8px;padding:13px;white-space:pre-wrap">${esc(mensaje)}</p>
       <p style="font-size:14px;line-height:1.6"><a href="mailto:${esc(email)}">${esc(email)}</a>${wa ? ` · <a href="${wa}">WhatsApp +${whatsapp}</a>` : ''}</p>
       <p>${wa ? `<a href="${wa}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;margin-right:8px">Escribir por WhatsApp</a>` : ''}<a href="${enlace}" style="display:inline-block;background:#2D3A2E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px">Ver en mi panel</a></p>`),
  });
}

/* Aviso a la empresa cuando administración aprueba o rechaza su ficha. */
async function avisaModeracion({ para, empresa, id, estado, motivo }) {
  const panel = `${APP_URL}/panel/perfil.html`;
  if (estado === 'activa') {
    const ficha = `${APP_URL}/empresa.html?id=${id}`;
    return envia({
      para,
      asunto: `${empresa} ya está publicada en ROBLE`,
      texto: `Tu ficha ya aparece en el directorio: ${ficha}\n\nPuedes completarla desde tu panel: ${panel}`,
      html: plantilla(`${empresa} ya está publicada`,
        `<p style="font-size:14px;line-height:1.6">Tu ficha ya aparece en el directorio de ROBLE.</p>
         <p><a href="${esc(ficha)}" style="display:inline-block;background:#2D3A2E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px">Ver la ficha</a></p>
         <p style="font-size:13px;color:#837B70;line-height:1.6">Puedes completarla desde <a href="${esc(panel)}">tu panel</a>.</p>`),
    });
  }
  const razon = motivo ? `Motivo: ${motivo}` : 'No se indicó un motivo concreto.';
  return envia({
    para,
    asunto: `No hemos podido publicar la ficha de ${empresa}`,
    texto: `${razon}\n\nCorrígela desde tu panel (${panel}) y avísanos desde la página de contacto para que la revisemos: ${APP_URL}/contacto.html`,
    html: plantilla(`No hemos podido publicar la ficha de ${empresa}`,
      `<p style="font-size:14px;line-height:1.6;color:#55504A;background:#fff;border:1px solid #E6DFD3;border-radius:8px;padding:13px">${esc(razon)}</p>
       <p style="font-size:14px;line-height:1.6">Corrígela desde <a href="${esc(panel)}">tu panel</a> y avísanos desde la <a href="${esc(APP_URL)}/contacto.html">página de contacto</a> para que la revisemos.</p>`),
  });
}

module.exports = { hayCorreo, envia, plantilla, enviaCodigo, avisaContacto, avisaModeracion };
