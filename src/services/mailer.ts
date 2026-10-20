import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { AppError } from '../errors.js';

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
  connectionTimeout: config.smtpTimeoutMs,
  greetingTimeout: config.smtpTimeoutMs,
  socketTimeout: config.smtpTimeoutMs,
});

let transporter: Transporter | null = null;
const smtpTransporter = () => (transporter ??= nodemailer.createTransport(smtpOptions()));

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

const currentTransport = (): MailTransport | null => {
  if (overrideTransport) return overrideTransport;
  if (config.smtpHost) return smtpTransport;
  return config.nodeEnv === 'production' ? null : consoleTransport;
};

export const canSendMail = () => currentTransport() !== null;

export const sendMail = async (message: MailMessage) => {
  const transport = currentTransport();
  if (!transport) throw mailNotConfigured();
  await transport(message);
};

// Checks the connection and the login without sending anything (used by `npm run mail:test`).
export const verifySmtp = async () => {
  if (!config.smtpHost) throw new Error('SMTP_HOST no está definido.');
  await smtpTransporter().verify();
};

// A short description of a send failure for the logs: never the password, the links or the tokens.
export const describeMailError = (error: unknown) => {
  if (!(error instanceof Error)) return 'error desconocido';
  const { code, responseCode, command } = error as Error & { code?: string; responseCode?: number; command?: string };
  let message = error.message.replace(/https?:\/\/\S+/g, '[enlace]').replace(/[A-Za-z0-9_-]{20,}/g, '[oculto]');
  for (const secret of [config.smtpPass, smtpPassword()].filter((value) => value.length >= 4)) message = message.split(secret).join('[oculto]');
  return [code, responseCode ? `SMTP ${responseCode}` : '', command ? `comando ${command}` : '', message.slice(0, 200)].filter(Boolean).join(' · ');
};

// What to check for the usual failures, in Spanish.
export const mailErrorHint = (error: unknown) => {
  const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534)
    return 'El servidor rechazó el usuario o la contraseña. En Gmail usa una contraseña de aplicación de 16 caracteres (necesita la verificación en 2 pasos); en Brevo usa el login y la clave SMTP de la sección "SMTP & API".';
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNREFUSED' || code === 'EDNS')
    return 'No se pudo conectar con el servidor SMTP. Revisa SMTP_HOST y SMTP_PORT, y que SMTP_SECURE sea true con el puerto 465 o false con el 587.';
  if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553 || responseCode === 554)
    return 'El servidor rechazó el remitente o el destinatario. En Brevo, MAIL_FROM debe ser un remitente verificado; revisa también el correo de destino.';
  return 'Revisa las variables SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS y MAIL_FROM.';
};
