-- Products of stores that were deleted (stores.active = false) before deleting a store also deactivated its products.
-- One idempotent UPDATE: it never deletes rows and cannot fail because of existing data.
UPDATE products p SET active = false
FROM stores s
WHERE s.id = p.store_id AND s.active = false AND p.active = true;
