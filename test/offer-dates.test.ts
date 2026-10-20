import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';

describe('offers with a date range, catalog and expiration', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();
  const base = { category: 'Lácteos', price: 10000, stock: 8, expirationDate: addDays(today, 6) };
  let seller: Awaited<ReturnType<typeof registerStore>>;

  before(async () => {
    seller = await registerStore('fechas', { storeName: 'Tienda Fechas', neighborhood: 'Chapinero' });
  });

  const create = (body: Record<string, unknown>, token = seller.token) => call('POST', '/api/products', { ...base, ...body }, token);
  const offerNames = async (body: Record<string, unknown> = {}) => (await call('POST', '/api/offers/search', body)).body.data.map((item: { name: string }) => item.name);
  const setRange = (id: string, startsOn: string, endsOn: string) => context.pool.query('UPDATE products SET offer_starts_on = $2, offer_ends_on = $3 WHERE id = $1', [id, startsOn, endsOn]);

  it('saves an offer from today until the expiration day', async () => {
    const result = await create({ name: 'Leche hoy', discountPercent: 20, offerStartsOn: today, offerEndsOn: base.expirationDate });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.deepEqual([result.body.data.offerStartsOn, result.body.data.offerEndsOn, result.body.data.offerStatus], [today, base.expirationDate, 'active']);
    assert.ok((await offerNames()).includes('Leche hoy'));
    const [offer] = (await call('POST', '/api/offers/search', { search: 'leche hoy' })).body.data;
    assert.deepEqual([offer.offerEndsOn, offer.offerDaysLeft], [base.expirationDate, 6]);
  });

  it('rejects the ranges that break the rules, with messages in Spanish', async () => {
    const yesterday = await create({ name: 'Ayer', discountPercent: 20, offerStartsOn: addDays(today, -1), offerEndsOn: addDays(today, 2) });
    assert.equal(yesterday.status, 400);
    assert.equal(yesterday.body.message, 'La fecha de inicio de la oferta no puede ser anterior a hoy.');
    const backwards = await create({ name: 'Al revés', discountPercent: 20, offerStartsOn: addDays(today, 3), offerEndsOn: addDays(today, 2) });
    assert.equal(backwards.body.message, 'La fecha de finalización no puede ser anterior a la fecha de inicio.');
    const tooLong = await create({ name: 'Muy larga', discountPercent: 20, offerStartsOn: today, offerEndsOn: addDays(today, 7) });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.message, /^La oferta no puede terminar después del vencimiento del producto \(\d{2}\/\d{2}\/\d{4}\)\.$/);
    const badDate = await create({ name: 'Fecha rara', discountPercent: 20, offerStartsOn: '2026-02-30' });
    assert.equal(badDate.status, 400);
    assert.match(badDate.body.message, /Fecha de inicio|La fecha no es válida/);
  });

  it('never lets an expired product have an offer', async () => {
    const created = await create({ name: 'Kumis viejo', discountPercent: 0 });
    await context.pool.query('UPDATE products SET expiration_date = $2 WHERE id = $1', [created.body.data.id, addDays(today, -1)]);
    const offer = await call('PUT', `/api/products/${created.body.data.id}`, { discountPercent: 30 }, seller.token);
    assert.equal(offer.status, 400);
    assert.equal(offer.body.message, 'Un producto vencido no puede tener oferta. Quita el descuento o corrige la fecha de vencimiento.');
    // Fixing the stock of that product still works.
    assert.equal((await call('PUT', `/api/products/${created.body.data.id}`, { stock: 2 }, seller.token)).status, 200);
    assert.equal((await call('GET', '/api/products/mine', undefined, seller.token)).body.data.find((item: { name: string }) => item.name === 'Kumis viejo').expired, true);
  });

  it('gives older clients that only send the percent the default range', async () => {
    const created = await create({ name: 'Cliente viejo', discountPercent: 15 });
    assert.deepEqual([created.body.data.offerStartsOn, created.body.data.offerEndsOn], [today, base.expirationDate]);
    // Editing other fields keeps the range, and removing the discount clears it.
    const edited = await call('PUT', `/api/products/${created.body.data.id}`, { ...base, name: 'Cliente viejo', discountPercent: 15, stock: 3 }, seller.token);
    assert.deepEqual([edited.body.data.offerStartsOn, edited.body.data.offerEndsOn], [today, base.expirationDate]);
    const cleared = await call('PUT', `/api/products/${created.body.data.id}`, { discountPercent: 0 }, seller.token);
    assert.deepEqual([cleared.body.data.offerStartsOn, cleared.body.data.offerEndsOn, cleared.body.data.offerStatus], [null, null, 'none']);
  });

  it('schedules an offer that only shows from its first day', async () => {
    const created = await create({ name: 'Yogur programado', discountPercent: 25, offerStartsOn: addDays(today, 2), offerEndsOn: addDays(today, 4) });
    assert.equal(created.body.data.offerStatus, 'scheduled');
    assert.ok(!(await offerNames()).includes('Yogur programado'));
    // Until it starts the product is in the catalog with its normal price.
    const catalog = (await call('GET', '/api/products')).body.data.find((item: { name: string }) => item.name === 'Yogur programado');
    assert.deepEqual([catalog.discountPercent, catalog.offerPrice, catalog.offerEndsOn], [0, 10000, null]);
    // The day it starts (moved here by changing the dates) it is an offer, and the catalog shows its discounted price, with no job involved.
    await setRange(created.body.data.id, today, addDays(today, 2));
    assert.ok((await offerNames()).includes('Yogur programado'));
    const started = (await call('GET', '/api/products')).body.data.find((item: { name: string }) => item.name === 'Yogur programado');
    assert.deepEqual([started.discountPercent, started.offerPrice, started.price, started.offerEndsOn], [25, 7500, 10000, addDays(today, 2)]);
  });

  it('expires the offer by itself the day after its last day and puts the product back in the catalog', async () => {
    const created = await create({ name: 'Queso que termina', discountPercent: 40, offerStartsOn: today, offerEndsOn: today });
    assert.ok((await offerNames()).includes('Queso que termina'));
    await setRange(created.body.data.id, addDays(today, -3), addDays(today, -1));
    assert.ok(!(await offerNames()).includes('Queso que termina'));
    const back = (await call('GET', '/api/products')).body.data.find((item: { name: string }) => item.name === 'Queso que termina');
    assert.deepEqual([back.discountPercent, back.offerPrice], [0, 10000], 'the normal price again, without the old discount');
    const mine = (await call('GET', '/api/products/mine', undefined, seller.token)).body.data.find((item: { name: string }) => item.name === 'Queso que termina');
    assert.deepEqual([mine.discountPercent, mine.offerStatus], [40, 'ended'], 'the panel still shows the saved discount, marked as ended');
  });

  it('groups the whole catalog by store, offers included, without expired products, and filters by one category', async () => {
    const other = await registerStore('fechas-otro', { storeName: 'Abarrotes Ana', neighborhood: 'Suba' });
    await create({ name: 'Arroz 1 kg', category: 'Granos', expirationDate: addDays(today, 200) }, other.token);
    await create({ name: 'Atún en lata', category: 'Despensa', expirationDate: addDays(today, 300), discountPercent: 10 }, other.token);
    await create({ name: 'Mantequilla', category: 'Lácteos' }, other.token);
    const result = await call('GET', '/api/products/catalog');
    assert.equal(result.status, 200);
    const groups = result.body.data as Array<{ store: { name: string; neighborhood: string }; products: Array<{ name: string }> }>;
    assert.deepEqual(groups.map((group) => group.store.name), ['Abarrotes Ana', 'Tienda Fechas']);
    assert.deepEqual(groups[0].products.map((item) => item.name), ['Arroz 1 kg', 'Atún en lata', 'Mantequilla'], 'the canned tuna on offer is in the catalog too');
    const tuna = groups[0].products.find((item) => item.name === 'Atún en lata') as unknown as { discountPercent: number; offerPrice: number; price: number };
    assert.deepEqual([tuna.discountPercent, tuna.offerPrice, tuna.price], [10, 9000, 10000]);
    assert.equal(groups[0].store.neighborhood, 'Suba');
    const names = groups.flatMap((group) => group.products.map((item) => item.name));
    assert.ok(names.includes('Leche hoy'), 'an active offer is in the catalog');
    assert.ok(!names.includes('Kumis viejo'), 'an expired product is not');
    assert.equal(result.body.total, names.length);

    const dairy = await call('GET', '/api/products/catalog?category=l%C3%A1cteos');
    assert.ok((dairy.body.data as typeof groups).every((group) => group.products.length > 0));
    assert.ok((dairy.body.data as typeof groups).flatMap((group) => group.products).every((item) => (item as { category: string }).category === 'Lácteos'));
    const empty = await call('GET', '/api/products/catalog?category=Aseo');
    assert.deepEqual([empty.body.data, empty.body.total], [[], 0]);
  });

  it('filters the offers by category and puts the biggest discount first by default', async () => {
    const shop = await registerStore('fechas-ofertas', { storeName: 'Fruver Ofertas', neighborhood: 'Bosa' });
    await create({ name: 'Mango', category: 'Frutas y verduras', discountPercent: 10 }, shop.token);
    await create({ name: 'Papaya', category: 'Frutas y verduras', discountPercent: 50 }, shop.token);
    await create({ name: 'Piña', category: 'Frutas y verduras', discountPercent: 30 }, shop.token);
    assert.deepEqual(await offerNames({ category: 'Frutas y verduras' }), ['Papaya', 'Piña', 'Mango']);
  });

  it('counts products and active offers per store for the home page', async () => {
    const stores = (await call('GET', '/api/stores')).body.data as Array<{ name: string; productCount: number; offerCount: number }>;
    const shop = stores.find((store) => store.name === 'Fruver Ofertas')!;
    assert.deepEqual([shop.productCount, shop.offerCount], [3, 3]);
  });

  it('uses only active offers in the chat and the recommender', async () => {
    const shop = await registerStore('fechas-chat', { storeName: 'Asadero Chat', neighborhood: 'Fontibón' });
    const ended = await create({ name: 'Pollo terminado', category: 'Pollo', discountPercent: 50 }, shop.token);
    await setRange(ended.body.data.id, addDays(today, -2), addDays(today, -1));
    await create({ name: 'Pollo vigente', category: 'Pollo', discountPercent: 20 }, shop.token);
    const chat = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'pollo en oferta en Fontibón' }] });
    assert.equal(chat.status, 200);
    const results = chat.body.data.results as Array<{ name: string; discountPercent: number }>;
    assert.ok(results.length > 0);
    const old = results.find((item) => item.name === 'Pollo terminado');
    assert.ok(!old || old.discountPercent === 0, 'an ended offer never shows its old discount');
    const offers = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'ofertas de hoy' }], neighborhood: 'Fontibón' });
    assert.deepEqual(offers.body.data.results.map((item: { name: string }) => item.name), ['Pollo vigente']);
    const { findResults } = await import('../src/services/assistant.js');
    const search = await findResults({ terms: ['pollo'], preference: 'relevance', wantsNearby: false, neighborhood: 'Fontibón' });
    const terminated = search.find((item) => item.name === 'Pollo terminado')!;
    assert.deepEqual([terminated.discountPercent, terminated.offerPrice], [0, 10000]);
  });
});
