import { app } from './app.js';
import { config } from './config.js';
import { pool } from './database.js';
import { migrate } from './migrate.js';
import { mailSetupProblems } from './services/mailer.js';
import { supabaseAuthProblems } from './services/supabase-token.js';

const start = async () => {
  try {
    for (const problem of mailSetupProblems()) console.warn(`Correo: ${problem}`);
    if (!['legacy', 'supabase'].includes(config.authProvider)) console.warn(`Autenticación: AUTH_PROVIDER="${config.authProvider}" no es válido; se usa el modo legacy.`);
    if (config.authProvider === 'supabase') for (const problem of supabaseAuthProblems()) console.warn(`Autenticación: AUTH_PROVIDER=supabase pero ${problem}. Nadie podrá iniciar sesión.`);
    await migrate();
    await pool.query('SELECT 1');
    app.listen(config.port, () => console.info(`StockBarrio API escuchando en http://localhost:${config.port}`));
  } catch (error) {
    console.error('No se pudo iniciar la API.', error);
    await pool.end();
    process.exitCode = 1;
  }
};

void start();
