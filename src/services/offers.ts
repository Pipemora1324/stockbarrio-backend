import { daysBetween, todayInBogota } from '../dates.js';
import { productRepository } from '../repositories/product.js';
import { normalizeText } from './discount-rules.js';

export const offerSorts = ['discount', 'expiring'] as const;
export type OfferSort = (typeof offerSorts)[number];

export interface OfferQuery {
  neighborhood?: string;
  category?: string;
  search?: string;
  sort: OfferSort;
}

export const maxOffers = 60;
const candidateLimit = 300;

export const findOffers = async (query: OfferQuery, today = todayInBogota()) => {
  const rows = await productRepository.listOffers({
    neighborhood: query.neighborhood,
    category: query.category,
    search: query.search ? normalizeText(query.search) : undefined,
    today,
    limit: candidateLimit,
  });
  const offers = rows.map((row) => ({
    productId: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    imageUrl: row.imageUrl,
    price: row.price,
    offerPrice: row.offerPrice,
    discountPercent: row.discountPercent,
    stock: row.stock,
    expirationDate: row.expirationDate,
    daysToExpire: daysBetween(today, row.expirationDate),
    // Último día de la oferta (incluido) y cuántos días le quedan.
    offerStartsOn: row.offerStartsOn,
    offerEndsOn: row.offerEndsOn,
    offerDaysLeft: daysBetween(today, row.offerEndsOn ?? row.expirationDate),
    store: { id: row.storeId, name: row.storeName, neighborhood: row.neighborhood, address: row.address },
  }));

  const comparators: Record<OfferSort, (first: (typeof offers)[number], second: (typeof offers)[number]) => number> = {
    discount: (first, second) => second.discountPercent - first.discountPercent || first.daysToExpire - second.daysToExpire,
    expiring: (first, second) => first.daysToExpire - second.daysToExpire || second.discountPercent - first.discountPercent,
  };
  return { data: offers.sort(comparators[query.sort]).slice(0, maxOffers), total: offers.length };
};
