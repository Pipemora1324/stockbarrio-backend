# Cambios en la rama `desarrollo`

## Fase 2: IA de vencimientos y descuentos

### Qué cambió

- **Reglas de descuento** (`src/services/discount-rules.ts`). Para cada producto activo con stock se calculan los días para vencer (hora de Bogotá) y se sugiere un descuento:
  - Base por días restantes: vence hoy 50 %, mañana 40 %, 2–3 días 30 %, 4–7 días 20 %, 8–14 días 10 %. Con más de 14 días no hay sugerencia, y los vencidos tampoco reciben descuento (hay que retirarlos).
  - +10 puntos con 30 unidades o más, +5 con 15 o más (exceso de stock).
  - +5 puntos si la categoría es perecedera (lácteos, panadería, frutas y verduras, carnes, carnes frías, pescados, huevos).
  - Se redondea a múltiplos de 5, con un tope de 70 %. Solo se sugiere si supera el descuento actual.
  - La razón se escribe en español, por ejemplo: "Vence en 2 días, tienes 30 unidades (exceso de stock), lácteos es una categoría perecedera: sugerimos 45 % de descuento."
- **Sugerencias que la tienda aprueba o rechaza.** El descuento solo se aplica con aprobación.
  - `GET /api/suggestions` analiza el inventario y devuelve las pendientes, de la más urgente a la menos.
  - `POST /api/suggestions/:id/approve` aplica el descuento y recalcula el precio de oferta.
  - `POST /api/suggestions/:id/reject` descarta la sugerencia. No vuelve a aparecer salvo que el descuento sugerido suba.
  - `POST /api/suggestions/approve-all` aplica todas las pendientes.
  - Todo exige el rol de tienda. Una sugerencia de otra tienda responde 404 y una ya revisada responde 409.
- **Proveedor de IA opcional** (`src/services/llm.ts`). Con `AI_PROVIDER` distinto de `local` y `OPENAI_API_KEY`, el proveedor compatible con OpenAI puede:
  - reescribir las razones y reordenar por prioridad;
  - mover un descuento como máximo ±5 puntos, sin pasar del 70 % ni quedar por debajo del descuento actual.

  La respuesta se valida siempre con Zod y debe incluir exactamente los mismos productos. Los precios se recalculan en el servidor. Si algo falla, se usan las reglas locales.
- **Recomendador de combos corregido** (`POST /api/recommendations`):
  - Prioriza lo que vence primero.
  - Lleva el presupuesto acumulado, con un máximo de 3 unidades por producto y nunca más que el stock.
  - Descarta lo vencido o sin stock.
  - Si no se eligen productos, usa todos los del barrio.
  - Si hay IA, su combo se valida (productos existentes, stock y presupuesto) y si no cumple se usa el local.

  La respuesta sigue siendo compatible e incluye además `productId` y `expirationDate`.
- **Precios con descuento** redondeados a pesos enteros.
- **Tests.** Cada archivo de integración vacía la base de pruebas, así que los archivos corren uno a la vez. El helper verifica que la base conectada termine en `_test` antes de borrar nada.

### Migraciones

- `003_discount_suggestions.sql` crea la tabla `discount_suggestions`, aditiva. El migrador le activa RLS automáticamente.

### Variables nuevas

Ninguna. Para usar un proveedor de IA ya existen `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` y `AI_TIMEOUT_MS`. Con `AI_PROVIDER=local` (el valor por defecto) no se llama a ningún servicio externo.

### Cómo probarlo

```bash
TEST_DATABASE_URL=postgresql://stock:stock@localhost:5432/stock_barrios_test npm test
npm run seed   # tiendas con productos por vencer
npm run dev
```

Inicia sesión con `mercado.elporvenir@stockbarrio.test` / `tienda12345` y llama `GET /api/suggestions` con el token.

## Fase 3: búsqueda conversacional y cercanía

### Qué cambió

- **Asistente de búsqueda** (`POST /api/assistant/search`, público, limitado a 30 peticiones por minuto). Recibe `{ message, latitude?, longitude?, neighborhood? }` y responde `{ reply, intent, origin, results }`.
  - **Intención con reglas locales** (`src/services/search-intent.ts`). Reconoce el producto (quita tildes, palabras de relleno y plurales: "huevos" → "huevo") y una preferencia:

    | Preferencia | Ejemplos de lo que reconoce |
    | --- | --- |
    | `cheapest` | "barato", "económico", "menor precio" |
    | `best_deal` | "oferta", "descuento", "rebaja" |
    | `best_grade` | "mejor categoría", "mejor calidad", "premium" (ordena AAA > AA > A) |
    | `nearest` | "cerca de mí", "más cerca" |
    | `expiring` | "por vencer", "vence pronto" |

    También detecta un barrio escrito en el mensaje ("huevos en Chapinero") y lo usa como filtro.
  - **IA opcional.** Con proveedor activo, puede afinar los términos y la preferencia. Su respuesta se valida con Zod: solo letras, números y espacios, máximo 5 términos y preferencia de la lista. Si no cumple, se usan las reglas locales.
  - **Distancia con Haversine** (`src/geo.ts`) desde la ubicación que envía el cliente o, si eligió un barrio, desde el promedio de las tiendas de ese barrio que tienen coordenadas.
  - **Resultados.** Hasta 8, sin productos vencidos ni sin stock, ordenados por el criterio pedido. Cada uno trae tienda, barrio, dirección, distancia aproximada, precio con descuento, porcentaje y días para vencer. La respuesta se redacta en español; si el cliente pidió "cerca" sin compartir ubicación, le sugiere compartirla o elegir su barrio.
  - **Privacidad.** La ubicación del cliente solo se usa durante la petición: no se guarda en la base y morgan no registra el cuerpo.
- **Ubicación de la tienda.**
  - `GET /api/stores/me` devuelve la tienda del usuario.
  - `PUT /api/stores/me` guarda `{ latitude, longitude }`, o ambas en `null` para quitarla. Se rechazan coordenadas fuera de Colombia, con un aviso por si quedaron invertidas.
- **`GET /api/stores/neighborhoods`** lista los barrios con tiendas activas.
- **`GET /api/stores/:id`** valida que el id sea un UUID.

### Migraciones

Ninguna. Se usan las columnas `latitude` y `longitude` que ya existían en `stores`.

### Variables nuevas

Ninguna.

### Cómo probarlo

```bash
npm run seed && npm run dev
curl -X POST localhost:3000/api/assistant/search -H 'content-type: application/json' -d '{"message":"busco huevos baratos"}'
curl -X POST localhost:3000/api/assistant/search -H 'content-type: application/json' -d '{"message":"leche cerca de mí","latitude":4.6405,"longitude":-74.064}'
```

## Fase 4: alertas y notificaciones

### Qué cambió

- **Rol `customer`.** `POST /api/auth/register` con `accountType: "customer"` crea una cuenta de cliente con nombre, correo y contraseña. Sin `accountType` (o con `"store"`) sigue creando tiendas, así que el frontend actual no se rompe. Con cualquier otro valor, incluido `"admin"`, responde 400: el registro público nunca crea administradores.
- **Alertas del cliente** (`/api/alerts`, solo clientes):
  - Se pueden listar (`GET`), crear (`POST`) y eliminar (`DELETE /:id`).
  - Una alerta lleva producto o categoría, más un barrio o un radio, y un descuento mínimo.
  - Para un radio hace falta `locationConsent: true`. La posición se guarda redondeada a 3 decimales (unos 100 m), y al eliminar la alerta se desactiva y deja de usarse.
  - Máximo 20 alertas activas por cliente.
- **Notificaciones.** Cuando una tienda aprueba un descuento (uno a uno o "aprobar todas"), se avisa a los clientes cuyas alertas coinciden:
  - El nombre debe contener las palabras de la alerta (con plurales), la categoría debe ser igual y el descuento debe alcanzar el mínimo.
  - El barrio debe coincidir o, para alertas por radio, la tienda debe estar dentro del radio (Haversine; si la tienda no tiene coordenadas, no coincide).
  - El mensaje es corto y en español, con tienda, barrio, producto, precio, distancia si aplica y vencimiento. Por ejemplo: "Tienda Doña Luz (Chapinero) tiene Leche entera 1 L a $ 2.940. Vence en 2 días."
  - **Sin spam:**
    - una sola vez por suscripción y producto (índice único);
    - una sola por persona y producto, aunque tenga varias alertas que coincidan;
    - un límite diario por persona (`NOTIFICATIONS_DAILY_LIMIT`, 10 por defecto, día de Bogotá).
  - La respuesta de aprobar incluye `notified` con el número de avisos creados. Si fallan las notificaciones, el descuento queda aplicado igual.
- **Bandeja dentro de la app** (`/api/notifications`, solo clientes):
  - `GET` devuelve las últimas 50 y el número de no leídas.
  - `GET /unread-count` devuelve solo el contador.
  - `POST /:id/read` marca una como leída y `POST /read-all` las marca todas.
- **Canales.** `NotificationChannel` (`src/services/notifications.ts`) es la interfaz para agregar correo o WhatsApp más adelante. Por defecto no hay ningún canal externo registrado, así que ningún dato sale de la app. No se integró ningún servicio de pago.
- **Seed.** Ahora crea también `cliente.demo@stockbarrio.test`, con alertas de huevos y de leche en Chapinero.

### Migraciones

- `004_customer_role.sql` amplía el `CHECK` de `users.role` a `admin`, `store` y `customer`. Corre dentro de la transacción del migrador y no reescribe filas.
- `005_alerts.sql` crea las tablas `alert_subscriptions` y `notifications`, aditivas y con RLS automático.

### Variables nuevas para Render

- `NOTIFICATIONS_DAILY_LIMIT` es opcional (por defecto 10). Solo hay que agregarla si quieres otro límite.

### Cómo probarlo

`npm run seed`, entra como `tienda.donaluz@stockbarrio.test` y aprueba la sugerencia de "Leche entera 1 L". Luego entra como `cliente.demo@stockbarrio.test` y llama `GET /api/notifications`.
