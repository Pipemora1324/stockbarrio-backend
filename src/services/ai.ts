import { daysBetween, todayInBogota } from '../dates.js';
import { formatCop } from '../format.js';

export interface RecommendationProduct {
  id: string;
  name: string;
  price: number;
  offerPrice: number;
  stock: number;
  expirationDate: string;
}

export interface RecommendationInput {
  budget: number;
  neighborhood: string;
  products: RecommendationProduct[];
}

export interface Recommendation {
  suggestion: string;
  products: Array<{ productId: string; name: string; price: number; offerPrice: number; quantity: number; total: number; expirationDate: string }>;
  total: number;
  savings: number;
  confidence: number;
}

export const maxComboItems = 5;
export const maxUnitsPerProduct = 3;

const buildCombo = (input: RecommendationInput, picks: Array<{ product: RecommendationProduct; quantity: number }>) => {
  const products = picks.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    price: product.price,
    offerPrice: product.offerPrice,
    quantity,
    total: product.offerPrice * quantity,
    expirationDate: product.expirationDate,
  }));
  const total = products.reduce((sum, item) => sum + item.total, 0);
  const savings = products.reduce((sum, item) => sum + (item.price - item.offerPrice) * item.quantity, 0);
  return { products, total, savings };
};

const describeCombo = (input: RecommendationInput, combo: ReturnType<typeof buildCombo>) =>
  combo.products.length
    ? `Para ${input.neighborhood} armamos un combo de ${combo.products.length} ${combo.products.length === 1 ? 'producto' : 'productos'} por ${formatCop(combo.total)}${combo.savings > 0 ? ` y ahorras ${formatCop(combo.savings)}` : ''}. Primero va lo que vence antes: ${combo.products[0].name}.`
    : 'No hay productos suficientes para formar un combo dentro del presupuesto indicado.';

// Sellable products ordered by urgency: closest expiration, then the biggest relative saving, then the cheapest.
export const rankForCombo = (products: RecommendationProduct[], today: string) =>
  products
    .filter((product) => product.stock > 0 && product.offerPrice > 0 && daysBetween(today, product.expirationDate) >= 0)
    .sort(
      (first, second) =>
        first.expirationDate.localeCompare(second.expirationDate) ||
        (second.price - second.offerPrice) / second.price - (first.price - first.offerPrice) / first.price ||
        first.offerPrice - second.offerPrice,
    );

export const localRecommendation = (input: RecommendationInput, today = todayInBogota()): Recommendation => {
  let remaining = input.budget;
  const picks: Array<{ product: RecommendationProduct; quantity: number }> = [];
  for (const product of rankForCombo(input.products, today)) {
    if (picks.length >= maxComboItems) break;
    const quantity = Math.min(product.stock, maxUnitsPerProduct, Math.floor(remaining / product.offerPrice));
    if (quantity < 1) continue;
    picks.push({ product, quantity });
    remaining -= product.offerPrice * quantity;
  }
  const combo = buildCombo(input, picks);
  return { suggestion: describeCombo(input, combo), ...combo, confidence: 0.8 };
};

// Combos are solved well by the rules, so they never spend AI quota.
export const getRecommendations = async (input: RecommendationInput): Promise<Recommendation> => localRecommendation(input);
