import { badRequest } from '../errors.js';

// Las fechas de oferta son días 'AAAA-MM-DD' del calendario de Bogotá, comparados como texto (nunca con toISOString).
export interface OfferFields {
  discountPercent: number;
  offerStartsOn: string | null;
  offerEndsOn: string | null;
  expirationDate: string;
}

// none: sin descuento o sin fechas; scheduled: empieza después; active: se ve hoy; ended: su último día ya pasó.
export type OfferStatus = 'none' | 'scheduled' | 'active' | 'ended';

export const offerStatus = (product: OfferFields, today: string): OfferStatus => {
  if (!(product.discountPercent > 0) || !product.offerStartsOn || !product.offerEndsOn) return 'none';
  if (today < product.offerStartsOn) return 'scheduled';
  if (today > product.offerEndsOn || today > product.expirationDate) return 'ended';
  return 'active';
};

// Condición SQL con la misma regla, para que cada consulta pública decida "activa" con la fecha de hoy y sin tareas programadas.
export const activeOfferSql = (todayParam: string, alias = 'p') =>
  `(${alias}.discount_percent > 0 AND ${alias}.offer_starts_on IS NOT NULL AND ${alias}.offer_ends_on IS NOT NULL
    AND ${todayParam}::date BETWEEN ${alias}.offer_starts_on AND ${alias}.offer_ends_on AND ${alias}.expiration_date >= ${todayParam}::date)`;

// 2026-10-19 -> 19/10/2026, para los mensajes.
export const formatDay = (day: string) => day.split('-').reverse().join('/');

export const offerMessages = {
  expiredProduct: 'Un producto vencido no puede tener oferta. Quita el descuento o corrige la fecha de vencimiento.',
  startInPast: 'La fecha de inicio de la oferta no puede ser anterior a hoy.',
  endBeforeStart: 'La fecha de finalización no puede ser anterior a la fecha de inicio.',
  endInPast: 'La fecha de finalización de la oferta no puede ser anterior a hoy.',
  endAfterExpiration: (expirationDate: string) => `La oferta no puede terminar después del vencimiento del producto (${formatDay(expirationDate)}).`,
};

export interface OfferChange {
  discountPercent: number;
  expirationDate: string;
  // undefined o null: no se envió. Los clientes viejos solo envían el porcentaje, así que el rango toma los valores por defecto.
  offerStartsOn?: string | null;
  offerEndsOn?: string | null;
}

// Decide el rango que se guarda con un producto y comprueba las reglas. Sin descuento, el rango se borra.
// Las fechas que no se enviaron conservan su valor guardado o toman las de por defecto: de hoy al vencimiento.
// Un inicio que no se está cambiando puede estar en el pasado (una oferta que ya empezó).
export const resolveOfferRange = (change: OfferChange, today: string, previous?: OfferFields): { offerStartsOn: string | null; offerEndsOn: string | null } => {
  if (!(change.discountPercent > 0)) return { offerStartsOn: null, offerEndsOn: null };
  // No cambió nada de la oferta (por ejemplo, solo se editó el stock): el rango guardado se queda como está.
  const unchanged =
    previous &&
    previous.discountPercent === change.discountPercent &&
    previous.expirationDate === change.expirationDate &&
    (!change.offerStartsOn || change.offerStartsOn === previous.offerStartsOn) &&
    (!change.offerEndsOn || change.offerEndsOn === previous.offerEndsOn);
  if (unchanged && previous.offerStartsOn && previous.offerEndsOn) return { offerStartsOn: previous.offerStartsOn, offerEndsOn: previous.offerEndsOn };
  if (change.expirationDate < today) throw badRequest(offerMessages.expiredProduct);
  const hadOffer = Boolean(previous && previous.discountPercent > 0 && previous.offerStartsOn && previous.offerEndsOn);
  const startsOn = change.offerStartsOn || (hadOffer ? previous!.offerStartsOn! : today);
  let endsOn = change.offerEndsOn || (hadOffer ? previous!.offerEndsOn! : change.expirationDate);
  // Solo para los clientes que no envían fechas: el fin sigue a un vencimiento nuevo y más cercano.
  if (!change.offerEndsOn && endsOn > change.expirationDate) endsOn = change.expirationDate;
  const startChanged = !hadOffer || startsOn !== previous!.offerStartsOn;
  const endChanged = !hadOffer || endsOn !== previous!.offerEndsOn;
  if (startChanged && startsOn < today) throw badRequest(offerMessages.startInPast);
  if (endsOn < startsOn) throw badRequest(offerMessages.endBeforeStart);
  if (endChanged && endsOn < today) throw badRequest(offerMessages.endInPast);
  if (endsOn > change.expirationDate) throw badRequest(offerMessages.endAfterExpiration(change.expirationDate));
  return { offerStartsOn: startsOn, offerEndsOn: endsOn };
};
