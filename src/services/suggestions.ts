import type { PoolClient } from 'pg';
import { z } from 'zod';
import { database } from '../database.js';
import { todayInBogota } from '../dates.js';
import { conflict, notFound } from '../errors.js';
import { productRepository } from '../repositories/product.js';
import { suggestionRepository, type SuggestionValues } from '../repositories/suggestion.js';
import { analyzeInventory, maxSuggestedPercent, priceWithDiscount, type DiscountSuggestion } from './discount-rules.js';
import { isLlmEnabled, requestJson } from './llm.js';

export interface AppliedDiscount {
  productId: string;
  storeId: string;
  discountPercent: number;
  offerPrice: number;
}

// The provider may only reword reasons, reorder, and nudge a percent by a few points.
export const maxAiAdjustment = 5;

const aiResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        productId: z.string(),
        reason: z.string().trim().min(10).max(300),
        suggestedPercent: z.number().int().min(0).max(100).optional(),
      }),
    )
    .max(100),
});

const aiPrompt = `Eres un asesor de tiendas de barrio en Colombia. Recibes sugerencias de descuento calculadas con reglas.
Devuelve JSON {"suggestions":[{"productId","reason","suggestedPercent"}]} ordenado de la más urgente a la menos urgente.
Usa solo los productId recibidos. Escribe "reason" en español, en una frase corta y clara para el tendero.
Puedes ajustar "suggestedPercent" como máximo ${maxAiAdjustment} puntos respecto al recibido.`;

// Applies the provider's answer only if it passes every check; otherwise the local suggestions stay untouched.
export const mergeAiSuggestions = (local: DiscountSuggestion[], answer: z.infer<typeof aiResponseSchema> | null): Array<DiscountSuggestion & { priority: number; source: 'local' | 'ai' }> => {
  const fallback = local.map((suggestion, index) => ({ ...suggestion, priority: index, source: 'local' as const }));
  if (!answer) return fallback;
  const byId = new Map(local.map((suggestion) => [suggestion.productId, suggestion]));
  const answered = new Map(answer.suggestions.filter((item) => byId.has(item.productId)).map((item) => [item.productId, item]));
  // Every local suggestion must come back exactly once; anything else means the answer is not trustworthy.
  if (answered.size !== local.length || answer.suggestions.length !== local.length) return fallback;
  return [...answered.values()].map((item, index) => {
    const base = byId.get(item.productId)!;
    const lower = Math.max(base.currentPercent + 1, base.suggestedPercent - maxAiAdjustment);
    const upper = Math.min(maxSuggestedPercent, base.suggestedPercent + maxAiAdjustment);
    const suggestedPercent = Math.round(Math.min(upper, Math.max(lower, item.suggestedPercent ?? base.suggestedPercent)));
    return { ...base, reason: item.reason, suggestedPercent, priority: index, source: 'ai' as const };
  });
};

const improveWithAi = async (suggestions: DiscountSuggestion[], products: Map<string, { price: number; stock: number; category: string }>) => {
  if (!isLlmEnabled() || !suggestions.length) return mergeAiSuggestions(suggestions, null);
  const payload = suggestions.map((suggestion) => ({ ...suggestion, ...products.get(suggestion.productId) }));
  const merged = mergeAiSuggestions(suggestions, await requestJson(aiPrompt, { suggestions: payload }, aiResponseSchema));
  // Recompute prices from the real product price so the provider never decides an amount.
  return merged.map((item) => ({ ...item, suggestedPrice: priceWithDiscount(products.get(item.productId)!.price, item.suggestedPercent) }));
};

const toValues = (suggestion: DiscountSuggestion & { priority: number; source: 'local' | 'ai' }): SuggestionValues => ({
  productId: suggestion.productId,
  currentPercent: suggestion.currentPercent,
  suggestedPercent: suggestion.suggestedPercent,
  suggestedPrice: suggestion.suggestedPrice,
  daysToExpire: suggestion.daysToExpire,
  reason: suggestion.reason,
  priority: suggestion.priority,
  source: suggestion.source,
});

export const refreshSuggestions = async (storeId: string, today = todayInBogota()) => {
  const products = await productRepository.listByStore(storeId);
  const local = analyzeInventory(products, today);
  const enriched = await improveWithAi(local, new Map(products.map((product) => [product.id, product])));
  await database.withTransaction(async (client) => {
    const pending = await suggestionRepository.pendingByProduct(client, storeId);
    const rejected = await suggestionRepository.rejectedPercents(client, storeId);
    const kept = new Set<string>();
    for (const suggestion of enriched) {
      const pendingId = pending.get(suggestion.productId);
      if (pendingId) {
        await suggestionRepository.update(client, pendingId, toValues(suggestion));
        kept.add(suggestion.productId);
      } else if (suggestion.suggestedPercent > (rejected.get(suggestion.productId) ?? -1)) {
        await suggestionRepository.insert(client, storeId, toValues(suggestion));
      }
    }
    const stale = [...pending].filter(([productId]) => !kept.has(productId)).map(([, id]) => id);
    if (stale.length) await suggestionRepository.expire(client, stale);
  });
  return suggestionRepository.listPending(storeId);
};

const applyDiscount = async (client: PoolClient, storeId: string, suggestion: { id: string; productId: string; suggestedPercent: number }): Promise<AppliedDiscount | null> => {
  const product = await client.query<{ price: number; stock: number; active: boolean }>(
    'SELECT price, stock, active FROM products WHERE id = $1 AND store_id = $2 FOR UPDATE',
    [suggestion.productId, storeId],
  );
  const current = product.rows[0];
  if (!current?.active || current.stock <= 0) {
    await suggestionRepository.setStatus(client, suggestion.id, 'expired');
    return null;
  }
  const offerPrice = priceWithDiscount(Number(current.price), Number(suggestion.suggestedPercent));
  await client.query('UPDATE products SET discount_percent = $2, offer_price = $3 WHERE id = $1', [suggestion.productId, suggestion.suggestedPercent, offerPrice]);
  await suggestionRepository.setStatus(client, suggestion.id, 'approved');
  return { productId: suggestion.productId, storeId, discountPercent: Number(suggestion.suggestedPercent), offerPrice };
};

const assertPending = async (storeId: string, id: string) => {
  const suggestion = await suggestionRepository.findForStore(storeId, id);
  if (!suggestion) throw notFound('La sugerencia no existe.');
  if (suggestion.status !== 'pending') throw conflict('Esta sugerencia ya fue revisada.');
};

export const approveSuggestion = async (storeId: string, id: string): Promise<AppliedDiscount> => {
  await assertPending(storeId, id);
  const applied = await database.withTransaction(async (client) => {
    const [suggestion] = await suggestionRepository.lockPending(client, storeId, id);
    if (!suggestion) throw conflict('Esta sugerencia ya fue revisada.');
    return applyDiscount(client, storeId, suggestion);
  });
  if (!applied) throw conflict('El producto ya no está disponible, así que la sugerencia se descartó.');
  return applied;
};

export const approveAllSuggestions = async (storeId: string): Promise<AppliedDiscount[]> =>
  database.withTransaction(async (client) => {
    const applied: AppliedDiscount[] = [];
    for (const suggestion of await suggestionRepository.lockPending(client, storeId)) {
      const result = await applyDiscount(client, storeId, suggestion);
      if (result) applied.push(result);
    }
    return applied;
  });

export const rejectSuggestion = async (storeId: string, id: string) => {
  await assertPending(storeId, id);
  await database.withTransaction(async (client) => {
    const [suggestion] = await suggestionRepository.lockPending(client, storeId, id);
    if (!suggestion) throw conflict('Esta sugerencia ya fue revisada.');
    await suggestionRepository.setStatus(client, suggestion.id, 'rejected');
  });
};
