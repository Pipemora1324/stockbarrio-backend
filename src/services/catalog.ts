import type { CatalogRow } from '../repositories/product.js';

export interface CatalogGroup {
  store: { id: string; name: string; neighborhood: string; address: string; phone: string };
  products: Array<Omit<CatalogRow, 'storeName' | 'neighborhood' | 'address' | 'phone'>>;
}

// Rows come ordered by store; each store becomes one group with its own header and products, in the same order.
export const groupByStore = (rows: CatalogRow[]): CatalogGroup[] => {
  const groups = new Map<string, CatalogGroup>();
  for (const { storeName, neighborhood, address, phone, ...product } of rows) {
    let group = groups.get(product.storeId);
    if (!group) {
      group = { store: { id: product.storeId, name: storeName, neighborhood, address, phone }, products: [] };
      groups.set(product.storeId, group);
    }
    group.products.push(product);
  }
  return [...groups.values()];
};
