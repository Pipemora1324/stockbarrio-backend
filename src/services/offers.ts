import { daysBetween, todayInBogota } from '../dates.js';
import { distanceKm, hasCoordinates, type Coordinates } from '../geo.js';
import { productRepository } from '../repositories/product.js';
import { normalizeText } from './discount-rules.js';

export const offerSorts = ['discount', 'nearest', 'expiring'] as const;
export type OfferSort = (typeof offerSorts)[number];

export interface OfferQuery {
  neighborhood?: string;
  category?: string;
  search?: string;
  // Only used for this request to compute distances; never stored.
  location?: Coordinates;
  radiusKm?: number;
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
  const offers = rows
    .map((row) => ({
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
      distanceKm: query.location && hasCoordinates(row) ? Math.round(distanceKm(query.location, row) * 100) / 100 : null,
      store: { id: row.storeId, name: row.storeName, neighborhood: row.neighborhood, address: row.address },
    }))
    // With a radius, stores without coordinates cannot be placed, so they are left out.
    .filter((offer) => !query.location || query.radiusKm === undefined || (offer.distanceKm !== null && offer.distanceKm <= query.radiusKm));

  const byDistance = (first: (typeof offers)[number], second: (typeof offers)[number]) => (first.distanceKm ?? Infinity) - (second.distanceKm ?? Infinity);
  const comparators: Record<OfferSort, (first: (typeof offers)[number], second: (typeof offers)[number]) => number> = {
    discount: (first, second) => second.discountPercent - first.discountPercent || first.daysToExpire - second.daysToExpire || byDistance(first, second),
    nearest: (first, second) => byDistance(first, second) || second.discountPercent - first.discountPercent,
    expiring: (first, second) => first.daysToExpire - second.daysToExpire || second.discountPercent - first.discountPercent,
  };
  return { data: offers.sort(comparators[query.sort]).slice(0, maxOffers), total: offers.length };
};
