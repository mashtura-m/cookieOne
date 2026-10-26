import pg from 'pg';
import { config } from './config';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX ?? 10) });

export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
