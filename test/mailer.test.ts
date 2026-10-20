import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import nodemailer from 'nodemailer';
import { config } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { runMailTest } from '../src/mail-test.js';
import { passwordChangedMail, passwordResetMail } from '../src/services/mail-templates.js';
import { canSendMail, describeMailError, mailErrorHint, resetSmtpTransport, senderAddress, sendMail, smtpOptions, smtpPassword, useMailTransport } from '../src/services/mailer.js';

const message = { to: 'ana@correo.co', subject: 'Prueba', text: 'Hola' };
const smtpError = (code: string, responseCode?: number, text = 'fallo') => Object.assign(new Error(text), { code, responseCode, command: 'AUTH PLAIN' });

// Cada prueba recibe un transporte nuevo de nodemailer, porque el módulo guarda uno por proceso.
let reset = 0;
const freshMailer = async () => import(`../src/services/mailer.js?fresh=${++reset}`) as Promise<typeof import('../src/services/mailer.js')>;

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

  it('refuses to send in production without SMTP, with a 503 in Spanish, and never prints the message', async () => {
    Object.assign(config, { nodeEnv: 'production', smtpHost: '' });
    const info = mock.method(console, 'info', () => {});
    assert.equal(canSendMail(), false);
    await assert.rejects(sendMail(message), (error: unknown) => error instanceof AppError && error.status === 503 && /no está configurado/.test(error.message));
    assert.equal(info.mock.callCount(), 0);
  });

  it('uses TLS on 465 and requires STARTTLS on 587, with 10 s timeouts', () => {
    Object.assign(config, { smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, smtpUser: 'tienda@gmail.com', smtpPass: 'abcdefghijklmnop' });
    assert.deepEqual(smtpOptions(), {
      host: 'smtp.gmail.com', port: 465, secure: true, requireTLS: false, auth: { user: 'tienda@gmail.com', pass: 'abcdefghijklmnop' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    });
    Object.assign(config, { smtpHost: 'smtp-relay.brevo.com', smtpPort: 587, smtpSecure: false, smtpUser: '9a1b2c001@smtp-brevo.com' });
    assert.deepEqual([smtpOptions().secure, smtpOptions().requireTLS], [false, true]);
    Object.assign(config, { smtpHost: 'localhost', smtpPort: 1025, smtpSecure: false, smtpUser: '' });
    assert.deepEqual([smtpOptions().requireTLS, smtpOptions().auth], [false, undefined], 'a local test server without TLS still works');
  });

  it('removes the spaces Gmail shows in app passwords, only for Gmail', () => {
    Object.assign(config, { smtpHost: 'smtp.gmail.com', smtpPass: 'abcd efgh ijkl mnop' });
    assert.equal(smtpPassword(), 'abcdefghijklmnop');
    Object.assign(config, { smtpHost: 'smtp-relay.brevo.com', smtpPass: 'clave con espacios' });
    assert.equal(smtpPassword(), 'clave con espacios');
  });

  it('sends from MAIL_FROM, or from the authenticated account when it is empty', () => {
    Object.assign(config, { mailFrom: 'StockBarrio <avisos@stockbarrio.co>', smtpUser: 'tienda@gmail.com' });
    assert.equal(senderAddress(), 'StockBarrio <avisos@stockbarrio.co>');
    Object.assign(config, { mailFrom: '' });
    assert.equal(senderAddress(), 'StockBarrio <tienda@gmail.com>');
    Object.assign(config, { smtpUser: '9a1b2c001' });
    assert.equal(senderAddress(), 'StockBarrio <no-responder@stockbarrio.local>');
  });

  it('sends text and HTML through SMTP with the configured sender, reusing one connection', async () => {
    Object.assign(config, { nodeEnv: 'production', smtpHost: 'smtp.simulado', smtpPort: 465, smtpSecure: true, smtpUser: 'avisos', smtpPass: 'clave-smtp', mailFrom: 'StockBarrio <avisos@stockbarrio.co>' });
    const sent: Array<Record<string, unknown>> = [];
    const createTransport = mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (mail: Record<string, unknown>) => sent.push(mail) }));
    const mailer = await freshMailer();
    await mailer.sendMail({ ...message, html: '<p>Hola</p>' });
    await mailer.sendMail({ ...message, to: 'luis@correo.co' });
    assert.equal(createTransport.mock.callCount(), 1);
    assert.equal((createTransport.mock.calls[0].arguments[0] as { secure: boolean }).secure, true);
    assert.deepEqual(sent[0], { from: 'StockBarrio <avisos@stockbarrio.co>', to: 'ana@correo.co', subject: 'Prueba', text: 'Hola', html: '<p>Hola</p>' });
    assert.equal(sent[1].to, 'luis@correo.co');
  });

  it('describes failures without the password, links or tokens', () => {
    Object.assign(config, { smtpHost: 'smtp.gmail.com', smtpPass: 'abcd efgh ijkl mnop' });
    const error = smtpError('EAUTH', 535, 'Invalid login abcdefghijklmnop for https://stockbarrio.app/reset-password?token=Zx9_long-token-value-1234567890 at abcd efgh ijkl mnop');
    const text = describeMailError(error);
    assert.match(text, /^EAUTH · SMTP 535 · comando AUTH PLAIN · Invalid login/);
    assert.doesNotMatch(text, /abcdefghijklmnop|abcd efgh|https:|token=|Zx9_/);
    assert.equal(describeMailError('raro'), 'error desconocido');
  });

  it('explains the usual Gmail and Brevo problems in Spanish', () => {
    assert.match(mailErrorHint(smtpError('EAUTH', 535)), /contraseña de aplicación de 16 caracteres.*verificación en 2 pasos/);
    assert.match(mailErrorHint(smtpError('ETIMEDOUT')), /SMTP_SECURE sea true con el puerto 465/);
    assert.match(mailErrorHint(smtpError('EENVELOPE', 550)), /remitente verificado/);
    assert.match(mailErrorHint(new Error('otro')), /Revisa las variables/);
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

describe('mail templates', () => {
  it('writes the reset mail in Spanish, in text and HTML, with the link, the 30 minutes and the warning', () => {
    const mail = passwordResetMail('Ana <Pérez>', 'https://stockbarrio.app/reset-password?token=abc', 30);
    assert.equal(mail.subject, 'Cambia tu contraseña de StockBarrio');
    for (const body of [mail.text, mail.html!]) {
      assert.match(body, /https:\/\/stockbarrio\.app\/reset-password\?token=abc/);
      assert.match(body, /vence en (<strong>)?30 minutos/);
      assert.match(body, /Si no fuiste tú, ignora este mensaje/);
    }
    assert.match(mail.html!, /Ana &lt;Pérez&gt;/, 'names are escaped in HTML');
    assert.match(mail.html!, /^<!doctype html>\n<html lang="es">/);
  });

  it('writes the "password changed" notice with a link to the login', () => {
    const mail = passwordChangedMail('Ana', 'https://stockbarrio.app/login');
    assert.equal(mail.subject, 'Tu contraseña de StockBarrio fue cambiada');
    assert.match(mail.text, /fue cambiada y cerramos las sesiones/);
    assert.match(mail.text, /Si no fuiste tú/);
    assert.match(mail.html!, /href="https:\/\/stockbarrio\.app\/login"/);
  });
});

describe('npm run mail:test', () => {
  const original = { ...config };
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
    resetSmtpTransport();
  });
  const capture = () => {
    const lines: string[] = [];
    return { lines, log: { info: (text: string) => lines.push(text), error: (text: string) => lines.push(text) } as unknown as Console };
  };

  it('asks for a destination and for SMTP_HOST', async () => {
    const first = capture();
    assert.equal(await runMailTest(undefined, first.log), 1);
    assert.match(first.lines[0], /npm run mail:test -- tucorreo@ejemplo\.com/);
    Object.assign(config, { smtpHost: '' });
    const second = capture();
    assert.equal(await runMailTest('ana@correo.co', second.log), 1);
    assert.match(second.lines[0], /SMTP_HOST no está definido/);
  });

  it('verifies the login and sends one test message with the current configuration', async () => {
    Object.assign(config, { smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, smtpUser: 'tienda@gmail.com', smtpPass: 'abcd efgh ijkl mnop', mailFrom: '', appUrl: 'https://stockbarrio.app' });
    const sent: Array<Record<string, string>> = [];
    let verified = 0;
    mock.method(nodemailer, 'createTransport', (options: { auth: { pass: string } }) => {
      assert.equal(options.auth.pass, 'abcdefghijklmnop');
      return { verify: async () => verified++, sendMail: async (mail: Record<string, string>) => sent.push(mail) };
    });
    const { lines, log } = capture();
    assert.equal(await runMailTest('ana@correo.co', log), 0);
    assert.equal(verified, 1);
    assert.deepEqual([sent[0].to, sent[0].from, sent[0].subject], ['ana@correo.co', 'StockBarrio <tienda@gmail.com>', 'Correo de prueba de StockBarrio']);
    assert.match(sent[0].text, /https:\/\/stockbarrio\.app/);
    const output = lines.join('\n');
    assert.match(output, /smtp\.gmail\.com:465 \(TLS directo\)/);
    assert.match(output, /Listo: se envió un correo de prueba a ana@correo\.co/);
    assert.doesNotMatch(output, /abcd|mnop/);
  });

  it('shows a clear error without printing the password', async () => {
    Object.assign(config, { smtpHost: '127.0.0.1', smtpPort: 1, smtpSecure: false, smtpUser: 'tienda@gmail.com', smtpPass: 'clave-super-secreta', mailTimeoutMs: 2000 });
    const unreachable = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1 clave-super-secreta'), { code: 'ESOCKET', command: 'CONN' });
    mock.method(nodemailer, 'createTransport', () => ({ verify: async () => { throw unreachable; } }));
    const { lines, log } = capture();
    assert.equal(await runMailTest('ana@correo.co', log), 1);
    const output = lines.join('\n');
    assert.match(output, /contraseña: definida/);
    assert.match(output, /No se pudo enviar el correo de prueba: /);
    assert.match(output, /No se pudo conectar con el servidor SMTP/);
    assert.doesNotMatch(output, /clave-super-secreta/);
  });
});
