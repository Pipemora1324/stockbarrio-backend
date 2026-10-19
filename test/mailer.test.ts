import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import nodemailer from 'nodemailer';
import { config } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { canSendMail, sendMail, useMailTransport } from '../src/services/mailer.js';

const message = { to: 'ana@correo.co', subject: 'Prueba', text: 'Hola' };

describe('mailer', () => {
  const original = { ...config };
  afterEach(() => {
    Object.assign(config, original);
    useMailTransport(null);
    mock.restoreAll();
  });

  it('prints the message in development when there is no SMTP', async () => {
    Object.assign(config, { nodeEnv: 'development', smtpHost: '' });
    const info = mock.method(console, 'info', () => {});
    assert.equal(canSendMail(), true);
    await sendMail(message);
    assert.match(String(info.mock.calls[0].arguments[0]), /\[correo de desarrollo\] Para: ana@correo\.co\nAsunto: Prueba\nHola/);
  });

  it('refuses to send in production without SMTP, with a 503 in Spanish', async () => {
    Object.assign(config, { nodeEnv: 'production', smtpHost: '' });
    assert.equal(canSendMail(), false);
    await assert.rejects(sendMail(message), (error: unknown) => error instanceof AppError && error.status === 503 && /no está configurado/.test(error.message));
  });

  it('sends through SMTP with the configured sender, reusing one connection', async () => {
    Object.assign(config, { nodeEnv: 'production', smtpHost: 'smtp.simulado', smtpPort: 465, smtpUser: 'avisos', smtpPass: 'clave-smtp', mailFrom: 'StockBarrio <avisos@stockbarrio.co>' });
    const sent: unknown[] = [];
    const createTransport = mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (mail: unknown) => sent.push(mail) }));
    await sendMail(message);
    await sendMail({ ...message, to: 'luis@correo.co' });
    assert.equal(createTransport.mock.callCount(), 1);
    assert.deepEqual(createTransport.mock.calls[0].arguments[0], { host: 'smtp.simulado', port: 465, secure: true, auth: { user: 'avisos', pass: 'clave-smtp' } });
    assert.deepEqual(sent[0], { from: 'StockBarrio <avisos@stockbarrio.co>', to: 'ana@correo.co', subject: 'Prueba', text: 'Hola' });
    assert.equal((sent[1] as { to: string }).to, 'luis@correo.co');
  });

  it('lets tests capture messages instead of sending them', async () => {
    const outbox: unknown[] = [];
    useMailTransport(async (mail) => {
      outbox.push(mail);
    });
    Object.assign(config, { nodeEnv: 'production', smtpHost: '' });
    assert.equal(canSendMail(), true);
    await sendMail(message);
    assert.deepEqual(outbox, [message]);
  });
});
