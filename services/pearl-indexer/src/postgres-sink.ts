import type { PearlBlockSink, PearlBlockSummary, SaveBlockResult } from './block-poller.js';

/**
 * Minimal pg client interface — `node-postgres`' `Pool` and `Client` both satisfy this.
 * Kept narrow so tests can pass in a fake without pulling in the real driver.
 */
export interface PgQueryClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export type PgTxClient = PgQueryClient;

/**
 * Subset of `Pool` we need: a `withTransaction` helper plus a top-level
 * `query` for non-tx reads (like `loadNextHeight`).
 */
export interface PgTransactionalClient extends PgQueryClient {
  withTransaction<T>(fn: (tx: PgTxClient) => Promise<T>): Promise<T>;
}

const NEXT_HEIGHT_KEY = 'next_height';

export class PgBlockSink implements PearlBlockSink {
  private readonly client: PgTransactionalClient;

  constructor(client: PgTransactionalClient) {
    this.client = client;
  }

  async saveBlock(block: PearlBlockSummary): Promise<SaveBlockResult> {
    return this.client.withTransaction(async (tx) => {
      // Idempotency: if this exact (hash, height) is already indexed and not detached, skip.
      const existing = await tx.query<{ height: number; detached: boolean }>(
        'SELECT height, detached FROM pearl_blocks WHERE hash = $1',
        [block.hash],
      );
      if (
        (existing.rowCount ?? 0) > 0 &&
        !existing.rows[0].detached &&
        Number(existing.rows[0].height) === block.height
      ) {
        await this.advanceNextHeight(tx, block.height + 1);
        return { kind: 'duplicate' };
      }

      // Reorg check: for any block past genesis, its `previousHash` must match the canonical
      // (non-detached) block at H-1. If it doesn't, we're on a forked chain — mark the
      // stale parent detached and tell the poller to restart from there.
      if (block.height > 0) {
        const parent = await tx.query<{ hash: string }>(
          `SELECT hash FROM pearl_blocks
           WHERE height = $1 AND detached = false
           ORDER BY indexed_at DESC LIMIT 1`,
          [block.height - 1],
        );
        if ((parent.rowCount ?? 0) > 0 && parent.rows[0].hash !== block.previousHash) {
          await tx.query(
            `UPDATE pearl_blocks SET detached = true
             WHERE height = $1 AND detached = false`,
            [block.height - 1],
          );
          return {
            kind: 'reorg',
            detachedFromHeight: block.height - 1,
            indexedHash: parent.rows[0].hash,
            newPreviousHash: block.previousHash,
          };
        }
      }

      // Insert (or replace) this block. `ON CONFLICT (hash) DO UPDATE` covers the case where
      // a previously-detached block is back on the canonical chain — undetach + refresh.
      await tx.query(
        `INSERT INTO pearl_blocks (hash, height, previous_hash, timestamp, txids, detached, indexed_at)
         VALUES ($1, $2, $3, $4, $5, false, now())
         ON CONFLICT (hash) DO UPDATE
           SET detached = false,
               previous_hash = EXCLUDED.previous_hash,
               timestamp = EXCLUDED.timestamp,
               txids = EXCLUDED.txids,
               indexed_at = now()`,
        [block.hash, block.height, block.previousHash ?? null, block.timestamp, block.txids],
      );

      await this.advanceNextHeight(tx, block.height + 1);
      return { kind: 'saved' };
    });
  }

  /**
   * Read the persisted `next_height` from `indexer_state`. Returns `defaultValue`
   * if no state has been written yet (first run).
   */
  async loadNextHeight(defaultValue: number): Promise<number> {
    const result = await this.client.query<{ value: string }>(
      'SELECT value FROM indexer_state WHERE key = $1',
      [NEXT_HEIGHT_KEY],
    );
    if ((result.rowCount ?? 0) === 0) return defaultValue;
    return Number(result.rows[0].value);
  }

  /**
   * Only advances; never moves `next_height` backward. Reorg recovery handles
   * the rewind path by marking blocks detached and returning a smaller next-height
   * to the poller; we don't overwrite persisted state to a lower value.
   */
  private async advanceNextHeight(tx: PgTxClient, candidateHeight: number): Promise<void> {
    await tx.query(
      `INSERT INTO indexer_state (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET value = GREATEST(indexer_state.value::bigint, EXCLUDED.value::bigint)::text,
             updated_at = now()`,
      [NEXT_HEIGHT_KEY, String(candidateHeight)],
    );
  }
}

/**
 * Adapt a `pg.Pool` into our narrow `PgTransactionalClient`.
 * Isolated here so the import of the real driver is in a single file.
 */
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
        const result = await fn({ query: (t, p) => conn.query(t, p) });
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await conn.query('ROLLBACK');
        } catch {
          // surface the original error, not a rollback failure
        }
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}
