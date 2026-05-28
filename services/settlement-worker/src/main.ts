import pg from 'pg';

import {
  EthersUsdcEscrowReader,
  HttpPearlProofReader,
  PgOtcRepository,
  pgPoolAdapter,
  type OtcRepository,
} from '@kaspacom/otc-api';
import type { PearlEscrowBroadcastAttempt } from '@kaspacom/pearl-escrow';
import { createScriptPathSigner } from '@kaspacom/pearl-escrow';
import { PearlRpcClient, PearlRpcTransactionBroadcaster } from '@kaspacom/pearl-rpc';

import { readSettlementWorkerRuntimeConfig } from './config.js';
import { InMemorySettlementDecisionRepository } from './decision-engine.js';
import {
  JsonFilePearlEscrowBroadcastAttemptRepository,
  submitPearlEscrowBroadcastAttempt,
} from './pearl-transaction-adapters.js';
import { PreauthorizedArbiterSignerAdapter } from './preauthorized-arbiter-signer-adapter.js';
import {
  EthersBackedSettlementBaseEscrowSource,
  IndexerBackedSettlementPearlProofSource,
  PgOtcRepositorySettlementTradeSource,
} from './repository-adapters.js';
import { runSettlementWorkerIteration } from './settlement-loop.js';

const runtime = readSettlementWorkerRuntimeConfig();

const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
const repository: OtcRepository = new PgOtcRepository(pgPoolAdapter(pool));
const trades = new PgOtcRepositorySettlementTradeSource(repository);

const pearlProofReader = new HttpPearlProofReader(runtime.pearlIndexerWatchUrl, runtime.pearlIndexerWatchTimeoutMs);
const pearl = new IndexerBackedSettlementPearlProofSource(pearlProofReader);

const baseReader = new EthersUsdcEscrowReader(runtime.baseRpcUrl, runtime.baseEscrowContract);
const base = new EthersBackedSettlementBaseEscrowSource(baseReader);

const arbiterPrivkey = parsePrivateKey(runtime.arbiterPrivkeyHex);
const arbiterSigner = createScriptPathSigner(arbiterPrivkey);
const broadcastAttempts = new JsonFilePearlEscrowBroadcastAttemptRepository(runtime.broadcastAttemptsPath);

const signer = new PreauthorizedArbiterSignerAdapter({
  arbiterSigner,
  broadcastAttempts,
  refreshTrade: (tradeId) => trades.findTradeById(tradeId),
  signerKeyId: runtime.arbiterSignerKeyId,
});

const broadcaster = new PearlRpcTransactionBroadcaster(
  new PearlRpcClient({
    url: runtime.pearlRpcUrl,
    user: runtime.pearlRpcUser,
    pass: runtime.pearlRpcPass,
  }),
);

const decisions = new InMemorySettlementDecisionRepository();

async function loop(): Promise<void> {
  try {
    const iteration = await runSettlementWorkerIteration({
      trades,
      pearl,
      base,
      decisions,
      signer,
      broadcaster: {
        async prepareUsdcRelease(trade, decision) {
          // USDC release is the on-chain Base call, executed by an EVM broadcaster that
          // doesn't ship in this dev iteration — we surface the decision but defer the
          // actual Base release to a follow-up worker (or manual operator action).
          return {
            actionId: `usdc_release_deferred_${decision.decisionId}`,
            decisionId: decision.decisionId,
            tradeId: trade.tradeId,
            action: decision.action,
            status: 'prepared',
            idempotencyKey: `usdc:release:${trade.tradeId}:${decision.decisionId}`,
            createdAt: new Date().toISOString(),
            metadata: { adapter: 'deferred_usdc_release', liveBroadcast: false },
          };
        },
      },
    });
    console.log(JSON.stringify({
      msg: 'settlement worker iteration complete',
      scanned: iteration.scannedTrades,
      createdDecisions: iteration.createdDecisionIds.length,
      preparedActions: iteration.preparedActions.length,
    }));

    // Broadcast loop: send any signed-but-not-submitted Pearl release txs.
    const pending = (await broadcastAttempts.listBroadcastAttempts()).filter(isReadyToBroadcast);
    for (const attempt of pending) {
      try {
        const result = await submitPearlEscrowBroadcastAttempt({
          repository: broadcastAttempts,
          broadcaster,
          attempt,
        });
        console.log(JSON.stringify({
          msg: 'pearl release broadcast submitted',
          tradeId: result.tradeId,
          broadcastTxid: result.broadcastTxid,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          msg: 'pearl release broadcast failed',
          tradeId: attempt.tradeId,
          idempotencyKey: attempt.idempotencyKey,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({
      msg: 'settlement worker iteration crashed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

function isReadyToBroadcast(attempt: PearlEscrowBroadcastAttempt): boolean {
  if (attempt.status !== 'signed' && attempt.status !== 'failed') return false;
  if (!attempt.signedTxHex) return false;
  if (attempt.nextRetryAt && new Date(attempt.nextRetryAt).getTime() > Date.now()) return false;
  return true;
}

function parsePrivateKey(hex: string): Buffer {
  const normalized = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('OYSTER_WORKER_ARBITER_PRIVKEY_HEX must be 32-byte hex');
  }
  return Buffer.from(normalized, 'hex');
}

console.log(JSON.stringify({
  msg: 'settlement worker starting',
  loopIntervalMs: runtime.loopIntervalMs,
  signerKeyId: runtime.arbiterSignerKeyId,
  pearlRpc: !!runtime.pearlRpcUrl,
  pearlIndexer: !!runtime.pearlIndexerWatchUrl,
  baseRpc: !!runtime.baseRpcUrl,
  broadcastAttemptsPath: runtime.broadcastAttemptsPath,
}));

// Serialize iterations: schedule the next run only after the current one completes.
// `setInterval` would let a slow iteration overlap with the next, which could allow
// two concurrent broadcast attempts for the same trade.
async function loopForever(): Promise<void> {
  await loop();
  if (runtime.loopIntervalMs > 0) {
    setTimeout(loopForever, runtime.loopIntervalMs);
  }
}

await loopForever();
