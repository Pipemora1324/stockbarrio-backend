import { integrationSkip, useTestApi } from './helpers/api.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ZodType } from 'zod';
import { addDays, todayInBogota } from '../src/dates.js';
import {
  categorySchema,
  discountSchema,
  emailSchema,
  futureDateSchema,
  passwordDiffersFromEmail,
  passwordSchema,
  personNameSchema,
  phoneSchema,
  priceSchema,
  productNameSchema,
  stockSchema,
  storeNameSchema,
} from '../src/validation.js';

const accepts = (schema: ZodType, value: unknown) => schema.safeParse(value).success;
const messageOf = (schema: ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? '' : result.error.issues[0].message;
};

describe('validation rules', () => {
  it('person names: letters with accents and ñ, spaces, apostrophe and hyphen, 2 to 60', () => {
    for (const name of ['Luz Marina Rodríguez', 'Ñoño Peña', "D'Angelo", 'Ana-María', 'José  Pérez ']) assert.ok(accepts(personNameSchema, name), name);
    for (const name of ['A', 'Juan2', 'Juan_Pérez', 'Ana@', 'x'.repeat(61), '-Ana', 'Ana--María']) assert.ok(!accepts(personNameSchema, name), name);
    assert.equal(personNameSchema.parse('  José   Pérez '), 'José Pérez');
    assert.match(messageOf(personNameSchema, 'Juan2'), /solo puede tener letras/);
  });

  it('store names: letters, numbers and . , - & \' with at least one letter, 2 to 80', () => {
    for (const name of ['Tienda Doña Luz', 'Supermercado La 14', 'Pérez & Hijos', "Don José's", 'Mini-mercado El Prado, S.A.']) assert.ok(accepts(storeNameSchema, name), name);
    for (const name of ['1234', 'A', 'Tienda #1', 'Tienda <script>', 'x'.repeat(81)]) assert.ok(!accepts(storeNameSchema, name), name);
    assert.match(messageOf(storeNameSchema, '1234'), /al menos una letra/);
  });

  it('phones: Colombian mobile starting with 3 (with optional +57) or landline', () => {
    for (const phone of ['3101234567', '+57 310 123 4567', '57-310-123-4567', '(601) 234 5678', '6042345678', '']) assert.ok(accepts(phoneSchema, phone), phone);
    for (const phone of ['2101234567', '310123456', '31012345678', '+1 310 123 4567', '6092345678', 'telefono']) assert.ok(!accepts(phoneSchema, phone), phone);
    assert.equal(phoneSchema.parse('+57 310 123 4567'), '3101234567');
  });

  it('emails: valid format, lowercase, at most 254 characters', () => {
    assert.equal(emailSchema.parse('  Luz.Marina@Ejemplo.CO '), 'luz.marina@ejemplo.co');
    for (const email of ['luz@', 'luz@ejemplo', 'luz ejemplo@x.co', `${'a'.repeat(250)}@x.co`]) assert.ok(!accepts(emailSchema, email), email);
  });

  it('passwords: 8 to 72 characters with a letter and a number, different from the email', () => {
    assert.ok(accepts(passwordSchema, 'tienda12345'));
    assert.match(messageOf(passwordSchema, 'corta1'), /al menos 8/);
    assert.match(messageOf(passwordSchema, 'solamenteletras'), /al menos un número/);
    assert.match(messageOf(passwordSchema, '1234567890'), /al menos una letra/);
    assert.match(messageOf(passwordSchema, `a1${'x'.repeat(71)}`), /como máximo 72/);
    assert.equal(passwordDiffersFromEmail('Luz2026@x.co', 'luz2026@x.co'), false);
    assert.equal(passwordDiffersFromEmail('otraClave9', 'luz2026@x.co'), true);
  });

  it('products: name, integer price and stock with limits, discount 0 to 90', () => {
    assert.ok(accepts(productNameSchema, 'Huevos AA x 30'));
    assert.ok(!accepts(productNameSchema, '123'));
    assert.ok(!accepts(productNameSchema, 'x'.repeat(81)));
    assert.ok(accepts(priceSchema, 4900));
    for (const price of [0, -5, 49.5, 10_000_001, 'mil']) assert.ok(!accepts(priceSchema, price), String(price));
    assert.ok(accepts(stockSchema, 0));
    for (const stock of [-1, 2.5, 100_001]) assert.ok(!accepts(stockSchema, stock), String(stock));
    assert.ok(accepts(discountSchema, 90));
    for (const discount of [-1, 91, 12.5]) assert.ok(!accepts(discountSchema, discount), String(discount));
  });

  it('categories come from a controlled list, ignoring case and accents', () => {
    assert.equal(categorySchema.parse('lacteos'), 'Lácteos');
    assert.equal(categorySchema.parse('POLLO'), 'Pollo');
    assert.match(messageOf(categorySchema, 'Juguetes'), /Elige una categoría de la lista/);
  });

  it('expiration dates must be real and not in the past when creating', () => {
    const today = todayInBogota();
    assert.ok(accepts(futureDateSchema, today));
    assert.ok(accepts(futureDateSchema, addDays(today, 30)));
    assert.match(messageOf(futureDateSchema, addDays(today, -1)), /no puede estar en el pasado/);
    assert.ok(!accepts(futureDateSchema, '2026-02-30'));
    assert.ok(!accepts(futureDateSchema, addDays(today, 365 * 6)));
  });
});

describe('validation in the API', { skip: integrationSkip }, () => {
  const { call, registerStore } = useTestApi();

  it('rejects invalid registrations with one Spanish message per field', async () => {
    const result = await call('POST', '/api/auth/register', {
      accountType: 'customer',
      name: 'Juan2',
      email: 'no-es-correo',
      password: 'sololetras',
    });
    assert.equal(result.status, 400);
    const fields = (result.body.errors as Array<{ field: string; message: string }>).map((item) => item.field);
    assert.deepEqual(fields.sort(), ['email', 'name', 'password']);
  });

  it('rejects a password equal to the email and a bad phone', async () => {
    const same = await call('POST', '/api/auth/register', { accountType: 'customer', name: 'Ana', email: 'ana2026@x.co', password: 'ana2026@x.co' });
    assert.equal(same.status, 400);
    assert.match(same.body.message, /no puede ser igual a tu correo/);
    const phone = await call('POST', '/api/auth/register', { name: 'Ana Pérez', email: 'ana.tienda@x.co', password: 'tienda12345', storeName: 'Tienda Ana', neighborhood: 'Suba', address: 'Calle 1 # 2-3', phone: '12345' });
    assert.equal(phone.status, 400);
    assert.match(phone.body.message, /celular colombiano/);
  });

  it('stores the normalized email and phone', async () => {
    const { token } = await registerStore('normaliza', { email: 'Tienda.Normaliza@Stockbarrio.Test', phone: '+57 310 555 1234' });
    const store = await call('GET', '/api/stores/mine', undefined, token);
    assert.equal(store.body.data[0].phone, '3105551234');
    const login = await call('POST', '/api/auth/login', { email: 'TIENDA.NORMALIZA@stockbarrio.test', password: 'tienda12345' });
    assert.equal(login.status, 200);
  });

  it('validates products and maps the category to the list', async () => {
    const { token } = await registerStore('productos');
    const today = todayInBogota();
    const valid = await call('POST', '/api/products', { name: 'Pollo asado entero', category: 'pollo', price: 32000, stock: 5, expirationDate: today }, token);
    assert.equal(valid.status, 201);
    assert.equal(valid.body.data.category, 'Pollo');
    const invalid = await call('POST', '/api/products', { name: '12', category: 'Juguetes', price: 0, stock: -1, expirationDate: addDays(today, -1), discountPercent: 95 }, token);
    assert.equal(invalid.status, 400);
    const fields = (invalid.body.errors as Array<{ field: string }>).map((item) => item.field).sort();
    assert.deepEqual(fields, ['category', 'discountPercent', 'expirationDate', 'name', 'price', 'stock']);
    // Editar un producto viejo sigue funcionando aunque su categoría no esté en la lista.
    const id = valid.body.data.id as string;
    assert.equal((await call('PUT', `/api/products/${id}`, { category: 'Juguetes' }, token)).status, 400);
    assert.equal((await call('PUT', `/api/products/${id}`, { stock: 3 }, token)).status, 200);
  });

  it('lists the product categories', async () => {
    const result = await call('GET', '/api/products/categories');
    assert.ok(result.body.data.includes('Comidas preparadas'));
  });
});
