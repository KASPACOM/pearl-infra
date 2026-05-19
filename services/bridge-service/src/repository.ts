import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  BridgeAdminDecision,
  BridgeExitRequest,
  BridgeReconciliationSnapshotRecord,
  IgraBridgeEvent,
} from './types.js';

export interface BridgeExitRequestRepository {
  upsertExitRequest(exit: BridgeExitRequest): Promise<{ exit: BridgeExitRequest; created: boolean }>;
  findExitRequest(exitId: string): Promise<BridgeExitRequest | undefined>;
  listExitRequests(): Promise<BridgeExitRequest[]>;
}

export interface BridgeStateRepository extends BridgeExitRequestRepository {
  saveReconciliationSnapshot(record: BridgeReconciliationSnapshotRecord): Promise<{ record: BridgeReconciliationSnapshotRecord; created: boolean }>;
  latestReconciliationSnapshot(): Promise<BridgeReconciliationSnapshotRecord | undefined>;
  listReconciliationSnapshots(limit?: number): Promise<BridgeReconciliationSnapshotRecord[]>;
  saveIgraEvent(event: IgraBridgeEvent): Promise<{ event: IgraBridgeEvent; created: boolean }>;
  listIgraEvents(): Promise<IgraBridgeEvent[]>;
  saveAdminDecision(decision: BridgeAdminDecision): Promise<{ decision: BridgeAdminDecision; created: boolean }>;
  listAdminDecisions(targetId?: string): Promise<BridgeAdminDecision[]>;
}

export class InMemoryBridgeStateRepository implements BridgeStateRepository {
  private readonly snapshots = new Map<string, BridgeReconciliationSnapshotRecord>();
  private readonly events = new Map<string, IgraBridgeEvent>();
  private readonly exits = new Map<string, BridgeExitRequest>();
  private readonly decisions = new Map<string, BridgeAdminDecision>();

  async saveReconciliationSnapshot(record: BridgeReconciliationSnapshotRecord): Promise<{ record: BridgeReconciliationSnapshotRecord; created: boolean }> {
    const existing = this.snapshots.get(record.snapshotId);
    if (existing) return { record: existing, created: false };
    this.snapshots.set(record.snapshotId, record);
    return { record, created: true };
  }

  async latestReconciliationSnapshot(): Promise<BridgeReconciliationSnapshotRecord | undefined> {
    return (await this.listReconciliationSnapshots(1))[0];
  }

  async listReconciliationSnapshots(limit = 25): Promise<BridgeReconciliationSnapshotRecord[]> {
    return [...this.snapshots.values()]
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
      .slice(0, limit);
  }

  async saveIgraEvent(event: IgraBridgeEvent): Promise<{ event: IgraBridgeEvent; created: boolean }> {
    const existing = this.events.get(event.eventId);
    if (existing) return { event: existing, created: false };
    this.events.set(event.eventId, event);
    return { event, created: true };
  }

  async listIgraEvents(): Promise<IgraBridgeEvent[]> {
    return [...this.events.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  async upsertExitRequest(exit: BridgeExitRequest): Promise<{ exit: BridgeExitRequest; created: boolean }> {
    const existing = this.exits.get(exit.exitId);
    if (existing) {
      const merged = mergeExit(existing, exit);
      this.exits.set(exit.exitId, merged);
      return { exit: merged, created: false };
    }
    this.exits.set(exit.exitId, exit);
    return { exit, created: true };
  }

  async findExitRequest(exitId: string): Promise<BridgeExitRequest | undefined> {
    return this.exits.get(exitId);
  }

  async listExitRequests(): Promise<BridgeExitRequest[]> {
    return [...this.exits.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveAdminDecision(decision: BridgeAdminDecision): Promise<{ decision: BridgeAdminDecision; created: boolean }> {
    const existing = this.decisions.get(decision.idempotencyKey);
    if (existing) return { decision: existing, created: false };
    this.decisions.set(decision.idempotencyKey, decision);
    return { decision, created: true };
  }

  async listAdminDecisions(targetId?: string): Promise<BridgeAdminDecision[]> {
    return [...this.decisions.values()]
      .filter((decision) => targetId === undefined || decision.targetId === targetId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

interface BridgeStateFile {
  snapshots: BridgeReconciliationSnapshotRecord[];
  events: IgraBridgeEvent[];
  exits: BridgeExitRequest[];
  decisions: BridgeAdminDecision[];
}

export class JsonFileBridgeStateRepository implements BridgeStateRepository {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async saveReconciliationSnapshot(record: BridgeReconciliationSnapshotRecord): Promise<{ record: BridgeReconciliationSnapshotRecord; created: boolean }> {
    const state = await this.readState();
    const existing = state.snapshots.find((candidate) => candidate.snapshotId === record.snapshotId);
    if (existing) return { record: existing, created: false };
    state.snapshots.push(record);
    await this.writeState(state);
    return { record, created: true };
  }

  async latestReconciliationSnapshot(): Promise<BridgeReconciliationSnapshotRecord | undefined> {
    return (await this.listReconciliationSnapshots(1))[0];
  }

  async listReconciliationSnapshots(limit = 25): Promise<BridgeReconciliationSnapshotRecord[]> {
    const state = await this.readState();
    return state.snapshots
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
      .slice(0, limit);
  }

  async saveIgraEvent(event: IgraBridgeEvent): Promise<{ event: IgraBridgeEvent; created: boolean }> {
    const state = await this.readState();
    const existing = state.events.find((candidate) => candidate.eventId === event.eventId);
    if (existing) return { event: existing, created: false };
    state.events.push(event);
    await this.writeState(state);
    return { event, created: true };
  }

  async listIgraEvents(): Promise<IgraBridgeEvent[]> {
    const state = await this.readState();
    return state.events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  async upsertExitRequest(exit: BridgeExitRequest): Promise<{ exit: BridgeExitRequest; created: boolean }> {
    const state = await this.readState();
    const index = state.exits.findIndex((candidate) => candidate.exitId === exit.exitId);
    if (index >= 0) {
      const merged = mergeExit(state.exits[index], exit);
      state.exits[index] = merged;
      await this.writeState(state);
      return { exit: merged, created: false };
    }
    state.exits.push(exit);
    await this.writeState(state);
    return { exit, created: true };
  }

  async findExitRequest(exitId: string): Promise<BridgeExitRequest | undefined> {
    return (await this.readState()).exits.find((exit) => exit.exitId === exitId);
  }

  async listExitRequests(): Promise<BridgeExitRequest[]> {
    return (await this.readState()).exits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveAdminDecision(decision: BridgeAdminDecision): Promise<{ decision: BridgeAdminDecision; created: boolean }> {
    const state = await this.readState();
    const existing = state.decisions.find((candidate) => candidate.idempotencyKey === decision.idempotencyKey);
    if (existing) return { decision: existing, created: false };
    state.decisions.push(decision);
    await this.writeState(state);
    return { decision, created: true };
  }

  async listAdminDecisions(targetId?: string): Promise<BridgeAdminDecision[]> {
    const state = await this.readState();
    return state.decisions
      .filter((decision) => targetId === undefined || decision.targetId === targetId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async readState(): Promise<BridgeStateFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<BridgeStateFile>;
      return {
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        exits: Array.isArray(parsed.exits) ? parsed.exits : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      };
    } catch (error) {
      if (isNotFound(error)) return emptyState();
      throw error;
    }
  }

  private async writeState(state: BridgeStateFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}

function emptyState(): BridgeStateFile {
  return {
    snapshots: [],
    events: [],
    exits: [],
    decisions: [],
  };
}

function mergeExit(existing: BridgeExitRequest, next: BridgeExitRequest): BridgeExitRequest {
  const keepTerminal = existing.status === 'released' || existing.status === 'refunded' || existing.status === 'cancelled';
  const keepProcessed = existing.status === 'processed' && next.status === 'pending';
  return {
    ...existing,
    ...next,
    status: keepTerminal || keepProcessed ? existing.status : next.status,
    pearlReleaseTxid: existing.pearlReleaseTxid ?? next.pearlReleaseTxid,
    pearlReleaseBlock: existing.pearlReleaseBlock ?? next.pearlReleaseBlock,
    releasedAt: existing.releasedAt ?? next.releasedAt,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(next.metadata ?? {}),
    },
    createdAt: existing.createdAt,
    updatedAt: next.updatedAt,
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
