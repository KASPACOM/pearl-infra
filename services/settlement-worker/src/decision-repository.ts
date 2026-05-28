import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SettlementDecisionRecord, SettlementDecisionRepository } from './types.js';

export class JsonFileSettlementDecisionRepository implements SettlementDecisionRepository {
  constructor(private readonly filePath: string) {}

  async saveDecision(decision: SettlementDecisionRecord): Promise<{
    decision: SettlementDecisionRecord;
    created: boolean;
  }> {
    const decisions = await this.readDecisions();
    const existing = decisions.find((candidate) => candidate.idempotencyKey === decision.idempotencyKey);
    if (existing) {
      return { decision: existing, created: false };
    }
    decisions.push(decision);
    await this.writeDecisions(decisions);
    return { decision, created: true };
  }

  async findDecisionByIdempotencyKey(idempotencyKey: string): Promise<SettlementDecisionRecord | undefined> {
    return (await this.readDecisions()).find((candidate) => candidate.idempotencyKey === idempotencyKey);
  }

  private async readDecisions(): Promise<SettlementDecisionRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('settlement decision store must contain a JSON array');
      }
      return parsed as SettlementDecisionRecord[];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  private async writeDecisions(decisions: SettlementDecisionRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(decisions, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
