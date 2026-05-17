import type { PgTransactionalClient, PgTxClient } from './postgres-sink.js';
import {
  WatchConflictError,
  WatchNotFoundError,
  type AddressObservation,
  type AddressSpend,
  type RegisterWatchInput,
  type WatchPurpose,
  type WatchedAddress,
  type WatchedAddressWithHistory,
} from './watched-address-types.js';

export interface WatchedAddressRepository {
  register(input: RegisterWatchInput): Promise<{ watch: WatchedAddress; created: boolean }>;
  get(watchId: string): Promise<WatchedAddressWithHistory | null>;
  close(watchId: string): Promise<WatchedAddress>;
  listActive(purposes: WatchPurpose[]): Promise<WatchedAddress[]>;
}

type WatchedAddressRow = Record<string, unknown> & {
  watch_id: string;
  purpose: string;
  network: string;
  address: string;
  required_confirmations: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

type AddressObservationRow = Record<string, unknown> & {
  outpoint: string;
  watch_id: string;
  block_hash: string;
  height: string | number;
  amount_grains: string;
  confirmations: number;
  match_status: string;
  observed_at: Date;
}

type AddressSpendRow = Record<string, unknown> & {
  spend_txid: string;
  spent_outpoint: string;
  block_hash: string;
  height: string | number;
  classification: string;
  classification_data: Record<string, unknown> | null;
  observed_at: Date;
}

function rowToWatch(row: WatchedAddressRow): WatchedAddress {
  return {
    watchId: row.watch_id,
    purpose: row.purpose as WatchedAddress['purpose'],
    network: row.network as WatchedAddress['network'],
    address: row.address,
    requiredConfirmations: Number(row.required_confirmations),
    status: row.status as WatchedAddress['status'],
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToObservation(row: AddressObservationRow): AddressObservation {
  return {
    outpoint: row.outpoint,
    watchId: row.watch_id,
    blockHash: row.block_hash,
    height: Number(row.height),
    amountGrains: row.amount_grains,
    confirmations: row.confirmations,
    matchStatus: row.match_status as AddressObservation['matchStatus'],
    observedAt: row.observed_at.toISOString(),
  };
}

function rowToSpend(row: AddressSpendRow): AddressSpend {
  return {
    spendTxid: row.spend_txid,
    spentOutpoint: row.spent_outpoint,
    blockHash: row.block_hash,
    height: Number(row.height),
    classification: row.classification,
    classificationData: row.classification_data,
    observedAt: row.observed_at.toISOString(),
  };
}

function diffWatchFields(existing: WatchedAddress, input: RegisterWatchInput): string[] {
  const diffs: string[] = [];
  if (existing.purpose !== input.purpose) diffs.push('purpose');
  if (existing.network !== input.network) diffs.push('network');
  if (existing.address !== input.address) diffs.push('address');
  if (existing.requiredConfirmations !== input.requiredConfirmations) diffs.push('required_confirmations');
  return diffs;
}

export class PgWatchedAddressRepository implements WatchedAddressRepository {
  private readonly client: PgTransactionalClient;

  constructor(client: PgTransactionalClient) {
    this.client = client;
  }

  async register(input: RegisterWatchInput): Promise<{ watch: WatchedAddress; created: boolean }> {
    return this.client.withTransaction(async (tx) => {
      const existing = await this.findRow(tx, input.watchId);
      if (existing) {
        const watch = rowToWatch(existing);
        const diffs = diffWatchFields(watch, input);
        if (diffs.length > 0) {
          throw new WatchConflictError(input.watchId, diffs);
        }
        return { watch, created: false };
      }

      const inserted = await tx.query<WatchedAddressRow>(
        `INSERT INTO watched_addresses (
           watch_id, purpose, network, address, required_confirmations, status, metadata
         ) VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)
         RETURNING watch_id, purpose, network, address, required_confirmations, status,
                   metadata, created_at, updated_at`,
        [
          input.watchId,
          input.purpose,
          input.network,
          input.address,
          input.requiredConfirmations,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      return { watch: rowToWatch(inserted.rows[0]), created: true };
    });
  }

  async get(watchId: string): Promise<WatchedAddressWithHistory | null> {
    const watchResult = await this.client.query<WatchedAddressRow>(
      `SELECT watch_id, purpose, network, address, required_confirmations, status,
              metadata, created_at, updated_at
         FROM watched_addresses WHERE watch_id = $1`,
      [watchId],
    );
    if ((watchResult.rowCount ?? 0) === 0) return null;

    const [observations, spends] = await Promise.all([
      this.client.query<AddressObservationRow>(
        `SELECT outpoint, watch_id, block_hash, height, amount_grains, confirmations,
                match_status, observed_at
           FROM address_observations
           WHERE watch_id = $1
           ORDER BY height ASC, outpoint ASC`,
        [watchId],
      ),
      this.client.query<AddressSpendRow>(
        `SELECT s.spend_txid, s.spent_outpoint, s.block_hash, s.height, s.classification,
                s.classification_data, s.observed_at
           FROM address_spends s
           JOIN address_observations o ON o.outpoint = s.spent_outpoint
           WHERE o.watch_id = $1
           ORDER BY s.height ASC, s.spend_txid ASC`,
        [watchId],
      ),
    ]);

    return {
      ...rowToWatch(watchResult.rows[0]),
      observations: observations.rows.map(rowToObservation),
      spends: spends.rows.map(rowToSpend),
    };
  }

  async close(watchId: string): Promise<WatchedAddress> {
    const result = await this.client.query<WatchedAddressRow>(
      `UPDATE watched_addresses
          SET status = 'closed', updated_at = now()
        WHERE watch_id = $1
        RETURNING watch_id, purpose, network, address, required_confirmations, status,
                  metadata, created_at, updated_at`,
      [watchId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new WatchNotFoundError(watchId);
    }
    return rowToWatch(result.rows[0]);
  }

  async listActive(purposes: WatchPurpose[]): Promise<WatchedAddress[]> {
    if (purposes.length === 0) return [];
    const result = await this.client.query<WatchedAddressRow>(
      `SELECT watch_id, purpose, network, address, required_confirmations, status,
              metadata, created_at, updated_at
         FROM watched_addresses
        WHERE status = 'active' AND purpose = ANY($1::text[])
        ORDER BY created_at ASC`,
      [purposes],
    );
    return result.rows.map(rowToWatch);
  }

  private async findRow(tx: PgTxClient, watchId: string): Promise<WatchedAddressRow | null> {
    const result = await tx.query<WatchedAddressRow>(
      `SELECT watch_id, purpose, network, address, required_confirmations, status,
              metadata, created_at, updated_at
         FROM watched_addresses WHERE watch_id = $1 FOR UPDATE`,
      [watchId],
    );
    return (result.rowCount ?? 0) === 0 ? null : result.rows[0];
  }
}

export class MemoryWatchedAddressRepository implements WatchedAddressRepository {
  private readonly watches = new Map<string, WatchedAddress>();
  private readonly observations = new Map<string, AddressObservation[]>();
  private readonly spends = new Map<string, AddressSpend[]>();

  async register(input: RegisterWatchInput): Promise<{ watch: WatchedAddress; created: boolean }> {
    const existing = this.watches.get(input.watchId);
    if (existing) {
      const diffs = diffWatchFields(existing, input);
      if (diffs.length > 0) {
        throw new WatchConflictError(input.watchId, diffs);
      }
      return { watch: existing, created: false };
    }
    const now = new Date().toISOString();
    const watch: WatchedAddress = {
      watchId: input.watchId,
      purpose: input.purpose,
      network: input.network,
      address: input.address,
      requiredConfirmations: input.requiredConfirmations,
      status: 'active',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.watches.set(input.watchId, watch);
    return { watch, created: true };
  }

  async get(watchId: string): Promise<WatchedAddressWithHistory | null> {
    const watch = this.watches.get(watchId);
    if (!watch) return null;
    return {
      ...watch,
      observations: this.observations.get(watchId) ?? [],
      spends: this.spends.get(watchId) ?? [],
    };
  }

  async close(watchId: string): Promise<WatchedAddress> {
    const watch = this.watches.get(watchId);
    if (!watch) throw new WatchNotFoundError(watchId);
    const updated: WatchedAddress = { ...watch, status: 'closed', updatedAt: new Date().toISOString() };
    this.watches.set(watchId, updated);
    return updated;
  }

  async listActive(purposes: WatchPurpose[]): Promise<WatchedAddress[]> {
    if (purposes.length === 0) return [];
    const set = new Set(purposes);
    return Array.from(this.watches.values())
      .filter((w) => w.status === 'active' && set.has(w.purpose))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
