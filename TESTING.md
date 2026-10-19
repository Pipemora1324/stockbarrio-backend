# Pruebas del backend

Las pruebas usan el runner nativo de Node (`node:test`) con `tsx`, y la cobertura se mide con `c8`. Corren en serie (`--test-concurrency=1`) porque los archivos de integración comparten la misma base de pruebas.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm test` | Corre todas las pruebas |
| `npm run test:coverage` | Corre las pruebas y genera el reporte en `coverage/` (texto en consola, `coverage/index.html` y `coverage/coverage-summary.json`) |
| `npx tsx --import ./test/setup.ts --test test/chat.test.ts` | Corre un solo archivo |

Sin `TEST_DATABASE_URL` solo corren las pruebas unitarias; las de integración aparecen como omitidas.

## Base de datos de pruebas

Las pruebas de integración levantan la API en un puerto libre y **borran el esquema `public`** de la base antes de cada archivo, así que necesitan una base desechable:

```bash
# Con Docker
docker run -d --name stock-test -p 5544:5432 -e POSTGRES_USER=stock -e POSTGRES_PASSWORD=stock -e POSTGRES_DB=stock_barrios_test postgres:16-alpine

# O con un Postgres instalado
createdb -U stock stock_barrios_test

TEST_DATABASE_URL=postgresql://stock:stock@localhost:5544/stock_barrios_test npm test
TEST_DATABASE_URL=postgresql://stock:stock@localhost:5544/stock_barrios_test npm run test:coverage
```

En PowerShell: `$env:TEST_DATABASE_URL = "postgresql://stock:stock@localhost:5544/stock_barrios_test"; npm test`.

### Protecciones

`test/setup.ts` se carga antes de cada archivo de prueba, antes de que la app lea su configuración:

- Si `TEST_DATABASE_URL` contiene `supabase.co` (incluye `pooler.supabase.com`), las pruebas **se niegan a correr**, aunque el nombre termine en `_test`.
- Solo se acepta una base cuyo nombre termine en `_test`. Además, antes de borrar nada, el helper confirma con `current_database()` que el nombre termina en `_test`.
- `DATABASE_URL` nunca se usa en pruebas: sin una base de pruebas válida, el pool apunta a un puerto donde no hay nada.
- Se vacían `OPENAI_API_KEY`, `AI_FALLBACK_API_KEY` y `SMTP_HOST`, y `AI_PROVIDER` queda en `local`. Ninguna clave real llega a las pruebas.
- `fetch` solo puede ir a `localhost`. Cualquier llamada a un proveedor de IA real falla; las pruebas de IA simulan Groq y Gemini con respuestas, 429, 5xx y tiempos de espera.

## Qué cubre cada suite

| Archivo | Tipo | Qué prueba |
| --- | --- | --- |
| `database-guard.test.ts` | Unitaria | Rechazo de URLs de Supabase, nombres `_test`, claves vacías y bloqueo de red |
| `auth.test.ts` | Integración | Login (mayúsculas, contraseña o correo errados con el mismo mensaje, hash roto), registro sin elegir rol ni repetir correo o tienda, JWT vencido o firmado con otro secreto, `token_version`, cuentas borradas, tokens antiguos sin `tv`, 403 por rol y tienda sin registro |
| `account.test.ts` | Integración | Recuperación de contraseña (respuesta genérica, hash del token, un solo uso, vencimiento, solo el enlace más nuevo), cambio de contraseña y de correo (confirmación, correo ocupado, cierre de sesiones), tokens de un tipo usados en el otro, límites por IP y por correo, 503 sin SMTP en producción |
| `api.test.ts` | Integración | Migraciones (no se repiten, RLS en todas las tablas, rollback completo de una migración fallida, todas aditivas), propiedad de productos (403), fechas ISO antiguas, filtros |
| `stores.test.ts` | Integración | Tiendas por barrio y nombre, 404, ubicación (ambas coordenadas, dentro de Colombia), productos públicos, borrado, edición con fecha pasada y categoría antigua, stock en 0, JSON roto, rutas inexistentes, error 500 sin detalles |
| `validation.test.ts` | Unitaria e integración | Reglas de nombres, teléfonos, correos, contraseñas, productos, categorías, fechas y coordenadas, con mensajes en español |
| `discount-rules.test.ts` | Unitaria | Tramos por días (con todos los bordes), bonos de stock en 15 y 30, categorías perecederas, tope, precio en pesos enteros, orden |
| `suggestions.test.ts` | Unitaria e integración | Sugerencias por urgencia, aprobación y rechazo, otras tiendas fuera, explicaciones de IA una vez al día y sin números inventados |
| `ai.test.ts` | Unitaria | Recomendador de combos: vencimiento primero, presupuesto, stock, vencidos y agotados, máximo 5 productos y 3 unidades, desempates, sin IA |
| `recommendations.test.ts` | Integración | API de combos: solo el barrio elegido, selección de productos, presupuesto insuficiente, validaciones |
| `chat.test.ts` | Unitaria e integración | Reglas primero, intención, presupuestos, datos personales, tamaño del prompt, límites por minuto y por día, anti-alucinación (precios, porcentajes y distancias en cualquier formato), proveedor principal y respaldo, JSON inválido, tiempo de espera, todos caídos, temas ajenos, caché |
| `llm.test.ts` | Unitaria | Cadena de modelos, 429 con `Retry-After`, cupo diario, presupuestos de tokens, razonamiento oculto, claves fuera de los logs |
| `assistant.test.ts`, `search-intent.test.ts` | Unitaria e integración | Búsqueda en español, orden, distancia desde la ubicación o el barrio, la ubicación no se guarda |
| `offers.test.ts` | Integración | Solo productos con descuento y stock, filtros, orden por distancia o vencimiento, una oferta dura hasta el final de su día |
| `notifications.test.ts` | Unitaria e integración | Alertas y notificaciones (pausadas con `ENABLE_ALERTS`; la suite las enciende para probarlas) |
| `geo.test.ts`, `dates.test.ts` | Unitaria | Haversine (ciudades, extremos del país, antípodas), formato de distancias, cambio de día en Bogotá, bisiestos |
| `mailer.test.ts` | Unitaria | SMTP (remitente, puerto seguro, una sola conexión), consola en desarrollo, 503 en producción sin SMTP |
| `product-filters.test.ts` | Unitaria | Filtros SQL con los placeholders correctos |

## Resultado actual

193 pruebas en 32 suites, todas en verde (unos 40 s con la base de pruebas local, en Node 20 y Node 24).

| Métrica | Antes de esta ronda | Ahora |
| --- | --- | --- |
| Líneas | 96,0 % | 98,0 % |
| Ramas | 86,3 % | 89,8 % |
| Funciones | 100 % | 100 % |

Lo que queda sin cubrir es sobre todo:

- los `catch (error) { next(error) }` de las rutas, que solo se alcanzan si la base falla;
- el bloque de `migrate.ts` que corre al ejecutar el archivo directamente;
- las rutas de notificaciones, que están pausadas.

La caída de ramas en `config.ts` no es una pérdida real: `test/setup.ts` fija las variables de entorno, así que ya no se recorren los valores por defecto.

## Integración continua

`.github/workflows/ci.yml` corre en cada push y pull request con Node 20 y un Postgres 16 de servicio, sin secretos: `npm ci`, `npm run lint`, `npm run build` y `npm run test:coverage`. El reporte de cobertura queda como artefacto del job durante 7 días.
