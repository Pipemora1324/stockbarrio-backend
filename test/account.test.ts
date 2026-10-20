import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { config } from '../src/config.js';
import { hashPassword } from '../src/services/auth.js';
import { useMailTransport, type MailMessage } from '../src/services/mailer.js';

describe('account API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call } = context;
  let outbox: MailMessage[] = [];
  const original = { ...config };

  let visitor = 0;
  beforeEach(() => {
    // Every test is a different visitor, so the per-IP limits of one test do not affect the next.
    context.clientIp = `10.0.0.${++visitor}`;
    outbox = [];
    useMailTransport(async (message) => {
      outbox.push(message);
    });
  });

  afterEach(() => {
    useMailTransport(null);
    Object.assign(config, original);
  });

  const registerCustomer = async (suffix: string, password = 'cliente12345') => {
    const email = `cuenta-${suffix}@stockbarrio.test`;
    const result = await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Ana Pérez', email, password });
    assert.equal(result.status, 201);
    return { email, password, token: result.body.token as string };
  };
  const waitForMail = async () => {
    for (let attempt = 0; attempt < 50 && !outbox.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    return outbox.at(-1)!;
  };
  const linkToken = (message: MailMessage) => /token=([\w-]+)/.exec(message.text)![1];

  it('answers the same way whether the email exists or not', async () => {
    const { email } = await registerCustomer('generico');
    const known = await call('POST', '/api/auth/forgot-password', { email });
    const unknown = await call('POST', '/api/auth/forgot-password', { email: 'nadie@stockbarrio.test' });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.body.message, unknown.body.message);
    const message = await waitForMail();
    assert.equal(outbox.length, 1);
    assert.equal(message.to, email);
    assert.match(message.text, /reset-password\?token=/);
  });

  it('stores only the hash of the token, uses it once and signs out old sessions', async () => {
    const { email, token: oldSession } = await registerCustomer('reset');
    await call('POST', '/api/auth/forgot-password', { email });
    const resetToken = linkToken(await waitForMail());
    const stored = await context.pool.query<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1');
    assert.notEqual(stored.rows[0].token_hash, resetToken);
    assert.equal(stored.rows[0].token_hash.length, 64);

    assert.equal((await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'corta' })).status, 400);
    const reset = await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'nuevaClave2026' });
    assert.equal(reset.status, 200);
    assert.equal((await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'otraClave2026' })).status, 400, 'single use');
    assert.equal((await call('GET', '/api/auth/me', undefined, oldSession)).status, 401, 'old sessions are closed');
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'nuevaClave2026' })).status, 200);
  });

  it('rejects expired reset links', async () => {
    const { email } = await registerCustomer('vencido');
    await call('POST', '/api/auth/forgot-password', { email });
    const resetToken = linkToken(await waitForMail());
    await context.pool.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'`);
    const result = await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'nuevaClave2026' });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /no es válido o ya venció/);
  });

  it('tells that email is not configured in production without SMTP', async () => {
    useMailTransport(null);
    Object.assign(config, { nodeEnv: 'production', smtpHost: '' });
    const result = await call('POST', '/api/auth/forgot-password', { email: 'alguien@stockbarrio.test' });
    assert.equal(result.status, 503);
    assert.match(result.body.message, /no está configurado/);
  });

  it('updates the name and the password, keeping only the current session', async () => {
    const { token, email } = await registerCustomer('perfil');
    const named = await call('PATCH', '/api/account/name', { name: 'Ana María Pérez' }, token);
    assert.equal(named.body.user.name, 'Ana María Pérez');
    assert.equal((await call('PATCH', '/api/account/name', { name: 'Ana 2' }, token)).status, 400);

    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'equivocada1', newPassword: 'nuevaClave2026' }, token)).status, 400);
    const changed = await call('POST', '/api/account/password', { currentPassword: 'cliente12345', newPassword: 'nuevaClave2026' }, token);
    assert.equal(changed.status, 200);
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 401, 'the old token stops working');
    assert.equal((await call('GET', '/api/auth/me', undefined, changed.body.token)).status, 200, 'the new token keeps the user signed in');
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'nuevaClave2026' })).status, 200);
  });

  it('changes the email only after confirming the new address', async () => {
    const { token, password } = await registerCustomer('correo');
    await registerCustomer('ocupado');
    assert.equal((await call('POST', '/api/account/email', { newEmail: 'cuenta-ocupado@stockbarrio.test', currentPassword: password }, token)).status, 409);
    const requested = await call('POST', '/api/account/email', { newEmail: 'Nuevo.Correo@stockbarrio.test', currentPassword: password }, token);
    assert.equal(requested.status, 200);
    await waitForMail();
    const confirmation = outbox.find((message) => message.to === 'nuevo.correo@stockbarrio.test')!;
    assert.ok(outbox.some((message) => message.to === 'cuenta-correo@stockbarrio.test' && /pidió cambiar el correo/.test(message.text)), 'the old address is warned');
    const profile = await call('GET', '/api/account', undefined, token);
    assert.deepEqual([profile.body.data.email, profile.body.data.pendingEmail], ['cuenta-correo@stockbarrio.test', 'nuevo.correo@stockbarrio.test']);

    const confirmed = await call('POST', '/api/account/email/confirm', { token: linkToken(confirmation) });
    assert.equal(confirmed.status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: 'nuevo.correo@stockbarrio.test', password })).status, 200);
    assert.equal((await call('POST', '/api/account/email/confirm', { token: linkToken(confirmation) })).status, 400);
  });

  it('keeps only the newest reset link and does not spend it on a rejected password', async () => {
    const { email } = await registerCustomer('ultimo');
    await call('POST', '/api/auth/forgot-password', { email });
    const first = linkToken(await waitForMail());
    outbox = [];
    await call('POST', '/api/auth/forgot-password', { email });
    const second = linkToken(await waitForMail());
    assert.equal((await call('POST', '/api/auth/reset-password', { token: first, password: 'nuevaClave2026' })).status, 400, 'the older link stops working');

    const sameAsEmail = await call('POST', '/api/auth/reset-password', { token: second, password: email });
    assert.equal(sameAsEmail.status, 400);
    assert.equal((await call('POST', '/api/auth/reset-password', { token: second, password: 'nuevaClave2026' })).status, 200, 'the link survives a rejected attempt');
  });

  it('does not accept a link of one kind for the other', async () => {
    const { token, password, email } = await registerCustomer('tipos');
    await call('POST', '/api/account/email', { newEmail: 'tipos.nuevo@stockbarrio.test', currentPassword: password }, token);
    await waitForMail();
    const emailLink = linkToken(outbox.find((message) => message.to === 'tipos.nuevo@stockbarrio.test')!);
    assert.equal((await call('POST', '/api/auth/reset-password', { token: emailLink, password: 'nuevaClave2026' })).status, 400);
    outbox = [];
    await call('POST', '/api/auth/forgot-password', { email });
    const resetLink = linkToken(await waitForMail());
    assert.equal((await call('POST', '/api/account/email/confirm', { token: resetLink })).status, 400);
    assert.equal((await call('POST', '/api/account/email/confirm', { token: 'x'.repeat(10) })).status, 400, 'too short');
  });

  it('rejects password changes that reuse the current password or the email', async () => {
    const { token, email } = await registerCustomer('igual');
    const same = await call('POST', '/api/account/password', { currentPassword: 'cliente12345', newPassword: 'cliente12345' }, token);
    assert.equal(same.status, 400);
    assert.match(same.body.message, /distinta de la actual/);
    const asEmail = await call('POST', '/api/account/password', { currentPassword: 'cliente12345', newPassword: email }, token);
    assert.equal(asEmail.status, 400);
    assert.equal((await call('POST', '/api/account/password', { newPassword: 'nuevaClave2026' }, token)).status, 400, 'the current password is required');
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 200, 'failed attempts keep the session');
  });

  it('asks for the right password and a different address before changing the email', async () => {
    const { token, email, password } = await registerCustomer('mismo');
    const wrong = await call('POST', '/api/account/email', { newEmail: 'otro.mismo@stockbarrio.test', currentPassword: 'equivocada1' }, token);
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.message, /contraseña actual no es correcta/);
    const same = await call('POST', '/api/account/email', { newEmail: email.toUpperCase(), currentPassword: password }, token);
    assert.equal(same.status, 400);
    assert.match(same.body.message, /igual al actual/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(outbox.length, 0, 'nothing is sent for rejected requests');
  });

  it('does not confirm an email that another account took in the meantime', async () => {
    const { token, password } = await registerCustomer('carrera');
    await call('POST', '/api/account/email', { newEmail: 'disputado@stockbarrio.test', currentPassword: password }, token);
    await waitForMail();
    const link = linkToken(outbox.find((message) => message.to === 'disputado@stockbarrio.test')!);
    await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Quien Llegó Antes', email: 'disputado@stockbarrio.test', password: 'cliente12345' });
    const result = await call('POST', '/api/account/email/confirm', { token: link });
    assert.equal(result.status, 409);
    const profile = await call('GET', '/api/account', undefined, token);
    assert.equal(profile.status, 200, 'the session stays open because nothing changed');
    assert.equal(profile.body.data.email, 'cuenta-carrera@stockbarrio.test');
  });

  it('closes every open session after the email changes', async () => {
    const { token, password, email } = await registerCustomer('sesiones');
    const otherDevice = (await call('POST', '/api/auth/login', { email, password })).body.token as string;
    await call('POST', '/api/account/email', { newEmail: 'sesiones.nuevo@stockbarrio.test', currentPassword: password }, token);
    await waitForMail();
    await call('POST', '/api/account/email/confirm', { token: linkToken(outbox.find((message) => message.to === 'sesiones.nuevo@stockbarrio.test')!) });
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 401);
    assert.equal((await call('GET', '/api/auth/me', undefined, otherDevice)).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email, password })).status, 401, 'the old email no longer signs in');
  });

  it('needs a session for every profile endpoint', async () => {
    for (const [method, path] of [['GET', '/api/account'], ['PATCH', '/api/account/name'], ['POST', '/api/account/password'], ['POST', '/api/account/email']])
      assert.equal((await call(method, path, method === 'GET' ? undefined : {})).status, 401, `${method} ${path}`);
  });

  it('limits reset requests per visitor and per email', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) assert.equal((await call('POST', '/api/auth/forgot-password', { email: `limite-${attempt}@stockbarrio.test` })).status, 200);
    const perIp = await call('POST', '/api/auth/forgot-password', { email: 'limite-6@stockbarrio.test' });
    assert.equal(perIp.status, 429);
    assert.match(perIp.body.message, /demasiadas solicitudes/);

    // From many addresses, a single inbox still gets at most three requests per hour.
    const statuses = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      context.clientIp = `10.1.0.${attempt}`;
      statuses.push((await call('POST', '/api/auth/forgot-password', { email: attempt % 2 ? 'Inundada@stockbarrio.test' : ' inundada@StockBarrio.test' })).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  const waitForMails = async (count: number) => {
    for (let attempt = 0; attempt < 100 && outbox.length < count; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    return outbox;
  };

  it('runs the whole recovery: link from APP_URL in text and HTML, new password, notice and closed sessions', async () => {
    config.appUrl = 'https://stockbarrio.app';
    const { email, token: oldSession } = await registerCustomer('completo');
    const answer = await call('POST', '/api/auth/forgot-password', { email: email.toUpperCase() });
    assert.equal(answer.status, 200);
    const [resetMail] = await waitForMails(1);
    assert.equal(resetMail.to, email);
    assert.match(resetMail.text, /https:\/\/stockbarrio\.app\/reset-password\?token=[\w-]{40,}/);
    assert.match(resetMail.html!, /href="https:\/\/stockbarrio\.app\/reset-password\?token=[\w-]{40,}"/);
    assert.match(resetMail.text, /vence en 30 minutos/);
    assert.match(resetMail.text, /Si no fuiste tú, ignora este mensaje/);

    const reset = await call('POST', '/api/auth/reset-password', { token: linkToken(resetMail), password: 'NuevaClave2026' });
    assert.equal(reset.status, 200);
    const [, notice] = await waitForMails(2);
    assert.equal(notice.to, email);
    assert.equal(notice.subject, 'Tu contraseña de StockBarrio fue cambiada');
    assert.match(notice.text, /https:\/\/stockbarrio\.app\/login/);
    assert.doesNotMatch(notice.text, /token=/, 'the notice has no reset link');

    assert.equal((await call('GET', '/api/auth/me', undefined, oldSession)).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'cliente12345' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'NuevaClave2026' })).status, 200);
  });

  it('answers the same when SMTP fails and logs no address, link, token or password', async () => {
    config.smtpPass = 'clave-smtp-secreta';
    const { email } = await registerCustomer('smtp-caido');
    let attempted = '';
    useMailTransport(async (message) => {
      attempted = message.text;
      throw Object.assign(new Error(`Greeting never received for ${message.text} with clave-smtp-secreta`), { code: 'ETIMEDOUT', command: 'CONN' });
    });
    const errors = mock.method(console, 'error', () => {});
    const known = await call('POST', '/api/auth/forgot-password', { email });
    const unknown = await call('POST', '/api/auth/forgot-password', { email: 'nadie.smtp@stockbarrio.test' });
    assert.deepEqual([known.status, unknown.status], [200, 200]);
    assert.equal(known.body.message, unknown.body.message);
    for (let attempt = 0; attempt < 100 && !errors.mock.callCount(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    const logged = errors.mock.calls.map((entry) => entry.arguments.join(' ')).join('\n');
    assert.match(logged, /No se pudo enviar el correo de recuperación de contraseña: ETIMEDOUT/);
    const token = /token=([\w-]+)/.exec(attempted)![1];
    for (const secret of [token, 'reset-password', email, 'clave-smtp-secreta']) assert.equal(logged.includes(secret), false, secret);
  });

  it('builds the link only from APP_URL, never from the host of the request', async () => {
    config.appUrl = 'https://stockbarrio.app';
    const { email } = await registerCustomer('host');
    const response = await fetch(`${context.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'atacante.example', 'X-Forwarded-Host': 'atacante.example', 'X-Forwarded-Proto': 'http', Origin: 'https://atacante.example' },
      body: JSON.stringify({ email }),
    });
    assert.equal(response.status, 200);
    const [mail] = await waitForMails(1);
    assert.match(mail.text, /https:\/\/stockbarrio\.app\/reset-password\?token=/);
    assert.equal(mail.text.includes('atacante'), false);
    assert.equal(mail.html!.includes('atacante'), false);
  });

  it('finds an older account saved with capital letters by the email it was created with', async () => {
    await context.pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Cuenta Vieja', 'Cuenta.Vieja@StockBarrio.test', $1, 'customer')`, [await hashPassword('vieja12345')]);
    await call('POST', '/api/auth/forgot-password', { email: 'cuenta.vieja@stockbarrio.test' });
    const [mail] = await waitForMails(1);
    assert.equal(mail.to, 'Cuenta.Vieja@StockBarrio.test');
    assert.equal((await call('POST', '/api/auth/reset-password', { token: linkToken(mail), password: 'NuevaVieja2026' })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: ' CUENTA.vieja@stockbarrio.test ', password: 'NuevaVieja2026' })).status, 200);
  });

  it('tells that email is not configured in production without APP_URL, instead of mailing links to localhost', async () => {
    Object.assign(config, { nodeEnv: 'production', appUrlConfigured: false });
    const { email } = await registerCustomer('sin-app-url');
    const result = await call('POST', '/api/auth/forgot-password', { email });
    assert.equal(result.status, 503);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(outbox.length, 0);
  });

  it('also warns by email when the password is changed from the profile', async () => {
    const { token, email } = await registerCustomer('aviso-perfil');
    await call('POST', '/api/account/password', { currentPassword: 'cliente12345', newPassword: 'nuevaClave2026' }, token);
    const [mail] = await waitForMails(1);
    assert.deepEqual([mail.to, mail.subject], [email, 'Tu contraseña de StockBarrio fue cambiada']);
  });
});
