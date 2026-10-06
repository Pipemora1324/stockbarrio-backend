import { config } from '../config.js';

export interface RecommendationInput {
  budget: number;
  neighborhood: string;
  products: Array<{ name: string; price: number; offerPrice: number; stock: number; expirationDate: string }>;
}

export interface Recommendation {
  suggestion: string;
  products: Array<{ name: string; price: number; offerPrice: number; quantity: number; total: number }>;
  total: number;
  savings: number;
  confidence: number;
}

const localRecommendation = (input: RecommendationInput): Recommendation => {
  const offers = input.products.filter((product) => product.stock > 0).sort((first, second) => second.offerPrice / second.stock - first.offerPrice / first.stock);
  const selected: Recommendation['products'] = [];
  let total = 0;
  let savings = 0;
  for (const product of offers) {
    if (selected.length >= 4 || total + product.offerPrice > input.budget) continue;
    const quantity = Math.min(3, Math.max(1, Math.floor(input.budget / product.offerPrice)));
    const itemTotal = product.offerPrice * quantity;
    if (total + itemTotal > input.budget) continue;
    selected.push({ ...product, quantity, total: itemTotal });
    total += itemTotal;
    savings += product.price * quantity - itemTotal;
  }
  return { suggestion: selected.length ? `Para ${input.neighborhood}, el combo más equilibrado alcanza ${total.toFixed(2)} con ${selected.length} productos.` : 'No hay productos suficientes para formar un combo dentro del presupuesto indicado.', products: selected, total, savings, confidence: 0.82 };
};

export const getRecommendations = async (input: RecommendationInput): Promise<Recommendation> => {
  if (config.aiProvider === 'local') return localRecommendation(input);
  if (!config.openAiApiKey) throw new Error('La configuración de IA no tiene una clave válida.');
  const response = await fetch(`${config.openAiBaseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.openAiApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.openAiModel, temperature: 0.35, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Eres un asistente de compras de barrio. Responde en español, usa únicamente los productos proporcionados y devuelve JSON con suggestion, products, total, savings, confidence.' }, { role: 'user', content: JSON.stringify(input) }] }), signal: AbortSignal.timeout(config.aiTimeoutMs) });
  if (!response.ok) throw new Error('La IA no pudo procesar la recomendación.');
  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return JSON.parse(data.choices[0].message.content) as Recommendation;
};
