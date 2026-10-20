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

## Fase 5: revisión final

### Qué cambió

- README actualizado con roles, tabla de endpoints, reglas de descuento, privacidad, variables y cómo probar.
- Revisión de código:
  - todo el código está en inglés y los mensajes de la API en español;
  - no hay `console.log` sobrantes (solo quedan logs del servidor con `console.info` o `console.error`);
  - no hay claves ni `.env` en el repositorio.

### Migraciones y variables

Ninguna nueva en esta fase.

## Resumen para pasar `desarrollo` a `main`

| Migración | Qué hace |
| --- | --- |
| `003_discount_suggestions.sql` | Tabla `discount_suggestions` |
| `004_customer_role.sql` | Amplía el `CHECK` de `users.role` con `customer` |
| `005_alerts.sql` | Tablas `alert_subscriptions` y `notifications` |

Las tres son aditivas, corren solas al arrancar en Render, cada una en su transacción, y el migrador les activa RLS a las tablas nuevas. No modifican datos existentes.

**Variables nuevas en Render:** solo `NOTIFICATIONS_DAILY_LIMIT`, y es opcional (por defecto 10). Para la IA siguen sirviendo las de antes, con `AI_PROVIDER=local` como valor por defecto.

**Compatibilidad:** la API de `desarrollo` sigue funcionando con el frontend que hoy está en `main`. El registro sin `accountType` crea tiendas, y los campos de producto, tienda y combo solo ganan propiedades nuevas.

**Pruebas:** `npm run lint`, `npm run build` y `npm test` en verde, con 75 pruebas unitarias y de integración contra Postgres local.

# Rama `mejoras`

## A) Validaciones (Zod es la autoridad)

Todas las reglas están en `src/validation.ts`. Cada error responde 400 con un mensaje en español por campo.

| Campo | Regla |
| --- | --- |
| Nombre de persona | Solo letras (con tildes y ñ), espacios, apóstrofe y guion; 2–60 |
| Nombre de tienda | Letras, números y `. , - & '`; 2–80; al menos una letra |
| Teléfono (opcional) | Celular de 10 dígitos que empieza en 3 (acepta +57), o fijo 60X + 7 dígitos; se guarda solo con dígitos |
| Correo | Formato válido, se guarda en minúsculas, máximo 254 |
| Contraseña | 8–72 caracteres, con letra y número, distinta del correo |
| Producto | Nombre de 2–80 con al menos una letra; precio entero de 1 a 10.000.000; stock entero de 0 a 100.000; descuento entero de 0 a 90; vencimiento real y no pasado al crear; categoría de una lista |
| Coordenadas | Latitud −90 a 90, longitud −180 a 180, y dentro de Colombia para tiendas y alertas |

- **Categorías.** `GET /api/products/categories` devuelve la lista. Al editar se acepta la categoría que el producto ya tenía, aunque no esté en la lista, para no romper productos viejos.
- **Login.** Sigue aceptando cualquier contraseña existente: las reglas nuevas solo aplican al crear o cambiar.
- **Stock 0.** Se permite, porque significa agotado; precio y descuento sí deben ser enteros.

## B) Ofertas

- `POST /api/offers/search`: productos con descuento, con stock y no vencidos. Filtros: barrio, categoría, texto y radio desde la ubicación. Orden: `discount`, `nearest` o `expiring`. La ubicación va en el cuerpo, no en la URL, y no se guarda.
- Las notificaciones ahora traen `productName`, para enlazar a sus ofertas.

## C) IA real

- **Proveedores.** Principal (`OPENAI_*`) → respaldo opcional (`AI_FALLBACK_*`) → reglas locales. Ante 429, 5xx, timeout o una respuesta inválida pasa al siguiente. Sin claves todo funciona y nunca falla.
- **`POST /api/assistant/chat`.** Recibe `{ messages: [{ role, content }], latitude?, longitude?, neighborhood? }`. Usa los últimos 6 turnos, con mensajes de máximo 500 caracteres, y el último debe ser del cliente. Funciona así:
  1. El modelo extrae la intención como JSON validado con Zod: tema, producto, categoría, criterio, barrio y presupuesto. Si falla, se usan reglas locales, que también reutilizan el producto de mensajes anteriores ("¿y el más barato?").
  2. Se consulta la base de datos real.
  3. El modelo redacta la respuesta solo con esos datos, que van entre `<datos>` como dato no confiable.
- **Anti-alucinación.** Cada precio, porcentaje, tienda y referencia de la respuesta debe estar en los resultados; si no, se usa el texto local. Sin resultados, lo dice y sugiere ofertas reales. Si el tema no es StockBarrio, responde que solo ayuda con productos y ofertas.
- **Privacidad.** Al proveedor no se envían coordenadas, correos ni teléfonos (se reemplazan), ni nombres de usuarios. Solo van distancias redondeadas.
- **Límites:**
  - 10 mensajes por minuto y 100 por día, por IP y por usuario (configurables);
  - `max_tokens` y timeout de 8 s;
  - caché de 60 s para preguntas idénticas.
  - `trust proxy` activado para que los límites vean la IP real detrás de Render.
- **Respuesta.** Trae `mode: "ai" | "basic"` y la lista de resultados para las tarjetas.
- **Descuentos.** El modelo solo redacta la explicación de cada sugerencia. Se guarda una vez y se vuelve a pedir solo si cambian el porcentaje o los días. Las reglas deciden siempre el porcentaje, y un texto que invente números se descarta.
- **Seed.** Agrega pollo asado en tres tiendas y completa productos que falten en tiendas ya creadas.

## D) Cuenta

- **Olvidé mi contraseña** (`POST /api/auth/forgot-password`):
  - Responde siempre lo mismo, exista o no el correo, y envía en segundo plano.
  - Límite de 5 cada 15 min por IP y de 3 por hora por correo.
  - El token es aleatorio, de un solo uso, se guarda con hash SHA-256 y vence en 30 min.
- **Restablecer contraseña** (`POST /api/auth/reset-password`): cambia la contraseña y sube `token_version`, lo que cierra todas las sesiones anteriores.
- **Correo:**
  - Con `SMTP_*` usa nodemailer 10.
  - En desarrollo sin SMTP imprime el correo en la consola.
  - En producción sin SMTP responde 503 "El envío de correos no está configurado todavía…".
- **Perfil** (`/api/account`):
  - `GET` devuelve los datos de la cuenta.
  - `PATCH /name` cambia el nombre.
  - `POST /password` pide la contraseña actual, devuelve un token nuevo y cierra las demás sesiones.
  - `POST /email` pide la contraseña actual, envía un enlace al correo nuevo y avisa al viejo.
  - `POST /email/confirm` cambia el correo y cierra las sesiones.
- **Sesiones.** Las que traen un token anterior al último cambio, o de una cuenta borrada, responden 401.

## Migraciones

- `006_account_security.sql`, aditiva:
  - agrega `users.token_version` (por defecto 0);
  - amplía `users.email` a 254 caracteres (sin reescribir datos);
  - crea `password_reset_tokens` y `email_change_tokens`, con RLS automático.

## Variables nuevas para Render

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `APP_URL` | Sí, si vas a enviar correos | URL pública del frontend en Vercel, para los enlaces de los correos |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | No | Sin ellas, "olvidé mi contraseña" responde que el correo no está configurado |
| `AI_PROVIDER` (distinto de `local`), `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | No | Para usar IA real (por ejemplo Gemini) |
| `AI_FALLBACK_API_KEY`, `AI_FALLBACK_BASE_URL`, `AI_FALLBACK_MODEL` | No | Respaldo (por ejemplo Groq) |
| `AI_MAX_TOKENS`, `AI_CACHE_TTL_MS`, `CHAT_RATE_PER_MINUTE`, `CHAT_RATE_PER_DAY` | No | Tienen valores por defecto |

## Cómo probar

```bash
TEST_DATABASE_URL=postgresql://stock:stock@localhost:5432/stock_barrios_test npm test   # 119 pruebas, con proveedores simulados
npm run seed && npm run dev
curl -X POST localhost:3000/api/assistant/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"¿dónde puedo encontrar pollo asado?"}]}'
curl -X POST localhost:3000/api/auth/forgot-password -H 'content-type: application/json' -d '{"email":"cliente.demo@stockbarrio.test"}'   # el enlace sale en la consola
```

## Ajuste de IA para cupos gratuitos (Groq + Gemini)

- **Cadenas de modelos.** `AI_MODELS` define los del principal y `AI_FALLBACK_MODELS` los del respaldo. Sin `AI_MODELS` se usa solo `OPENAI_MODEL`.
- **Pausa de modelos agotados.** Ante 429 el modelo queda en pausa según `Retry-After`, o hasta el día siguiente si la cuota es diaria; ante 5xx, 30 s. Mientras tanto se usa el siguiente. Si todos fallan, el chat responde con reglas y nunca falla.
- **Presupuestos en memoria por modelo.**
  - Principal: 28 peticiones/min, 950/día, 7.000 tokens/min y 150.000/día.
  - Respaldo: 5/min y 20/día.
- **Peticiones pequeñas.**
  - Prompts de menos de 700 tokens (se recorta el historial y se envían máximo 6 resultados).
  - `max_tokens` 300 y razonamiento bajo (gpt-oss y Gemini en low, Qwen en none y oculto).
  - El razonamiento interno se descarta y nunca llega al usuario.
- **Reglas primero.** Búsqueda sin tildes, con raíces y sinónimos. Con coincidencia clara el chat responde con plantilla sin llamar al modelo (`mode: "rules"`). La IA solo entra cuando las reglas no bastan. `/api/assistant/search` aplica lo mismo.
- **Explicaciones de descuento.** Una llamada por tienda y por día, en lote con todas sus sugerencias, guardada en la base (migración `007`).
- **Límites de IA por persona.** 5 mensajes/min y 30/día (`AI_CHAT_PER_MINUTE` y `AI_CHAT_PER_DAY`). Al pasarlos, el chat sigue con reglas (`mode: "basic"`). El límite general del endpoint no cambia.
- **Combos.** Ya no usan IA.
- **Logs.** No registran claves: solo modelo, pausa y motivo.

### Migraciones

- `007_store_ai_reasons_day.sql` agrega `stores.ai_reasons_on` (fecha). Es aditiva.

### Variables

Las de la sección IA de `.env.example` y del README. Todas tienen valores por defecto, salvo las claves.

### Pruebas

126 en verde, con proveedores simulados (sin claves reales): cadena de modelos, 429 con `Retry-After`, cuota diaria, presupuesto de tokens, razonamiento oculto, claves fuera de los logs, reglas primero, límites por persona, prompts bajo 700 tokens y una llamada por tienda y por día.

## Alertas y notificaciones en pausa

- **Variable nueva:** `ENABLE_ALERTS`, con valor por defecto `false`. Mientras esté apagada, aprobar sugerencias (una o todas) no genera notificaciones y la respuesta trae `notified: 0`.
- **Sin cambios:** los endpoints, las tablas y las migraciones de alertas y notificaciones se quedan como están.
- **Pruebas:** un test nuevo comprueba que con la bandera apagada no se crea ninguna notificación. Los tests de notificaciones la encienden para seguir probando esa parte.
- **Reactivar:** `ENABLE_ALERTS=true` en Render (y en Vercel para el frontend).

## Ronda de pruebas (rama `pruebas`)

- **Cobertura:** `npm run test:coverage` (c8). Pasó de 96,0 % a 98,0 % en líneas y de 86,3 % a 89,8 % en ramas. Las pruebas pasaron de 127 a 193.
- **Protección de la base:** `test/setup.ts` se carga antes de cada archivo de prueba.
  - Las pruebas se niegan a correr si `TEST_DATABASE_URL` contiene `supabase.co`, y solo usan bases cuyo nombre termine en `_test`.
  - `DATABASE_URL` nunca se usa en pruebas.
  - Se vacían las claves de IA y de SMTP, y `fetch` solo puede ir a `localhost`: la IA siempre se prueba con proveedores simulados.
- **Pruebas nuevas:**
  - autenticación: login, JWT vencido o falsificado, `token_version`, cuentas borradas y permisos por rol;
  - recuperación y cambio de contraseña y correo: enlaces de un tipo usados en el otro, solo el enlace más nuevo, correo tomado entre la solicitud y la confirmación, límites por IP y por correo;
  - API de combos y bordes del recomendador;
  - tiendas, productos públicos y stock en 0;
  - errores en español y error 500 sin detalles;
  - migraciones: una fallida se revierte completa y todas son aditivas;
  - bordes de las reglas de descuento;
  - Haversine y fechas de Bogotá;
  - chat: anti-alucinación, ventanas de los límites, JSON inválido, tiempo de espera;
  - correo por SMTP;
  - ofertas que vencen hoy.
- **Bugs corregidos:**
  - El anti-alucinación del chat solo revisaba precios con "$" y porcentajes con "%". Una respuesta del modelo con "9.900 pesos", "5 mil", "40 por ciento" o una distancia inventada ("a 200 m") pasaba la validación. Ahora se revisan esos formatos y las distancias, y si algo no coincide con los resultados se responde con la plantilla.
  - Entre 975 y 999 m las distancias se mostraban como "1000 m". Ahora se muestran como "1,0 km".
- **Integración continua:** `.github/workflows/ci.yml`. Corre en cada push y pull request con Node 20 y un Postgres 16 de servicio, sin secretos: `npm ci`, lint, build y pruebas con cobertura. La insignia está en el README.
- **Documentación:** `TESTING.md`.
- **Migraciones:** ninguna.
- **Variables nuevas:** ninguna.
- **Cómo probar:** `TEST_DATABASE_URL=postgresql://stock:stock@localhost:5544/stock_barrios_test npm run test:coverage`. Los detalles están en `TESTING.md`.

## Simplificación (rama `simplificar`)

- **Ubicación eliminada:**
  - Ofertas, el chat y el buscador ya no reciben latitud, longitud ni radio. Si un cliente viejo los manda, se ignoran.
  - El orden `nearest` ya no existe y responde 400.
  - Ninguna respuesta trae `distanceKm` ni `origin`.
  - Las tiendas ya no exponen latitud ni longitud, y se quitó `PUT /api/stores/me`. La tienda queda con nombre, barrio, dirección y teléfono.
  - Las alertas pausadas quedan solo por barrio. Las antiguas por radio ya no generan avisos, para no avisar de cualquier barrio.
  - Se borraron `src/geo.ts` (Haversine), las validaciones de coordenadas y las coordenadas del seed.
- **Columnas y migraciones:** no se borraron ni se crearon. `latitude`, `longitude` y `radius_km` siguen en la base, pero ya no se leen ni se escriben.
- **"Cerca de mí" en el chat:**
  - si el mensaje nombra un barrio, o el cliente lo eligió en el chat, se filtra por ese barrio;
  - si no, el asistente pide el barrio y dice en qué barrios hay tiendas;
  - el anti-alucinación rechaza cualquier distancia en la respuesta del modelo.
- **Combos eliminados:** se quitaron `POST /api/recommendations`, el recomendador (`src/services/ai.ts`) y sus pruebas. Nada más los usaba.
- **Pruebas:** 174 en verde, con 97,8 % de líneas y 88,8 % de ramas. Se borraron las de distancias, coordenadas y combos, y se agregaron las de "cerca de mí" por barrio y las de coordenadas ignoradas.
- **Variables nuevas:** ninguna.
- **Migraciones:** ninguna.
- **Cómo probar:** con el seed, pide en el chat "pollo asado cerca" (pide el barrio) y "pollo asado cerca en Suba" (solo Suba). `POST /api/offers/search` con `{ "sort": "nearest" }` responde 400.

## Recuperación de contraseña por correo (rama `correo`)

- **Buscar la cuenta:** se busca por el correo con el que se creó, sin importar mayúsculas ni espacios. Antes, una cuenta antigua guardada con mayúsculas no se encontraba.
- **SMTP:**
  - variables nuevas `SMTP_SECURE` (true con el 465; false con el 587, con STARTTLS obligatorio) y `SMTP_TIMEOUT_MS` (10 s para conectar y para enviar);
  - `MAIL_FROM` vacío usa `SMTP_USER`, y si el proveedor reescribe el remitente el correo sale igual;
  - a la contraseña de aplicación de Gmail se le quitan los espacios;
  - funciona con Gmail y con Brevo.
- **Plantillas en español** en texto y HTML: enlace armado solo con `APP_URL`, aviso de que vence en 30 minutos y "Si no fuiste tú, ignora este mensaje". Después de restablecer la contraseña, o de cambiarla desde el perfil, llega "Tu contraseña de StockBarrio fue cambiada".
- **Errores y registros:**
  - si el SMTP falla, la API responde lo mismo y el registro solo dice el tipo de error, sin el correo de la persona, el enlace, el token ni la contraseña;
  - en producción nunca se imprimen enlaces;
  - en producción sin `APP_URL`, la API responde que el correo no está configurado en vez de mandar enlaces a `localhost`, y avisa al arrancar.
- **Script `npm run mail:test -- tucorreo@ejemplo.com`:** verifica la conexión, envía un correo de prueba y explica el error sin imprimir la contraseña. En Render se corre con `node dist/mail-test.js tucorreo@ejemplo.com`.
- **Seguridad, sin cambios y comprobada con pruebas:**
  - token de un solo uso con hash, que vence en 30 minutos;
  - solo vale el enlace más nuevo, y un token de otro tipo no sirve;
  - límites por IP y por correo;
  - las sesiones se cierran al cambiar la contraseña;
  - el enlace no usa el host de la petición.
- **Pruebas:** 190 en verde (97,8 % de líneas, 88,7 % de ramas). Todas usan un transporte simulado: ninguna envía correos reales.
- **Documentación:** guía paso a paso para Gmail y Brevo en el README y en `.env.example`.
- **Migraciones:** ninguna.
- **Variables:** `SMTP_SECURE` y `SMTP_TIMEOUT_MS` son nuevas y opcionales. Para que el correo funcione en Render hacen falta `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`.
- **Cómo probar:** pon las variables, corre `npm run mail:test -- tucorreo@ejemplo.com` y luego pide un enlace desde "¿Olvidaste tu contraseña?" con el correo de tu cuenta.

### Envío por la API de Brevo (rama `correo`)

- **El problema:** Render Free bloquea el tráfico saliente a los puertos SMTP 25, 465 y 587. Desde ahí el SMTP termina siempre en `ETIMEDOUT`.
- **`MAIL_PROVIDER`:**
  - `smtp`, o vacío, funciona como antes;
  - `brevo-api` envía por `POST https://api.brevo.com/v3/smtp/email` con la cabecera `api-key`;
  - un valor desconocido se avisa al arrancar y el correo queda "no configurado".
- **Variables nuevas:** `MAIL_PROVIDER`, `BREVO_API_KEY` y `MAIL_TIMEOUT_MS`, que reemplaza a `SMTP_TIMEOUT_MS`; esta última se sigue aceptando.
- **Transporte de Brevo:** usa `fetch` nativo con límite de 10 s, sin librerías nuevas. Tiene el mismo contrato y las mismas plantillas que SMTP:
  - la API responde igual aunque falle el envío;
  - el registro solo dice `Brevo 401 · unauthorized`, `Brevo 400 · invalid_parameter`, `Brevo · tiempo de espera agotado` o `Brevo · sin conexión (ENOTFOUND)`;
  - nunca registra la clave, el correo de la persona, el enlace ni el token.
- **Configuración incompleta:** con `brevo-api` y sin `BREVO_API_KEY`, o sin un `MAIL_FROM` válido, la API avisa al arrancar y responde "correo no configurado" (503) sin dejar de funcionar.
- **`npm run mail:test`:**
  - con Brevo, verifica la API key con `GET /v3/account` antes de enviar;
  - muestra el transporte y el remitente sin claves;
  - explica los errores típicos: clave, IP bloqueada, remitente sin verificar y puertos SMTP bloqueados en Render Free.
- **Pruebas:** 203 en verde con Node 20 y Node 24 (97,8 % de líneas, 88,3 % de ramas). `fetch` está simulado en éxito, 401, 400, tiempo agotado y red caída, más la recuperación completa por la API. Ninguna hace llamadas reales.
- **Variables para Render:** `MAIL_PROVIDER=brevo-api`, `BREVO_API_KEY`, `MAIL_FROM` (remitente verificado en Brevo) y `APP_URL`.
- **Bug encontrado por el CI:** el primer límite de tiempo usaba `AbortSignal.timeout`, cuyo temporizador en Node 20 no mantiene vivo el proceso. Si Brevo no respondía, `mail:test` podía terminar sin mostrar ningún error. Ahora usa un `AbortController` con un temporizador normal.
- **Migraciones:** ninguna.
- **Frontend:** sin cambios.

## Supabase Auth opcional (rama `supabase-auth`)

- **`AUTH_PROVIDER`:** `legacy` por defecto, que funciona como antes y conserva sus pruebas, o `supabase`.
- **Modo `supabase`:**
  - **Verificación del token:** la API verifica el access token de Supabase sin librerías nuevas: `jsonwebtoken` y las claves del JWKS leídas con `crypto`. Acepta ES256 o RS256 por `SUPABASE_JWKS_URL` (en caché, y se recargan si aparece una clave nueva) y HS256 con `SUPABASE_JWT_SECRET`, sin mezclar algoritmos. Valida el emisor, la audiencia `authenticated`, el vencimiento y el rol, y exige el correo confirmado (403).
  - **Perfil local:** en el primer acceso vincula la cuenta vieja con el mismo correo confirmado (hereda tienda, productos y rol) o crea un cliente o una tienda con los datos del registro, con las mismas validaciones. Los roles salen de `public.users` y nunca se crean administradores.
  - **Endpoints antiguos:** `login`, `register`, `forgot-password`, `reset-password` y los de cambio de contraseña y correo propios responden 404 con un mensaje claro.
  - **Cambio de nombre:** sigue en `public.users`, sin emitir token propio.
  - **Configuración incompleta:** la API avisa al arrancar y responde 503.
- **Migración `008_users_auth_id.sql`:** aditiva, agrega `users.auth_id` (uuid, nula y única cuando tiene valor) con RLS activado.
- **Variables nuevas:** `AUTH_PROVIDER`, `SUPABASE_URL` y `SUPABASE_JWKS_URL`, o `SUPABASE_JWT_SECRET`. No hace falta la `service_role` key.
- **Guía:** `SUPABASE_AUTH.md`, para hacer en el panel de Supabase, con plantillas en español listas para pegar y pruebas manuales.
- **Pruebas:** 220 en verde con Node 20 y Node 24 (97,7 % de líneas, 87,6 % de ramas), con claves de prueba generadas al vuelo y sin llamar a Supabase.
