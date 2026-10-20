import { z } from 'zod';
import { daysBetween, todayInBogota } from '../dates.js';
import { formatCop } from '../format.js';
import { productRepository, type SearchRow } from '../repositories/product.js';
import { storeRepository } from '../repositories/store.js';
import { normalizeText } from './discount-rules.js';
import { requestJson } from './llm.js';
import { parseIntent, searchPreferences, searchStem, singularize, synonymVariants, type SearchIntent, type SearchPreference } from './search-intent.js';

export interface AssistantQuery {
  message: string;
  // Chosen by the customer: used as the neighborhood filter when the message does not name one.
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

export const rankResults = (results: AssistantResult[], preference: SearchPreference) => {
  const tieBreak = (first: AssistantResult, second: AssistantResult) => first.offerPrice - second.offerPrice || first.daysToExpire - second.daysToExpire;
  const comparators: Record<SearchPreference, (first: AssistantResult, second: AssistantResult) => number> = {
    cheapest: (first, second) => first.offerPrice - second.offerPrice || tieBreak(first, second),
    best_deal: (first, second) => second.discountPercent - first.discountPercent || tieBreak(first, second),
    best_grade: (first, second) => gradeScore(second.name) - gradeScore(first.name) || tieBreak(first, second),
    expiring: (first, second) => first.daysToExpire - second.daysToExpire || second.discountPercent - first.discountPercent,
    relevance: (first, second) => first.daysToExpire - second.daysToExpire || first.offerPrice - second.offerPrice,
  };
  return [...results].sort(comparators[preference]);
};

const preferenceLabels: Record<SearchPreference, string> = {
  cheapest: 'La más barata',
  best_deal: 'La de mayor descuento',
  best_grade: 'La de mejor categoría',
  expiring: 'La que vence primero',
  relevance: 'Te recomiendo',
};

const describeResult = (result: AssistantResult) => {
  const discount = result.discountPercent > 0 ? ` (${result.discountPercent} % de descuento)` : '';
  const expires = result.daysToExpire === 0 ? 'vence hoy' : result.daysToExpire === 1 ? 'vence mañana' : `vence en ${result.daysToExpire} días`;
  return `${result.name} en ${result.store.name} (${result.store.neighborhood}) a ${formatCop(result.offerPrice)}${discount}; ${expires}`;
};

// "A, B y C" with at most six items.
export const listInSpanish = (items: string[], max = 6) => {
  const shown = items.slice(0, max);
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} y ${shown.at(-1)}` : (shown[0] ?? '');
};

// "Cerca de mí" without a neighborhood: ask for it and say where there are stores.
export const askNeighborhood = (neighborhoods: string[]) => {
  const list = listInSpanish(neighborhoods);
  return `Para buscar cerca de ti, dime tu barrio${list ? `. Hay tiendas en ${list}` : ''}.`;
};

// Start of the question asked by the "Tiendas cercanas" button: the next answer is read as the neighborhood.
export const storesQuestionStart = 'Para mostrarte las tiendas cercanas, dime en qué barrio estás';
export const askNeighborhoodForStores = (neighborhoods: string[]) => {
  const list = listInSpanish(neighborhoods);
  return list ? `${storesQuestionStart}. Hay tiendas afiliadas en ${list}.` : `${storesQuestionStart}. Todavía no hay tiendas afiliadas, pero pronto llegarán.`;
};

export const buildReply = (intent: SearchIntent, results: AssistantResult[], neighborhoods: string[] = []) => {
  const what = intent.terms.length ? `«${intent.terms.join(' ')}»` : 'productos';
  const nearbyHint = intent.wantsNearby && !intent.neighborhood ? askNeighborhood(neighborhoods) : '';
  if (!intent.terms.length && intent.preference === 'relevance') return nearbyHint || '¿Qué producto buscas? Escribe por ejemplo «huevos baratos», «leche cerca» u «ofertas de hoy».';
  if (!results.length) return `No encontré ${what} disponibles${intent.neighborhood ? ` en ${intent.neighborhood}` : ''}. Prueba con otra palabra o revisa el catálogo.`;
  const stores = new Set(results.map((result) => result.store.id)).size;
  const inStores = stores > 1 ? ` en ${stores} tiendas` : '';
  const parts = [`Encontré ${results.length} ${results.length === 1 ? 'opción' : 'opciones'} de ${what}${inStores}. ${preferenceLabels[intent.preference]}: ${describeResult(results[0])}.`];
  if (nearbyHint) parts.push(nearbyHint);
  return parts.join(' ');
};

const aiIntentSchema = z.object({
  terms: z.array(z.string().trim().min(2).max(40).regex(/^[\p{L}\d ]+$/u)).max(5),
  preference: z.enum(searchPreferences),
});

const aiPrompt = `Interpretas búsquedas de clientes de tiendas de barrio en Colombia.
Devuelve JSON {"terms": palabras del producto buscado (sin preferencias ni lugares), "preference": una de ${searchPreferences.join(', ')}}.
cheapest = más barato, best_deal = mayor descuento u oferta, best_grade = mejor categoría o calidad, expiring = por vencer.`;

// The provider can only refine the terms and the preference; location handling always comes from local rules.
const resolveIntent = async (message: string, neighborhoods: string[]): Promise<SearchIntent> => {
  const local = parseIntent(message, neighborhoods);
  // The rules already understood the product: no need to spend the model quota.
  if (local.terms.length || local.preference !== 'relevance') return local;
  const answer = await requestJson(aiPrompt, { message }, aiIntentSchema);
  if (!answer || !answer.terms.length) return local;
  const terms = [...new Set(answer.terms.map((term) => singularize(normalizeText(term))))];
  return { ...local, terms, preference: answer.preference };
};

const toResult = (row: SearchRow, today: string): AssistantResult => ({
  productId: row.id,
  name: row.name,
  category: row.category,
  price: row.price,
  offerPrice: row.offerPrice,
  discountPercent: row.discountPercent,
  stock: row.stock,
  expirationDate: row.expirationDate,
  daysToExpire: daysBetween(today, row.expirationDate),
  store: { id: row.storeId, name: row.storeName, neighborhood: row.neighborhood, address: row.address },
});

export interface ResultFilters {
  category?: string;
  maxPrice?: number;
  limit?: number;
}

// Real products from the database for an intent: never anything the database does not have.
export const findResults = async (intent: SearchIntent, filters: ResultFilters = {}, today = todayInBogota()) => {
  if (!intent.terms.length && intent.preference === 'relevance' && !filters.category) return [];
  const options = {
    neighborhood: intent.neighborhood,
    category: filters.category,
    maxPrice: filters.maxPrice,
    onlyDiscounted: intent.preference === 'best_deal' && !intent.terms.length,
    limit: candidateLimit,
    today,
  };
  const stems = (terms: string[]) => terms.map(searchStem);
  let rows = await productRepository.search(stems(intent.terms), { ...options, matchAll: true });
  // Accent-free search first, then common synonyms, and only then any of the words.
  for (const variant of rows.length ? [] : synonymVariants(intent.terms)) {
    rows = await productRepository.search(stems(variant), { ...options, matchAll: true });
    if (rows.length) break;
  }
  if (!rows.length && intent.terms.length > 1) rows = await productRepository.search(stems(intent.terms), { ...options, matchAll: false });
  const sellable = rows.map((row) => toResult(row, today)).filter((result) => result.daysToExpire >= 0);
  return rankResults(sellable, intent.preference).slice(0, filters.limit ?? maxAssistantResults);
};

// The neighborhood chosen by the customer filters the search when the message does not name one.
export const withChosenNeighborhood = <T extends SearchIntent>(intent: T, chosen: string | undefined, neighborhoods: string[]): T => {
  if (intent.neighborhood || !chosen) return intent;
  const known = neighborhoods.find((item) => normalizeText(item) === normalizeText(chosen));
  return known ? { ...intent, neighborhood: known } : intent;
};

export const searchAssistant = async (query: AssistantQuery, today = todayInBogota()) => {
  const neighborhoods = await storeRepository.listNeighborhoods();
  const intent = withChosenNeighborhood(await resolveIntent(query.message, neighborhoods), query.neighborhood, neighborhoods);
  const results = await findResults(intent, {}, today);
  return {
    reply: buildReply(intent, results, neighborhoods),
    intent: { terms: intent.terms, preference: intent.preference, neighborhood: intent.neighborhood ?? null },
    results,
  };
};
