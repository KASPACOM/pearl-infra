import type { BridgeExitRequestRepository } from './repository.js';
import { matchReserveSpendToExit, type ReserveSpendMatch } from './reserve-spend-matcher.js';
import type { BridgeAddressSpend, BridgeExitRequest } from './types.js';

export interface ApplyReserveSpendMatchResult {
  spendTxid: string;
  status: ReserveSpendMatch['status'];
  exitId?: string;
  blockers: string[];
  updatedExit?: BridgeExitRequest;
}

export async function applyReserveSpendMatchesToExits(input: {
  repository: BridgeExitRequestRepository;
  spends: readonly BridgeAddressSpend[];
  now?: Date;
}): Promise<ApplyReserveSpendMatchResult[]> {
  const now = input.now ?? new Date();
  const results: ApplyReserveSpendMatchResult[] = [];
  let exits = await input.repository.listExitRequests();

  for (const spend of input.spends) {
    const usedReleaseTxids = new Set(
      exits
        .filter((exit) => exit.pearlReleaseTxid !== undefined)
        .map((exit) => exit.pearlReleaseTxid as string),
    );
    const match = matchReserveSpendToExit({
      spend,
      exits,
      usedReleaseTxids,
    });

    if (match.status !== 'matched_exit_release' || !match.exitId) {
      results.push({
        spendTxid: spend.spendTxid,
        status: match.status,
        blockers: match.blockers,
      });
      continue;
    }

    const existing = await input.repository.findExitRequest(match.exitId);
    if (!existing) {
      results.push({
        spendTxid: spend.spendTxid,
        status: 'unknown_spend',
        blockers: ['matched_exit_missing'],
      });
      continue;
    }

    const updated: BridgeExitRequest = {
      ...existing,
      status: 'released',
      pearlReleaseTxid: spend.spendTxid,
      pearlReleaseBlock: spend.height,
      releasedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata: {
        ...(existing.metadata ?? {}),
        pearl_release_spent_outpoint: spend.spentOutpoint,
        pearl_release_classification: spend.classification,
        pearl_release_observed_at: spend.observedAt,
      },
    };
    const saved = await input.repository.upsertExitRequest(updated);
    exits = exits.map((exit) => (exit.exitId === saved.exit.exitId ? saved.exit : exit));
    results.push({
      spendTxid: spend.spendTxid,
      status: match.status,
      exitId: match.exitId,
      blockers: [],
      updatedExit: saved.exit,
    });
  }

  return results;
}
