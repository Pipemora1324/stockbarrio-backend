import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { testMail } from './services/mail-templates.js';
import { canSendMail, describeMailError, describeSender, formatSeconds, mailErrorHint, mailProvider, mailSetupProblems, sendMail, smtpOptions, verifyTransport } from './services/mailer.js';

// The configuration in use, without any password or key.
export const describeMailSetup = () => {
  const provider = mailProvider();
  if (provider === 'brevo-api') return `Transporte: API HTTPS de Brevo · API key: ${config.brevoApiKey ? 'definida' : 'vacía'} · remitente: ${describeSender()} · límite: ${formatSeconds(config.mailTimeoutMs)}`;
  const options = smtpOptions();
  const security = options.secure ? 'TLS directo' : options.requireTLS ? 'STARTTLS obligatorio' : 'STARTTLS si el servidor lo ofrece';
  return `Transporte: SMTP ${options.host}:${options.port} (${security}) · usuario: ${config.smtpUser || '(sin usuario)'} · contraseña: ${config.smtpPass ? 'definida' : 'vacía'} · remitente: ${describeSender()} · límite: ${formatSeconds(config.mailTimeoutMs)}`;
};

// Usage: npm run mail:test -- tucorreo@ejemplo.com
// Sends one test message with the current configuration. It never prints the password or the API key.
export const runMailTest = async (to: string | undefined, log = console) => {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    log.error('Indica a qué correo enviar la prueba: npm run mail:test -- tucorreo@ejemplo.com');
    return 1;
  }
  const blocking = mailSetupProblems().filter((problem) => !problem.startsWith('APP_URL'));
  if (mailProvider() === 'smtp' && !config.smtpHost) blocking.push('SMTP_HOST no está definido: no hay servidor de correo configurado.');
  if (blocking.length || !canSendMail()) {
    for (const problem of new Set(blocking)) log.error(problem);
    log.error('Revisa la guía de correo en el README.');
    return 1;
  }
  log.info(describeMailSetup());
  try {
    await verifyTransport();
    log.info(mailProvider() === 'brevo-api' ? 'La API key de Brevo es válida.' : 'Conexión e inicio de sesión correctos.');
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
