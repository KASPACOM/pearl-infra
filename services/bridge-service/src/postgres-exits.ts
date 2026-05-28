import type { BridgeExitRequestRepository } from './repository.js';
import type { BridgeExitRequest } from './types.js';
import type { IgraBridgePollerCheckpointStore } from './igra-poller.js';

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

type BridgeExitRow = Record<string, unknown> & {
  igra_burn_txid: string;
  igra_burn_log_index: number;
  igra_burn_block: string | number;
  igra_chain_id: string | number;
  exit_id: string;
  requested_amount_grains: string;
  pearl_recipient: string;
  status: string;
  pearl_release_txid: string | null;
  pearl_release_block: string | number | null;
  released_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export class PgBridgeExitRequestRepository implements BridgeExitRequestRepository {
  private readonly client: PgTransactionalClient;

  constructor(client: PgTransactionalClient) {
    this.client = client;
  }

  async upsertExitRequest(exit: BridgeExitRequest): Promise<{ exit: BridgeExitRequest; created: boolean }> {
    return this.client.withTransaction(async (tx) => {
      if (exit.pearlReleaseTxid) {
        const releaseConflict = await tx.query<{ exit_id: string }>(
          `SELECT exit_id
             FROM bridge_exit_requests
            WHERE pearl_release_txid = $1
              AND exit_id <> $2
            LIMIT 1`,
          [exit.pearlReleaseTxid, exit.exitId],
        );
        if ((releaseConflict.rowCount ?? 0) > 0) {
          throw new Error(`Pearl release txid already belongs to exit ${releaseConflict.rows[0].exit_id}`);
        }
      }

      const existing = await tx.query<BridgeExitRow>(
        `SELECT igra_burn_txid, igra_burn_log_index, igra_burn_block, igra_chain_id,
                exit_id, requested_amount_grains, pearl_recipient, status,
                pearl_release_txid, pearl_release_block, released_at, metadata,
                created_at, updated_at
           FROM bridge_exit_requests
          WHERE igra_burn_txid = $1 AND igra_burn_log_index = $2
          FOR UPDATE`,
        [exit.igraBurnTxid, exit.igraBurnLogIndex],
      );
      const created = (existing.rowCount ?? 0) === 0;

      const result = await tx.query<BridgeExitRow>(
        `INSERT INTO bridge_exit_requests (
           igra_burn_txid, igra_burn_log_index, igra_burn_block, igra_chain_id,
           exit_id, requested_amount_grains, pearl_recipient, status,
           pearl_release_txid, pearl_release_block, released_at, metadata,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12::jsonb,
           $13::timestamptz, $14::timestamptz
         )
         ON CONFLICT (igra_burn_txid, igra_burn_log_index) DO UPDATE
           SET exit_id = EXCLUDED.exit_id,
               requested_amount_grains = EXCLUDED.requested_amount_grains,
               pearl_recipient = EXCLUDED.pearl_recipient,
               status = CASE
                 WHEN bridge_exit_requests.status IN ('released', 'refunded', 'cancelled')
                   THEN bridge_exit_requests.status
                 WHEN bridge_exit_requests.status = 'processed' AND EXCLUDED.status = 'pending'
                   THEN bridge_exit_requests.status
                 ELSE EXCLUDED.status
               END,
               pearl_release_txid = COALESCE(bridge_exit_requests.pearl_release_txid, EXCLUDED.pearl_release_txid),
               pearl_release_block = COALESCE(bridge_exit_requests.pearl_release_block, EXCLUDED.pearl_release_block),
               released_at = COALESCE(bridge_exit_requests.released_at, EXCLUDED.released_at),
               metadata = bridge_exit_requests.metadata || EXCLUDED.metadata,
               updated_at = EXCLUDED.updated_at
         RETURNING igra_burn_txid, igra_burn_log_index, igra_burn_block, igra_chain_id,
                   exit_id, requested_amount_grains, pearl_recipient, status,
                   pearl_release_txid, pearl_release_block, released_at, metadata,
                   created_at, updated_at`,
        [
          exit.igraBurnTxid,
          exit.igraBurnLogIndex,
          exit.igraBurnBlock,
          exit.igraChainId,
          exit.exitId,
          exit.requestedAmountGrains,
          exit.pearlRecipient,
          exit.status,
          exit.pearlReleaseTxid ?? null,
          exit.pearlReleaseBlock ?? null,
          exit.releasedAt ?? null,
          JSON.stringify(exit.metadata ?? {}),
          exit.createdAt,
          exit.updatedAt,
        ],
      );
      return { exit: rowToExit(result.rows[0]), created };
    });
  }

  async findExitRequest(exitId: string): Promise<BridgeExitRequest | undefined> {
    const result = await this.client.query<BridgeExitRow>(
      `SELECT igra_burn_txid, igra_burn_log_index, igra_burn_block, igra_chain_id,
              exit_id, requested_amount_grains, pearl_recipient, status,
              pearl_release_txid, pearl_release_block, released_at, metadata,
              created_at, updated_at
         FROM bridge_exit_requests
        WHERE exit_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [exitId],
    );
    return (result.rowCount ?? 0) === 0 ? undefined : rowToExit(result.rows[0]);
  }

  async listExitRequests(): Promise<BridgeExitRequest[]> {
    const result = await this.client.query<BridgeExitRow>(
      `SELECT igra_burn_txid, igra_burn_log_index, igra_burn_block, igra_chain_id,
              exit_id, requested_amount_grains, pearl_recipient, status,
              pearl_release_txid, pearl_release_block, released_at, metadata,
              created_at, updated_at
         FROM bridge_exit_requests
        ORDER BY updated_at DESC, igra_burn_block DESC`,
    );
    return result.rows.map(rowToExit);
  }
}

export class PgIgraBridgeCheckpointStore implements IgraBridgePollerCheckpointStore {
  private readonly client: PgTransactionalClient;
  private readonly key: string;

  constructor(client: PgTransactionalClient, input: { chainId: number; bridgeAddress: string; keyPrefix?: string }) {
    if (!Number.isInteger(input.chainId) || input.chainId <= 0) throw new Error('chainId must be a positive integer');
    this.client = client;
    this.key = [
      input.keyPrefix ?? 'bridge_igra_next_block',
      input.chainId,
      input.bridgeAddress.toLowerCase(),
    ].join(':');
  }

  async loadNextBlock(defaultStartBlock: number): Promise<number> {
    const result = await this.client.query<{ value: string }>(
      'SELECT value FROM indexer_state WHERE key = $1',
      [this.key],
    );
    if ((result.rowCount ?? 0) === 0) return defaultStartBlock;
    const value = Number(result.rows[0].value);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid bridge checkpoint value for ${this.key}`);
    return value;
  }

  async saveNextBlock(nextBlock: number): Promise<void> {
    if (!Number.isSafeInteger(nextBlock) || nextBlock <= 0) throw new Error('nextBlock must be a positive safe integer');
    await this.client.query(
      `INSERT INTO indexer_state (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET value = GREATEST(indexer_state.value::bigint, EXCLUDED.value::bigint)::text,
             updated_at = now()`,
      [this.key, String(nextBlock)],
    );
  }
}

function rowToExit(row: BridgeExitRow): BridgeExitRequest {
  return {
    exitId: row.exit_id,
    igraBurnTxid: row.igra_burn_txid,
    igraBurnLogIndex: Number(row.igra_burn_log_index),
    igraBurnBlock: Number(row.igra_burn_block),
    igraChainId: Number(row.igra_chain_id),
    requestedAmountGrains: row.requested_amount_grains,
    pearlRecipient: row.pearl_recipient,
    status: row.status as BridgeExitRequest['status'],
    ...(row.pearl_release_txid ? { pearlReleaseTxid: row.pearl_release_txid } : {}),
    ...(row.pearl_release_block !== null && row.pearl_release_block !== undefined
      ? { pearlReleaseBlock: Number(row.pearl_release_block) }
      : {}),
    ...(row.released_at ? { releasedAt: row.released_at.toISOString() } : {}),
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
