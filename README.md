# StockBarrio - Backend

API REST de StockBarrio, una aplicación de inventario para tiendas y mercados de barrio. Está hecha con Node.js, Express 5, TypeScript, Zod y PostgreSQL.

El frontend (Angular) está en un repositorio aparte: [stockbarrio-frontend](https://github.com/Pipemora1324/stockbarrio-frontend).

## Qué hace

- Registro e inicio de sesión con JWT. El registro público solo crea cuentas de tienda (rol `store`); el rol `admin` solo se crea con el script de seed.
- CRUD de productos por tienda, con stock, precios, descuentos y fechas de vencimiento. Cada tienda solo puede crear, editar y borrar sus propios productos (si no, responde 403).
- Consulta de tiendas y sus productos.
- Recomendaciones de compra: por defecto se calculan en local; opcionalmente se puede usar un proveedor compatible con la API de OpenAI.
- Validación de entrada con Zod, CORS, Helmet y límite de peticiones.

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
- Las fechas de vencimiento son fechas puras `AAAA-MM-DD`, sin hora ni zona horaria. La API también acepta una fecha ISO completa y se queda con el día.
- Los errores responden `{ message }` en español; los de validación (400) incluyen además `errors: [{ field, message }]`.
- `GET /api/auth/me` valida el token y devuelve el usuario actual.
- `GET /api/products/mine` devuelve los productos de la tienda del usuario autenticado.

## Estructura

- `src/routes`: rutas de la API (`/api/auth`, `/api/products`, `/api/stores`, `/api/recommendations`). Además está `/api/health`.
- `src/repositories`: acceso a PostgreSQL.
- `src/services`: autenticación y recomendaciones.
- `src/middleware`: verificación del token y de los roles.
- `src/errors.ts`: errores de la API y manejador de errores.
- `src/seed.ts`: datos de ejemplo.
- `src/migrations`: esquema de la base de datos.
- `test`: pruebas.
