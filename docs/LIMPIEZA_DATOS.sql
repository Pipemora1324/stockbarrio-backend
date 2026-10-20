-- =====================================================================================
-- Stock Barrio: limpieza de datos para empezar desde cero
-- =====================================================================================
-- Qué hace: borra TODOS los productos y TODOS los locales (los de demostración del seed y los
-- creados por las pruebas), pone users.store_id en NULL y deja intactas las cuentas (users),
-- con su rol, su contraseña y su auth_id de Supabase.
--
-- Cómo usarlo (lo corre una persona a mano; NO es una migración y la app nunca lo ejecuta):
--   1. Exporta los datos antes (ver "Exportar antes de limpiar" en el README).
--   2. En Supabase, abre SQL Editor y pega este archivo.
--   3. Corre primero solo la PARTE 1 (vista previa) y revisa los conteos y las filas.
--   4. Corre la PARTE 2 completa. Termina en ROLLBACK: no cambia nada, solo muestra lo que pasaría.
--   5. Si lo que ves está bien, cambia la última línea de la PARTE 2 de ROLLBACK a COMMIT y córrela otra vez.
--   6. Corre la PARTE 3 para verificar.
--
-- Después de limpiar: los vendedores siguen pudiendo entrar. El panel nuevo les muestra
-- "Crea tu primer local". Las alertas y notificaciones de los productos borrados se van con ellos.
-- =====================================================================================


-- =====================================================================================
-- PARTE 1: VISTA PREVIA (solo lectura)
-- =====================================================================================

-- Conteos de lo que se va a borrar y de lo que se conserva.
SELECT 'locales a borrar' AS que, count(*) AS filas FROM stores
UNION ALL SELECT 'productos a borrar', count(*) FROM products
UNION ALL SELECT 'sugerencias de descuento a borrar', count(*) FROM discount_suggestions
UNION ALL SELECT 'notificaciones de esos productos a borrar', count(*) FROM notifications WHERE product_id IS NOT NULL
UNION ALL SELECT 'cuentas con store_id que quedará en NULL', count(*) FROM users WHERE store_id IS NOT NULL
UNION ALL SELECT 'cuentas que se conservan (todas)', count(*) FROM users
UNION ALL SELECT 'cuentas con auth_id que se conservan', count(*) FROM users WHERE auth_id IS NOT NULL;

-- Locales que se van a borrar, con su dueño y cuántos productos tienen.
-- Los correos @stockbarrio.test son del seed de desarrollo o de las pruebas.
SELECT s.id, s.name AS local, s.neighborhood AS barrio, s.active AS activo, u.email AS dueno,
       u.email LIKE '%@stockbarrio.test' AS es_demo_o_prueba,
       (SELECT count(*) FROM products p WHERE p.store_id = s.id) AS productos
FROM stores s LEFT JOIN users u ON u.id = s.user_id
ORDER BY es_demo_o_prueba DESC, s.name;

-- Productos que se van a borrar (los primeros 200).
SELECT p.id, p.name AS producto, p.category AS categoria, s.name AS local, p.discount_percent AS descuento,
       p.offer_starts_on AS oferta_desde, p.offer_ends_on AS oferta_hasta, p.expiration_date AS vence
FROM products p JOIN stores s ON s.id = p.store_id
ORDER BY s.name, p.name
LIMIT 200;


-- =====================================================================================
-- PARTE 2: LIMPIEZA DENTRO DE UNA TRANSACCIÓN (por defecto termina en ROLLBACK)
-- =====================================================================================
BEGIN;

-- 1) Las cuentas dejan de apuntar a un local (users se conserva completo, con su auth_id).
UPDATE users SET store_id = NULL WHERE store_id IS NOT NULL;

-- 2) Lo que depende de los productos (también se borraría en cascada; se hace explícito para verlo).
DELETE FROM notifications WHERE product_id IS NOT NULL;
DELETE FROM discount_suggestions;

-- 3) Productos y locales.
DELETE FROM products;
DELETE FROM stores;

-- Cómo quedaría todo (dentro de la transacción).
SELECT 'locales' AS que, count(*) AS filas FROM stores
UNION ALL SELECT 'productos', count(*) FROM products
UNION ALL SELECT 'sugerencias', count(*) FROM discount_suggestions
UNION ALL SELECT 'cuentas', count(*) FROM users
UNION ALL SELECT 'cuentas con auth_id', count(*) FROM users WHERE auth_id IS NOT NULL
UNION ALL SELECT 'cuentas con store_id', count(*) FROM users WHERE store_id IS NOT NULL;

-- Por seguridad no se guarda nada. Cuando estés seguro, cambia ROLLBACK por COMMIT y vuelve a correr la PARTE 2.
ROLLBACK;


-- =====================================================================================
-- PARTE 3: VERIFICACIÓN (después del COMMIT)
-- =====================================================================================

-- Debe dar 0 locales, 0 productos, 0 sugerencias y 0 cuentas con store_id.
SELECT (SELECT count(*) FROM stores) AS locales,
       (SELECT count(*) FROM products) AS productos,
       (SELECT count(*) FROM discount_suggestions) AS sugerencias,
       (SELECT count(*) FROM users WHERE store_id IS NOT NULL) AS cuentas_con_local;

-- Las cuentas siguen ahí, con su rol y su auth_id.
SELECT role AS rol, count(*) AS cuentas, count(auth_id) AS con_auth_id FROM users GROUP BY role ORDER BY role;

-- La seguridad por filas (RLS) sigue activa en las tablas.
SELECT relname AS tabla, relrowsecurity AS rls_activa
FROM pg_class
WHERE relname IN ('users', 'stores', 'products', 'discount_suggestions', 'notifications', 'alert_subscriptions')
ORDER BY relname;
