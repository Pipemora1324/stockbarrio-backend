# StockBarrio - Backend

API REST de StockBarrio, una aplicación de inventario para tiendas y mercados de barrio. Está hecha con Node.js, Express 5, TypeScript, Zod y PostgreSQL.

El frontend (Angular) está en un repositorio aparte: [stockbarrio-frontend](https://github.com/Pipemora1324/stockbarrio-frontend).

## Qué hace

- **Cuentas con JWT y tres roles.** Las tiendas (`store`) gestionan su inventario y los clientes (`customer`) reciben alertas. El registro público solo crea esos dos tipos de cuenta; el rol `admin` solo se crea con el script de seed.
- **Productos por tienda**, con stock, precios en pesos, descuentos y fechas de vencimiento. Cada tienda solo puede crear, editar y borrar sus propios productos (si no, responde 403).
- **Descuentos sugeridos.** Se calculan con reglas claras (días para vencer, exceso de stock y categoría perecedera) y la tienda los aprueba o rechaza. Nada se aplica sin aprobación.
- **Asistente de búsqueda** en español ("busco huevos baratos", "leche cerca de mí"). Ordena por precio, descuento, categoría, cercanía o vencimiento, y calcula la distancia con Haversine desde la ubicación del cliente o desde su barrio. La ubicación no se guarda.
- **Combos con presupuesto**: priorizan lo que vence primero y respetan el presupuesto y el stock.
- **Alertas y notificaciones dentro de la app.** Cuando una tienda aprueba un descuento, se avisa a los clientes cuyas alertas coinciden. Hay un solo aviso por producto y suscripción, y un límite diario.
- **IA opcional.** Todo funciona en local sin claves. Con un proveedor compatible con OpenAI se pueden mejorar textos y orden, pero su respuesta se valida siempre con Zod y contra el stock, las cantidades y los límites; si falla, se usan las reglas locales.
- **Ofertas** con filtros por barrio, categoría y cercanía.
- **Cuenta**: recuperar contraseña por correo, perfil para cambiar nombre, contraseña y correo.
- **Seguridad**: validación con Zod (nombres, teléfono colombiano, correo, contraseña, productos y coordenadas), CORS, Helmet y límite de peticiones.

## Migraciones

Al arrancar, la API ejecuta en orden los archivos `src/migrations/NNN_nombre.sql` que todavía no estén registrados en la tabla `schema_migrations`. Cada migración corre en su propia transacción y queda registrada, así que no se vuelve a ejecutar. Las migraciones deben ser aditivas: nunca borrar ni reescribir tablas con datos.

Todas las tablas tienen RLS (row level security) activado y sin políticas, para que las claves públicas de Supabase (`anon`, `authenticated`) no puedan leerlas; la API se conecta como dueña de las tablas y no se ve afectada. El migrador activa RLS solo en las tablas nuevas que cree cada migración, así que las migraciones futuras no necesitan hacerlo a mano. No uses `FORCE ROW LEVEL SECURITY`, porque eso sí bloquearía a la API.

También se pueden ejecutar a mano con `npm run migrate`.

## Requisitos

- Node.js 20 o superior y npm.
- PostgreSQL 16 (local o con Docker).

## Correr en desarrollo

```bash
cp .env.example .env
npm install
npm run dev
```

Si no tienes PostgreSQL instalado, puedes levantar solo la base de datos con Docker:

```bash
docker compose up -d postgres
```

La API queda en http://localhost:3000 (prueba con `GET /api/health`).

## Correr con Docker

```bash
docker compose up --build
```

Levanta PostgreSQL (puerto 5432) y la API (puerto 3000). Puedes sobrescribir `JWT_SECRET`, `CORS_ORIGIN`, `AI_PROVIDER` y `OPENAI_API_KEY` con un archivo `.env` en la raíz.

## Variables de entorno

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `PORT` | Puerto de la API | `3000` |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL | `postgresql://stock:stock@localhost:5432/stock_barrios` |
| `JWT_SECRET` | Secreto para firmar los tokens. Obligatorio en producción | valor de desarrollo |
| `JWT_EXPIRES_IN` | Duración del token | `8h` |
| `CORS_ORIGIN` | Origen permitido para el frontend | `http://localhost:4200` |
| `AI_PROVIDER` | `local` calcula las recomendaciones sin servicios externos; cualquier otro valor usa el proveedor compatible con OpenAI | `local` |
| `OPENAI_API_KEY` | Clave del proveedor compatible con OpenAI | vacío |
| `OPENAI_MODEL` | Modelo a usar | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | URL base del proveedor | `https://api.openai.com/v1` |
| `AI_TIMEOUT_MS` | Tiempo máximo de espera del proveedor | `8000` |
| `NOTIFICATIONS_DAILY_LIMIT` | Máximo de notificaciones por cliente al día (hora de Bogotá) | `10` |
| `AI_MODELS` | Cadena de modelos del principal, separados por comas. Si no está, se usa solo `OPENAI_MODEL` | vacío |
| `AI_FALLBACK_BASE_URL` / `AI_FALLBACK_API_KEY` | Proveedor de respaldo compatible con OpenAI (opcional) | vacío |
| `AI_FALLBACK_MODELS` | Cadena de modelos del respaldo (también acepta un solo `AI_FALLBACK_MODEL`) | vacío |
| `AI_MAX_TOKENS` / `AI_MAX_PROMPT_TOKENS` | Tokens máximos de respuesta y de prompt | `300` / `700` |
| `AI_REQUESTS_PER_MINUTE` / `AI_REQUESTS_PER_DAY` / `AI_TOKENS_PER_MINUTE` / `AI_TOKENS_PER_DAY` | Presupuesto por modelo del principal | `28` / `950` / `7000` / `150000` |
| `AI_FALLBACK_REQUESTS_PER_MINUTE` / `AI_FALLBACK_REQUESTS_PER_DAY` / `AI_FALLBACK_TOKENS_PER_MINUTE` / `AI_FALLBACK_TOKENS_PER_DAY` | Presupuesto por modelo del respaldo | `5` / `20` / `7000` / `150000` |
| `AI_CHAT_PER_MINUTE` / `AI_CHAT_PER_DAY` | Mensajes del chat que usan IA, por usuario o IP | `5` / `30` |
| `AI_CACHE_TTL_MS` | Tiempo de la caché de preguntas idénticas del chat | `60000` |
| `CHAT_RATE_PER_MINUTE` / `CHAT_RATE_PER_DAY` | Límite de mensajes del chat por IP y por usuario | `10` / `100` |
| `APP_URL` | URL pública del frontend, para los enlaces de los correos | `http://localhost:4200` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Envío de correos (opcional). Sin SMTP: en desarrollo el correo sale en la consola y en producción la API responde que no está configurado | vacío / `587` |

Variables solo para uso local (no hacen falta en el despliegue):

| Variable | Descripción |
| --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Si están definidas, `npm run seed` crea o actualiza ese administrador (contraseña de 12 caracteres o más) |
| `SEED_STORE_PASSWORD` | Contraseña de las tiendas de ejemplo del seed (por defecto `tienda12345` fuera de producción) |
| `TEST_DATABASE_URL` | Base desechable para los tests de integración; su nombre debe terminar en `_test` porque los tests la vacían |

Nunca subas el `.env` real; solo `.env.example`.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Arranca la API con recarga automática (tsx) |
| `npm run build` | Compila a `dist/` y copia las migraciones |
| `npm start` | Ejecuta la versión compilada |
| `npm run migrate` | Ejecuta las migraciones pendientes |
| `npm run seed` | Carga tiendas y productos de ejemplo (manual, ver abajo) |
| `npm test` | Corre las pruebas |
| `npm run lint` | Revisa los tipos sin compilar |

## Datos de ejemplo

`npm run seed` crea cinco tiendas (Chapinero, Teusaquillo y Suba en Bogotá, Laureles en Medellín y El Prado en Barranquilla) con productos en pesos colombianos, varios a punto de vencer. Las cuentas son `tienda.donaluz@stockbarrio.test`, `mercado.elporvenir@stockbarrio.test`, `autoservicio.lacolina@stockbarrio.test`, `granero.sanjose@stockbarrio.test` y `minimercado.elprado@stockbarrio.test`, con la contraseña de `SEED_STORE_PASSWORD`. También crea el cliente `cliente.demo@stockbarrio.test` (misma contraseña) con alertas de huevos y de leche en Chapinero.

El seed nunca se ejecuta al arrancar. Es idempotente (omite las tiendas que ya existen) y se niega a correr con `NODE_ENV=production` salvo que se pase `-- --allow-production`. En la imagen de Docker se ejecuta con `node dist/seed.js`.

Para crear o actualizar solo el administrador, sin tiendas de ejemplo: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed -- --admin-only`.

## Pruebas

```bash
createdb stock_barrios_test
TEST_DATABASE_URL=postgresql://stock:stock@localhost:5432/stock_barrios_test npm test
```

Sin `TEST_DATABASE_URL` solo corren las pruebas unitarias.

## Contrato de la API

- Los campos van en camelCase (`storeId`, `offerPrice`, `expirationDate`, `discountPercent`...).
- Las fechas de vencimiento son fechas puras `AAAA-MM-DD`, sin hora ni zona horaria, y los días se cuentan en hora de Bogotá. La API también acepta una fecha ISO completa y se queda con el día.
- Los precios son pesos colombianos enteros.
- Los errores responden `{ message }` en español; los de validación (400) incluyen además `errors: [{ field, message }]`.

### Endpoints

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /api/health` | Público | Estado de la API |
| `POST /api/auth/register` | Público | Crea una tienda (con `storeName`, `neighborhood` y `address`) o un cliente (`accountType: "customer"`) |
| `POST /api/auth/login` | Público | Inicia sesión |
| `GET /api/auth/me` | Con sesión | Valida el token y devuelve el usuario |
| `GET /api/products` | Público | Catálogo con filtros `neighborhood`, `category` y `search` |
| `GET /api/products/mine` | Tienda | Productos y datos de la tienda propia |
| `GET /api/products/store/:storeId` | Público | Productos de una tienda |
| `POST /api/products` · `PUT /api/products/:id` · `DELETE /api/products/:id` | Tienda dueña | Crear, editar y borrar productos |
| `GET /api/stores` · `GET /api/stores/:id` | Público | Tiendas |
| `GET /api/stores/neighborhoods` | Público | Barrios con tiendas activas |
| `GET /api/stores/me` · `PUT /api/stores/me` | Tienda | Ver y guardar las coordenadas de la tienda (deben quedar dentro de Colombia) |
| `GET /api/suggestions` | Tienda | Analiza el inventario y devuelve los descuentos sugeridos pendientes |
| `POST /api/suggestions/:id/approve` · `/:id/reject` · `/approve-all` | Tienda | Aprobar (aplica el descuento y notifica), rechazar o aprobar todas |
| `POST /api/assistant/search` | Público (30 por minuto) | `{ message, latitude?, longitude?, neighborhood? }` → respuesta en español y resultados |
| `POST /api/recommendations` | Público | Combo con `{ budget, neighborhood, productIds? }` |
| `POST /api/assistant/chat` | Público (10 por minuto y 100 por día, por IP y por usuario) | Chat con `{ messages, latitude?, longitude?, neighborhood? }` → `{ reply, mode, intent, results }` |
| `POST /api/offers/search` | Público | Ofertas con filtros `neighborhood`, `category`, `search`, `radiusKm` y orden `discount`, `nearest` o `expiring` |
| `GET /api/products/categories` | Público | Lista de categorías permitidas |
| `POST /api/auth/forgot-password` · `POST /api/auth/reset-password` | Público (con límites) | Recuperar la contraseña con un enlace de un solo uso que vence en 30 minutos |
| `GET /api/account` · `PATCH /api/account/name` · `POST /api/account/password` · `POST /api/account/email` | Con sesión | Perfil: nombre, contraseña (pide la actual) y correo (pide la actual y envía un enlace al correo nuevo) |
| `POST /api/account/email/confirm` | Público | Confirma el correo nuevo desde el enlace |
| `GET /api/alerts` · `POST /api/alerts` · `DELETE /api/alerts/:id` | Cliente | Alertas por producto o categoría, barrio o radio (con `locationConsent`) y descuento mínimo |
| `GET /api/notifications` · `GET /unread-count` · `POST /:id/read` · `POST /read-all` | Cliente | Bandeja de notificaciones |

### Reglas de descuento

| Días para vencer | Descuento base |
| --- | --- |
| 0 (vence hoy) | 50 % |
| 1 | 40 % |
| 2–3 | 30 % |
| 4–7 | 20 % |
| 8–14 | 10 % |

Sobre la base se suman puntos y se ajusta así:

- +10 puntos con 30 unidades o más en stock, o +5 con 15 o más.
- +5 puntos si la categoría es perecedera.
- Se redondea a múltiplos de 5, con un tope de 70 %.
- Con más de 14 días, o si el producto ya está vencido, no hay sugerencia.

### Privacidad

- La ubicación que el cliente comparte en el asistente solo se usa durante esa petición.
- En las alertas por radio se guarda redondeada (unos 100 m) y solo con consentimiento explícito.
- Las notificaciones solo se muestran dentro de la app: no hay canales externos registrados. Para agregar correo o WhatsApp se implementa `NotificationChannel` en `src/services/notifications.ts`.

## IA

Todo funciona sin claves: con `AI_PROVIDER=local` o sin `OPENAI_API_KEY`, el chat, la búsqueda y las sugerencias usan reglas locales y el chat nunca falla.

### Orden de uso

1. **Reglas primero.** Búsqueda sin tildes, con plurales, raíces (asado o asada) y sinónimos (gallina o pollo, banano o guineo…). Si hay una coincidencia clara, la respuesta sale de una plantilla y no se llama al modelo (`mode: "rules"`).
2. **Modelos principales**, en el orden de `AI_MODELS`.
3. **Modelos de respaldo**, en el orden de `AI_FALLBACK_MODELS`.
4. **Reglas locales** otra vez, con `mode: "basic"`.

### Configuración recomendada (Groq principal, Gemini respaldo)

```bash
AI_PROVIDER=openai
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=openai/gpt-oss-120b
AI_MODELS=openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b
OPENAI_API_KEY=tu-clave-de-groq
AI_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
AI_FALLBACK_API_KEY=tu-clave-de-gemini
```

### Cupos y presupuestos

- **Uso por modelo.** Se lleva en memoria: peticiones y tokens por minuto y por día. Los presupuestos quedan por debajo del cupo gratuito: 150K de los 200K tokens diarios y 7K de los 8K por minuto.
- **429.** El modelo queda en pausa el tiempo de `Retry-After`; si la cuota agotada es la diaria, hasta el día siguiente (UTC). Ante 5xx, la pausa es de 30 s. Mientras tanto se usa el siguiente modelo.
- **Tamaño de las peticiones.**
  - Prompts de menos de 700 tokens (se recorta el historial y se envían como máximo 6 resultados).
  - `max_tokens` de 300.
  - Razonamiento bajo cuando el modelo lo admite: `reasoning_effort` low en gpt-oss y Gemini 2.5, none y oculto en Qwen.
  - El razonamiento interno nunca se muestra: se descarta cualquier bloque `<think>` y solo se usa el JSON validado.
- **Límites por persona.** 5 mensajes con IA por minuto y 30 por día (`AI_CHAT_PER_*`), por usuario o por IP. Al pasarlos, el chat sigue respondiendo con reglas.
- **Descuentos.** Las explicaciones se piden una vez por tienda y por día, en un solo lote con todas sus sugerencias, y se guardan en la base. Las reglas siguen decidiendo el porcentaje.
- **Combos.** No usan IA.
- **Logs.** Nunca muestran claves: solo indican qué modelo quedó en pausa y por qué.

### Cómo se usa el modelo en el chat

1. **Intención.** Extrae la intención como JSON validado con Zod.
2. **Datos reales.** El backend consulta la base de datos.
3. **Respuesta.** El modelo redacta solo con esos resultados, entre `<datos>` y tratados como dato no confiable.

Salvaguardas:

- **Anti-alucinación.** Cada precio, porcentaje, tienda y referencia se compara con los resultados; si no coincide, se usa la plantilla.
- **Privacidad.** Al proveedor nunca se envían coordenadas, correos, teléfonos ni nombres de usuarios.

## Cuenta y correo

- **Recuperar contraseña.** "Olvidé mi contraseña" responde igual exista o no el correo. El token se guarda con hash, es de un solo uso y vence en 30 minutos.
- **Cierre de sesiones.** Restablecer o cambiar la contraseña, o confirmar un correo nuevo, sube `users.token_version` y cierra las sesiones anteriores.
- **Correos.** Se envían con nodemailer si hay `SMTP_HOST`. En desarrollo sin SMTP se imprimen en la consola.

### Cambiar a mano el correo de una cuenta

Para cuando alguien perdió acceso a su correo anterior. Requiere la migración `006`. Reemplaza los dos correos y ejecútalo en el editor SQL de Supabase:

```sql
-- 1) Revisa la cuenta y confirma que el correo nuevo no esté en uso.
SELECT id, name, email, role FROM users
WHERE email IN (lower('correo.anterior@ejemplo.com'), lower('correo.nuevo@ejemplo.com'));

-- 2) Cambia el correo y cierra sus sesiones abiertas.
BEGIN;
UPDATE users
SET email = lower(trim('correo.nuevo@ejemplo.com')), token_version = token_version + 1
WHERE email = lower('correo.anterior@ejemplo.com')
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = lower(trim('correo.nuevo@ejemplo.com')));
-- Debe decir UPDATE 1. Si dice UPDATE 0, ejecuta ROLLBACK y revisa el paso 1.
UPDATE email_change_tokens SET used_at = now()
WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = lower(trim('correo.nuevo@ejemplo.com')));
COMMIT;
```

Después, la persona puede usar "¿Olvidaste tu contraseña?" con el correo nuevo.

## Estructura

- `src/routes`: rutas de la API.
- `src/repositories`: acceso a PostgreSQL.
- `src/services`: reglas de descuento, sugerencias, asistente y chat, ofertas, combos, notificaciones, cuenta, correo y cliente opcional de IA con respaldo.
- `src/middleware`: verificación del token y de los roles.
- `src/errors.ts`: errores de la API y manejador de errores.
- `src/dates.ts`, `src/geo.ts`, `src/format.ts`: fechas en hora de Bogotá, distancias y formato de pesos.
- `src/seed.ts`: datos de ejemplo.
- `src/migrations`: esquema de la base de datos.
- `test`: pruebas unitarias y de integración.
