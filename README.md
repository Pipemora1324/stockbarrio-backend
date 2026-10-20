# StockBarrio - Backend

[![CI](https://github.com/Pipemora1324/stockbarrio-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Pipemora1324/stockbarrio-backend/actions/workflows/ci.yml)

API REST de StockBarrio, una aplicación de inventario para tiendas y mercados de barrio. Está hecha con Node.js, Express 5, TypeScript, Zod y PostgreSQL.

El frontend (Angular) está en un repositorio aparte: [stockbarrio-frontend](https://github.com/Pipemora1324/stockbarrio-frontend).

## Qué hace

- **Cuentas con JWT y tres roles.** Las tiendas (`store`) gestionan su inventario y los clientes (`customer`) reciben alertas. El registro público solo crea esos dos tipos de cuenta; el rol `admin` solo se crea con el script de seed.
- **Productos por tienda**, con stock, precios en pesos, descuentos y fechas de vencimiento. Cada tienda solo puede crear, editar y borrar sus propios productos (si no, responde 403).
- **Descuentos sugeridos.** Se calculan con reglas claras (días para vencer, exceso de stock y categoría perecedera) y la tienda los aprueba o rechaza. Nada se aplica sin aprobación.
- **Asistente de chat** en español ("busco huevos baratos", "leche en Chapinero"). Ordena por precio, descuento, categoría o vencimiento. La cercanía es solo por barrio: si el cliente pide algo "cerca de mí" sin decir el barrio, el asistente se lo pregunta y le dice en qué barrios hay tiendas.
- **Alertas y notificaciones dentro de la app.** Cuando una tienda aprueba un descuento, se avisa a los clientes cuyas alertas coinciden. Hay un solo aviso por producto y suscripción, y un límite diario.
- **IA opcional.** Todo funciona en local sin claves. Con un proveedor compatible con OpenAI se pueden mejorar textos y orden, pero su respuesta se valida siempre con Zod y contra el stock, las cantidades y los límites; si falla, se usan las reglas locales.
- **Ofertas** con filtros por barrio, categoría y texto, y orden por descuento o por vencimiento.
- **Cuenta**: recuperar contraseña por correo, perfil para cambiar nombre, contraseña y correo.
- **Seguridad**: validación con Zod (nombres, teléfono colombiano, correo, contraseña y productos), CORS, Helmet y límite de peticiones.

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
| `AI_PROVIDER` | `local` responde solo con reglas, sin servicios externos; cualquier otro valor usa el proveedor compatible con OpenAI | `local` |
| `OPENAI_API_KEY` | Clave del proveedor compatible con OpenAI | vacío |
| `OPENAI_MODEL` | Modelo a usar | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | URL base del proveedor | `https://api.openai.com/v1` |
| `AI_TIMEOUT_MS` | Tiempo máximo de espera del proveedor | `8000` |
| `ENABLE_ALERTS` | `true` activa las alertas y notificaciones. Apagadas, los endpoints responden, pero aprobar descuentos no genera notificaciones | `false` |
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
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Envío de correos. `SMTP_SECURE` es `true` con el puerto 465 y `false` con el 587 (STARTTLS); vacío, se deduce del puerto. `MAIL_FROM` vacío usa `SMTP_USER`. Ver [Configurar el correo](#configurar-el-correo) | vacío / `587` / según el puerto |
| `MAIL_PROVIDER` | Cómo se envían los correos: `smtp` (por defecto) o `brevo-api` (API HTTPS de Brevo, para Render Free). Ver [Configurar el correo](#configurar-el-correo) | `smtp` |
| `BREVO_API_KEY` | API key de Brevo, solo con `MAIL_PROVIDER=brevo-api` | vacío |
| `MAIL_TIMEOUT_MS` | Límite para conectar y para enviar un correo, con los dos transportes (también se acepta `SMTP_TIMEOUT_MS`) | `10000` |

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
| `npm run mail:test -- tucorreo@ejemplo.com` | Envía un correo de prueba con la configuración actual |
| `npm test` | Corre las pruebas |
| `npm run test:coverage` | Corre las pruebas y genera el reporte de cobertura en `coverage/` |
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

Sin `TEST_DATABASE_URL` solo corren las pruebas unitarias. Las pruebas se niegan a correr contra cualquier URL de Supabase y nunca usan claves reales ni salen a la red. Los detalles, la cobertura y qué cubre cada suite están en [TESTING.md](TESTING.md).

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
| `GET /api/stores/me` | Tienda | Datos de la tienda: nombre, barrio, dirección y teléfono |
| `GET /api/suggestions` | Tienda | Analiza el inventario y devuelve los descuentos sugeridos pendientes |
| `POST /api/suggestions/:id/approve` · `/:id/reject` · `/approve-all` | Tienda | Aprobar (aplica el descuento y notifica), rechazar o aprobar todas |
| `POST /api/assistant/search` | Público (30 por minuto) | `{ message, neighborhood? }` → respuesta en español y resultados (la usaba el asistente anterior; el frontend ya no la llama) |
| `POST /api/assistant/chat` | Público (10 por minuto y 100 por día, por IP y por usuario) | Chat con `{ messages, neighborhood? }` → `{ reply, mode, intent, results }` |
| `POST /api/offers/search` | Público | Ofertas con filtros `neighborhood`, `category` y `search`, y orden `discount` o `expiring` |
| `GET /api/products/categories` | Público | Lista de categorías permitidas |
| `POST /api/auth/forgot-password` · `POST /api/auth/reset-password` | Público (con límites) | Recuperar la contraseña con un enlace de un solo uso que vence en 30 minutos |
| `GET /api/account` · `PATCH /api/account/name` · `POST /api/account/password` · `POST /api/account/email` | Con sesión | Perfil: nombre, contraseña (pide la actual) y correo (pide la actual y envía un enlace al correo nuevo) |
| `POST /api/account/email/confirm` | Público | Confirma el correo nuevo desde el enlace |
| `GET /api/alerts` · `POST /api/alerts` · `DELETE /api/alerts/:id` | Cliente | Alertas por producto o categoría, barrio y descuento mínimo |
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

- La API no pide, no guarda y no expone coordenadas: ni del cliente ni de las tiendas. Las columnas `latitude`, `longitude` y `radius_km` siguen en la base (no se borró nada), pero ya no se leen ni se escriben. Si un cliente viejo manda coordenadas, se ignoran.
- Las alertas antiguas que eran por radio ya no generan avisos: sin distancias no hay forma de saber qué tiendas les quedan cerca.
- Las notificaciones solo se muestran dentro de la app: no hay canales externos registrados. Para agregar correo o WhatsApp se implementa `NotificationChannel` en `src/services/notifications.ts`.

## Alertas y notificaciones (pausadas)

Por ahora la app solo muestra la sección de Ofertas: las alertas y la bandeja de notificaciones están apagadas con `ENABLE_ALERTS=false` (valor por defecto).

Mientras estén apagadas:

- Los endpoints `/api/alerts` y `/api/notifications` siguen respondiendo.
- Las tablas y migraciones no cambian.
- Aprobar un descuento no crea notificaciones (`notified: 0`).

Para reactivarlas:

1. Pon `ENABLE_ALERTS=true` en Render.
2. Pon `ENABLE_ALERTS=true` en Vercel; el frontend lo lee al compilar (ver el README del frontend).

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
- **Logs.** Nunca muestran claves: solo indican qué modelo quedó en pausa y por qué.

### Cómo se usa el modelo en el chat

1. **Intención.** Extrae la intención como JSON validado con Zod.
2. **Datos reales.** El backend consulta la base de datos.
3. **Respuesta.** El modelo redacta solo con esos resultados, entre `<datos>` y tratados como dato no confiable.

Salvaguardas:

- **Anti-alucinación.** Cada precio, porcentaje, tienda y referencia se compara con los resultados; si no coincide, se usa la plantilla.
- **Privacidad.** Al proveedor nunca se envían correos, teléfonos ni nombres de usuarios. El frontend avisa bajo el campo del chat que el mensaje se procesa con un servicio de IA externo. Si el modelo menciona una distancia, la respuesta se descarta, porque la app no conoce distancias.

## Cuenta y correo

- **Recuperar contraseña.** En "¿Olvidaste tu contraseña?" la persona escribe el correo con el que creó la cuenta. No importan las mayúsculas ni los espacios, así que las cuentas antiguas guardadas con mayúsculas también se encuentran. La respuesta es la misma exista o no el correo, y aunque el envío falle.
- **El enlace.** Se arma solo con `APP_URL`, nunca con el host de la petición. El token se guarda con hash SHA-256, es de un solo uso y vence en 30 minutos. Pedir un enlace nuevo invalida el anterior, y un enlace de cambio de correo no sirve para restablecer la contraseña (ni al revés).
- **Límites.** 5 solicitudes cada 15 minutos por IP y 3 por hora por correo (aunque vengan de varias IP). Restablecer tiene 10 intentos cada 15 minutos por IP.
- **Cierre de sesiones.** Restablecer o cambiar la contraseña, o confirmar un correo nuevo, sube `users.token_version` y cierra las sesiones anteriores. Al cambiar la contraseña llega además el correo "Tu contraseña de StockBarrio fue cambiada".
- **Correos.** Van en español, en texto plano y HTML. Se envían con nodemailer, con 10 segundos de límite para conectar y para enviar. Si el envío falla, el registro solo dice el tipo de error (por ejemplo `EAUTH · SMTP 535`), sin el correo de la persona, el enlace, el token ni la contraseña SMTP.
- **Sin SMTP:**
  - en desarrollo el correo, con su enlace, se imprime en la consola;
  - en producción nunca se imprimen enlaces y la API responde 503 ("El envío de correos no está configurado todavía").
  - Lo mismo pasa en producción si falta `APP_URL`, para no mandar enlaces a `localhost`. Al arrancar, la API avisa en el registro si falta alguna de las dos.

### Configurar el correo

Hay dos formas de enviar, según `MAIL_PROVIDER`:

- **`smtp`** (por defecto, o sin la variable): nodemailer contra un servidor SMTP como Gmail o Brevo. Sirve en desarrollo y en hostings que permiten los puertos SMTP.
- **`brevo-api`**: la API HTTPS de Brevo (`POST https://api.brevo.com/v3/smtp/email` con la cabecera `api-key`), por el puerto 443.

> **Render Free bloquea el tráfico saliente a los puertos SMTP 25, 465 y 587.** Desde ahí el SMTP siempre termina en tiempo de espera agotado (`ETIMEDOUT`), sea Gmail o Brevo. En Render Free usa `MAIL_PROVIDER=brevo-api`.

Los dos transportes envían los mismos correos: las mismas plantillas en español, en texto y HTML, con el mismo límite de 10 s. También tienen el mismo contrato: si el envío falla, la API responde igual y el registro solo dice el tipo de error (por ejemplo `Brevo 401` o `ETIMEDOUT`), nunca la clave, el correo de la persona, el enlace ni el token. Si falta configuración, la API avisa al arrancar y responde "correo no configurado" sin dejar de funcionar.

Después de poner las variables, prueba con:

```bash
npm run mail:test -- tucorreo@ejemplo.com
```

El script muestra el transporte, el servidor o la API, si la contraseña o la API key están definidas (nunca las imprime) y el remitente. Luego verifica la conexión o la API key, envía un correo de prueba y, si algo falla, explica qué revisar. En Render se corre desde la pestaña Shell con `node dist/mail-test.js tucorreo@ejemplo.com`.

#### Brevo por API (recomendado en Render Free)

1. Crea una cuenta gratuita en https://www.brevo.com (300 correos al día). Confirma tu correo y completa los datos de la cuenta que pide Brevo; sin eso no activa los envíos.
2. **Verifica el remitente.** En **Senders, Domains & Dedicated IPs > Senders**, pulsa **Add a sender**, escribe el nombre ("StockBarrio") y el correo que aparecerá como remitente, y abre el enlace de confirmación que te llega a ese correo. Brevo rechaza con un 400 cualquier remitente sin verificar.
3. **Crea la API key.** En **SMTP & API > API Keys** pulsa **Generate a new API key**, ponle un nombre ("StockBarrio Render") y copia la clave, que empieza por `xkeysib-`. Brevo solo la muestra una vez. No uses la "clave SMTP": esa es para `MAIL_PROVIDER=smtp`.
4. Si en **Security > Authorized IPs** está activado el bloqueo por IP, desactívalo o agrega las IP de salida de Render. Si no, Brevo responde 401 aunque la clave esté bien.
5. Pon estas variables en Render:

   | Variable | Valor |
   | --- | --- |
   | `MAIL_PROVIDER` | `brevo-api` |
   | `BREVO_API_KEY` | la clave `xkeysib-…` |
   | `MAIL_FROM` | `StockBarrio <el remitente que verificaste>` |
   | `APP_URL` | la URL de Vercel, sin `/` al final |

   Con `brevo-api` no se usan `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` ni `SMTP_PASS`, así que puedes borrarlas o dejarlas.

#### Gmail

1. En tu cuenta de Google, activa la **Verificación en 2 pasos** (Seguridad > Cómo inicias sesión en Google). Sin ella no aparecen las contraseñas de aplicación.
2. Entra a https://myaccount.google.com/apppasswords, escribe un nombre (por ejemplo "StockBarrio") y pulsa **Crear**. Google muestra una contraseña de 16 letras en grupos de cuatro.
3. Copia esas 16 letras **sin espacios** en `SMTP_PASS`. Si se cuelan los espacios, la API los quita (solo para Gmail). Nunca uses la contraseña normal de la cuenta.
4. Pon estas variables:

   | Variable | Valor |
   | --- | --- |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_SECURE` | `true` |
   | `SMTP_USER` | tu correo de Gmail completo |
   | `SMTP_PASS` | la contraseña de aplicación de 16 letras |
   | `MAIL_FROM` | `StockBarrio <tu correo de Gmail>`, o vacío para usar `SMTP_USER` |
   | `APP_URL` | la URL de Vercel, por ejemplo `https://tu-app.vercel.app` (sin `/` al final) |

   También sirve el puerto `587` con `SMTP_SECURE=false`: la conexión pasa a cifrada con STARTTLS antes de iniciar sesión y, si no puede, no envía nada.
5. Gmail envía siempre desde la cuenta autenticada. Si `MAIL_FROM` tiene otra dirección, Gmail la reemplaza y el correo sale igual. El límite gratuito es de unos 500 correos al día.

#### Brevo por SMTP

1. Crea una cuenta gratuita en https://www.brevo.com (300 correos al día).
2. En **Senders, Domains & Dedicated IPs > Senders**, agrega el correo que aparecerá como remitente y confírmalo desde el enlace que te llega. Brevo rechaza remitentes sin verificar.
3. En **SMTP & API > SMTP**, copia el servidor, el puerto, el **login** (algo como `9a1b2c001@smtp-brevo.com`) y genera una **clave SMTP**.
4. Pon estas variables:

   | Variable | Valor |
   | --- | --- |
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_SECURE` | `false` |
   | `SMTP_USER` | el login SMTP de Brevo |
   | `SMTP_PASS` | la clave SMTP de Brevo |
   | `MAIL_FROM` | `StockBarrio <el remitente que verificaste>` (obligatorio en Brevo) |
   | `APP_URL` | la URL de Vercel |

#### Si no llega

- `Brevo 401`: la API key no es válida o Brevo bloquea la IP del servidor (Security > Authorized IPs).
- `Brevo 400`: casi siempre el remitente no está verificado. `MAIL_FROM` debe ser exactamente un remitente de la lista Senders.
- `Brevo · tiempo de espera agotado` o `Brevo · sin conexión`: el servidor no llegó a `api.brevo.com`; vuelve a intentar.
- `ETIMEDOUT` con SMTP desde Render Free: son los puertos bloqueados. Cambia a `MAIL_PROVIDER=brevo-api`.

- `EAUTH` o `SMTP 535`: usuario o contraseña. En Gmail tiene que ser la contraseña de aplicación; en Brevo, el login y la clave SMTP (no los de entrar a la web).
- `ETIMEDOUT`, `ESOCKET` o `ECONNECTION`: no conecta. Revisa el host, y que `SMTP_SECURE` sea `true` con el 465 o `false` con el 587.
- `SMTP 550/553/554` o `EENVELOPE`: el proveedor rechazó el remitente. En Brevo, `MAIL_FROM` debe ser un remitente verificado.
- Si `mail:test` dice que se envió pero no lo ves, revisa la carpeta de spam.

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
- `src/services`: reglas de descuento, sugerencias, asistente y chat, ofertas, notificaciones, cuenta, correo y cliente opcional de IA con respaldo.
- `src/middleware`: verificación del token y de los roles.
- `src/errors.ts`: errores de la API y manejador de errores.
- `src/dates.ts`, `src/format.ts`: fechas en hora de Bogotá y formato de pesos.
- `src/seed.ts`: datos de ejemplo.
- `src/migrations`: esquema de la base de datos.
- `test`: pruebas unitarias y de integración.
