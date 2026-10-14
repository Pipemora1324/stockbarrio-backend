# StockBarrio - Backend

API REST de StockBarrio, una aplicación de inventario para tiendas y mercados de barrio. Está hecha con Node.js, Express 5, TypeScript, Zod y PostgreSQL.

El frontend (Angular) está en un repositorio aparte: [stockbarrio-frontend](https://github.com/Pipemora1324/stockbarrio-frontend).

## Qué hace

- Registro e inicio de sesión con JWT (roles `admin` y `store`).
- CRUD de productos por tienda, con stock, precios, descuentos y fechas de vencimiento.
- Consulta de tiendas y sus productos.
- Recomendaciones de compra: por defecto se calculan en local; opcionalmente se puede usar un proveedor compatible con la API de OpenAI.
- Validación de entrada con Zod, CORS, Helmet y límite de peticiones.

Al arrancar, la API ejecuta la migración `src/migrations/001_init.sql`, que crea las tablas si no existen.

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

Nunca subas el `.env` real; solo `.env.example`.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Arranca la API con recarga automática (tsx) |
| `npm run build` | Compila a `dist/` y copia las migraciones |
| `npm start` | Ejecuta la versión compilada |
| `npm run migrate` | Ejecuta la migración manualmente |
| `npm test` | Corre las pruebas |
| `npm run lint` | Revisa los tipos sin compilar |

## Estructura

- `src/routes`: rutas de la API (`/api/auth`, `/api/products`, `/api/stores`, `/api/recommendations`). Además está `/api/health`.
- `src/repositories`: acceso a PostgreSQL.
- `src/services`: autenticación y recomendaciones.
- `src/middleware`: verificación del token.
- `src/migrations`: esquema de la base de datos.
- `test`: pruebas.
