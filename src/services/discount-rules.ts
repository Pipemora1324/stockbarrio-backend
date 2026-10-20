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

// Descuento base según los días que faltan para vencer. Con más días no hay sugerencia.
export const expirationTiers: ReadonlyArray<{ maxDays: number; percent: number; label: string }> = [
  { maxDays: 0, percent: 50, label: 'vence hoy' },
  { maxDays: 1, percent: 40, label: 'vence mañana' },
  { maxDays: 3, percent: 30, label: 'vence en {days} días' },
  { maxDays: 7, percent: 20, label: 'vence en {days} días' },
  { maxDays: 14, percent: 10, label: 'vence en {days} días' },
];

// Puntos extra cuando hay más stock del que la tienda suele vender antes de la fecha. No hay datos de ventas,
// así que nada aquí habla de "rotación": solo se usan el stock y los días que faltan.
export const stockBonuses: ReadonlyArray<{ minStock: number; percent: number }> = [
  { minStock: 30, percent: 10 },
  { minStock: 15, percent: 5 },
];

// Solo los productos perecederos reciben sugerencias automáticas (nombres sin tildes de las categorías del catálogo).
// Enlatados, granos, bebidas, productos de aseo y el resto nunca se sugieren, aunque la tienda puede
// poner cualquier producto en oferta a mano.
export const perishableCategories = ['frutas y verduras', 'carnes', 'carnes frias', 'pollo', 'pescados y mariscos', 'lacteos', 'comidas preparadas', 'panaderia', 'huevos'];
export const maxSuggestedPercent = 70;

export const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const isPerishable = (category: string) => perishableCategories.includes(normalizeText(category));

const roundToFive = (value: number) => Math.round(value / 5) * 5;
export const priceWithDiscount = (price: number, percent: number) => Math.max(0, Math.round(price * (1 - percent / 100)));

export const suggestDiscount = (item: InventoryItem, today: string): DiscountSuggestion | null => {
  const daysToExpire = daysBetween(today, item.expirationDate);
  // Los productos vencidos se retiran de la venta, no se rebajan; los no perecederos nunca se sugieren.
  if (daysToExpire < 0 || item.stock <= 0 || !isPerishable(item.category)) return null;
  const tier = expirationTiers.find((candidate) => daysToExpire <= candidate.maxDays);
  if (!tier) return null;

  const reasons = [tier.label.replace('{days}', String(daysToExpire))];
  let percent = tier.percent;
  const stockBonus = stockBonuses.find((bonus) => item.stock >= bonus.minStock);
  if (stockBonus) {
    percent += stockBonus.percent;
    reasons.push(`tienes ${item.stock} unidades (stock alto)`);
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

// Lo más urgente primero: menos días para vencer y luego el mayor descuento.
export const analyzeInventory = (items: InventoryItem[], today: string): DiscountSuggestion[] =>
  items
    .map((item) => suggestDiscount(item, today))
    .filter((suggestion): suggestion is DiscountSuggestion => suggestion !== null)
    .sort((first, second) => first.daysToExpire - second.daysToExpire || second.suggestedPercent - first.suggestedPercent);
