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
- **Seguridad**: validación con Zod, CORS, Helmet y límite de peticiones.

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

## Estructura

- `src/routes`: rutas de la API.
- `src/repositories`: acceso a PostgreSQL.
- `src/services`: reglas de descuento, sugerencias, asistente, combos, notificaciones y cliente opcional de IA.
- `src/middleware`: verificación del token y de los roles.
- `src/errors.ts`: errores de la API y manejador de errores.
- `src/dates.ts`, `src/geo.ts`, `src/format.ts`: fechas en hora de Bogotá, distancias y formato de pesos.
- `src/seed.ts`: datos de ejemplo.
- `src/migrations`: esquema de la base de datos.
- `test`: pruebas unitarias y de integración.
