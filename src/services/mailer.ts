import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { BrevoError, brevoProblems, parseSender, sendWithBrevo, verifyBrevo } from './brevo.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailTransport = (message: MailMessage) => Promise<void>;

export const mailNotConfigured = () =>
  new AppError(503, 'El envío de correos no está configurado todavía. Escríbele al equipo de StockBarrio para recuperar tu cuenta.');

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Gmail muestra las contraseñas de aplicación en grupos de cuatro ("abcd efgh ijkl mnop"); los espacios no son parte de la contraseña.
export const smtpPassword = () => (/(^|\.)gmail\.com$/i.test(config.smtpHost) ? config.smtpPass.replace(/\s+/g, '') : config.smtpPass);

// MAIL_FROM si está definido; si no, la cuenta autenticada, que es desde donde Gmail envía de todos modos.
// Si el proveedor reescribe un MAIL_FROM distinto con la cuenta autenticada, el mensaje igual sale.
export const senderAddress = () => config.mailFrom || (isEmail(config.smtpUser) ? `StockBarrio <${config.smtpUser}>` : 'StockBarrio <no-responder@stockbarrio.local>');

export const smtpOptions = () => ({
  host: config.smtpHost,
  port: config.smtpPort,
  // 465: TLS desde el inicio. 587: conexión normal que debe pasar a STARTTLS antes de iniciar sesión.
  secure: config.smtpSecure,
  requireTLS: !config.smtpSecure && config.smtpPort === 587,
  auth: config.smtpUser ? { user: config.smtpUser, pass: smtpPassword() } : undefined,
  connectionTimeout: config.mailTimeoutMs,
  greetingTimeout: config.mailTimeoutMs,
  socketTimeout: config.mailTimeoutMs,
});

let transporter: Transporter | null = null;
const smtpTransporter = () => (transporter ??= nodemailer.createTransport(smtpOptions()));
// Permite que las pruebas armen una conexión nueva con otra configuración.
export const resetSmtpTransport = () => {
  transporter = null;
};

const smtpTransport: MailTransport = async (message) => {
  await smtpTransporter().sendMail({ from: senderAddress(), to: message.to, subject: message.subject, text: message.text, html: message.html });
};

// Sin SMTP en desarrollo el mensaje va a la consola, para probar el flujo en local.
// Nunca se usa en producción, así que los enlaces nunca se escriben en los logs de producción.
const consoleTransport: MailTransport = async (message) => {
  console.info(`[correo de desarrollo] Para: ${message.to}\nAsunto: ${message.subject}\n${message.text}\n`);
};

let overrideTransport: MailTransport | null = null;
// Permite que las pruebas capturen los mensajes en vez de enviarlos.
export const useMailTransport = (transport: MailTransport | null) => {
  overrideTransport = transport;
};

export const mailProviders = ['smtp', 'brevo-api'] as const;
// Sin MAIL_PROVIDER la configuración SMTP funciona como antes.
export const mailProvider = () => config.mailProvider || 'smtp';

const currentTransport = (): MailTransport | null => {
  if (overrideTransport) return overrideTransport;
  if (mailProvider() === 'brevo-api') return brevoProblems().length ? null : sendWithBrevo;
  if (mailProvider() !== 'smtp') return null;
  if (config.smtpHost) return smtpTransport;
  return config.nodeEnv === 'production' ? null : consoleTransport;
};

// Problemas de configuración, en español, para avisar al arrancar la API. El correo queda "no configurado"; la API sigue funcionando.
export const mailSetupProblems = () => {
  const provider = mailProvider();
  if (!(mailProviders as readonly string[]).includes(provider)) return [`MAIL_PROVIDER="${provider}" no es válido: usa smtp o brevo-api. No se enviarán correos.`];
  const problems = provider === 'brevo-api' ? brevoProblems().map((problem) => `MAIL_PROVIDER=brevo-api pero ${problem}: no se enviarán correos.`) : [];
  if (provider === 'smtp' && config.nodeEnv === 'production' && !config.smtpHost) problems.push('SMTP_HOST no está definido: la recuperación de contraseña responderá que el correo no está configurado.');
  if (!config.appUrlConfigured) problems.push('APP_URL no está definida: no se enviarán correos, porque sus enlaces no tendrían a dónde apuntar.');
  return problems;
};

// El remitente tal como lo usará cada transporte.
export const describeSender = () => {
  if (mailProvider() !== 'brevo-api') return senderAddress();
  const sender = parseSender(config.mailFrom);
  return sender ? `${sender.name} <${sender.email}>` : '(MAIL_FROM no válido)';
};

export const canSendMail = () => currentTransport() !== null;

export const sendMail = async (message: MailMessage) => {
  const transport = currentTransport();
  if (!transport) throw mailNotConfigured();
  await transport(message);
};

// Comprueba la conexión y el inicio de sesión (o la clave de la API) sin enviar nada (lo usa `npm run mail:test`).
export const verifyTransport = async () => {
  if (mailProvider() === 'brevo-api') return verifyBrevo();
  if (!config.smtpHost) throw new Error('SMTP_HOST no está definido.');
  await smtpTransporter().verify();
};

// 10000 -> "10 s", 1500 -> "1,5 s".
export const formatSeconds = (ms: number) => `${String(Number((ms / 1000).toFixed(1))).replace('.', ',')} s`;

// Descripción corta de una falla de envío para los logs: nunca la contraseña, los enlaces ni los tokens.
export const describeMailError = (error: unknown) => {
  if (error instanceof BrevoError) {
    if (error.failure === 'http') return `Brevo ${error.status}${error.detail ? ` · ${error.detail}` : ''}`;
    if (error.failure === 'timeout') return `Brevo · tiempo de espera agotado (${formatSeconds(config.mailTimeoutMs)})`;
    return `Brevo · sin conexión${error.detail ? ` (${error.detail})` : ''}`;
  }
  if (!(error instanceof Error)) return 'error desconocido';
  const { code, responseCode, command } = error as Error & { code?: string; responseCode?: number; command?: string };
  let message = error.message.replace(/https?:\/\/\S+/g, '[enlace]').replace(/[A-Za-z0-9_-]{20,}/g, '[oculto]');
  for (const secret of [config.smtpPass, smtpPassword()].filter((value) => value.length >= 4)) message = message.split(secret).join('[oculto]');
  return [code, responseCode ? `SMTP ${responseCode}` : '', command ? `comando ${command}` : '', message.slice(0, 200)].filter(Boolean).join(' · ');
};

// Qué revisar en las fallas habituales, en español.
export const mailErrorHint = (error: unknown) => {
  if (error instanceof BrevoError) {
    if (error.status === 401)
      return 'Brevo rechazó BREVO_API_KEY. Crea una API key en Brevo (SMTP & API > API Keys) y cópiala completa. Si la clave es correcta, revisa en Security > Authorized IPs que Brevo no esté bloqueando la IP del servidor.';
    if (error.status === 400 && error.senderRejected) return 'Brevo rechazó el remitente: MAIL_FROM debe ser un remitente verificado en Brevo (Senders, Domains & Dedicated IPs > Senders).';
    if (error.status === 400) return 'Brevo rechazó el correo. Revisa que MAIL_FROM sea un remitente verificado y que el correo de destino sea válido.';
    if (error.status === 403) return 'Brevo no permite este envío con la cuenta actual. Revisa en Brevo que la cuenta esté activa y tenga envíos transaccionales disponibles.';
    if (error.status === 429) return 'Brevo limitó los envíos por ahora (cupo diario o por minuto). Inténtalo más tarde.';
    if (error.failure !== 'http') return 'No se pudo conectar con la API de Brevo (api.brevo.com). Revisa la conexión a internet del servidor y vuelve a intentar.';
    return 'Brevo no pudo enviar el correo. Revisa el estado del servicio y la configuración.';
  }
  const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534)
    return 'El servidor rechazó el usuario o la contraseña. En Gmail usa una contraseña de aplicación de 16 caracteres (necesita la verificación en 2 pasos); en Brevo usa el login y la clave SMTP de la sección "SMTP & API".';
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNREFUSED' || code === 'EDNS')
    return 'No se pudo conectar con el servidor SMTP. Revisa SMTP_HOST y SMTP_PORT, y que SMTP_SECURE sea true con el puerto 465 o false con el 587. En Render Free los puertos SMTP están bloqueados: usa MAIL_PROVIDER=brevo-api.';
  if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553 || responseCode === 554)
    return 'El servidor rechazó el remitente o el destinatario. En Brevo, MAIL_FROM debe ser un remitente verificado; revisa también el correo de destino.';
  return 'Revisa las variables SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS y MAIL_FROM.';
};
