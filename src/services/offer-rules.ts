import { badRequest } from '../errors.js';

// Offer dates are plain 'YYYY-MM-DD' days of the Bogota calendar, compared as text (never through toISOString).
export interface OfferFields {
  discountPercent: number;
  offerStartsOn: string | null;
  offerEndsOn: string | null;
  expirationDate: string;
}

// none: no discount or no dates; scheduled: starts later; active: visible today; ended: its last day already passed.
export type OfferStatus = 'none' | 'scheduled' | 'active' | 'ended';

export const offerStatus = (product: OfferFields, today: string): OfferStatus => {
  if (!(product.discountPercent > 0) || !product.offerStartsOn || !product.offerEndsOn) return 'none';
  if (today < product.offerStartsOn) return 'scheduled';
  if (today > product.offerEndsOn || today > product.expirationDate) return 'ended';
  return 'active';
};

export const isOfferActive = (product: OfferFields, today: string) => offerStatus(product, today) === 'active';

// SQL condition with the same rule, so every public query decides "active" with today's date and no scheduled job.
export const activeOfferSql = (todayParam: string, alias = 'p') =>
  `(${alias}.discount_percent > 0 AND ${alias}.offer_starts_on IS NOT NULL AND ${alias}.offer_ends_on IS NOT NULL
    AND ${todayParam}::date BETWEEN ${alias}.offer_starts_on AND ${alias}.offer_ends_on AND ${alias}.expiration_date >= ${todayParam}::date)`;

// 2026-10-19 -> 19/10/2026, for the messages.
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
  // undefined or null: not sent. Older clients only send the percent, so the range gets defaults.
  offerStartsOn?: string | null;
  offerEndsOn?: string | null;
}

// Decides the range saved with a product and checks the rules. Without a discount the range is cleared.
// Dates that were not sent keep their saved value or get the defaults: from today until the expiration date.
// A start that is not being changed may be in the past (an offer that is already running).
export const resolveOfferRange = (change: OfferChange, today: string, previous?: OfferFields): { offerStartsOn: string | null; offerEndsOn: string | null } => {
  if (!(change.discountPercent > 0)) return { offerStartsOn: null, offerEndsOn: null };
  // Nothing about the offer changed (for example only the stock was edited): the saved range stays as it is.
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
  // Only for clients that do not send dates: the end follows a new, earlier expiration date.
  if (!change.offerEndsOn && endsOn > change.expirationDate) endsOn = change.expirationDate;
  const startChanged = !hadOffer || startsOn !== previous!.offerStartsOn;
  const endChanged = !hadOffer || endsOn !== previous!.offerEndsOn;
  if (startChanged && startsOn < today) throw badRequest(offerMessages.startInPast);
  if (endsOn < startsOn) throw badRequest(offerMessages.endBeforeStart);
  if (endChanged && endsOn < today) throw badRequest(offerMessages.endInPast);
  if (endsOn > change.expirationDate) throw badRequest(offerMessages.endAfterExpiration(change.expirationDate));
  return { offerStartsOn: startsOn, offerEndsOn: endsOn };
};
