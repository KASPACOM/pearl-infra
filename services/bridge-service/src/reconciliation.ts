import type {
  BridgeAddressObservation,
  BridgeAddressSpend,
  BridgeExitRequest,
  WatchedBridgeAddressWithHistory,
} from './types.js';
import { matchReserveSpendToExit, type ReserveSpendMatch } from './reserve-spend-matcher.js';

export interface BridgeReconciliationInput {
  depositWatches: readonly WatchedBridgeAddressWithHistory[];
  reserveWatches: readonly WatchedBridgeAddressWithHistory[];
  exits: readonly BridgeExitRequest[];
  mintedSupplyGrains: string;
  staleAfterMs?: number;
  now?: Date;
}

export interface BridgeDepositReconciliationRow {
  depositId: string;
  address: string;
  status: 'pending' | 'confirmed' | 'consumed' | 'reorged' | 'unsafe';
  outpoint?: string;
  amountGrains?: string;
  confirmations: number;
  blockers: string[];
}

export interface BridgeReserveSpendRow {
  reserveId: string;
  spendTxid: string;
  spentOutpoint: string;
  classification: string;
  matchStatus: ReserveSpendMatch['status'];
  exitId?: string;
  amountGrains?: string;
  blockers: string[];
  unknown: boolean;
}

export interface BridgeReconciliationSnapshot {
  observedAt: string;
  mintedSupplyGrains: string;
  confirmedDepositGrains: string;
  pendingDepositGrains: string;
  confirmedReserveGrains: string;
  knownReserveSpendGrains: string;
  pendingExitGrains: string;
  reserveAvailableGrains: string;
  reserveSurplusGrains: string;
  reserveDeficitGrains: string;
  deposits: BridgeDepositReconciliationRow[];
  reserveSpends: BridgeReserveSpendRow[];
  pendingExits: BridgeExitRequest[];
  unknownReserveSpendCount: number;
  staleWatchIds: string[];
  blockers: string[];
}

export function createBridgeReconciliationSnapshot(input: BridgeReconciliationInput): BridgeReconciliationSnapshot {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 15 * 60 * 1000;
  const deposits = input.depositWatches.map(reconcileDepositWatch);
  const invalidReserveWatchIds = input.reserveWatches
    .filter((watch) => watch.purpose !== 'bridge_reserve')
    .map((watch) => watch.watchId)
    .sort();
  const validReserveWatches = input.reserveWatches.filter((watch) => watch.purpose === 'bridge_reserve');
  const usedReleaseTxids = new Set(
    input.exits
      .filter((exit) => exit.pearlReleaseTxid !== undefined)
      .map((exit) => exit.pearlReleaseTxid as string),
  );
  const reserveSpends = input.reserveWatches.flatMap((watch) => reconcileReserveSpends(watch, input.exits, usedReleaseTxids));
  const confirmedReserveGrains = sumObservations(validReserveWatches.flatMap((watch) => liveConfirmedObservations(watch.observations)));
  const knownReserveSpendGrains = sumStrings(
    reserveSpends
      .filter((spend) => !spend.unknown && spend.amountGrains !== undefined)
      .map((spend) => spend.amountGrains as string),
  );
  const pendingExits = input.exits.filter((exit) => exit.status === 'pending' || exit.status === 'processed');
  const pendingExitGrains = sumStrings(pendingExits.map((exit) => exit.requestedAmountGrains));
  const reserveAvailable = confirmedReserveGrains - knownReserveSpendGrains - pendingExitGrains;
  const mintedSupply = BigInt(input.mintedSupplyGrains);
  const surplus = reserveAvailable - mintedSupply;
  const staleWatchIds = [...input.depositWatches, ...input.reserveWatches]
    .filter((watch) => now.getTime() - new Date(watch.updatedAt).getTime() > staleAfterMs)
    .map((watch) => watch.watchId)
    .sort();
  const unknownReserveSpendCount = reserveSpends.filter((spend) => spend.unknown).length;
  const blockers = createBlockers({
    reserveDeficit: surplus < 0n,
    unknownReserveSpendCount,
    staleWatchIds,
    unsafeDepositCount: deposits.filter((deposit) => deposit.status === 'unsafe' || deposit.status === 'reorged').length,
    invalidReserveWatchCount: invalidReserveWatchIds.length,
  });

  return {
    observedAt: now.toISOString(),
    mintedSupplyGrains: input.mintedSupplyGrains,
    confirmedDepositGrains: sumStrings(
      deposits
        .filter((deposit) => deposit.status === 'confirmed' || deposit.status === 'consumed')
        .map((deposit) => deposit.amountGrains ?? '0'),
    ).toString(),
    pendingDepositGrains: sumStrings(deposits.filter((deposit) => deposit.status === 'pending').map((deposit) => deposit.amountGrains ?? '0')).toString(),
    confirmedReserveGrains: confirmedReserveGrains.toString(),
    knownReserveSpendGrains: knownReserveSpendGrains.toString(),
    pendingExitGrains: pendingExitGrains.toString(),
    reserveAvailableGrains: reserveAvailable.toString(),
    reserveSurplusGrains: (surplus > 0n ? surplus : 0n).toString(),
    reserveDeficitGrains: (surplus < 0n ? -surplus : 0n).toString(),
    deposits,
    reserveSpends,
    pendingExits,
    unknownReserveSpendCount,
    staleWatchIds,
    blockers,
  };
}

function reconcileDepositWatch(watch: WatchedBridgeAddressWithHistory): BridgeDepositReconciliationRow {
  if (watch.purpose !== 'bridge_deposit') {
    return {
      depositId: watch.watchId,
      address: watch.address,
      status: 'unsafe',
      confirmations: 0,
      blockers: ['unexpected_deposit_watch_purpose'],
    };
  }
  const live = watch.observations.filter((observation) => observation.matchStatus !== 'detached');
  const detached = watch.observations.filter((observation) => observation.matchStatus === 'detached');
  const best = [...live].sort((a, b) => b.confirmations - a.confirmations)[0];
  const blockers: string[] = [];
  if (detached.length > 0) blockers.push('deposit_reorged');
  if (live.length > 1) blockers.push('multiple_deposit_observations');
  if (!best) {
    return {
      depositId: watch.watchId,
      address: watch.address,
      status: detached.length > 0 ? 'reorged' : 'pending',
      confirmations: 0,
      blockers,
    };
  }
  const amountBlocker = validateDepositAmount(watch, best);
  if (amountBlocker) blockers.push(amountBlocker);
  if (live.some((observation) => observation.classification === 'late')) blockers.push('deposit_late');
  if (live.some((observation) => observation.classification === 'underpaid')) blockers.push('deposit_underpaid');
  if (live.some((observation) => observation.classification === 'duplicate')) blockers.push('duplicate_deposit');
  const consumed = watch.spends.some((spend) => spend.spentOutpoint === best.outpoint && spend.classification === 'claim');
  return {
    depositId: watch.watchId,
    address: watch.address,
    status: blockers.length > 0 ? 'unsafe' : consumed ? 'consumed' : best.matchStatus === 'confirmed' ? 'confirmed' : 'pending',
    outpoint: best.outpoint,
    amountGrains: best.amountGrains,
    confirmations: best.confirmations,
    blockers,
  };
}

function reconcileReserveSpends(
  watch: WatchedBridgeAddressWithHistory,
  exits: readonly BridgeExitRequest[],
  usedReleaseTxids: ReadonlySet<string>,
): BridgeReserveSpendRow[] {
  return watch.spends.map((spend) => {
    if (watch.purpose !== 'bridge_reserve') {
      return {
        reserveId: watch.watchId,
        spendTxid: spend.spendTxid,
        spentOutpoint: spend.spentOutpoint,
        classification: spend.classification,
        matchStatus: 'unknown_spend',
        blockers: ['unexpected_reserve_watch_purpose'],
        unknown: true,
      };
    }
    const amountGrains = readString(spend.classificationData, 'amount_grains');
    const match = matchReserveSpendToExit({ spend, exits, usedReleaseTxids });
    const knownExitRelease = match.status === 'matched_exit_release';
    return {
      reserveId: watch.watchId,
      spendTxid: spend.spendTxid,
      spentOutpoint: spend.spentOutpoint,
      classification: spend.classification,
      matchStatus: match.status,
      ...(match.exitId ? { exitId: match.exitId } : {}),
      ...(amountGrains ? { amountGrains } : {}),
      blockers: match.blockers,
      unknown: !knownExitRelease,
    };
  });
}

function validateDepositAmount(watch: WatchedBridgeAddressWithHistory, observation: BridgeAddressObservation): string | undefined {
  const min = readString(watch.metadata, 'expected_amount_min_grains');
  const max = readString(watch.metadata, 'expected_amount_max_grains');
  if (!min || !max) return 'deposit_missing_amount_bounds';
  const amount = BigInt(observation.amountGrains);
  if (amount < BigInt(min)) return 'deposit_below_min';
  if (amount > BigInt(max)) return 'deposit_above_max';
  return undefined;
}

function liveConfirmedObservations(observations: readonly BridgeAddressObservation[]): BridgeAddressObservation[] {
  return observations.filter((observation) => (
    observation.matchStatus === 'confirmed' ||
    observation.matchStatus === 'spent'
  ));
}

function sumObservations(observations: readonly BridgeAddressObservation[]): bigint {
  return sumStrings(observations.map((observation) => observation.amountGrains));
}

function sumStrings(values: readonly string[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value), 0n);
}

function readString(metadata: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function createBlockers(input: {
  reserveDeficit: boolean;
  unknownReserveSpendCount: number;
  staleWatchIds: readonly string[];
  unsafeDepositCount: number;
  invalidReserveWatchCount: number;
}): string[] {
  const blockers: string[] = [];
  if (input.reserveDeficit) blockers.push('reserve_deficit');
  if (input.unknownReserveSpendCount > 0) blockers.push('unknown_reserve_spend');
  if (input.staleWatchIds.length > 0) blockers.push('stale_pearl_watches');
  if (input.unsafeDepositCount > 0) blockers.push('unsafe_deposit_observation');
  if (input.invalidReserveWatchCount > 0) blockers.push('unexpected_reserve_watch_purpose');
  return blockers;
}
