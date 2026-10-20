-- Productos de locales que se eliminaron (stores.active = false) antes de que eliminar un local desactivara también sus productos.
-- Un solo UPDATE idempotente: nunca borra filas y no puede fallar por los datos que ya existen.
UPDATE products p SET active = false
FROM stores s
WHERE s.id = p.store_id AND s.active = false AND p.active = true;
