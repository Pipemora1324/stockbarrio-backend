import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000 });
pool.on('error', (error) => console.error('Error de conexión con PostgreSQL:', error.message));

export const database = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => pool.query<T>(text, params),
  withTransaction: async <T>(callback: (client: PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
