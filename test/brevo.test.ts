import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { runMailTest } from '../src/mail-test.js';
import { BrevoError, brevoProblems, parseSender, sendWithBrevo } from '../src/services/brevo.js';
import { canSendMail, describeMailError, mailErrorHint, mailSetupProblems, sendMail, useMailTransport } from '../src/services/mailer.js';

const apiKey = 'xkeysib-clave-de-prueba-0123456789abcdef';
const useBrevo = () => Object.assign(config, { mailProvider: 'brevo-api', brevoApiKey: apiKey, mailFrom: 'StockBarrio <avisos@stockbarrio.co>', smtpHost: '' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface BrevoCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, any> | null;
}

// Responde las URL de Brevo con la función dada y deja pasar todas las demás peticiones (la API que se prueba).
const simulateBrevo = (answer: (call: BrevoCall) => Response | Promise<Response>) => {
  const calls: BrevoCall[] = [];
  const realFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.startsWith('https://api.brevo.com/')) return realFetch(input, init);
    const call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    if (init.signal?.aborted) throw init.signal.reason;
    return answer(call);
  });
  return calls;
};

const message = { to: 'ana@correo.co', subject: 'Cambia tu contraseña de StockBarrio', text: 'Hola, Ana: https://stockbarrio.app/reset-password?token=Zx9mQ2kLp4rT7vW1yB3nC5dF8gH0', html: '<p>Hola</p>' };

describe('Brevo transport', () => {
  const original = { ...config };
  beforeEach(useBrevo);
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
  });

  it('reads MAIL_FROM with or without a name', () => {
    assert.deepEqual(parseSender('StockBarrio <avisos@stockbarrio.co>'), { name: 'StockBarrio', email: 'avisos@stockbarrio.co' });
    assert.deepEqual(parseSender('"Tienda Doña Luz" <luz@stockbarrio.co>'), { name: 'Tienda Doña Luz', email: 'luz@stockbarrio.co' });
    assert.deepEqual(parseSender(' avisos@stockbarrio.co '), { name: 'StockBarrio', email: 'avisos@stockbarrio.co' });
    assert.equal(parseSender(''), null);
    assert.equal(parseSender('StockBarrio'), null);
  });

  it('sends the same text and HTML with the api-key header to Brevo', async () => {
    const calls = simulateBrevo(() => json(201, { messageId: '<abc@smtp-relay.mailin.fr>' }));
    await sendMail(message);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['api-key'], apiKey);
    assert.deepEqual(calls[0].body, {
      sender: { name: 'StockBarrio', email: 'avisos@stockbarrio.co' },
      to: [{ email: 'ana@correo.co' }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: '<p>Hola</p>',
    });
  });

  it('reports a wrong key as "Brevo 401" without the key, the recipient or the link', async () => {
    simulateBrevo(() => json(401, { code: 'unauthorized', message: `Key not found: ${apiKey}` }));
    const error = await sendWithBrevo(message).catch((caught: unknown) => caught);
    assert.ok(error instanceof BrevoError);
    const text = `${describeMailError(error)} ${(error as Error).message}`;
    assert.equal(describeMailError(error), 'Brevo 401 · unauthorized');
    for (const secret of [apiKey, 'ana@correo.co', 'reset-password', 'Zx9mQ2']) assert.equal(text.includes(secret), false, secret);
    assert.match(mailErrorHint(error), /Brevo rechazó BREVO_API_KEY.*Authorized IPs/);
  });

  it('explains a 400 for an unverified sender', async () => {
    simulateBrevo(() => json(400, { code: 'invalid_parameter', message: 'Sender avisos@stockbarrio.co is not valid. Validate your sender or domain.' }));
    const error = await sendWithBrevo(message).catch((caught: unknown) => caught);
    assert.equal(describeMailError(error), 'Brevo 400 · invalid_parameter');
    assert.match(mailErrorHint(error), /remitente verificado en Brevo/);
    simulateBrevo(() => json(400, { code: 'invalid_parameter', message: 'email is not valid in to' }));
    assert.match(mailErrorHint(await sendWithBrevo(message).catch((caught: unknown) => caught)), /correo de destino sea válido/);
  });

  it('gives up after the time limit', async () => {
    config.mailTimeoutMs = 50;
    const realFetch = globalThis.fetch;
    // El Brevo simulado nunca responde: la petición debe terminar por su señal de cancelación.
    mock.method(globalThis, 'fetch', (input: string | URL | Request, init: RequestInit = {}) =>
      String(input).startsWith('https://api.brevo.com/')
        ? new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
        : realFetch(input, init),
    );
    const started = Date.now();
    const error = await sendWithBrevo(message).catch((caught: unknown) => caught);
    assert.ok(Date.now() - started < 2000);
    assert.equal(describeMailError(error), 'Brevo · tiempo de espera agotado (0,1 s)');
    assert.match(mailErrorHint(error), /No se pudo conectar con la API de Brevo/);
  });

  it('reports a network failure with only its code', async () => {
    simulateBrevo(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND api.brevo.com ${apiKey}`), { code: 'ENOTFOUND' }) });
    });
    const error = await sendWithBrevo(message).catch((caught: unknown) => caught);
    assert.equal(describeMailError(error), 'Brevo · sin conexión (ENOTFOUND)');
  });

  it('is "not configured" without the key or a valid MAIL_FROM, and says so at startup', () => {
    Object.assign(config, { brevoApiKey: '', nodeEnv: 'production' });
    assert.equal(canSendMail(), false);
    assert.deepEqual(brevoProblems(), ['falta BREVO_API_KEY']);
    assert.match(mailSetupProblems()[0], /^MAIL_PROVIDER=brevo-api pero falta BREVO_API_KEY: no se enviarán correos\.$/);
    Object.assign(config, { brevoApiKey: apiKey, mailFrom: 'StockBarrio' });
    assert.equal(canSendMail(), false);
    assert.match(mailSetupProblems()[0], /MAIL_FROM debe tener el remitente verificado/);
    Object.assign(config, { mailFrom: 'avisos@stockbarrio.co' });
    assert.equal(canSendMail(), true);
    assert.deepEqual(mailSetupProblems(), []);
  });

  it('keeps SMTP as before when MAIL_PROVIDER is empty, and rejects an unknown provider', () => {
    Object.assign(config, { mailProvider: '', smtpHost: '', nodeEnv: 'development' });
    assert.equal(canSendMail(), true, 'console transport in development');
    Object.assign(config, { mailProvider: 'sendgrid' });
    assert.equal(canSendMail(), false);
    assert.match(mailSetupProblems()[0], /MAIL_PROVIDER="sendgrid" no es válido/);
  });
});

describe('npm run mail:test with Brevo', () => {
  const original = { ...config };
  beforeEach(useBrevo);
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
  });
  const capture = () => {
    const lines: string[] = [];
    return { lines, log: { info: (text: string) => lines.push(text), error: (text: string) => lines.push(text) } as unknown as Console };
  };

  it('checks the key, sends the test message and never prints the key', async () => {
    const calls = simulateBrevo((call) => (call.method === 'GET' ? json(200, { email: 'cuenta@stockbarrio.co' }) : json(201, { messageId: 'x' })));
    const { lines, log } = capture();
    assert.equal(await runMailTest('ana@correo.co', log), 0);
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), ['GET https://api.brevo.com/v3/account', 'POST https://api.brevo.com/v3/smtp/email']);
    const output = lines.join('\n');
    assert.match(output, /Transporte: API HTTPS de Brevo · API key: definida · remitente: StockBarrio <avisos@stockbarrio\.co>/);
    assert.match(output, /La API key de Brevo es válida/);
    assert.equal(output.includes(apiKey), false);
  });

  it('explains a rejected key and a missing configuration', async () => {
    simulateBrevo(() => json(401, { code: 'unauthorized', message: 'Key not found' }));
    const failed = capture();
    assert.equal(await runMailTest('ana@correo.co', failed.log), 1);
    assert.match(failed.lines.join('\n'), /No se pudo enviar el correo de prueba: Brevo 401 · unauthorized/);
    config.brevoApiKey = '';
    const missing = capture();
    assert.equal(await runMailTest('ana@correo.co', missing.log), 1);
    assert.match(missing.lines.join('\n'), /falta BREVO_API_KEY/);
  });
});

describe('password recovery through the Brevo API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call } = context;
  const original = { ...config };
  let visitor = 0;
  beforeEach(() => {
    context.clientIp = `10.9.0.${++visitor}`;
    useMailTransport(null);
    useBrevo();
    config.appUrl = 'https://stockbarrio.app';
  });
  afterEach(() => {
    Object.assign(config, original);
    mock.restoreAll();
  });

  const waitFor = async (calls: BrevoCall[], count: number) => {
    for (let attempt = 0; attempt < 100 && calls.length < count; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const register = async (suffix: string) => {
    const email = `brevo-${suffix}@stockbarrio.test`;
    assert.equal((await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Ana Pérez', email, password: 'cliente12345' })).status, 201);
    return email;
  };

  it('sends the same reset and "password changed" templates through Brevo', async () => {
    const calls = simulateBrevo(() => json(201, { messageId: 'x' }));
    const email = await register('ok');
    assert.equal((await call('POST', '/api/auth/forgot-password', { email })).status, 200);
    await waitFor(calls, 1);
    const reset = calls[0].body!;
    assert.deepEqual(reset.to, [{ email }]);
    assert.equal(reset.subject, 'Cambia tu contraseña de StockBarrio');
    assert.match(reset.textContent, /https:\/\/stockbarrio\.app\/reset-password\?token=[\w-]{40,}/);
    assert.match(reset.textContent, /vence en 30 minutos/);
    assert.match(reset.htmlContent, /^<!doctype html>/);
    assert.match(reset.htmlContent, /Si no fuiste tú, ignora este mensaje/);

    const token = /token=([\w-]+)/.exec(reset.textContent)![1];
    assert.equal((await call('POST', '/api/auth/reset-password', { token, password: 'NuevaClave2026' })).status, 200);
    await waitFor(calls, 2);
    assert.equal(calls[1].body!.subject, 'Tu contraseña de StockBarrio fue cambiada');
    assert.match(calls[1].body!.htmlContent, /href="https:\/\/stockbarrio\.app\/login"/);
  });

  it('answers the same when Brevo fails and logs only "Brevo 401"', async () => {
    simulateBrevo(() => json(401, { code: 'unauthorized', message: 'Key not found' }));
    const errors = mock.method(console, 'error', () => {});
    const email = await register('falla');
    const known = await call('POST', '/api/auth/forgot-password', { email });
    const unknown = await call('POST', '/api/auth/forgot-password', { email: 'nadie.brevo@stockbarrio.test' });
    assert.deepEqual([known.status, unknown.status], [200, 200]);
    assert.equal(known.body.message, unknown.body.message);
    for (let attempt = 0; attempt < 100 && !errors.mock.callCount(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    const logged = errors.mock.calls.map((entry) => entry.arguments.join(' ')).join('\n');
    assert.equal(logged, 'No se pudo enviar el correo de recuperación de contraseña: Brevo 401 · unauthorized');
  });

  it('answers "not configured" without BREVO_API_KEY and keeps the API working', async () => {
    const calls = simulateBrevo(() => json(201, {}));
    config.brevoApiKey = '';
    const email = await register('sin-clave');
    const result = await call('POST', '/api/auth/forgot-password', { email });
    assert.equal(result.status, 503);
    assert.match(result.body.message, /no está configurado/);
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal(calls.length, 0);
  });
});
