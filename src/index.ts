import { app } from './app.js';
import { config } from './config.js';
import { pool } from './database.js';
import { migrate } from './migrate.js';

const start = async () => {
  try {
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
