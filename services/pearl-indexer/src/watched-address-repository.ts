import type { PgTransactionalClient, PgTxClient } from './postgres-sink.js';
import type {
  AddressObservation,
  AddressSpend,
  ObservedOutpoint,
  RegisterWatchInput,
  WatchPurpose,
  WatchedAddress,
  WatchedAddressWithHistory,
} from './watched-address-types.js';

export class WatchConflictError extends Error {
  readonly code = 'watch_conflict' as const;
  readonly differingFields: readonly string[];
  constructor(watchId: string, differingFields: readonly string[]) {
    super(`watch ${watchId} already exists with differing fields: ${differingFields.join(', ')}`);
    this.differingFields = differingFields;
  }
}

export class WatchNotFoundError extends Error {
  readonly code = 'watch_not_found' as const;
  constructor(watchId: string) {
    super(`no watch for watch_id ${watchId}`);
  }
}

export interface RecordObservationInput {
  outpoint: string;
  watchId: string;
  blockHash: string;
  height: number;
  amountGrains: string;
  classification: string;
}

export interface RecordSpendInput {
  spendTxid: string;
  spentOutpoint: string;
  blockHash: string;
  height: number;
  classification: string;
  classificationData?: Record<string, unknown>;
}

export interface WatchedAddressRepository {
  register(input: RegisterWatchInput): Promise<{ watch: WatchedAddress; created: boolean }>;
  get(watchId: string): Promise<WatchedAddressWithHistory | null>;
  close(watchId: string): Promise<WatchedAddress>;
  listActive(purposes: WatchPurpose[]): Promise<WatchedAddress[]>;
  findActiveByAddress(network: string, address: string): Promise<WatchedAddress[]>;
  recordObservation(input: RecordObservationInput): Promise<AddressObservation>;
  findObservedOutpoint(spentOutpoint: string): Promise<ObservedOutpoint | null>;
  recordSpend(input: RecordSpendInput): Promise<AddressSpend>;
  advanceConfirmations(tipHeight: number): Promise<number>;
  detachObservationsForBlock(blockHash: string): Promise<number>;
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
  classification: string | null;
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
    classification: row.classification ?? 'unknown_funding',
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
        const updated = await tx.query<WatchedAddressRow>(
          `UPDATE watched_addresses
              SET metadata = $2::jsonb || metadata,
                  updated_at = CASE
                    WHEN metadata = $2::jsonb || metadata THEN updated_at
                    ELSE now()
                  END
            WHERE watch_id = $1
            RETURNING watch_id, purpose, network, address, required_confirmations, status,
                      metadata, created_at, updated_at`,
          [input.watchId, JSON.stringify(input.metadata ?? {})],
        );
        return { watch: rowToWatch(updated.rows[0]), created: false };
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
        `SELECT outpoint, watch_id, block_hash, height, amount_grains,
                confirmations, match_status, classification, observed_at
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

  async findActiveByAddress(network: string, address: string): Promise<WatchedAddress[]> {
    const result = await this.client.query<WatchedAddressRow>(
      `SELECT watch_id, purpose, network, address, required_confirmations, status,
              metadata, created_at, updated_at
         FROM watched_addresses
        WHERE status = 'active' AND network = $1 AND address = $2`,
      [network, address],
    );
    return result.rows.map(rowToWatch);
  }

  async recordObservation(input: RecordObservationInput): Promise<AddressObservation> {
    const result = await this.client.query<AddressObservationRow>(
      `INSERT INTO address_observations (
         outpoint, watch_id, block_hash, height, amount_grains,
         confirmations, match_status, classification
       ) VALUES ($1, $2, $3, $4, $5, 1, 'pending', $6)
       ON CONFLICT (outpoint) DO UPDATE
         SET watch_id = EXCLUDED.watch_id,
             block_hash = EXCLUDED.block_hash,
             height = EXCLUDED.height,
             amount_grains = EXCLUDED.amount_grains,
             confirmations = 1,
             match_status = 'pending',
             classification = EXCLUDED.classification,
             observed_at = now()
         WHERE address_observations.match_status = 'detached'
       RETURNING outpoint, watch_id, block_hash, height, amount_grains,
                 confirmations, match_status, classification, observed_at`,
      [
        input.outpoint,
        input.watchId,
        input.blockHash,
        input.height,
        input.amountGrains,
        input.classification,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.client.query<AddressObservationRow>(
        `SELECT outpoint, watch_id, block_hash, height, amount_grains,
                confirmations, match_status, classification, observed_at
           FROM address_observations WHERE outpoint = $1`,
        [input.outpoint],
      );
      return rowToObservation(existing.rows[0]);
    }
    return rowToObservation(result.rows[0]);
  }

  async findObservedOutpoint(spentOutpoint: string): Promise<ObservedOutpoint | null> {
    const result = await this.client.query<WatchedAddressRow & AddressObservationRow>(
      `SELECT w.watch_id, w.purpose, w.network, w.address, w.required_confirmations,
              w.status, w.metadata, w.created_at, w.updated_at,
              o.outpoint, o.block_hash, o.height, o.amount_grains,
              o.confirmations, o.match_status, o.classification, o.observed_at
         FROM address_observations o
         JOIN watched_addresses w ON w.watch_id = o.watch_id
        WHERE o.outpoint = $1
          AND o.match_status <> 'detached'
        ORDER BY o.height ASC
        LIMIT 1`,
      [spentOutpoint],
    );
    if ((result.rowCount ?? 0) === 0) return null;
    const row = result.rows[0];
    return {
      watch: rowToWatch(row),
      observation: rowToObservation(row),
    };
  }

  async recordSpend(input: RecordSpendInput): Promise<AddressSpend> {
    return this.client.withTransaction(async (tx) => {
      const result = await tx.query<AddressSpendRow>(
        `INSERT INTO address_spends (
           spend_txid, spent_outpoint, block_hash, height, classification, classification_data
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (spend_txid, spent_outpoint) DO UPDATE
           SET classification = address_spends.classification
         RETURNING spend_txid, spent_outpoint, block_hash, height, classification,
                   classification_data, observed_at`,
        [
          input.spendTxid,
          input.spentOutpoint,
          input.blockHash,
          input.height,
          input.classification,
          JSON.stringify(input.classificationData ?? {}),
        ],
      );
      await tx.query(
        `UPDATE address_observations
            SET match_status = 'spent'
          WHERE outpoint = $1
            AND match_status <> 'detached'`,
        [input.spentOutpoint],
      );
      return rowToSpend(result.rows[0]);
    });
  }

  async advanceConfirmations(tipHeight: number): Promise<number> {
    const result = await this.client.query(
      `UPDATE address_observations o
          SET confirmations = $1 - o.height + 1,
              match_status = CASE
                WHEN ($1 - o.height + 1) >= w.required_confirmations THEN 'confirmed'
                ELSE 'pending'
              END
         FROM watched_addresses w
        WHERE o.watch_id = w.watch_id
          AND o.match_status IN ('pending', 'confirmed')
          AND (
            o.confirmations <> ($1 - o.height + 1)
            OR o.match_status <> CASE
              WHEN ($1 - o.height + 1) >= w.required_confirmations THEN 'confirmed'
              ELSE 'pending'
            END
          )`,
      [tipHeight],
    );
    return result.rowCount ?? 0;
  }

  async detachObservationsForBlock(blockHash: string): Promise<number> {
    const result = await this.client.query(
      `UPDATE address_observations
          SET match_status = 'detached',
              classification = 'reorged'
        WHERE block_hash = $1 AND match_status <> 'detached'`,
      [blockHash],
    );
    return result.rowCount ?? 0;
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
      const mergedMetadata = { ...(input.metadata ?? {}), ...existing.metadata };
      const updated: WatchedAddress = {
        ...existing,
        metadata: mergedMetadata,
        updatedAt: shallowRecordEqual(existing.metadata, mergedMetadata) ? existing.updatedAt : new Date().toISOString(),
      };
      this.watches.set(input.watchId, updated);
      return { watch: updated, created: false };
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

  async findActiveByAddress(network: string, address: string): Promise<WatchedAddress[]> {
    return Array.from(this.watches.values()).filter(
      (w) => w.status === 'active' && w.network === network && w.address === address,
    );
  }

  async recordObservation(input: RecordObservationInput): Promise<AddressObservation> {
    const list = this.observations.get(input.watchId) ?? [];
    const existing = list.find((o) => o.outpoint === input.outpoint);
    if (existing && existing.matchStatus !== 'detached') return existing;
    const obs: AddressObservation = {
      outpoint: input.outpoint,
      watchId: input.watchId,
      blockHash: input.blockHash,
      height: input.height,
      amountGrains: input.amountGrains,
      confirmations: 1,
      matchStatus: 'pending',
      classification: input.classification,
      observedAt: new Date().toISOString(),
    };
    if (existing?.matchStatus === 'detached') {
      const updated = list.map((o) => (o.outpoint === input.outpoint ? obs : o));
      this.observations.set(input.watchId, updated);
      return obs;
    }
    list.push(obs);
    this.observations.set(input.watchId, list);
    return obs;
  }

  async findObservedOutpoint(spentOutpoint: string): Promise<ObservedOutpoint | null> {
    for (const [watchId, list] of this.observations.entries()) {
      const observation = list.find((o) => o.outpoint === spentOutpoint && o.matchStatus !== 'detached');
      if (!observation) continue;
      const watch = this.watches.get(watchId);
      if (!watch) continue;
      return { watch, observation };
    }
    return null;
  }

  async recordSpend(input: RecordSpendInput): Promise<AddressSpend> {
    const observed = await this.findObservedOutpoint(input.spentOutpoint);
    if (!observed) {
      throw new Error(`cannot record spend for unknown outpoint ${input.spentOutpoint}`);
    }
    const list = this.spends.get(observed.watch.watchId) ?? [];
    const existing = list.find((s) => s.spendTxid === input.spendTxid && s.spentOutpoint === input.spentOutpoint);
    if (existing) return existing;
    const spend: AddressSpend = {
      spendTxid: input.spendTxid,
      spentOutpoint: input.spentOutpoint,
      blockHash: input.blockHash,
      height: input.height,
      classification: input.classification,
      classificationData: input.classificationData ?? {},
      observedAt: new Date().toISOString(),
    };
    list.push(spend);
    this.spends.set(observed.watch.watchId, list);

    const observations = this.observations.get(observed.watch.watchId) ?? [];
    this.observations.set(
      observed.watch.watchId,
      observations.map((o) => (o.outpoint === input.spentOutpoint ? { ...o, matchStatus: 'spent' as const } : o)),
    );
    return spend;
  }

  async advanceConfirmations(tipHeight: number): Promise<number> {
    let advanced = 0;
    for (const watch of this.watches.values()) {
      const list = this.observations.get(watch.watchId) ?? [];
      for (let i = 0; i < list.length; i += 1) {
        const o = list[i];
        if (o.matchStatus !== 'pending' && o.matchStatus !== 'confirmed') continue;
        const newConfirms = tipHeight - o.height + 1;
        const newStatus = newConfirms >= watch.requiredConfirmations ? 'confirmed' : 'pending';
        if (newConfirms === o.confirmations && o.matchStatus === newStatus) continue;
        list[i] = {
          ...o,
          confirmations: newConfirms,
          matchStatus: newStatus,
        };
        advanced += 1;
      }
    }
    return advanced;
  }

  async detachObservationsForBlock(blockHash: string): Promise<number> {
    let detached = 0;
    for (const [watchId, list] of this.observations.entries()) {
      let changed = false;
      const updated = list.map((o) => {
        if (o.blockHash === blockHash && o.matchStatus !== 'detached') {
          changed = true;
          detached += 1;
          return { ...o, matchStatus: 'detached' as const, classification: 'reorged' };
        }
        return o;
      });
      if (changed) this.observations.set(watchId, updated);
    }
    return detached;
  }
}

function shallowRecordEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}
