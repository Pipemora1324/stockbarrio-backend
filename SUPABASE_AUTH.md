# Supabase Auth: guía de configuración

Con `AUTH_PROVIDER=supabase`, el registro, el inicio de sesión y la recuperación de contraseña pasan a Supabase Auth. Con `AUTH_PROVIDER=legacy` (el valor por defecto) todo sigue como antes: bcrypt y el JWT propio de la API. Esta guía es para hacerla en el panel de Supabase y en Render y Vercel, en ese orden.

## Cómo funciona

| Paso | Qué pasa |
| --- | --- |
| Registro | El frontend llama a `supabase.auth.signUp` con el correo, la contraseña y los datos del perfil en `user_metadata` (tipo de cuenta, nombre y, para tiendas, nombre de la tienda, barrio, dirección y teléfono). Supabase envía un correo con un **enlace**; al abrirlo, la persona vuelve a `/login?confirmado=1` y ve "Tu correo quedó confirmado". |
| Login | `signInWithPassword`. El frontend manda el access token de Supabase como `Bearer` a la API, que lo verifica (firma, emisor, audiencia `authenticated` y vencimiento). |
| Perfil local | En la primera petición con un token válido, la API busca el perfil en `public.users`. Si hay un usuario con ese `auth_id`, lo usa. Si hay uno con el mismo correo **confirmado** y sin `auth_id` (una cuenta vieja), lo vincula: conserva la tienda, los productos y el rol. Si no hay ninguno, lo crea como cliente o como tienda con los datos del registro, validados con las mismas reglas de siempre. |
| Roles | Siempre salen de `public.users`. El registro nunca crea administradores, y lo que la persona escriba en `user_metadata` no cambia el rol de una cuenta existente. |
| Recuperar contraseña | "¿Olvidaste tu contraseña?" llama a `resetPasswordForEmail`. El correo trae un **código de 6 dígitos**, que la persona escribe en la app (`verifyOtp` con `type: 'recovery'`) junto con la contraseña nueva (`updateUser`). Al terminar se cierran todas las sesiones. |
| Perfil | El nombre se cambia en `public.users`. La contraseña y el correo se cambian en Supabase con `updateUser`; el correo nuevo se confirma con un enlace. |
| Endpoints antiguos | `POST /api/auth/login`, `/register`, `/forgot-password`, `/reset-password` y `POST /api/account/password`, `/email`, `/email/confirm` siguen en el código, pero responden 404 con un mensaje claro. |

La API no necesita la `service_role` key. El frontend solo usa la clave pública (anon o publishable).

## 1. Proveedor de correo

**Authentication → Sign In / Providers → Email:**

1. Activa **Enable Email provider**.
2. Activa **Confirm email**: sin confirmar el correo no se puede iniciar sesión.
3. Deja activado **Secure email change**: el cambio de correo se confirma desde las dos direcciones.
4. **Email OTP Expiration**: `3600` (60 minutos, lo que dice la pantalla de la app). Puedes bajarlo a `900` (15 minutos); en ese caso cambia también `codeMinutes` en `recover-with-code.component.ts`.
5. **Email OTP Length**: `6`.

## 2. URL Configuration

**Authentication → URL Configuration:**

- **Site URL:** la URL de Vercel, por ejemplo `https://tu-app.vercel.app`.
- **Redirect URLs** (una por línea):
  - `https://tu-app.vercel.app/login`
  - `https://tu-app.vercel.app/**`
  - `http://localhost:4200/login`
  - `http://localhost:4200/**`

Sin estas URL, Supabase manda a la persona a la Site URL en lugar de `/login?confirmado=1`.

## 3. SMTP propio con Gmail

El correo integrado de Supabase solo envía a los miembros del proyecto y tiene un límite muy bajo, así que hace falta un SMTP propio. A diferencia de Render Free, Supabase sí puede usar los puertos SMTP.

1. En tu cuenta de Google, activa la **Verificación en 2 pasos** y crea una **contraseña de aplicación** en https://myaccount.google.com/apppasswords. Copia las 16 letras sin espacios.
2. En **Authentication → Emails → SMTP Settings**, activa **Enable Custom SMTP** y llena:

   | Campo | Valor |
   | --- | --- |
   | Sender email | tu correo de Gmail |
   | Sender name | `StockBarrio` |
   | Host | `smtp.gmail.com` |
   | Port number | `465` |
   | Username | tu correo de Gmail completo |
   | Password | la contraseña de aplicación de 16 letras |

3. Guarda los cambios. Gmail envía siempre desde la cuenta autenticada, así que el remitente debe ser ese mismo correo.

## 4. Plantillas en español

En **Authentication → Emails → Templates**:

### Confirm signup (con enlace)

**Subject:** `Confirma tu cuenta de StockBarrio`

```html
<h2>Confirma tu cuenta</h2>
<p>Hola:</p>
<p>Gracias por registrarte en StockBarrio. Para activar tu cuenta, confirma tu correo:</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0f7a55;color:#ffffff;font-weight:bold;text-decoration:none;">Confirmar mi correo</a></p>
<p>Si el botón no funciona, copia este enlace en tu navegador:<br>{{ .ConfirmationURL }}</p>
<p>Si no creaste esta cuenta, ignora este mensaje.</p>
<p>Equipo de StockBarrio</p>
```

### Reset password (con código)

**Subject:** `Tu código para cambiar la contraseña de StockBarrio`

```html
<h2>Cambia tu contraseña</h2>
<p>Hola:</p>
<p>Recibimos una solicitud para cambiar la contraseña de tu cuenta de StockBarrio. Escribe este código en la app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;">{{ .Token }}</p>
<p>El código vence en 60 minutos y solo se puede usar una vez.</p>
<p>Si no fuiste tú, ignora este mensaje: tu contraseña no cambiará.</p>
<p>Equipo de StockBarrio</p>
```

La plantilla de recuperación **no** debe llevar `{{ .ConfirmationURL }}`: la app solo usa el código.

### Change email address (con enlace)

**Subject:** `Confirma tu nuevo correo en StockBarrio`

```html
<h2>Confirma tu nuevo correo</h2>
<p>Hola:</p>
<p>Pediste cambiar el correo de tu cuenta de StockBarrio de {{ .Email }} a {{ .NewEmail }}. Para confirmarlo, abre este enlace:</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0f7a55;color:#ffffff;font-weight:bold;text-decoration:none;">Confirmar el cambio</a></p>
<p>Si no pediste este cambio, ignora este mensaje y cambia tu contraseña.</p>
<p>Equipo de StockBarrio</p>
```

## 5. Límites de envío y de intentos

En **Authentication → Rate Limits**:

- **Rate limit for sending emails:** `30` por hora (con SMTP propio). Cubre registros, códigos y cambios de correo.
- **Rate limit for token verifications:** el valor por defecto (30 cada 5 minutos por IP). Es el límite de intentos para escribir el código: después de eso Supabase responde 429 y la app dice "Hiciste demasiados intentos. Espera unos minutos".
- En **Authentication → Sign In / Providers → Email**, **Minimum interval between emails per user** queda en `60` segundos. Es lo mismo que espera el botón "Pedir otro código".

La API mantiene además sus límites por IP y por usuario.

## 6. Claves para verificar los tokens

En **Project Settings → JWT Keys**:

- Si la clave actual es **ECC (P-256)** o **RSA** (claves asimétricas, lo recomendado), usa `SUPABASE_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`. No es un secreto.
- Si la clave actual es el **Legacy JWT Secret** (HS256), usa `SUPABASE_JWT_SECRET` con ese valor. Es un secreto: solo va en Render. Lo mejor es migrar a claves asimétricas desde la misma pantalla y pasar a `SUPABASE_JWKS_URL`.
- Puedes poner las dos variables durante la migración. La API acepta HS256 solo con el secreto y RS256 o ES256 solo con el JWKS.

`<ref>` es el identificador del proyecto (está en la URL del panel y en Project Settings → General).

## 7. Variables

**Render (backend):**

| Variable | Valor |
| --- | --- |
| `AUTH_PROVIDER` | `supabase` (o `legacy` para volver atrás) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_SECRET` | solo si el proyecto sigue con el secreto HS256 |

**Vercel (frontend), en Production y Preview:**

| Variable | Valor |
| --- | --- |
| `AUTH_PROVIDER` | `supabase` (o `legacy`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | la clave **anon** o **publishable** (Project Settings → API Keys). Nunca la `service_role` ni una `sb_secret_…`: el build se detiene si detecta una |

El frontend lee estas variables al compilar, así que después de cambiarlas hay que redesplegar.

## 8. Pruebas manuales

1. **Registro de cliente:** en `/register`, crea una cuenta con un correo real. Debe aparecer "Revisa tu correo". Intenta iniciar sesión antes de confirmar: debe decir que falta confirmar y ofrecer "Reenviar correo de confirmación".
2. **Confirmación:** abre el enlace del correo. Debes llegar a `/login` con "Tu correo quedó confirmado". Inicia sesión: un cliente entra a Ofertas.
3. **Registro de tienda:** repite con "Tengo una tienda". Al primer inicio de sesión debes entrar al panel con la tienda creada y poder agregar un producto.
4. **Recuperación:** en "¿Olvidaste tu contraseña?" escribe el correo. Llega un código de 6 dígitos.
   - Escribe un código equivocado: debe decir "El código no es válido o ya venció. Pide otro."
   - Escribe el correcto y una contraseña nueva: debes volver al login con un aviso.
   - Entra con la nueva.
5. **Vinculación de una cuenta vieja:** con una cuenta creada antes en modo legacy (por ejemplo `tienda.donaluz@stockbarrio.test` del seed, o una real), regístrate en Supabase con **el mismo correo** y confírmalo. Al iniciar sesión debes ver la misma tienda y los mismos productos. En SQL: `SELECT email, auth_id FROM users WHERE email = '…';` muestra el `auth_id` lleno.
6. **Perfil:**
   - cambia el nombre;
   - cambia la contraseña (pide la actual);
   - cambia el correo: llegan los enlaces de confirmación y, al abrirlos, el perfil muestra el correo nuevo.
7. **Vuelta al modo legacy:** pon `AUTH_PROVIDER=legacy` en Render y en Vercel y redespliega los dos.
   - Las cuentas viejas entran con su contraseña de siempre.
   - Las cuentas creadas en Supabase no tienen contraseña local: deben usar "¿Olvidaste tu contraseña?" (enlace por correo de la API) para crear una.
