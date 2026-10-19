import { z } from 'zod';
import { daysBetween, todayInBogota } from '../dates.js';
import { formatCop } from '../format.js';
import { distanceKm, formatDistance, hasCoordinates, type Coordinates } from '../geo.js';
import { productRepository, type SearchRow } from '../repositories/product.js';
import { storeRepository } from '../repositories/store.js';
import { normalizeText } from './discount-rules.js';
import { requestJson } from './llm.js';
import { parseIntent, searchPreferences, singularize, type SearchIntent, type SearchPreference } from './search-intent.js';

export interface AssistantQuery {
  message: string;
  // The customer's position is only used for this request; it is never stored.
  location?: Coordinates;
  neighborhood?: string;
}

export interface AssistantResult {
  productId: string;
  name: string;
  category: string;
  price: number;
  offerPrice: number;
  discountPercent: number;
  stock: number;
  expirationDate: string;
  daysToExpire: number;
  distanceKm: number | null;
  store: { id: string; name: string; neighborhood: string; address: string };
}

export const maxAssistantResults = 8;
const candidateLimit = 200;

// Egg and product grades used in Colombia: AAA > AA > A. "Extra" or "premium" count as top grade.
export const gradeScore = (name: string) => {
  const text = ` ${normalizeText(name)} `;
  if (/\saaa\s|\sextra\s|\spremium\s|\sjumbo\s/.test(text)) return 3;
  if (/\saa\s/.test(text)) return 2;
  if (/\sa\s/.test(text)) return 1;
  return 0;
};

const byDistance = (first: AssistantResult, second: AssistantResult) => (first.distanceKm ?? Infinity) - (second.distanceKm ?? Infinity);

export const rankResults = (results: AssistantResult[], preference: SearchPreference, wantsNearby: boolean) => {
  const tieBreak = (first: AssistantResult, second: AssistantResult) => (wantsNearby ? byDistance(first, second) : 0) || first.offerPrice - second.offerPrice || first.daysToExpire - second.daysToExpire;
  const comparators: Record<SearchPreference, (first: AssistantResult, second: AssistantResult) => number> = {
    cheapest: (first, second) => first.offerPrice - second.offerPrice || tieBreak(first, second),
    best_deal: (first, second) => second.discountPercent - first.discountPercent || tieBreak(first, second),
    best_grade: (first, second) => gradeScore(second.name) - gradeScore(first.name) || tieBreak(first, second),
    nearest: (first, second) => byDistance(first, second) || first.offerPrice - second.offerPrice,
    expiring: (first, second) => first.daysToExpire - second.daysToExpire || second.discountPercent - first.discountPercent,
    relevance: (first, second) => byDistance(first, second) || first.daysToExpire - second.daysToExpire || first.offerPrice - second.offerPrice,
  };
  return [...results].sort(comparators[preference]);
};

const preferenceLabels: Record<SearchPreference, string> = {
  cheapest: 'La más barata',
  best_deal: 'La de mayor descuento',
  best_grade: 'La de mejor categoría',
  nearest: 'La más cercana',
  expiring: 'La que vence primero',
  relevance: 'Te recomiendo',
};

const describeResult = (result: AssistantResult) => {
  const distance = result.distanceKm === null ? '' : `, a ${formatDistance(result.distanceKm)}`;
  const discount = result.discountPercent > 0 ? ` (${result.discountPercent} % de descuento)` : '';
  const expires = result.daysToExpire === 0 ? 'vence hoy' : result.daysToExpire === 1 ? 'vence mañana' : `vence en ${result.daysToExpire} días`;
  return `${result.name} en ${result.store.name} (${result.store.neighborhood}) a ${formatCop(result.offerPrice)}${discount}${distance}; ${expires}`;
};

export const buildReply = (intent: SearchIntent, results: AssistantResult[], hasOrigin: boolean) => {
  const what = intent.terms.length ? `«${intent.terms.join(' ')}»` : 'productos';
  if (!intent.terms.length && intent.preference === 'relevance') return '¿Qué producto buscas? Escribe por ejemplo «huevos baratos» o «leche cerca de mí».';
  if (!results.length) return `No encontré ${what} disponibles${intent.neighborhood ? ` en ${intent.neighborhood}` : ''}. Prueba con otra palabra o revisa el catálogo.`;
  const parts = [`Encontré ${results.length} ${results.length === 1 ? 'opción' : 'opciones'} de ${what}. ${preferenceLabels[intent.preference]}: ${describeResult(results[0])}.`];
  if ((intent.wantsNearby || intent.preference === 'nearest') && !hasOrigin) parts.push('Para ordenar por cercanía, comparte tu ubicación o elige tu barrio.');
  return parts.join(' ');
};

const aiIntentSchema = z.object({
  terms: z.array(z.string().trim().min(2).max(40).regex(/^[\p{L}\d ]+$/u)).max(5),
  preference: z.enum(searchPreferences),
});

const aiPrompt = `Interpretas búsquedas de clientes de tiendas de barrio en Colombia.
Devuelve JSON {"terms": palabras del producto buscado (sin preferencias ni lugares), "preference": una de ${searchPreferences.join(', ')}}.
cheapest = más barato, best_deal = mayor descuento u oferta, best_grade = mejor categoría o calidad, nearest = más cerca, expiring = por vencer.`;

// The provider can only refine the terms and the preference; location handling always comes from local rules.
const resolveIntent = async (message: string, neighborhoods: string[]): Promise<SearchIntent> => {
  const local = parseIntent(message, neighborhoods);
  const answer = await requestJson(aiPrompt, { message }, aiIntentSchema);
  if (!answer || !answer.terms.length) return local;
  const terms = [...new Set(answer.terms.map((term) => singularize(normalizeText(term))))];
  return { ...local, terms, preference: answer.preference, wantsNearby: local.wantsNearby || answer.preference === 'nearest' };
};

const toResult = (row: SearchRow, today: string, origin: Coordinates | null): AssistantResult => ({
  productId: row.id,
  name: row.name,
  category: row.category,
  price: row.price,
  offerPrice: row.offerPrice,
  discountPercent: row.discountPercent,
  stock: row.stock,
  expirationDate: row.expirationDate,
  daysToExpire: daysBetween(today, row.expirationDate),
  distanceKm: origin && hasCoordinates(row) ? Math.round(distanceKm(origin, row) * 100) / 100 : null,
  store: { id: row.storeId, name: row.storeName, neighborhood: row.neighborhood, address: row.address },
});

export interface ResultFilters {
  category?: string;
  maxPrice?: number;
  limit?: number;
}

// Real products from the database for an intent: never anything the database does not have.
export const findResults = async (intent: SearchIntent, origin: Coordinates | null, filters: ResultFilters = {}, today = todayInBogota()) => {
  if (!intent.terms.length && intent.preference === 'relevance' && !filters.category) return [];
  const options = {
    neighborhood: intent.neighborhood,
    category: filters.category,
    maxPrice: filters.maxPrice,
    onlyDiscounted: intent.preference === 'best_deal' && !intent.terms.length,
    limit: candidateLimit,
  };
  let rows = await productRepository.search(intent.terms, { ...options, matchAll: true });
  if (!rows.length && intent.terms.length > 1) rows = await productRepository.search(intent.terms, { ...options, matchAll: false });
  const sellable = rows.map((row) => toResult(row, today, origin)).filter((result) => result.daysToExpire >= 0);
  return rankResults(sellable, intent.preference, intent.wantsNearby).slice(0, filters.limit ?? maxAssistantResults);
};

export const resolveOrigin = async (query: { location?: Coordinates; neighborhood?: string }) =>
  query.location ?? (query.neighborhood ? await storeRepository.neighborhoodCenter(query.neighborhood) : null);

export const searchAssistant = async (query: AssistantQuery, today = todayInBogota()) => {
  const neighborhoods = await storeRepository.listNeighborhoods();
  const intent = await resolveIntent(query.message, neighborhoods);
  const origin = await resolveOrigin(query);
  const originType = query.location ? 'location' : origin ? 'neighborhood' : null;
  const results = await findResults(intent, origin, {}, today);
  return {
    reply: buildReply(intent, results, origin !== null),
    intent: { terms: intent.terms, preference: intent.preference, neighborhood: intent.neighborhood ?? null },
    origin: originType,
    results,
  };
};
