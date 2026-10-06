import { Router } from 'express';
import { z } from 'zod';
import { getRecommendations } from '../services/ai.js';
import { productRepository } from '../repositories/product.js';

const router = Router();
const schema = z.object({ budget: z.coerce.number().positive(), neighborhood: z.string().trim().min(2), productIds: z.array(z.string().uuid()).max(30) });

router.post('/', async (request, response, next) => {
  try {
    const input = schema.parse(request.body);
    const products = await productRepository.list({ neighborhood: input.neighborhood });
    const selected = products.filter((product) => input.productIds.includes(product.id));
    const result = await getRecommendations({ budget: input.budget, neighborhood: input.neighborhood, products: selected.map((product) => ({ name: product.name, price: Number(product.price), offerPrice: Number(product.offerPrice), stock: Number(product.stock), expirationDate: product.expirationDate.toISOString() })) });
    response.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
