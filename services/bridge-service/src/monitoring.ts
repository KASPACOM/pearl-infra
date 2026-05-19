import type { BridgeAttestationQuorum } from './attestations.js';
import type { BridgeReconciliationSnapshot } from './reconciliation.js';
import type { BridgePilotAlert } from './types.js';

export interface BridgeMonitoringInput {
  reconciliation: BridgeReconciliationSnapshot;
  attestationQuorums?: readonly BridgeAttestationQuorum[];
  pilotSupplyCapGrains: string;
  capWarningBps?: number;
}

export function evaluateBridgePilotAlerts(input: BridgeMonitoringInput): BridgePilotAlert[] {
  const alerts: BridgePilotAlert[] = [];
  for (const blocker of input.reconciliation.blockers) {
    alerts.push({
      alertId: `bridge:${blocker}`,
      severity: blocker === 'reserve_deficit' || blocker === 'unknown_reserve_spend' ? 'critical' : 'warning',
      code: blocker,
      message: messageForBlocker(blocker),
      sourceIds: [...input.reconciliation.staleWatchIds],
    });
  }
  const capWarningBps = input.capWarningBps ?? 8_000;
  const capUsedBps = bps(input.reconciliation.mintedSupplyGrains, input.pilotSupplyCapGrains);
  if (capUsedBps >= capWarningBps) {
    alerts.push({
      alertId: 'bridge:cap_near_limit',
      severity: capUsedBps >= 9_500 ? 'critical' : 'warning',
      code: 'cap_near_limit',
      message: `minted supply is ${capUsedBps} bps of pilot cap`,
      sourceIds: [],
      metadata: {
        capUsedBps,
        mintedSupplyGrains: input.reconciliation.mintedSupplyGrains,
        pilotSupplyCapGrains: input.pilotSupplyCapGrains,
      },
    });
  }
  for (const quorum of input.attestationQuorums ?? []) {
    if (quorum.status === 'manual_review') {
      alerts.push({
        alertId: `bridge:quorum:${quorum.eventId}`,
        severity: 'critical',
        code: 'quorum_failure',
        message: `relayer quorum failed: ${quorum.blockers.join(', ')}`,
        sourceIds: [quorum.eventId],
        metadata: {
          eventHash: quorum.eventHash,
          validAttestationCount: quorum.validAttestationCount,
          requiredAttestations: quorum.requiredAttestations,
        },
      });
    }
  }
  return dedupeAlerts(alerts);
}

function bps(numerator: string, denominator: string): number {
  const denom = BigInt(denominator);
  if (denom === 0n) return 0;
  return Number((BigInt(numerator) * 10_000n) / denom);
}

function messageForBlocker(blocker: string): string {
  switch (blocker) {
    case 'reserve_deficit':
      return 'confirmed Pearl reserves no longer cover minted supply and pending exits';
    case 'unknown_reserve_spend':
      return 'a Pearl reserve spend could not be classified';
    case 'stale_pearl_watches':
      return 'one or more Pearl watch records are stale';
    case 'unsafe_deposit_observation':
      return 'one or more deposit observations require manual review';
    default:
      return `bridge reconciliation blocker: ${blocker}`;
  }
}

function dedupeAlerts(alerts: BridgePilotAlert[]): BridgePilotAlert[] {
  return [...new Map(alerts.map((alert) => [alert.alertId, alert])).values()];
}
