# Pruebas del backend

Las pruebas usan el runner nativo de Node (`node:test`) con `tsx`, y la cobertura se mide con `c8`. Corren en serie (`--test-concurrency=1`) porque los archivos de integración comparten la misma base de pruebas.

Las pruebas de correo nunca envían correos reales: usan un transporte simulado (`useMailTransport`), un nodemailer simulado o un `fetch` simulado para Brevo. `test/setup.ts` vacía `SMTP_HOST`, `MAIL_PROVIDER` y `BREVO_API_KEY`, y bloquea cualquier `fetch` fuera de localhost.

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
| `account.test.ts` | Integración | Flujo completo de recuperación (enlace con `APP_URL` en texto y HTML, 30 minutos, nueva contraseña, aviso de contraseña cambiada, sesiones cerradas), fallo de SMTP con la misma respuesta y sin datos en el registro, enlace armado sin el host de la petición, cuenta antigua guardada con mayúsculas, producción sin `APP_URL`, respuesta genérica, hash del token, un solo uso, vencimiento, solo el enlace más nuevo, cambio de contraseña y de correo, tokens de un tipo usados en el otro, límites por IP y por correo, 503 sin SMTP en producción |
| `api.test.ts` | Integración | Migraciones (no se repiten, RLS en todas las tablas, rollback completo de una migración fallida, todas aditivas), propiedad de productos (403), fechas ISO antiguas, filtros |
| `stores.test.ts` | Integración | Tiendas por barrio y nombre, 404, la tienda solo como texto (ninguna respuesta trae coordenadas y ya no hay ruta para guardarlas), productos públicos, borrado, edición con fecha pasada y categoría antigua, stock en 0, JSON roto, rutas inexistentes, error 500 sin detalles |
| `validation.test.ts` | Unitaria e integración | Reglas de nombres, teléfonos, correos, contraseñas, productos, categorías y fechas, con mensajes en español |
| `discount-rules.test.ts` | Unitaria | Tramos por días (con todos los bordes), bonos de stock en 15 y 30, categorías perecederas, tope, precio en pesos enteros, orden |
| `suggestions.test.ts` | Unitaria e integración | Sugerencias por urgencia, aprobación y rechazo, otras tiendas fuera, explicaciones de IA una vez al día y sin números inventados |
| `chat.test.ts` | Unitaria e integración | Reglas primero, intención, "cerca de mí" (pide el barrio o filtra por el barrio del mensaje o del chat), presupuestos, datos personales, tamaño del prompt, límites por minuto y por día, anti-alucinación (precios y porcentajes en cualquier formato, y ninguna distancia), proveedor principal y respaldo, JSON inválido, tiempo de espera, todos caídos, temas ajenos, caché |
| `llm.test.ts` | Unitaria | Cadena de modelos, 429 con `Retry-After`, cupo diario, presupuestos de tokens, razonamiento oculto, claves fuera de los logs |
| `assistant.test.ts`, `search-intent.test.ts` | Unitaria e integración | Búsqueda en español, orden, barrio del mensaje o elegido como filtro, "cerca de mí" sin barrio, coordenadas de clientes viejos ignoradas |
| `offers.test.ts` | Integración | Solo productos con descuento y stock, filtros, orden por vencimiento, ya no hay orden por cercanía ni distancias, una oferta dura hasta el final de su día |
| `notifications.test.ts` | Unitaria e integración | Alertas y notificaciones por barrio, sin ubicación; las alertas antiguas por radio no avisan (pausadas con `ENABLE_ALERTS`; la suite las enciende para probarlas) |
| `dates.test.ts` | Unitaria | Cambio de día en Bogotá, bisiestos |
| `mailer.test.ts` | Unitaria | SMTP con TLS en el 465 y STARTTLS obligatorio en el 587, timeouts de 10 s, contraseña de aplicación de Gmail sin espacios, remitente por defecto, texto y HTML, errores descritos sin claves, enlaces ni tokens, pistas para Gmail y Brevo, plantillas en español, `mail:test` sin imprimir la contraseña; consola en desarrollo y 503 en producción sin SMTP |
| `brevo.test.ts` | Unitaria e integración | API HTTPS de Brevo con `fetch` simulado: envío con la cabecera `api-key` y las mismas plantillas, 401 (clave), 400 (remitente no verificado), tiempo agotado y red caída descritos sin la clave ni datos de la persona, "correo no configurado" sin `BREVO_API_KEY` o `MAIL_FROM`, `mail:test` con Brevo, recuperación completa por la API y misma respuesta si Brevo falla |
| `product-filters.test.ts` | Unitaria | Filtros SQL con los placeholders correctos |

## Resultado actual

203 pruebas, todas en verde (unos 40 s con la base de pruebas local).

| Métrica | Correo por SMTP | Ahora (con Brevo por API) |
| --- | --- | --- |
| Líneas | 97,8 % | 97,8 % |
| Ramas | 88,7 % | 88,2 % |
| Funciones | 100 % | 100 % |

Lo que queda sin cubrir es sobre todo:

- los `catch (error) { next(error) }` de las rutas, que solo se alcanzan si la base falla;
- el bloque de `migrate.ts` que corre al ejecutar el archivo directamente;
- las rutas de notificaciones, que están pausadas.

La caída de ramas en `config.ts` no es una pérdida real: `test/setup.ts` fija las variables de entorno, así que ya no se recorren los valores por defecto.

## Integración continua

`.github/workflows/ci.yml` corre en cada push y pull request con Node 20 y un Postgres 16 de servicio, sin secretos: `npm ci`, `npm run lint`, `npm run build` y `npm run test:coverage`. El reporte de cobertura queda como artefacto del job durante 7 días.
