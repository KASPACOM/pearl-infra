import type { BridgeAddressSpend, BridgeExitRequest } from './types.js';

export interface ReserveSpendMatch {
  spendTxid: string;
  status: 'matched_exit_release' | 'unknown_spend' | 'amount_mismatch' | 'recipient_mismatch' | 'duplicate_release_txid';
  exitId?: string;
  blockers: string[];
}

export function matchReserveSpendToExit(input: {
  spend: BridgeAddressSpend;
  exits: readonly BridgeExitRequest[];
  usedReleaseTxids?: ReadonlySet<string>;
}): ReserveSpendMatch {
  if (input.spend.classification !== 'exit_release') return unknownSpend(input.spend, 'reserve_spend_not_exit_release');

  const amountGrains = readString(input.spend.classificationData, 'amount_grains');
  const pearlRecipient = readString(input.spend.classificationData, 'pearl_recipient');
  const spendTxid = normalizePearlTxid(input.spend.spendTxid);
  const candidates = input.exits.filter((exit) => exit.status === 'pending' || exit.status === 'processed' || exit.status === 'released');
  const exact = candidates.find((exit) => (
    exit.requestedAmountGrains === amountGrains &&
    (pearlRecipient === undefined || exit.pearlRecipient === pearlRecipient)
  ));
  if (exact) {
    const exactReleaseTxid = exact.pearlReleaseTxid ? normalizePearlTxid(exact.pearlReleaseTxid) : undefined;
    if (exact.status === 'processed' && exactReleaseTxid && exactReleaseTxid !== spendTxid) {
      return {
        spendTxid: input.spend.spendTxid,
        status: 'duplicate_release_txid',
        exitId: exact.exitId,
        blockers: ['processed_release_txid_mismatch'],
      };
    }
    if (exact.status === 'released') {
      if (exactReleaseTxid === spendTxid) {
        return {
          spendTxid: input.spend.spendTxid,
          status: 'matched_exit_release',
          exitId: exact.exitId,
          blockers: [],
        };
      }
      return {
        spendTxid: input.spend.spendTxid,
        status: 'duplicate_release_txid',
        exitId: exact.exitId,
        blockers: ['exit_already_released'],
      };
    }
    const usedReleaseTxids = input.usedReleaseTxids ?? new Set<string>();
    if (hasNormalizedTxid(usedReleaseTxids, spendTxid) && exactReleaseTxid !== spendTxid) {
      return {
        spendTxid: input.spend.spendTxid,
        status: 'duplicate_release_txid',
        blockers: ['release_txid_already_used'],
      };
    }
    return {
      spendTxid: input.spend.spendTxid,
      status: 'matched_exit_release',
      exitId: exact.exitId,
      blockers: [],
    };
  }
  if (amountGrains && candidates.some((exit) => exit.requestedAmountGrains === amountGrains)) {
    return {
      spendTxid: input.spend.spendTxid,
      status: 'recipient_mismatch',
      blockers: ['reserve_spend_recipient_mismatch'],
    };
  }
  if (pearlRecipient && candidates.some((exit) => exit.pearlRecipient === pearlRecipient)) {
    return {
      spendTxid: input.spend.spendTxid,
      status: 'amount_mismatch',
      blockers: ['reserve_spend_amount_mismatch'],
    };
  }
  return unknownSpend(input.spend, 'unknown_reserve_spend');
}

function hasNormalizedTxid(txids: ReadonlySet<string>, txid: string): boolean {
  for (const used of txids) {
    if (normalizePearlTxid(used) === txid) return true;
  }
  return false;
}

function unknownSpend(spend: BridgeAddressSpend, blocker: string): ReserveSpendMatch {
  return {
    spendTxid: spend.spendTxid,
    status: 'unknown_spend',
    blockers: [blocker],
  };
}

function readString(metadata: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizePearlTxid(txid: string): string {
  const normalized = txid.toLowerCase();
  if (/^0x[0-9a-f]{64}$/.test(normalized)) return normalized.slice(2);
  return normalized;
}
