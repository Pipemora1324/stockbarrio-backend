import { z } from 'zod';
import { daysBetween, todayInBogota } from '../dates.js';
import { formatCop } from '../format.js';
import { requestJson } from './llm.js';

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

const aiComboSchema = z.object({
  suggestion: z.string().trim().min(10).max(400),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1) })).min(1).max(maxComboItems),
});

const aiPrompt = `Eres un asistente de compras de barrio en Colombia. Arma un combo con los productos recibidos sin pasarte del presupuesto (pesos colombianos).
Prioriza los que vencen antes. Devuelve JSON {"suggestion": texto corto en español, "items":[{"productId","quantity"}]}.
Usa solo los productId recibidos, como máximo ${maxUnitsPerProduct} unidades por producto y nunca más que el stock.`;

// Accepts the provider's combo only if every item exists, respects stock and limits, and the real total fits the budget.
export const validateAiCombo = (input: RecommendationInput, answer: z.infer<typeof aiComboSchema> | null, today = todayInBogota()): Recommendation | null => {
  if (!answer) return null;
  const sellable = new Map(rankForCombo(input.products, today).map((product) => [product.id, product]));
  const seen = new Set<string>();
  const picks: Array<{ product: RecommendationProduct; quantity: number }> = [];
  for (const item of answer.items) {
    const product = sellable.get(item.productId);
    if (!product || seen.has(item.productId) || item.quantity > Math.min(product.stock, maxUnitsPerProduct)) return null;
    seen.add(item.productId);
    picks.push({ product, quantity: item.quantity });
  }
  const combo = buildCombo(input, picks);
  if (combo.total > input.budget) return null;
  return { suggestion: answer.suggestion, ...combo, confidence: 0.9 };
};

export const getRecommendations = async (input: RecommendationInput): Promise<Recommendation> => {
  const local = localRecommendation(input);
  if (!local.products.length) return local;
  const payload = { budget: input.budget, neighborhood: input.neighborhood, products: rankForCombo(input.products, todayInBogota()) };
  return validateAiCombo(input, await requestJson(aiPrompt, payload, aiComboSchema)) ?? local;
};
