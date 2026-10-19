import { config } from '../config.js';
import { database } from '../database.js';
import { daysBetween, todayInBogota } from '../dates.js';
import { formatCop } from '../format.js';
import { alertRepository, notificationRepository, type AlertSubscriptionRecord, type NotificationRecord } from '../repositories/alert.js';
import { normalizeText } from './discount-rules.js';
import { singularize } from './search-intent.js';
import type { AppliedDiscount } from './suggestions.js';

export interface DiscountedProduct {
  id: string;
  name: string;
  category: string;
  offerPrice: number;
  discountPercent: number;
  expirationDate: string;
  store: { name: string; neighborhood: string };
}

export interface NotificationDelivery {
  userId: string;
  notification: NotificationRecord;
}

// Extra delivery channels (email, WhatsApp...) implement this interface. Notifications are always stored for the
// in-app inbox first; channels only receive the ones that were actually created, so dedupe and limits apply to all.
// No external channel is registered by default, so no customer data leaves the app.
export interface NotificationChannel {
  readonly name: string;
  deliver(delivery: NotificationDelivery): Promise<void>;
}

const channels: NotificationChannel[] = [];
export const registerNotificationChannel = (channel: NotificationChannel) => channels.push(channel);

const words = (value: string) => normalizeText(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(singularize);

export const matchesProduct = (subscription: Pick<AlertSubscriptionRecord, 'query' | 'category'>, product: Pick<DiscountedProduct, 'name' | 'category'>) => {
  if (subscription.category && normalizeText(subscription.category) !== normalizeText(product.category)) return false;
  if (!subscription.query) return true;
  const productWords = words(`${product.name} ${product.category}`);
  return words(subscription.query).every((term) => productWords.some((word) => word.startsWith(term)));
};

// An alert without neighborhood matches every store.
export const matchesPlace = (subscription: Pick<AlertSubscriptionRecord, 'neighborhood'>, store: DiscountedProduct['store']) =>
  !subscription.neighborhood || normalizeText(subscription.neighborhood) === normalizeText(store.neighborhood);

export const buildNotificationText = (product: DiscountedProduct, today = todayInBogota()) => {
  const days = daysBetween(today, product.expirationDate);
  const expires = days <= 0 ? 'Vence hoy' : days === 1 ? 'Vence mañana' : `Vence en ${days} días`;
  return {
    title: `${product.discountPercent} % de descuento en ${product.name}`.slice(0, 120),
    message: `${product.store.name} (${product.store.neighborhood}) tiene ${product.name} a ${formatCop(product.offerPrice)}. ${expires}.`.slice(0, 400),
  };
};

const loadProduct = async (productId: string): Promise<DiscountedProduct | undefined> =>
  (
    await database.query<DiscountedProduct & { storeName: string; neighborhood: string }>(
      `SELECT p.id, p.name, p.category, p.offer_price AS "offerPrice", p.discount_percent AS "discountPercent", p.expiration_date AS "expirationDate",
         s.name AS "storeName", s.neighborhood
       FROM products p JOIN stores s ON s.id = p.store_id WHERE p.id = $1 AND p.active = true`,
      [productId],
    )
  ).rows.map((row) => ({ ...row, store: { name: row.storeName, neighborhood: row.neighborhood } }))[0];

// Creates notifications for the customers whose alerts match a discount that a store just approved.
export const notifyDiscountApplied = async (applied: AppliedDiscount[]): Promise<number> => {
  const deliveries: NotificationDelivery[] = [];
  for (const discount of applied) {
    const product = await loadProduct(discount.productId);
    if (!product) continue;
    await database.withTransaction(async (client) => {
      const notifiedUsers = new Set<string>();
      for (const subscription of await alertRepository.candidatesFor(client, product.discountPercent)) {
        if (notifiedUsers.has(subscription.userId) || !matchesProduct(subscription, product)) continue;
        if (!matchesPlace(subscription, product.store)) continue;
        // One notice per product and person, and a daily cap so nobody gets spammed.
        if (await notificationRepository.alreadyNotified(client, subscription.userId, product.id)) continue;
        if ((await notificationRepository.countToday(client, subscription.userId)) >= config.notificationsDailyLimit) continue;
        const notification = await notificationRepository.insert(client, { userId: subscription.userId, subscriptionId: subscription.id, productId: product.id, ...buildNotificationText(product) });
        if (!notification) continue;
        notifiedUsers.add(subscription.userId);
        deliveries.push({ userId: subscription.userId, notification });
      }
    });
  }
  for (const delivery of deliveries) {
    for (const channel of channels) {
      await channel.deliver(delivery).catch((error: unknown) => console.error(`El canal ${channel.name} no pudo entregar una notificación.`, error instanceof Error ? error.message : error));
    }
  }
  return deliveries.length;
};
