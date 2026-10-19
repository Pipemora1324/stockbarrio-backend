import { normalizeText } from './discount-rules.js';

export const searchPreferences = ['relevance', 'cheapest', 'best_deal', 'best_grade', 'nearest', 'expiring'] as const;
export type SearchPreference = (typeof searchPreferences)[number];

export interface SearchIntent {
  terms: string[];
  preference: SearchPreference;
  wantsNearby: boolean;
  neighborhood?: string;
}

// Phrases are checked on the normalized message (lowercase, no accents). Longer phrases go first.
const preferencePhrases: Array<{ preference: Exclude<SearchPreference, 'relevance'>; phrases: string[] }> = [
  { preference: 'expiring', phrases: ['por vencer', 'proximo a vencer', 'proximos a vencer', 'a punto de vencer', 'vence pronto', 'vencen pronto', 'que vence', 'que vencen'] },
  { preference: 'best_grade', phrases: ['mejor categoria', 'mejor calidad', 'la mejor', 'el mejor', 'los mejores', 'las mejores', 'premium', 'triple a'] },
  { preference: 'best_deal', phrases: ['mejor oferta', 'mejores ofertas', 'mas descuento', 'mayor descuento', 'en oferta', 'ofertas', 'oferta', 'descuento', 'descuentos', 'rebaja', 'promocion'] },
  { preference: 'cheapest', phrases: ['mas barato', 'mas baratos', 'mas barata', 'mas baratas', 'baratos', 'baratas', 'barato', 'barata', 'economico', 'economicos', 'economica', 'menor precio', 'mejor precio'] },
  { preference: 'nearest', phrases: ['cerca de mi', 'cerca a mi', 'mas cerca', 'mas cercano', 'mas cercana', 'cercano', 'cercana', 'cerquita', 'cerca'] },
];

const stopWords = new Set([
  'busco', 'buscar', 'buscando', 'quiero', 'queria', 'necesito', 'me', 'gustaria', 'hay', 'tienen', 'tiene', 'venden', 'vende', 'donde', 'consigo', 'conseguir',
  'comprar', 'compro', 'dame', 'muestrame', 'mostrar', 'ver', 'por', 'favor', 'porfa', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'en',
  'a', 'al', 'y', 'o', 'para', 'con', 'que', 'mi', 'mis', 'algo', 'algun', 'alguna', 'producto', 'productos', 'tienda', 'tiendas', 'hola', 'buenas', 'buenos',
  'dias', 'tardes', 'noches', 'mas', 'muy', 'lo', 'le', 'se', 'es', 'son', 'esta', 'estan', 'hoy', 'aqui', 'aca', 'barrio', 'sector', 'zona', 'mismo',
  'puedo', 'puede', 'pueden', 'encontrar', 'encuentro', 'cuanto', 'cuesta', 'cuestan', 'vale', 'valen', 'precio', 'precios', 'quisiera', 'dime', 'sabes',
  'existe', 'queda', 'quedan', 'alguna', 'alguno', 'ayudame', 'ayudas', 'y', 'tambien', 'otra', 'otro', 'opcion', 'opciones', 'mejor',
]);

// Simple Spanish plural to singular so "huevos" matches "Huevos AA" and "panes" matches "Pan tajado".
export const singularize = (word: string) => {
  if (word.length > 4 && word.endsWith('ces')) return `${word.slice(0, -3)}z`;
  if (word.length > 4 && /[^aeiou]es$/.test(word) && !/(ies|ues)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
};

export const parseIntent = (message: string, knownNeighborhoods: string[] = []): SearchIntent => {
  let text = ` ${normalizeText(message).replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let preference: SearchPreference = 'relevance';
  let wantsNearby = false;

  for (const group of preferencePhrases) {
    for (const phrase of group.phrases) {
      if (!text.includes(` ${phrase} `)) continue;
      if (group.preference === 'nearest') wantsNearby = true;
      if (preference === 'relevance' || (preference === 'nearest' && group.preference !== 'nearest')) preference = group.preference;
      text = text.replaceAll(` ${phrase} `, ' ');
    }
  }
  if (wantsNearby && preference === 'relevance') preference = 'nearest';

  let neighborhood: string | undefined;
  for (const candidate of [...knownNeighborhoods].sort((first, second) => second.length - first.length)) {
    const normalized = normalizeText(candidate);
    if (normalized && text.includes(` ${normalized} `)) {
      neighborhood = candidate;
      text = text.replaceAll(` ${normalized} `, ' ');
      break;
    }
  }

  const terms = [...new Set(text.split(' ').filter((word) => word.length > 1 && !stopWords.has(word)).map(singularize))].slice(0, 5);
  return { terms, preference, wantsNearby, ...(neighborhood ? { neighborhood } : {}) };
};

// Search root: drops a final "a"/"o" in longer words so "asada" finds "asado" and "tajada" finds "tajado".
export const searchStem = (term: string) => (term.length >= 5 && /[ao]$/.test(term) ? term.slice(0, -1) : term);

// Common Colombian names for the same product (accent-free, singular). Used when the literal search finds nothing.
const synonymGroups: string[][] = [
  ['gaseosa', 'refresco', 'soda'],
  ['banano', 'banana', 'guineo'],
  ['frijol', 'frejol', 'poroto'],
  ['papa', 'patata'],
  ['aguacate', 'palta'],
  ['arveja', 'guisante'],
  ['mantequilla', 'margarina'],
  ['crispeta', 'palomita', 'maiz pira'],
  ['salchicha', 'salchichon'],
  ['gallina', 'pollo'],
  ['jabon', 'detergente'],
  ['yogur', 'yogurt', 'kumis'],
  ['bocadillo', 'guayaba'],
  ['tinto', 'cafe'],
  ['panela', 'piloncillo'],
];

export const synonymsOf = (term: string) => synonymGroups.find((group) => group.includes(term))?.filter((item) => item !== term) ?? [];

// Alternative term lists, replacing one term at a time by each synonym.
export const synonymVariants = (terms: string[]) =>
  terms.flatMap((term, index) => synonymsOf(term).map((synonym) => terms.map((item, position) => (position === index ? synonym : item))));
