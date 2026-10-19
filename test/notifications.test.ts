import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { addDays, todayInBogota } from '../src/dates.js';
import { buildNotificationText, matchesPlace, matchesProduct, type DiscountedProduct } from '../src/services/notifications.js';

const store = { name: 'Tienda Doña Luz', neighborhood: 'Chapinero' };
const product: DiscountedProduct = { id: 'p', name: 'Huevos AA x 30', category: 'Huevos', offerPrice: 12950, discountPercent: 30, expirationDate: '2026-10-21', store };

describe('alert matching', () => {
  it('matches by product words, plurals and category', () => {
    assert.equal(matchesProduct({ query: 'huevos', category: null }, product), true);
    assert.equal(matchesProduct({ query: 'huevo aa', category: null }, product), true);
    assert.equal(matchesProduct({ query: 'leche', category: null }, product), false);
    assert.equal(matchesProduct({ query: null, category: 'huevos' }, product), true);
    assert.equal(matchesProduct({ query: 'huevos', category: 'Lácteos' }, product), false);
  });

  it('matches by neighborhood only, ignoring letter case and accents', () => {
    assert.equal(matchesPlace({ neighborhood: 'chapinero' }, store), true);
    assert.equal(matchesPlace({ neighborhood: 'Suba' }, store), false);
    assert.equal(matchesPlace({ neighborhood: null }, store), true, 'without neighborhood it matches every store');
    assert.equal(matchesPlace({ neighborhood: 'Usaquén' }, { ...store, neighborhood: 'usaquen' }), true);
  });

  it('writes a short Spanish message with store, product and price, without distances', () => {
    const text = buildNotificationText(product, '2026-10-18');
    assert.equal(text.title, '30 % de descuento en Huevos AA x 30');
    assert.equal(text.message, 'Tienda Doña Luz (Chapinero) tiene Huevos AA x 30 a $ 12.950. Vence en 3 días.');
  });
});

describe('alerts and notifications API', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();
  const originalLimit = config.notificationsDailyLimit;

  beforeEach(() => {
    config.enableAlerts = true;
  });

  afterEach(() => {
    config.notificationsDailyLimit = originalLimit;
    config.enableAlerts = false;
  });

  const registerCustomer = async (suffix: string) => {
    const result = await call('POST', '/api/auth/register', { accountType: 'customer', name: `Cliente ${suffix}`, email: `cliente-${suffix}@stockbarrio.test`, password: 'cliente12345' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body as { token: string; user: { role: string } };
  };

  // Creates a product about to expire and approves the suggested discount, which triggers the notifications.
  const approveDiscountFor = async (token: string, name: string, category = 'Huevos') => {
    await call('POST', '/api/products', { name, category, price: 18500, stock: 30, expirationDate: addDays(today, 3), discountPercent: 0 }, token);
    const suggestions = (await call('GET', '/api/suggestions', undefined, token)).body.data as Array<{ id: string; productName: string }>;
    const suggestion = suggestions.find((item) => item.productName === name)!;
    return call('POST', `/api/suggestions/${suggestion.id}/approve`, undefined, token);
  };

  it('registers customers but never admins', async () => {
    const customer = await registerCustomer('uno');
    assert.equal(customer.user.role, 'customer');
    const admin = await call('POST', '/api/auth/register', { accountType: 'admin', name: 'Colado', email: 'colado@stockbarrio.test', password: '12345678' });
    assert.equal(admin.status, 400);
    assert.equal((await context.pool.query(`SELECT 1 FROM users WHERE role = 'admin'`)).rowCount, 0);
  });

  it('never saves a position for an alert, even if an older client sends one', async () => {
    const { token } = await registerCustomer('consent');
    const saved = await call('POST', '/api/alerts', { query: 'leche', neighborhood: 'Chapinero', latitude: 4.641234, longitude: -74.063612, radiusKm: 2, locationConsent: true }, token);
    assert.equal(saved.status, 201);
    assert.doesNotMatch(JSON.stringify(saved.body), /latitude|longitude|radius/);
    const stored = await context.pool.query('SELECT latitude, longitude, radius_km FROM alert_subscriptions WHERE id = $1', [saved.body.data.id]);
    assert.deepEqual(stored.rows[0], { latitude: null, longitude: null, radius_km: null });
    assert.equal((await call('POST', '/api/alerts', { minDiscount: 10 }, token)).status, 400);
  });

  it('notifies matching customers once when a store approves a discount', async () => {
    const shop = await registerStore('noti-tienda', { neighborhood: 'Chapinero' });
    const byProduct = await registerCustomer('huevos');
    const oldRadius = await registerCustomer('radio');
    const otherPlace = await registerCustomer('suba');
    const tooDemanding = await registerCustomer('exigente');
    await call('POST', '/api/alerts', { query: 'huevos', neighborhood: 'Chapinero' }, byProduct.token);
    await call('POST', '/api/alerts', { category: 'Huevos' }, byProduct.token);
    // An alert saved by radius before this change has no place filter left, so it is not used.
    const old = await call('POST', '/api/alerts', { query: 'huevos' }, oldRadius.token);
    await context.pool.query('UPDATE alert_subscriptions SET latitude = 4.64, longitude = -74.064, radius_km = 1 WHERE id = $1', [old.body.data.id]);
    await call('POST', '/api/alerts', { query: 'huevos', neighborhood: 'Suba' }, otherPlace.token);
    await call('POST', '/api/alerts', { query: 'huevos', minDiscount: 80 }, tooDemanding.token);

    const approved = await approveDiscountFor(shop.token, 'Huevos AA x 30');
    assert.equal(approved.status, 200);
    assert.equal(approved.body.notified, 1);

    const inbox = await call('GET', '/api/notifications', undefined, byProduct.token);
    assert.equal(inbox.body.data.length, 1, 'two matching alerts of the same person produce a single notice');
    assert.equal(inbox.body.unread, 1);
    assert.match(inbox.body.data[0].message, /^Tienda noti-tienda \(Chapinero\) tiene Huevos AA x 30 a \$ \d{1,3}\.\d{3}\. Vence en 3 días\.$/);
    assert.equal((await call('GET', '/api/notifications', undefined, oldRadius.token)).body.data.length, 0);
    assert.equal((await call('GET', '/api/notifications', undefined, otherPlace.token)).body.data.length, 0);
    assert.equal((await call('GET', '/api/notifications', undefined, tooDemanding.token)).body.data.length, 0);
  });

  it('does not repeat a notice for the same product and respects the daily limit', async () => {
    const shop = await registerStore('noti-limite');
    const customer = await registerCustomer('limite');
    await call('POST', '/api/alerts', { query: 'leche' }, customer.token);
    config.notificationsDailyLimit = 1;

    await approveDiscountFor(shop.token, 'Leche entera 1 L', 'Lácteos');
    // A bigger discount later on the same product does not send a second notice.
    const productId = (await call('GET', '/api/products/mine', undefined, shop.token)).body.data[0].id as string;
    await call('PUT', `/api/products/${productId}`, { discountPercent: 0, expirationDate: today }, shop.token);
    const again = (await call('GET', '/api/suggestions', undefined, shop.token)).body.data[0];
    assert.equal((await call('POST', `/api/suggestions/${again.id}/approve`, undefined, shop.token)).body.notified, 0);

    const second = await approveDiscountFor(shop.token, 'Leche deslactosada 1 L', 'Lácteos');
    assert.equal(second.body.notified, 0, 'the daily limit of 1 is already used');
    assert.equal((await call('GET', '/api/notifications', undefined, customer.token)).body.data.length, 1);
  });

  it('marks notifications as read', async () => {
    const shop = await registerStore('noti-leer');
    const customer = await registerCustomer('leer');
    await call('POST', '/api/alerts', { query: 'arepa' }, customer.token);
    await approveDiscountFor(shop.token, 'Arepas de maíz x 5', 'Panadería');
    const [notification] = (await call('GET', '/api/notifications', undefined, customer.token)).body.data;
    assert.equal((await call('GET', '/api/notifications/unread-count', undefined, customer.token)).body.unread, 1);
    assert.equal((await call('POST', `/api/notifications/${notification.id}/read`, undefined, customer.token)).body.unread, 0);
    assert.equal((await call('POST', `/api/notifications/${notification.id}/read`, undefined, shop.token)).status, 403);
  });

  it('keeps each role in its own area', async () => {
    const shop = await registerStore('noti-roles');
    const customer = await registerCustomer('roles');
    assert.equal((await call('GET', '/api/alerts', undefined, shop.token)).status, 403);
    assert.equal((await call('GET', '/api/suggestions', undefined, customer.token)).status, 403);
    assert.equal((await call('POST', '/api/products', { name: 'Pan', price: 1000, stock: 1, expirationDate: today, discountPercent: 0 }, customer.token)).status, 403);
  });

  it('creates no notifications while ENABLE_ALERTS is off', async () => {
    config.enableAlerts = false;
    const shop = await registerStore('noti-apagado');
    const customer = await registerCustomer('apagado');
    await call('POST', '/api/alerts', { query: 'yogur' }, customer.token);
    const approved = await approveDiscountFor(shop.token, 'Yogur de fresa', 'Lácteos');
    assert.equal(approved.status, 200);
    assert.equal(approved.body.notified, 0);
    assert.equal((await call('GET', '/api/notifications', undefined, customer.token)).body.data.length, 0);
  });

  it('lets a customer delete an alert', async () => {
    const customer = await registerCustomer('borrar');
    const created = await call('POST', '/api/alerts', { query: 'queso' }, customer.token);
    assert.equal((await call('DELETE', `/api/alerts/${created.body.data.id}`, undefined, customer.token)).status, 200);
    assert.equal((await call('GET', '/api/alerts', undefined, customer.token)).body.data.length, 0);
  });
});
