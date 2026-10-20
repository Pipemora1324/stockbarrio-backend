import { normalizeText } from './discount-rules.js';

export const searchPreferences = ['relevance', 'cheapest', 'best_deal', 'best_grade', 'expiring'] as const;
export type SearchPreference = (typeof searchPreferences)[number];

export interface SearchIntent {
  terms: string[];
  preference: SearchPreference;
  // "Cerca de mí": no hay distancias, así que solo significa "en mi barrio".
  wantsNearby: boolean;
  neighborhood?: string;
}

// Las frases se buscan en el mensaje normalizado (minúsculas, sin tildes). Las más largas van primero.
const preferencePhrases: Array<{ preference: Exclude<SearchPreference, 'relevance'>; phrases: string[] }> = [
  { preference: 'expiring', phrases: ['por vencer', 'proximo a vencer', 'proximos a vencer', 'a punto de vencer', 'vence pronto', 'vencen pronto', 'que vence', 'que vencen'] },
  { preference: 'best_grade', phrases: ['mejor categoria', 'mejor calidad', 'la mejor', 'el mejor', 'los mejores', 'las mejores', 'premium', 'triple a'] },
  { preference: 'best_deal', phrases: ['mejor oferta', 'mejores ofertas', 'mas descuento', 'mayor descuento', 'en oferta', 'ofertas', 'oferta', 'descuento', 'descuentos', 'rebaja', 'promocion'] },
  { preference: 'cheapest', phrases: ['mas barato', 'mas baratos', 'mas barata', 'mas baratas', 'baratos', 'baratas', 'barato', 'barata', 'economico', 'economicos', 'economica', 'menor precio', 'mejor precio'] },
];
const nearbyPhrases = ['cerca de mi', 'cerca a mi', 'mas cerca', 'mas cercano', 'mas cercana', 'cercanos', 'cercanas', 'cercano', 'cercana', 'cerquita', 'cerca'];

const stopWords = new Set([
  'busco', 'buscar', 'buscando', 'quiero', 'queria', 'necesito', 'me', 'gustaria', 'hay', 'tienen', 'tiene', 'venden', 'vende', 'donde', 'consigo', 'conseguir',
  'comprar', 'compro', 'dame', 'muestrame', 'mostrar', 'ver', 'por', 'favor', 'porfa', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'en',
  'a', 'al', 'y', 'o', 'para', 'con', 'que', 'mi', 'mis', 'algo', 'algun', 'alguna', 'producto', 'productos', 'tienda', 'tiendas', 'hola', 'buenas', 'buenos',
  'dias', 'tardes', 'noches', 'mas', 'muy', 'lo', 'le', 'se', 'es', 'son', 'esta', 'estan', 'hoy', 'aqui', 'aca', 'barrio', 'sector', 'zona', 'mismo',
  'puedo', 'puede', 'pueden', 'encontrar', 'encuentro', 'cuanto', 'cuesta', 'cuestan', 'vale', 'valen', 'precio', 'precios', 'quisiera', 'dime', 'sabes',
  'existe', 'queda', 'quedan', 'alguna', 'alguno', 'ayudame', 'ayudas', 'y', 'tambien', 'otra', 'otro', 'opcion', 'opciones', 'mejor',
]);

// Plural a singular simple en español, para que "huevos" encuentre "Huevos AA" y "panes" encuentre "Pan tajado".
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
      if (preference === 'relevance') preference = group.preference;
      text = text.replaceAll(` ${phrase} `, ' ');
    }
  }
  for (const phrase of nearbyPhrases) {
    if (!text.includes(` ${phrase} `)) continue;
    wantsNearby = true;
    text = text.replaceAll(` ${phrase} `, ' ');
  }

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

// Raíz de búsqueda: quita una "a"/"o" final en palabras largas para que "asada" encuentre "asado" y "tajada" encuentre "tajado".
export const searchStem = (term: string) => (term.length >= 5 && /[ao]$/.test(term) ? term.slice(0, -1) : term);

// Nombres colombianos comunes del mismo producto (sin tildes, en singular). Se usan cuando la búsqueda literal no encuentra nada.
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

// Listas alternativas de términos, cambiando un término a la vez por cada sinónimo.
export const synonymVariants = (terms: string[]) =>
  terms.flatMap((term, index) => synonymsOf(term).map((synonym) => terms.map((item, position) => (position === index ? synonym : item))));
