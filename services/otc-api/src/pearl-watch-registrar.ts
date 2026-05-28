import type { OtcTrade } from '@kaspacom/pearl-sdk';

import type { PearlEscrowWatchRegistrar, PearlEscrowWatchRegistrationOptions } from './trade-service.js';

export interface PearlEscrowWatchRegistration {
  watchId: string;
  purpose: 'otc_escrow';
  network: OtcTrade['pearlEscrow']['network'];
  address: string;
  requiredConfirmations: number;
  metadata: Record<string, unknown>;
}

export class HttpPearlEscrowWatchRegistrar implements PearlEscrowWatchRegistrar {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 5_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async registerPearlEscrowWatch(
    trade: OtcTrade,
    options: PearlEscrowWatchRegistrationOptions = {},
  ): Promise<PearlEscrowWatchRegistration> {
    const registration = createPearlEscrowWatchRegistration(trade, options);
    const response = await fetch(`${this.baseUrl}/watches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toIndexerRequest(registration)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Pearl indexer watch registration failed: ${response.status} ${await response.text()}`);
    }
    return registration;
  }
}

export function createPearlEscrowWatchRegistration(
  trade: OtcTrade,
  options: PearlEscrowWatchRegistrationOptions = {},
): PearlEscrowWatchRegistration {
  const spendAmountBounds = createSpendAmountBounds(
    trade.pearlEscrow.expectedAmountGrains,
    options.classificationFeeToleranceGrains,
  );
  return {
    watchId: createPearlEscrowWatchId(trade.tradeId),
    purpose: 'otc_escrow',
    network: trade.pearlEscrow.network,
    address: trade.pearlEscrow.address,
    requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
    metadata: {
      trade_id: trade.tradeId,
      quote_id: trade.quoteId,
      side: trade.side,
      expected_amount_grains: trade.pearlEscrow.expectedAmountGrains,
      pearl_funding_deadline: trade.deadlines.pearlFundingDeadline,
      refund_available_at: trade.deadlines.refundAvailableAt,
      settlement_deadline: trade.deadlines.settlementDeadline,
      release_address: trade.buyerPearlAddress,
      refund_address: trade.sellerPearlRefundAddress,
      release_amount_min_grains: spendAmountBounds.minAmountGrains,
      release_amount_max_grains: spendAmountBounds.maxAmountGrains,
      refund_amount_min_grains: spendAmountBounds.minAmountGrains,
      refund_amount_max_grains: spendAmountBounds.maxAmountGrains,
      classification_fee_tolerance_grains: spendAmountBounds.feeToleranceGrains,
      buyer_pearl_address: trade.buyerPearlAddress,
      seller_pearl_refund_address: trade.sellerPearlRefundAddress,
      ...(trade.pearlEscrow.releaseTxid ? { release_txid: trade.pearlEscrow.releaseTxid } : {}),
      ...(trade.pearlEscrow.refundTxid ? { refund_txid: trade.pearlEscrow.refundTxid } : {}),
      ...(trade.pearlEscrow.escrowScriptType ? { escrow_script_type: trade.pearlEscrow.escrowScriptType } : {}),
      ...(trade.pearlEscrow.taprootOutputScriptHex
        ? { taproot_output_script_hex: trade.pearlEscrow.taprootOutputScriptHex }
        : {}),
      ...(trade.pearlEscrow.releaseTemplate ? { release_template: trade.pearlEscrow.releaseTemplate } : {}),
      ...(trade.pearlEscrow.refundTemplate ? { refund_template: trade.pearlEscrow.refundTemplate } : {}),
    },
  };
}

export function createPearlEscrowWatchId(tradeId: string): string {
  return `otc:${tradeId}:pearl-escrow`;
}

function createSpendAmountBounds(
  expectedAmountGrains: string,
  feeToleranceGrains = '0',
): { minAmountGrains: string; maxAmountGrains: string; feeToleranceGrains: string } {
  if (!isUnsignedIntegerString(expectedAmountGrains)) {
    throw new Error('Pearl escrow expectedAmountGrains must be an unsigned integer string');
  }
  if (!isUnsignedIntegerString(feeToleranceGrains)) {
    throw new Error('Pearl escrow classificationFeeToleranceGrains must be an unsigned integer string');
  }
  const expected = BigInt(expectedAmountGrains);
  const tolerance = BigInt(feeToleranceGrains);
  if (expected === 0n) {
    throw new Error('Pearl escrow expectedAmountGrains must be greater than zero');
  }
  if (tolerance >= expected) {
    throw new Error('Pearl escrow classificationFeeToleranceGrains must be smaller than expectedAmountGrains');
  }
  const min = expected - tolerance;
  return {
    minAmountGrains: min.toString(),
    maxAmountGrains: expected.toString(),
    feeToleranceGrains: tolerance.toString(),
  };
}

function isUnsignedIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

function toIndexerRequest(registration: PearlEscrowWatchRegistration): Record<string, unknown> {
  return {
    watch_id: registration.watchId,
    purpose: registration.purpose,
    network: registration.network,
    address: registration.address,
    required_confirmations: registration.requiredConfirmations,
    metadata: registration.metadata,
  };
}
