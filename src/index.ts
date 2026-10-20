import { app } from './app.js';
import { config } from './config.js';
import { pool } from './database.js';
import { migrate } from './migrate.js';

const start = async () => {
  try {
    if (config.nodeEnv === 'production' && !config.smtpHost) console.warn('SMTP_HOST no está definido: la recuperación de contraseña responderá que el correo no está configurado.');
    if (!config.appUrlConfigured) console.warn('APP_URL no está definida: no se enviarán correos, porque sus enlaces no tendrían a dónde apuntar.');
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
