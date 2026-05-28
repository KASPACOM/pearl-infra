import {
  combinePearlEscrowScriptPathPsbt,
  createPearlEscrowBroadcastAttempt,
  type PearlEscrowBroadcastAttempt,
  type PearlEscrowScriptPathSigner,
} from '@kaspacom/pearl-escrow';
import type { OtcTrade } from '@kaspacom/pearl-sdk';

import type { PearlEscrowBroadcastAttemptRepository } from './pearl-transaction-adapters.js';
import type {
  SettlementDecisionRecord,
  SettlementPreparedAction,
  SettlementSignerAdapter,
} from './types.js';

export interface PreauthorizedArbiterSignerAdapterOptions {
  arbiterSigner: PearlEscrowScriptPathSigner;
  broadcastAttempts: PearlEscrowBroadcastAttemptRepository;
  refreshTrade: (tradeId: string) => Promise<OtcTrade | undefined>;
  signerKeyId: string;
  now?: () => Date;
}

export class PreauthorizedArbiterSignerAdapter implements SettlementSignerAdapter {
  private readonly arbiterSigner: PearlEscrowScriptPathSigner;
  private readonly broadcastAttempts: PearlEscrowBroadcastAttemptRepository;
  private readonly refreshTrade: (tradeId: string) => Promise<OtcTrade | undefined>;
  private readonly signerKeyId: string;
  private readonly now: () => Date;

  constructor(options: PreauthorizedArbiterSignerAdapterOptions) {
    this.arbiterSigner = options.arbiterSigner;
    this.broadcastAttempts = options.broadcastAttempts;
    this.refreshTrade = options.refreshTrade;
    this.signerKeyId = options.signerKeyId;
    this.now = options.now ?? (() => new Date());
  }

  async preparePrlRelease(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    // Re-read the trade just before signing to catch a late revocation (L9 race).
    const current = await this.refreshTrade(trade.tradeId);
    if (!current) {
      // Trade vanished between decision and sign-time — fail closed without crashing the loop.
      return this.deferredAction(trade, decision, 'trade_not_found_at_sign_time');
    }
    if (current.pearlEscrowMode !== 'multisig') {
      // Worker is wired with the preauthorized adapter; a non-multisig trade shouldn't be
      // released through this path. Defer to operator rather than throwing so the loop
      // continues handling other trades.
      return this.deferredAction(current, decision, 'not_multisig_escrow');
    }
    if (current.pearlReleaseSigningMode !== 'preauthorize_release') {
      return this.deferredAction(current, decision, 'not_preauthorize_release_mode');
    }
    const presig = current.pearlEscrow.buyerReleasePresignature;
    if (!presig || presig.revokedAt) {
      return this.deferredAction(current, decision, 'buyer_presignature_missing_or_revoked');
    }

    const idempotencyKey = createPearlReleaseIdempotencyKey(current, decision);

    const existing = await this.broadcastAttempts.findLatestByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        actionId: `pearl_preauth_${existing.idempotencyKey}`,
        decisionId: decision.decisionId,
        tradeId: current.tradeId,
        action: decision.action,
        status: 'prepared',
        idempotencyKey: existing.idempotencyKey,
        createdAt: existing.createdAt,
        metadata: {
          adapter: 'preauthorized_arbiter',
          broadcastAttemptStatus: existing.status,
          broadcastAttemptCreated: false,
          signedTxid: existing.signedTxid ?? '',
        },
      };
    }

    const combined = combinePearlEscrowScriptPathPsbt({
      psbtBase64: presig.psbtBase64,
      network: current.pearlEscrow.network,
      signers: [this.arbiterSigner],
    });
    const attempt: PearlEscrowBroadcastAttempt = createPearlEscrowBroadcastAttempt(
      {
        tradeId: current.tradeId,
        action: 'release',
        idempotencyKey,
        signedTxHex: combined.signedTxHex,
        signedTxid: combined.signedTxid,
        signerKeyId: this.signerKeyId,
        signedAt: this.now().toISOString(),
      },
      1,
      this.now(),
    );
    const saved = await this.broadcastAttempts.saveBroadcastAttempt(attempt);
    return {
      actionId: `pearl_preauth_${saved.attempt.idempotencyKey}`,
      decisionId: decision.decisionId,
      tradeId: current.tradeId,
      action: decision.action,
      status: 'prepared',
      idempotencyKey: saved.attempt.idempotencyKey,
      createdAt: saved.attempt.createdAt,
      metadata: {
        adapter: 'preauthorized_arbiter',
        broadcastAttemptStatus: saved.attempt.status,
        broadcastAttemptCreated: saved.created,
        signedTxid: saved.attempt.signedTxid ?? '',
      },
    };
  }

  private deferredAction(trade: OtcTrade, decision: SettlementDecisionRecord, skipReason: string): SettlementPreparedAction {
    return {
      actionId: `pearl_preauth_deferred_${decision.decisionId}`,
      decisionId: decision.decisionId,
      tradeId: trade.tradeId,
      action: decision.action,
      status: 'prepared',
      idempotencyKey: `pearl:preauth:deferred:${trade.tradeId}:${decision.decisionId}`,
      createdAt: this.now().toISOString(),
      metadata: {
        adapter: 'preauthorized_arbiter',
        skipReason,
        deferredToOperator: true,
      },
    };
  }

  async preparePrlRefund(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    // Refund signing is never auto-performed by the worker. The seller_timeout_refund
    // leaf only carries the seller's pubkey, which the worker does not hold; the user
    // signs and submits the refund through the OTC API paste/broadcast flow.
    return {
      actionId: `pearl_preauth_refund_deferred_${decision.decisionId}`,
      decisionId: decision.decisionId,
      tradeId: trade.tradeId,
      action: decision.action,
      status: 'prepared',
      idempotencyKey: `pearl:preauth:refund:${trade.tradeId}:${decision.decisionId}`,
      createdAt: this.now().toISOString(),
      metadata: {
        adapter: 'preauthorized_arbiter',
        deferredToUserPasteFlow: true,
      },
    };
  }
}

function createPearlReleaseIdempotencyKey(trade: OtcTrade, decision: SettlementDecisionRecord): string {
  return `pearl:preauth:release:${trade.tradeId}:${decision.decisionId}`;
}
