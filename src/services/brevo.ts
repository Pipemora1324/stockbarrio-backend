import { config } from '../config.js';
import type { MailMessage } from './mailer.js';

// Brevo's transactional email API over HTTPS, for hosts that block SMTP ports (Render Free blocks 25, 465 and 587).
export const brevoSendUrl = 'https://api.brevo.com/v3/smtp/email';
export const brevoAccountUrl = 'https://api.brevo.com/v3/account';

type BrevoFailure = 'http' | 'timeout' | 'network';

// Its message is safe for logs: only the HTTP status or the kind of failure, never the key, the recipient or the content.
export class BrevoError extends Error {
  constructor(
    readonly failure: BrevoFailure,
    readonly status: number | null = null,
    // Brevo's error code (for example "unauthorized"), or the network error code.
    readonly detail = '',
    readonly senderRejected = false,
  ) {
    super(failure === 'http' ? `Brevo ${status}` : failure === 'timeout' ? 'Brevo: tiempo de espera agotado' : 'Brevo: sin conexión');
    this.name = 'BrevoError';
  }
}

// MAIL_FROM as "Name <email>" or just "email".
export const parseSender = (value: string) => {
  const match = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  const email = (match ? match[2] : value).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name: match?.[1].replace(/^"(.*)"$/, '$1').trim() || 'StockBarrio', email };
};

// What is missing to send through Brevo, in Spanish (empty when it is ready).
export const brevoProblems = () => [
  ...(config.brevoApiKey ? [] : ['falta BREVO_API_KEY']),
  ...(parseSender(config.mailFrom) ? [] : ['MAIL_FROM debe tener el remitente verificado en Brevo, por ejemplo "StockBarrio <avisos@tu-dominio.com>"']),
];

const request = async (url: string, init: RequestInit) => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(config.mailTimeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new BrevoError('timeout');
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    throw new BrevoError('network', null, typeof code === 'string' ? code : '');
  }
};

// Reads Brevo's error code and whether it complains about the sender, without keeping its message.
const failureOf = async (response: Response) => {
  let code = '';
  let senderRejected = false;
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string') code = body.code.replace(/[^\w-]/g, '').slice(0, 40);
    senderRejected = /sender/i.test(String(body.message ?? ''));
  } catch {
    // Not JSON: the status is enough.
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

// Checks the key without sending anything (used by `npm run mail:test`).
export const verifyBrevo = async () => {
  const response = await request(brevoAccountUrl, { method: 'GET', headers: headers() });
  if (!response.ok) throw await failureOf(response);
};
