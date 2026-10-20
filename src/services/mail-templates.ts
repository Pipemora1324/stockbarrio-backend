import type { MailMessage } from './mailer.js';

type Mail = Omit<MailMessage, 'to'>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const signature = 'Equipo de StockBarrio';

// Simple layout with inline styles, which is what mail clients render reliably.
const layout = (title: string, paragraphs: string[], action?: { label: string; url: string }) => `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f4f7f5;font-family:Arial,Helvetica,sans-serif;color:#1d2b25;">
  <div style="max-width:520px;margin:0 auto;padding:28px;border-radius:16px;background:#ffffff;">
    <p style="margin:0 0 16px;color:#0f7a55;font-weight:bold;">StockBarrio</p>
    <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
    ${paragraphs.map((text) => `<p style="margin:0 0 14px;line-height:1.5;">${text}</p>`).join('\n    ')}
    ${action ? `<p style="margin:22px 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0f7a55;color:#ffffff;font-weight:bold;text-decoration:none;">${escapeHtml(action.label)}</a></p>
    <p style="margin:0 0 14px;font-size:13px;color:#5b6b64;line-height:1.5;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${escapeHtml(action.url)}" style="color:#0f7a55;word-break:break-all;">${escapeHtml(action.url)}</a></p>` : ''}
    <p style="margin:22px 0 0;color:#5b6b64;">${signature}</p>
  </div>
</body>
</html>`;

export const passwordResetMail = (name: string, link: string, minutes: number): Mail => ({
  subject: 'Cambia tu contraseña de StockBarrio',
  text: `Hola, ${name}:\n\nRecibimos una solicitud para cambiar la contraseña de tu cuenta de StockBarrio. Abre este enlace para elegir una nueva:\n\n${link}\n\nEl enlace vence en ${minutes} minutos y solo se puede usar una vez.\n\nSi no fuiste tú, ignora este mensaje: tu contraseña no cambiará.\n\n${signature}`,
  html: layout(
    'Cambia tu contraseña',
    [
      `Hola, ${escapeHtml(name)}:`,
      'Recibimos una solicitud para cambiar la contraseña de tu cuenta de StockBarrio.',
      `El enlace vence en <strong>${minutes} minutos</strong> y solo se puede usar una vez.`,
      'Si no fuiste tú, ignora este mensaje: tu contraseña no cambiará.',
    ],
    { label: 'Elegir una contraseña nueva', url: link },
  ),
});

export const passwordChangedMail = (name: string, loginUrl: string): Mail => ({
  subject: 'Tu contraseña de StockBarrio fue cambiada',
  text: `Hola, ${name}:\n\nLa contraseña de tu cuenta de StockBarrio fue cambiada y cerramos las sesiones que estaban abiertas.\n\nSi fuiste tú, no tienes que hacer nada más: ya puedes iniciar sesión en ${loginUrl}\n\nSi no fuiste tú, pide un enlace nuevo desde "¿Olvidaste tu contraseña?" para recuperar tu cuenta y escríbenos.\n\n${signature}`,
  html: layout('Tu contraseña fue cambiada', [
    `Hola, ${escapeHtml(name)}:`,
    'La contraseña de tu cuenta de StockBarrio fue cambiada y cerramos las sesiones que estaban abiertas.',
    `Si fuiste tú, no tienes que hacer nada más: ya puedes <a href="${escapeHtml(loginUrl)}" style="color:#0f7a55;">iniciar sesión</a>.`,
    'Si no fuiste tú, pide un enlace nuevo desde «¿Olvidaste tu contraseña?» para recuperar tu cuenta y escríbenos.',
  ]),
});

export const emailChangeConfirmMail = (name: string, link: string, minutes: number): Mail => ({
  subject: 'Confirma tu nuevo correo en StockBarrio',
  text: `Hola, ${name}:\n\nPara usar este correo en tu cuenta de StockBarrio, abre este enlace en los próximos ${minutes} minutos:\n\n${link}\n\nSi no pediste este cambio, ignora este mensaje.\n\n${signature}`,
  html: layout(
    'Confirma tu nuevo correo',
    [`Hola, ${escapeHtml(name)}:`, `Para usar este correo en tu cuenta de StockBarrio, confirma en los próximos <strong>${minutes} minutos</strong>.`, 'Si no pediste este cambio, ignora este mensaje.'],
    { label: 'Confirmar mi correo', url: link },
  ),
});

export const emailChangeWarningMail = (name: string, newEmail: string): Mail => ({
  subject: 'Se pidió cambiar el correo de tu cuenta',
  text: `Hola, ${name}:\n\nAlguien con acceso a tu cuenta pidió cambiar el correo a ${newEmail}. El cambio solo se hará cuando se confirme desde ese correo.\nSi no fuiste tú, cambia tu contraseña cuanto antes.\n\n${signature}`,
  html: layout('Se pidió cambiar tu correo', [
    `Hola, ${escapeHtml(name)}:`,
    `Alguien con acceso a tu cuenta pidió cambiar el correo a <strong>${escapeHtml(newEmail)}</strong>. El cambio solo se hará cuando se confirme desde ese correo.`,
    'Si no fuiste tú, cambia tu contraseña cuanto antes.',
  ]),
});

export const testMail = (appUrl: string): Mail => ({
  subject: 'Correo de prueba de StockBarrio',
  text: `Si lees esto, el envío de correos de StockBarrio funciona.\n\nLos enlaces de los correos apuntarán a ${appUrl}\n\n${signature}`,
  html: layout('Correo de prueba', ['Si lees esto, el envío de correos de StockBarrio funciona.', `Los enlaces de los correos apuntarán a <strong>${escapeHtml(appUrl)}</strong>.`]),
});
