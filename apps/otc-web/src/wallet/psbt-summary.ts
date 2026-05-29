import type { PearlPrefundSpendContract } from '@kaspacom/pearl-wallet';

export interface PsbtSummaryLine {
  label: string;
  value: string;
}

export interface PsbtSummary {
  kind: 'sweep' | 'refund' | 'unknown';
  lines: PsbtSummaryLine[];
  feeGrains: number;
}

/**
 * Builds a human-readable summary of a prefund spend that the W5 sign UI
 * shows to the maker before they sign. The maker sees exactly:
 *   - input outpoint + amount
 *   - each output (address + amount) IN ORDER
 *   - implied fee
 * The displayed values come from the contract the server prepared, NOT from
 * the PSBT bytes — this matches the validation: the wallet rejects signing
 * if the PSBT disagrees with the contract, so what the user sees IS what
 * will be signed.
 *
 * Classification (sweep vs refund) is based on the contract shape:
 *   - 1 output → refund (CLTV-gated maker recovery)
 *   - 2 outputs → sweep (trade escrow output + change back to prefund)
 *   - anything else → 'unknown', UI should surface this as suspicious.
 */
export function buildPsbtSummary(contract: PearlPrefundSpendContract): PsbtSummary {
  const lines: PsbtSummaryLine[] = [];
  lines.push({ label: 'Spending', value: formatGrains(contract.expectedInputAmountGrains) });
  lines.push({ label: 'From outpoint', value: truncateOutpoint(contract.expectedInputOutpoint) });
  for (let i = 0; i < contract.expectedOutputs.length; i += 1) {
    const o = contract.expectedOutputs[i]!;
    lines.push({
      label: `Output ${i + 1}: pays`,
      value: `${formatGrains(o.amountGrains)} → ${truncateAddress(o.address)}`,
    });
  }
  const outputSum = contract.expectedOutputs.reduce((s, o) => s + o.amountGrains, 0);
  const feeGrains = contract.expectedInputAmountGrains - outputSum;
  lines.push({ label: 'Network fee', value: formatGrains(feeGrains) });
  return {
    kind: classify(contract),
    lines,
    feeGrains,
  };
}

function classify(contract: PearlPrefundSpendContract): PsbtSummary['kind'] {
  if (contract.expectedOutputs.length === 1) return 'refund';
  if (contract.expectedOutputs.length === 2) return 'sweep';
  return 'unknown';
}

/**
 * Format Pearl grains (1 PRL = 10^8 grains) as a fixed-precision PRL string.
 * Strips trailing zeros for readability ("1.5 PRL" instead of "1.50000000 PRL")
 * but keeps at least one decimal so the unit is obvious.
 */
export function formatGrains(grains: number): string {
  if (grains < 0) return `-${formatGrains(-grains)}`;
  const whole = Math.floor(grains / 100_000_000);
  const fractional = grains - whole * 100_000_000;
  if (fractional === 0) return `${whole}.0 PRL`;
  const fracStr = fractional.toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole}.${fracStr} PRL`;
}

function truncateAddress(address: string): string {
  if (address.length <= 24) return address;
  return `${address.slice(0, 14)}…${address.slice(-8)}`;
}

function truncateOutpoint(outpoint: string): string {
  const [txid, vout] = outpoint.split(':');
  if (!txid || !vout) return outpoint;
  if (txid.length <= 16) return outpoint;
  return `${txid.slice(0, 10)}…${txid.slice(-6)}:${vout}`;
}
