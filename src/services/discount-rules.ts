import { daysBetween } from '../dates.js';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  expirationDate: string;
  discountPercent: number;
}

export interface DiscountSuggestion {
  productId: string;
  productName: string;
  daysToExpire: number;
  currentPercent: number;
  suggestedPercent: number;
  suggestedPrice: number;
  reason: string;
}

// Base discount by days left before expiration. Products with more days left get no suggestion.
export const expirationTiers: ReadonlyArray<{ maxDays: number; percent: number; label: string }> = [
  { maxDays: 0, percent: 50, label: 'vence hoy' },
  { maxDays: 1, percent: 40, label: 'vence mañana' },
  { maxDays: 3, percent: 30, label: 'vence en {days} días' },
  { maxDays: 7, percent: 20, label: 'vence en {days} días' },
  { maxDays: 14, percent: 10, label: 'vence en {days} días' },
];

// Extra points when there is more stock than the store can usually sell before the date.
export const stockBonuses: ReadonlyArray<{ minStock: number; percent: number }> = [
  { minStock: 30, percent: 10 },
  { minStock: 15, percent: 5 },
];

// Fresh categories spoil fast, so they get a small extra push.
export const perishableCategories = ['lacteos', 'panaderia', 'frutas y verduras', 'carnes', 'carnes frias', 'pescados', 'huevos'];
export const perishableBonus = 5;
export const maxSuggestedPercent = 70;

export const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const roundToFive = (value: number) => Math.round(value / 5) * 5;
export const priceWithDiscount = (price: number, percent: number) => Math.max(0, Math.round(price * (1 - percent / 100)));

export const suggestDiscount = (item: InventoryItem, today: string): DiscountSuggestion | null => {
  const daysToExpire = daysBetween(today, item.expirationDate);
  // Expired products must be removed from sale, not discounted.
  if (daysToExpire < 0 || item.stock <= 0) return null;
  const tier = expirationTiers.find((candidate) => daysToExpire <= candidate.maxDays);
  if (!tier) return null;

  const reasons = [tier.label.replace('{days}', String(daysToExpire))];
  let percent = tier.percent;
  const stockBonus = stockBonuses.find((bonus) => item.stock >= bonus.minStock);
  if (stockBonus) {
    percent += stockBonus.percent;
    reasons.push(`tienes ${item.stock} unidades (exceso de stock)`);
  }
  if (perishableCategories.includes(normalizeText(item.category))) {
    percent += perishableBonus;
    reasons.push(`${item.category.toLowerCase()} es una categoría perecedera`);
  }
  const suggestedPercent = Math.min(maxSuggestedPercent, roundToFive(percent));
  if (suggestedPercent <= item.discountPercent) return null;

  const suggestedPrice = priceWithDiscount(item.price, suggestedPercent);
  const sentence = reasons.join(', ');
  return {
    productId: item.id,
    productName: item.name,
    daysToExpire,
    currentPercent: item.discountPercent,
    suggestedPercent,
    suggestedPrice,
    reason: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}: sugerimos ${suggestedPercent} % de descuento.`,
  };
};

// Most urgent first: fewer days left, then the bigger discount.
export const analyzeInventory = (items: InventoryItem[], today: string): DiscountSuggestion[] =>
  items
    .map((item) => suggestDiscount(item, today))
    .filter((suggestion): suggestion is DiscountSuggestion => suggestion !== null)
    .sort((first, second) => first.daysToExpire - second.daysToExpire || second.suggestedPercent - first.suggestedPercent);
