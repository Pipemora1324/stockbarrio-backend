import { z } from 'zod';
import { addDays, todayInBogota } from './dates.js';

const isRealDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const collapseSpaces = (value: string) => value.trim().replace(/\s+/g, ' ');
const accentInsensitive = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Accepts 'YYYY-MM-DD' (and full ISO strings from older clients) and keeps only the calendar day.
export const dateOnlySchema = z
  .string({ error: 'La fecha es obligatoria.' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'La fecha debe tener el formato AAAA-MM-DD.')
  .transform((value) => value.slice(0, 10))
  .refine(isRealDate, 'La fecha no es válida.');

// People: letters (accents and ñ included), spaces, apostrophes and hyphens. No digits or symbols.
export const personNameSchema = z
  .string({ error: 'El nombre es obligatorio.' })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(2, 'El nombre debe tener al menos 2 caracteres.')
      .max(60, 'El nombre debe tener como máximo 60 caracteres.')
      .regex(/^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u, 'El nombre solo puede tener letras, espacios, apóstrofes y guiones.'),
  );

// Stores: letters, numbers and . , - & ' with at least one letter.
export const storeNameSchema = z
  .string({ error: 'El nombre de la tienda es obligatorio.' })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(2, 'El nombre de la tienda debe tener al menos 2 caracteres.')
      .max(80, 'El nombre de la tienda debe tener como máximo 80 caracteres.')
      .regex(/^[\p{L}\p{M}\p{N} .,&'’-]+$/u, 'El nombre de la tienda solo puede tener letras, números y los signos . , - & \'')
      .regex(/\p{L}/u, 'El nombre de la tienda debe tener al menos una letra.'),
  );

// Colombian phones: mobile 3XXXXXXXXX or landline 60X XXXXXXX (national format since 2021), with optional +57.
export const normalizePhone = (value: string) => value.replace(/[\s().-]/g, '').replace(/^(\+?57)(?=\d{10}$)/, '');
export const isColombianPhone = (digits: string) => /^3\d{9}$/.test(digits) || /^60[1-8]\d{7}$/.test(digits);
export const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((value) => value === '' || isColombianPhone(value), 'El teléfono debe ser un celular colombiano de 10 dígitos que empiece por 3, o un fijo como 601 2345678.');

export const emailSchema = z
  .string({ error: 'El correo electrónico es obligatorio.' })
  .trim()
  .toLowerCase()
  .max(254, 'El correo electrónico debe tener como máximo 254 caracteres.')
  .pipe(z.email('El correo electrónico no es válido.'));

// One mailbox, one account. Gmail ignores dots and "+tag" in the local part and treats googlemail.com as gmail.com,
// so those variants are the same mailbox. Other providers are only compared in lowercase.
const gmailDomains = new Set(['gmail.com', 'googlemail.com']);
export const canonicalEmail = (email: string) => {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1) return normalized;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!gmailDomains.has(domain)) return normalized;
  return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
};

// The same canonical form computed in SQL over the stored emails (no index needed, the table is small).
export const canonicalEmailSql = (column = 'email') => {
  const email = `lower(trim(${column}))`;
  return `(CASE WHEN split_part(${email}, '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(${email}, '@', 1), '+', 1), '.', '') || '@gmail.com' ELSE ${email} END)`;
};

export const plusAliasMessage = 'No uses alias con +; escribe tu correo normal.';
export const emailTakenMessage = 'Este correo ya está vinculado a una cuenta. Inicia sesión o recupera tu contraseña.';
export const hasPlusAlias = (email: string) => email.split('@')[0]?.includes('+') ?? false;

// For new accounts and email changes. Login and recovery keep accepting older addresses with "+".
export const newEmailSchema = emailSchema.refine((value) => !hasPlusAlias(value), plusAliasMessage);

// bcrypt only uses the first 72 bytes, so longer passwords are rejected instead of silently truncated.
export const passwordSchema = z
  .string({ error: 'La contraseña es obligatoria.' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(72, 'La contraseña debe tener como máximo 72 caracteres.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'La contraseña es demasiado larga.')
  .refine((value) => /\p{L}/u.test(value), 'La contraseña debe tener al menos una letra.')
  .refine((value) => /\d/.test(value), 'La contraseña debe tener al menos un número.');

export const passwordDiffersFromEmail = (password: string, email: string) => password.trim().toLowerCase() !== email.trim().toLowerCase();
export const passwordEqualsEmailMessage = 'La contraseña no puede ser igual a tu correo.';

export const productCategories = [
  'Alimentación',
  'Aseo',
  'Bebidas',
  'Carnes',
  'Carnes frías',
  'Comidas preparadas',
  'Despensa',
  'Frutas y verduras',
  'Granos',
  'Huevos',
  'Lácteos',
  'Panadería',
  'Pescados y mariscos',
  'Pollo',
  'Snacks y dulces',
] as const;

const categoryByKey = new Map(productCategories.map((category) => [accentInsensitive(category), category]));
export const canonicalCategory = (value: string) => categoryByKey.get(accentInsensitive(value));

// Accepts any capitalization or missing accents ("lacteos") and stores the canonical name ("Lácteos").
export const categorySchema = z
  .string({ error: 'La categoría es obligatoria.' })
  .transform((value, context) => {
    const category = canonicalCategory(value);
    if (!category) {
      context.addIssue({ code: 'custom', message: 'Elige una categoría de la lista.' });
      return z.NEVER;
    }
    return category;
  });

export const productNameSchema = z
  .string({ error: 'El nombre del producto es obligatorio.' })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(2, 'El nombre del producto debe tener al menos 2 caracteres.')
      .max(80, 'El nombre del producto debe tener como máximo 80 caracteres.')
      .regex(/\p{L}/u, 'El nombre del producto debe tener al menos una letra.'),
  );

export const maxPrice = 10_000_000;
export const maxStock = 100_000;
export const maxDiscount = 90;

export const priceSchema = z.coerce
  .number({ error: 'El precio debe ser un número.' })
  .int('El precio debe ser un número entero de pesos.')
  .min(1, 'El precio debe ser mayor que 0.')
  .max(maxPrice, 'El precio no puede superar $ 10.000.000.');

// 0 is allowed and means "sold out".
export const stockSchema = z.coerce
  .number({ error: 'El stock debe ser un número.' })
  .int('El stock debe ser un número entero.')
  .min(0, 'El stock no puede ser negativo.')
  .max(maxStock, 'El stock no puede superar 100.000 unidades.');

export const discountSchema = z.coerce
  .number({ error: 'El descuento debe ser un número.' })
  .int('El descuento debe ser un número entero.')
  .min(0, 'El descuento no puede ser negativo.')
  .max(maxDiscount, 'El descuento no puede superar el 90 %.');

export const maxExpirationYears = 5;

// New products cannot expire in the past (Bogota calendar) nor absurdly far in the future.
export const futureDateSchema = dateOnlySchema
  .refine((value) => value >= todayInBogota(), 'La fecha de vencimiento no puede estar en el pasado.')
  .refine((value) => value <= addDays(todayInBogota(), 365 * maxExpirationYears), 'La fecha de vencimiento es demasiado lejana.');

export const neighborhoodSchema = z
  .string({ error: 'El barrio es obligatorio.' })
  .transform(collapseSpaces)
  .pipe(
    z
      .string()
      .min(2, 'El barrio debe tener al menos 2 caracteres.')
      .max(80, 'El barrio debe tener como máximo 80 caracteres.')
      .regex(/^[\p{L}\p{M}\p{N} .,'’-]+$/u, 'El barrio solo puede tener letras, números, espacios y los signos . , - \''),
  );

export const addressSchema = z
  .string({ error: 'La dirección es obligatoria.' })
  .transform(collapseSpaces)
  .pipe(z.string().min(5, 'La dirección debe tener al menos 5 caracteres.').max(200, 'La dirección debe tener como máximo 200 caracteres.'));
