import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, todayInBogota } from '../src/dates.js';
import { AppError } from '../src/errors.js';
import { formatDay, isOfferActive, offerMessages, offerStatus, resolveOfferRange, type OfferFields } from '../src/services/offer-rules.js';

const today = '2026-10-19';
const product = (overrides: Partial<OfferFields> = {}): OfferFields => ({
  discountPercent: 20,
  offerStartsOn: today,
  offerEndsOn: addDays(today, 3),
  expirationDate: addDays(today, 5),
  ...overrides,
});

const rejects = (run: () => unknown, message: string) =>
  assert.throws(run, (error: unknown) => error instanceof AppError && error.status === 400 && error.message === message);

describe('offerStatus', () => {
  it('is active from the first to the last day of the range, both included', () => {
    const offer = product();
    assert.equal(offerStatus(offer, addDays(today, -1)), 'scheduled');
    assert.equal(offerStatus(offer, today), 'active');
    assert.equal(offerStatus(offer, addDays(today, 3)), 'active');
    assert.equal(offerStatus(offer, addDays(today, 4)), 'ended');
  });

  it('needs a discount and both dates', () => {
    assert.equal(offerStatus(product({ discountPercent: 0 }), today), 'none');
    assert.equal(offerStatus(product({ offerStartsOn: null }), today), 'none');
    assert.equal(offerStatus(product({ offerEndsOn: null }), today), 'none');
    assert.equal(isOfferActive(product({ offerEndsOn: null }), today), false);
  });

  it('ends with the product: an expired product never shows an active offer', () => {
    assert.equal(offerStatus(product({ offerEndsOn: addDays(today, 3), expirationDate: addDays(today, 1) }), addDays(today, 2)), 'ended');
  });

  it('changes at midnight in Bogota, not at midnight UTC', () => {
    const offer = product({ offerStartsOn: '2026-10-20', offerEndsOn: '2026-10-20', expirationDate: '2026-10-25' });
    // 23:59 of October 19 in Bogota is already October 20 in UTC.
    const lastMinute = todayInBogota(new Date('2026-10-20T04:59:00Z'));
    const nextDay = todayInBogota(new Date('2026-10-20T05:00:00Z'));
    assert.deepEqual([lastMinute, nextDay], ['2026-10-19', '2026-10-20']);
    assert.equal(offerStatus(offer, lastMinute), 'scheduled');
    assert.equal(offerStatus(offer, nextDay), 'active');
    // And it ends after 23:59 of its last day in Bogota.
    assert.equal(offerStatus(offer, todayInBogota(new Date('2026-10-21T04:59:00Z'))), 'active');
    assert.equal(offerStatus(offer, todayInBogota(new Date('2026-10-21T05:00:00Z'))), 'ended');
  });
});

describe('resolveOfferRange', () => {
  const expirationDate = addDays(today, 5);

  it('clears the dates when there is no discount', () => {
    assert.deepEqual(resolveOfferRange({ discountPercent: 0, expirationDate, offerStartsOn: today, offerEndsOn: today }, today), { offerStartsOn: null, offerEndsOn: null });
  });

  it('proposes today until the expiration date when the client does not send dates', () => {
    assert.deepEqual(resolveOfferRange({ discountPercent: 20, expirationDate }, today), { offerStartsOn: today, offerEndsOn: expirationDate });
  });

  it('accepts a start today and an end on the expiration day', () => {
    assert.deepEqual(resolveOfferRange({ discountPercent: 20, expirationDate, offerStartsOn: today, offerEndsOn: expirationDate }, today), {
      offerStartsOn: today,
      offerEndsOn: expirationDate,
    });
    // A one-day offer on the last day of the product.
    assert.deepEqual(resolveOfferRange({ discountPercent: 20, expirationDate, offerStartsOn: expirationDate, offerEndsOn: expirationDate }, today), {
      offerStartsOn: expirationDate,
      offerEndsOn: expirationDate,
    });
  });

  it('rejects a start before today', () => {
    rejects(() => resolveOfferRange({ discountPercent: 20, expirationDate, offerStartsOn: addDays(today, -1), offerEndsOn: expirationDate }, today), offerMessages.startInPast);
  });

  it('rejects an end before the start', () => {
    rejects(() => resolveOfferRange({ discountPercent: 20, expirationDate, offerStartsOn: addDays(today, 2), offerEndsOn: addDays(today, 1) }, today), offerMessages.endBeforeStart);
  });

  it('rejects an end after the expiration date and says which date it is', () => {
    const message = offerMessages.endAfterExpiration(expirationDate);
    assert.equal(message, 'La oferta no puede terminar después del vencimiento del producto (24/10/2026).');
    rejects(() => resolveOfferRange({ discountPercent: 20, expirationDate, offerStartsOn: today, offerEndsOn: addDays(expirationDate, 1) }, today), message);
  });

  it('does not allow an offer on an expired product', () => {
    rejects(() => resolveOfferRange({ discountPercent: 20, expirationDate: addDays(today, -1) }, today), offerMessages.expiredProduct);
  });

  it('keeps a running offer whose start is already in the past when nothing about it changes', () => {
    const running = product({ offerStartsOn: addDays(today, -3), offerEndsOn: addDays(today, 2), expirationDate });
    assert.deepEqual(resolveOfferRange({ discountPercent: 20, expirationDate }, today, running), { offerStartsOn: addDays(today, -3), offerEndsOn: addDays(today, 2) });
    // Moving only the end keeps the past start, which is not being changed.
    assert.deepEqual(resolveOfferRange({ discountPercent: 30, expirationDate, offerEndsOn: addDays(today, 4) }, today, running), {
      offerStartsOn: addDays(today, -3),
      offerEndsOn: addDays(today, 4),
    });
    // But a new start in the past is rejected.
    rejects(() => resolveOfferRange({ discountPercent: 20, expirationDate, offerStartsOn: addDays(today, -2) }, today, running), offerMessages.startInPast);
  });

  it('lets an expired product with an old offer be edited when the offer is not touched', () => {
    const old = product({ offerStartsOn: addDays(today, -10), offerEndsOn: addDays(today, -5), expirationDate: addDays(today, -5) });
    assert.deepEqual(resolveOfferRange({ discountPercent: 20, expirationDate: old.expirationDate }, today, old), { offerStartsOn: old.offerStartsOn, offerEndsOn: old.offerEndsOn });
  });

  it('moves the end with an earlier expiration date only for clients that do not send dates', () => {
    const running = product({ offerStartsOn: today, offerEndsOn: addDays(today, 5), expirationDate: addDays(today, 5) });
    assert.deepEqual(resolveOfferRange({ discountPercent: 20, expirationDate: addDays(today, 2) }, today, running), { offerStartsOn: today, offerEndsOn: addDays(today, 2) });
    rejects(
      () => resolveOfferRange({ discountPercent: 20, expirationDate: addDays(today, 2), offerEndsOn: addDays(today, 5) }, today, running),
      offerMessages.endAfterExpiration(addDays(today, 2)),
    );
  });

  it('rejects a new end in the past', () => {
    const running = product({ offerStartsOn: addDays(today, -3), offerEndsOn: addDays(today, 2) });
    rejects(() => resolveOfferRange({ discountPercent: 20, expirationDate, offerEndsOn: addDays(today, -1) }, today, running), offerMessages.endInPast);
  });

  it('formats days as DD/MM/AAAA without going through Date', () => {
    assert.equal(formatDay('2026-01-05'), '05/01/2026');
  });
});
