import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { testMail } from './services/mail-templates.js';
import { describeMailError, mailErrorHint, senderAddress, sendMail, smtpOptions, verifySmtp } from './services/mailer.js';

// Usage: npm run mail:test -- tucorreo@ejemplo.com
// Sends one test message with the current configuration. It never prints the password.
export const runMailTest = async (to: string | undefined, log = console) => {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    log.error('Indica a qué correo enviar la prueba: npm run mail:test -- tucorreo@ejemplo.com');
    return 1;
  }
  if (!config.smtpHost) {
    log.error('SMTP_HOST no está definido: no hay servidor de correo configurado. Revisa la guía de correo en el README.');
    return 1;
  }
  const options = smtpOptions();
  log.info(
    `Servidor: ${options.host}:${options.port} (${options.secure ? 'TLS directo' : options.requireTLS ? 'STARTTLS obligatorio' : 'STARTTLS si el servidor lo ofrece'}) · usuario: ${config.smtpUser || '(sin usuario)'} · contraseña: ${config.smtpPass ? 'definida' : 'vacía'} · remitente: ${senderAddress()}`,
  );
  try {
    await verifySmtp();
    log.info('Conexión e inicio de sesión correctos.');
    await sendMail({ to, ...testMail(config.appUrl) });
    log.info(`Listo: se envió un correo de prueba a ${to}. Si no llega en unos minutos, revisa la carpeta de spam.`);
    return 0;
  } catch (error) {
    log.error(`No se pudo enviar el correo de prueba: ${describeMailError(error)}`);
    log.error(mailErrorHint(error));
    return 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMailTest(process.argv[2]).then((code) => {
    process.exitCode = code;
  });
}
