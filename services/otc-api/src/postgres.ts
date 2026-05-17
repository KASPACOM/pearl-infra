export interface PgQueryClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export type PgTxClient = PgQueryClient;

export interface PgTransactionalClient extends PgQueryClient {
  withTransaction<T>(fn: (tx: PgTxClient) => Promise<T>): Promise<T>;
}

export function pgPoolAdapter(pool: {
  query: PgQueryClient['query'];
  connect: () => Promise<{ query: PgQueryClient['query']; release: () => void }>;
}): PgTransactionalClient {
  return {
    query: (text, params) => pool.query(text, params),
    async withTransaction(fn) {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        const result = await fn({ query: (text, params) => conn.query(text, params) });
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await conn.query('ROLLBACK');
        } catch {
          // Preserve the original error; rollback failures are secondary here.
        }
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}
