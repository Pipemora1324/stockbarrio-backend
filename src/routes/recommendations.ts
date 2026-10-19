import { Router } from 'express';
import { z } from 'zod';
import { getRecommendations } from '../services/ai.js';
import { productRepository } from '../repositories/product.js';

const router = Router();
const schema = z.object({ budget: z.coerce.number().positive().max(100_000_000), neighborhood: z.string().trim().min(2), productIds: z.array(z.string().uuid()).max(30).default([]) });

router.post('/', async (request, response, next) => {
  try {
    const input = schema.parse(request.body);
    const products = await productRepository.list({ neighborhood: input.neighborhood });
    // Without a selection, the combo can use any product of the neighborhood.
    const selected = input.productIds.length ? products.filter((product) => input.productIds.includes(product.id)) : products;
    const result = await getRecommendations({
      budget: input.budget,
      neighborhood: input.neighborhood,
      products: selected.map((product) => ({ id: product.id, name: product.name, price: product.price, offerPrice: product.offerPrice, stock: product.stock, expirationDate: product.expirationDate })),
    });
    response.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
