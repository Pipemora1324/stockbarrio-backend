import { config } from '../config.js';
import type { MailMessage } from './mailer.js';

// API de correo transaccional de Brevo por HTTPS, para servidores que bloquean los puertos SMTP (Render Free bloquea 25, 465 y 587).
export const brevoSendUrl = 'https://api.brevo.com/v3/smtp/email';
export const brevoAccountUrl = 'https://api.brevo.com/v3/account';

type BrevoFailure = 'http' | 'timeout' | 'network';

// Su mensaje es seguro para los logs: solo el estado HTTP o el tipo de falla, nunca la clave, el destinatario ni el contenido.
export class BrevoError extends Error {
  constructor(
    readonly failure: BrevoFailure,
    readonly status: number | null = null,
    // El código de error de Brevo (por ejemplo "unauthorized") o el código del error de red.
    readonly detail = '',
    readonly senderRejected = false,
  ) {
    super(failure === 'http' ? `Brevo ${status}` : failure === 'timeout' ? 'Brevo: tiempo de espera agotado' : 'Brevo: sin conexión');
    this.name = 'BrevoError';
  }
}

// MAIL_FROM como "Nombre <correo>" o solo "correo".
export const parseSender = (value: string) => {
  const match = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  const email = (match ? match[2] : value).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name: match?.[1].replace(/^"(.*)"$/, '$1').trim() || 'StockBarrio', email };
};

// Lo que falta para enviar por Brevo, en español (vacío cuando está listo).
export const brevoProblems = () => [
  ...(config.brevoApiKey ? [] : ['falta BREVO_API_KEY']),
  ...(parseSender(config.mailFrom) ? [] : ['MAIL_FROM debe tener el remitente verificado en Brevo, por ejemplo "StockBarrio <avisos@tu-dominio.com>"']),
];

// Un temporizador normal en vez de AbortSignal.timeout: en Node 20 ese no mantiene vivo el proceso, así que
// un script como `npm run mail:test` podría terminar en silencio mientras Brevo todavía no responde.
const request = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Brevo no respondió a tiempo.', 'TimeoutError')), config.mailTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) throw new BrevoError('timeout');
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    throw new BrevoError('network', null, typeof code === 'string' ? code : '');
  } finally {
    clearTimeout(timer);
  }
};

// Lee el código de error de Brevo y si se queja del remitente, sin guardar su mensaje.
const failureOf = async (response: Response) => {
  let code = '';
  let senderRejected = false;
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string') code = body.code.replace(/[^\w-]/g, '').slice(0, 40);
    senderRejected = /sender/i.test(String(body.message ?? ''));
  } catch {
    // No es JSON: basta con el estado.
  }
  return new BrevoError('http', response.status, code, senderRejected);
};

const headers = () => ({ 'api-key': config.brevoApiKey, accept: 'application/json', 'content-type': 'application/json' });

export const sendWithBrevo = async (message: MailMessage) => {
  const sender = parseSender(config.mailFrom);
  if (!sender) throw new BrevoError('http', 400, 'invalid_sender', true);
  const response = await request(brevoSendUrl, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ sender, to: [{ email: message.to }], subject: message.subject, textContent: message.text, ...(message.html ? { htmlContent: message.html } : {}) }),
  });
  if (!response.ok) throw await failureOf(response);
};

// Comprueba la clave sin enviar nada (lo usa `npm run mail:test`).
export const verifyBrevo = async () => {
  const response = await request(brevoAccountUrl, { method: 'GET', headers: headers() });
  if (!response.ok) throw await failureOf(response);
};
