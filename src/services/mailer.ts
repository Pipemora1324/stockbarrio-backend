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

// Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of the password.
export const smtpPassword = () => (/(^|\.)gmail\.com$/i.test(config.smtpHost) ? config.smtpPass.replace(/\s+/g, '') : config.smtpPass);

// MAIL_FROM when it is set; otherwise the authenticated account, which is what Gmail sends from anyway.
// If the provider rewrites a different MAIL_FROM to the authenticated account, the message still goes out.
export const senderAddress = () => config.mailFrom || (isEmail(config.smtpUser) ? `StockBarrio <${config.smtpUser}>` : 'StockBarrio <no-responder@stockbarrio.local>');

export const smtpOptions = () => ({
  host: config.smtpHost,
  port: config.smtpPort,
  // 465: TLS from the start. 587: plain connection that must upgrade with STARTTLS before logging in.
  secure: config.smtpSecure,
  requireTLS: !config.smtpSecure && config.smtpPort === 587,
  auth: config.smtpUser ? { user: config.smtpUser, pass: smtpPassword() } : undefined,
  connectionTimeout: config.mailTimeoutMs,
  greetingTimeout: config.mailTimeoutMs,
  socketTimeout: config.mailTimeoutMs,
});

let transporter: Transporter | null = null;
const smtpTransporter = () => (transporter ??= nodemailer.createTransport(smtpOptions()));
// Lets tests build a new connection with a different configuration.
export const resetSmtpTransport = () => {
  transporter = null;
};

const smtpTransport: MailTransport = async (message) => {
  await smtpTransporter().sendMail({ from: senderAddress(), to: message.to, subject: message.subject, text: message.text, html: message.html });
};

// Without SMTP in development the message goes to the console so the flow can be tested locally.
// It is never used in production, so links are never written to production logs.
const consoleTransport: MailTransport = async (message) => {
  console.info(`[correo de desarrollo] Para: ${message.to}\nAsunto: ${message.subject}\n${message.text}\n`);
};

let overrideTransport: MailTransport | null = null;
// Lets tests capture the messages instead of sending them.
export const useMailTransport = (transport: MailTransport | null) => {
  overrideTransport = transport;
};

export const mailProviders = ['smtp', 'brevo-api'] as const;
// Without MAIL_PROVIDER the SMTP setup works as before.
export const mailProvider = () => config.mailProvider || 'smtp';

const currentTransport = (): MailTransport | null => {
  if (overrideTransport) return overrideTransport;
  if (mailProvider() === 'brevo-api') return brevoProblems().length ? null : sendWithBrevo;
  if (mailProvider() !== 'smtp') return null;
  if (config.smtpHost) return smtpTransport;
  return config.nodeEnv === 'production' ? null : consoleTransport;
};

// Configuration problems, in Spanish, to warn about when the API starts. Mail stays "not configured"; the API keeps working.
export const mailSetupProblems = () => {
  const provider = mailProvider();
  if (!(mailProviders as readonly string[]).includes(provider)) return [`MAIL_PROVIDER="${provider}" no es válido: usa smtp o brevo-api. No se enviarán correos.`];
  const problems = provider === 'brevo-api' ? brevoProblems().map((problem) => `MAIL_PROVIDER=brevo-api pero ${problem}: no se enviarán correos.`) : [];
  if (provider === 'smtp' && config.nodeEnv === 'production' && !config.smtpHost) problems.push('SMTP_HOST no está definido: la recuperación de contraseña responderá que el correo no está configurado.');
  if (!config.appUrlConfigured) problems.push('APP_URL no está definida: no se enviarán correos, porque sus enlaces no tendrían a dónde apuntar.');
  return problems;
};

// The sender as each transport will use it.
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

// Checks the connection and the login (or the API key) without sending anything (used by `npm run mail:test`).
export const verifyTransport = async () => {
  if (mailProvider() === 'brevo-api') return verifyBrevo();
  if (!config.smtpHost) throw new Error('SMTP_HOST no está definido.');
  await smtpTransporter().verify();
};

// A short description of a send failure for the logs: never the password, the links or the tokens.
export const describeMailError = (error: unknown) => {
  if (error instanceof BrevoError) {
    if (error.failure === 'http') return `Brevo ${error.status}${error.detail ? ` · ${error.detail}` : ''}`;
    if (error.failure === 'timeout') return `Brevo · tiempo de espera agotado (${Math.round(config.mailTimeoutMs / 1000)} s)`;
    return `Brevo · sin conexión${error.detail ? ` (${error.detail})` : ''}`;
  }
  if (!(error instanceof Error)) return 'error desconocido';
  const { code, responseCode, command } = error as Error & { code?: string; responseCode?: number; command?: string };
  let message = error.message.replace(/https?:\/\/\S+/g, '[enlace]').replace(/[A-Za-z0-9_-]{20,}/g, '[oculto]');
  for (const secret of [config.smtpPass, smtpPassword()].filter((value) => value.length >= 4)) message = message.split(secret).join('[oculto]');
  return [code, responseCode ? `SMTP ${responseCode}` : '', command ? `comando ${command}` : '', message.slice(0, 200)].filter(Boolean).join(' · ');
};

// What to check for the usual failures, in Spanish.
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
