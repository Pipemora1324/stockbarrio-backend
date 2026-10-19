import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailTransport = (message: MailMessage) => Promise<void>;

export const mailNotConfigured = () =>
  new AppError(503, 'El envío de correos no está configurado todavía. Escríbele al equipo de StockBarrio para recuperar tu cuenta.');

let smtp: MailTransport | null = null;
const smtpTransport = (): MailTransport => {
  if (smtp) return smtp;
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
  });
  smtp = async (message) => {
    await transporter.sendMail({ from: config.mailFrom, to: message.to, subject: message.subject, text: message.text });
  };
  return smtp;
};

// Without SMTP in development the message goes to the console so the flow can be tested locally.
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
  if (config.smtpHost) return smtpTransport();
  return config.nodeEnv === 'production' ? null : consoleTransport;
};

export const canSendMail = () => currentTransport() !== null;

export const sendMail = async (message: MailMessage) => {
  const transport = currentTransport();
  if (!transport) throw mailNotConfigured();
  await transport(message);
};
