import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';
import { askNeighborhoodForStores, storesQuestionStart } from '../src/services/assistant.js';
import { asksForStores, clearChatCache } from '../src/services/chat.js';

describe('asksForStores', () => {
  it('recognizes requests for stores in any form', () => {
    for (const text of ['Tiendas cercanas', '¿Qué tiendas hay cerca?', 'locales en mi barrio', 'un granero abierto']) assert.equal(asksForStores(text), true, text);
    for (const text of ['ofertas de hoy', 'leche barata', 'hola']) assert.equal(asksForStores(text), false, text);
  });

  it('asks for the neighborhood and says where there are stores, or that there are none yet', () => {
    assert.equal(askNeighborhoodForStores(['Bosa', 'Suba']), `${storesQuestionStart}. Hay tiendas afiliadas en Bosa y Suba.`);
    assert.equal(askNeighborhoodForStores([]), `${storesQuestionStart}. Todavía no hay tiendas afiliadas, pero pronto llegarán.`);
  });
});

describe('chat: nearby stores without a neighborhood picker', { skip: integrationSkip }, () => {
  const context = useTestApi();
  const { call, registerStore } = context;
  const today = todayInBogota();

  before(async () => {
    const first = await registerStore('chat-tienda-uno', { storeName: 'Tienda Kra 7', neighborhood: 'Chapinero' });
    await registerStore('chat-tienda-dos', { storeName: 'Panadería La 60', neighborhood: 'Chapinero' });
    await registerStore('chat-tienda-tres', { storeName: 'Fruver Sur', neighborhood: 'Kennedy' });
    await call('POST', '/api/products', { name: 'Leche entera', category: 'Lácteos', price: 5000, stock: 9, expirationDate: addDays(today, 4), discountPercent: 20 }, first.token);
    await call('POST', '/api/products', { name: 'Leche futura', category: 'Lácteos', price: 5000, stock: 9, expirationDate: addDays(today, 4), discountPercent: 30, offerStartsOn: addDays(today, 1) }, first.token);
    clearChatCache();
  });

  type Turn = { role: 'user' | 'assistant'; content: string };
  const chat = (messages: Turn[], neighborhood?: string) => call('POST', '/api/assistant/chat', { messages, ...(neighborhood ? { neighborhood } : {}) });

  it('asks for the neighborhood inside the chat when the customer taps "Tiendas cercanas"', async () => {
    const response = await chat([{ role: 'user', content: 'Tiendas cercanas' }]);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.reply, `${storesQuestionStart}. Hay tiendas afiliadas en Chapinero y Kennedy.`);
    assert.deepEqual([response.body.data.mode, response.body.data.stores, response.body.data.intent.neighborhood], ['rules', [], null]);
  });

  it('uses the answer as the neighborhood: lists its stores and their active offers, and returns it so the app remembers it', async () => {
    const question = (await chat([{ role: 'user', content: 'Tiendas cercanas' }])).body.data.reply as string;
    const response = await chat([
      { role: 'user', content: 'Tiendas cercanas' },
      { role: 'assistant', content: question },
      { role: 'user', content: 'chapinero' },
    ]);
    const data = response.body.data;
    assert.equal(data.intent.neighborhood, 'Chapinero');
    assert.deepEqual(data.stores.map((store: { name: string }) => store.name), ['Panadería La 60', 'Tienda Kra 7']);
    assert.deepEqual(data.stores.map((store: { offerCount: number }) => store.offerCount), [0, 1]);
    assert.equal(data.reply, 'En Chapinero hay 2 tiendas afiliadas: Panadería La 60 y Tienda Kra 7 (1 oferta hoy). Estas son sus ofertas activas de hoy.');
    assert.deepEqual(data.results.map((item: { name: string }) => item.name), ['Leche entera'], 'the offer that starts tomorrow is not shown');
  });

  it('answers clearly when the neighborhood has no stores yet', async () => {
    const question = `${storesQuestionStart}. Hay tiendas afiliadas en Chapinero y Kennedy.`;
    const response = await chat([
      { role: 'user', content: 'Tiendas cercanas' },
      { role: 'assistant', content: question },
      { role: 'user', content: 'Usaquén' },
    ]);
    assert.equal(response.body.data.reply, 'No encontré tiendas afiliadas en «Usaquén». Hay tiendas en Chapinero y Kennedy.');
    assert.equal(response.body.data.intent.neighborhood, null);
  });

  it('goes straight to the stores when the app already remembers the neighborhood', async () => {
    const response = await chat([{ role: 'user', content: '¿Qué tiendas hay cerca?' }], 'Kennedy');
    assert.equal(response.body.data.reply, 'En Kennedy hay 1 tienda afiliada: Fruver Sur. Hoy no tienen ofertas activas; en el catálogo ves todos sus productos.');
    assert.deepEqual(response.body.data.results, []);
  });

  it('keeps product questions as searches, filtered by the remembered neighborhood', async () => {
    const response = await chat([{ role: 'user', content: 'leche' }], 'Chapinero');
    assert.ok(response.body.data.results.length >= 1);
    assert.ok(response.body.data.results.every((item: { store: { neighborhood: string } }) => item.store.neighborhood === 'Chapinero'));
    const offers = await chat([{ role: 'user', content: 'Ofertas de hoy' }], 'Kennedy');
    assert.equal(offers.body.data.reply, 'Hoy no hay ofertas activas en Kennedy. Revisa el catálogo para ver todos los productos de las tiendas.');
  });
});
