import { Contract, JsonRpcProvider, Wallet, type TransactionReceipt } from 'ethers';

import { PRL_USDC_ESCROW_ABI } from '@kaspacom/usdc-escrow-client';
import { parseUsdcToMicros, type OtcTrade } from '@kaspacom/pearl-sdk';

import type {
  SettlementBroadcasterAdapter,
  SettlementDecisionRecord,
  SettlementPreparedAction,
} from './types.js';

/**
 * Calls `createTrade()` and `release()` on the Base mainnet `PrlUsdcEscrow` contract
 * using a hot operator key. Idempotency is enforced by reading on-chain trade state
 * before submitting — the contract itself rejects duplicates, but the pre-check avoids
 * wasted gas and confusing revert reasons in the worker log.
 *
 * The broadcaster never holds the contract Owner key; rotating the operator key is a
 * single onlyOwner setOperator() tx from the cold owner.
 */
export interface EthersEvmBroadcasterOptions {
  rpcUrl: string;
  escrowContract: string;
  operatorPrivateKeyHex: string;
  /** ms to wait between gas estimate and revert reason surfacing; defaults to 60_000. */
  confirmationTimeoutMs?: number;
  now?: () => Date;
}

interface OnChainTrade {
  buyer: string;
  seller: string;
  amount: bigint;
  fee: bigint;
  expiry: bigint;
  status: number; // 0 None, 1 Created, 2 Deposited, 3 Released, 4 Refunded, 5 Cancelled
}

const STATUS_NONE = 0;
const STATUS_CREATED = 1;
const STATUS_DEPOSITED = 2;
const STATUS_RELEASED = 3;

export class EthersEvmBroadcaster implements SettlementBroadcasterAdapter {
  private readonly contract: Contract;
  private readonly wallet: Wallet;
  private readonly confirmationTimeoutMs: number;
  private readonly now: () => Date;
  readonly operatorAddress: string;

  constructor(options: EthersEvmBroadcasterOptions) {
    const provider = new JsonRpcProvider(options.rpcUrl);
    this.wallet = new Wallet(normalizePrivkey(options.operatorPrivateKeyHex), provider);
    this.contract = new Contract(options.escrowContract, PRL_USDC_ESCROW_ABI, this.wallet);
    this.operatorAddress = this.wallet.address;
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? 60_000;
    this.now = options.now ?? (() => new Date());
  }

  /** Idempotent createTrade: skips if on-chain trade already exists. */
  async ensureCreateTrade(trade: OtcTrade): Promise<{ txHash?: string; alreadyExisted: boolean }> {
    const onChain = await this.readTrade(trade.usdcEscrow.tradeKey);
    if (onChain.status !== STATUS_NONE) {
      return { alreadyExisted: true };
    }
    try {
      const tx = await this.contract.createTrade(
        trade.usdcEscrow.tradeKey,
        trade.buyerUsdcAddress,
        trade.sellerUsdcReceiveAddress,
        parseUsdcToMicros(trade.amountUsdc),
        parseUsdcToMicros(trade.feeUsdc),
        BigInt(Math.floor(new Date(trade.deadlines.usdcDepositDeadline).getTime() / 1000)),
      );
      const receipt = await this.waitForReceipt(tx);
      return { txHash: receipt.hash, alreadyExisted: false };
    } catch (error) {
      // Race: another iteration or external caller landed createTrade between our
      // status read and broadcast. Contract reverts with "trade exists" — treat as
      // success-no-op since the on-chain state we want is now in place.
      if (isTradeExistsRevert(error)) {
        return { alreadyExisted: true };
      }
      throw error;
    }
  }

  /** Idempotent release: skips if on-chain trade is already Released or terminal. */
  async ensureRelease(trade: OtcTrade): Promise<{ txHash?: string; alreadyReleased: boolean }> {
    const onChain = await this.readTrade(trade.usdcEscrow.tradeKey);
    if (onChain.status === STATUS_RELEASED) {
      return { alreadyReleased: true };
    }
    if (onChain.status !== STATUS_DEPOSITED) {
      throw new Error(
        `Base trade ${trade.usdcEscrow.tradeKey} is in status ${onChainStatusName(onChain.status)} — release requires Deposited`,
      );
    }
    const tx = await this.contract.release(trade.usdcEscrow.tradeKey);
    const receipt = await this.waitForReceipt(tx);
    return { txHash: receipt.hash, alreadyReleased: false };
  }

  /**
   * SettlementBroadcasterAdapter.prepareBaseCreateTrade — wired by the worker decision
   * loop after Pearl escrow allocation and before the USDC deposit window opens. Calls
   * `createTrade(...)` on Base; idempotent across retries via on-chain status check.
   */
  async prepareBaseCreateTrade(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    const result = await this.ensureCreateTrade(trade);
    return {
      actionId: `base_create_trade_${decision.decisionId}`,
      decisionId: decision.decisionId,
      tradeId: trade.tradeId,
      action: decision.action,
      status: 'prepared',
      idempotencyKey: `base:create:${trade.usdcEscrow.tradeKey}`,
      createdAt: this.now().toISOString(),
      metadata: {
        adapter: 'ethers_evm_broadcaster',
        operator: this.operatorAddress,
        baseTxHash: result.txHash ?? '',
        alreadyExisted: result.alreadyExisted,
      },
    };
  }

  /**
   * SettlementBroadcasterAdapter.prepareUsdcRelease — wired by the worker decision loop
   * once Pearl release is observed as confirmed. Calls `release()` on Base; idempotent
   * across retries and pod restarts.
   */
  async prepareUsdcRelease(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    const result = await this.ensureRelease(trade);
    const status: SettlementPreparedAction['status'] = 'prepared';
    return {
      actionId: `usdc_release_${decision.decisionId}`,
      decisionId: decision.decisionId,
      tradeId: trade.tradeId,
      action: decision.action,
      status,
      idempotencyKey: `usdc:release:${trade.tradeId}:${decision.decisionId}`,
      createdAt: this.now().toISOString(),
      metadata: {
        adapter: 'ethers_evm_broadcaster',
        operator: this.operatorAddress,
        baseTxHash: result.txHash ?? '',
        alreadyReleased: result.alreadyReleased,
      },
    };
  }

  private async readTrade(tradeKey: string): Promise<OnChainTrade> {
    const r = await this.contract.trades(tradeKey);
    return {
      buyer: String(r.buyer ?? r[0]),
      seller: String(r.seller ?? r[1]),
      amount: BigInt(r.amount ?? r[2]),
      fee: BigInt(r.fee ?? r[3]),
      expiry: BigInt(r.expiry ?? r[4]),
      status: Number(r.status ?? r[5]),
    };
  }

  private async waitForReceipt(tx: { wait: (confirmations?: number, timeout?: number) => Promise<TransactionReceipt | null> }): Promise<TransactionReceipt> {
    const receipt = await tx.wait(1, this.confirmationTimeoutMs);
    if (!receipt) {
      throw new Error('Base tx receipt unavailable after timeout');
    }
    if (receipt.status !== 1) {
      throw new Error(`Base tx reverted: ${receipt.hash}`);
    }
    return receipt;
  }
}

function normalizePrivkey(hex: string): string {
  const trimmed = hex.trim().toLowerCase();
  const cleaned = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    throw new Error('operator privkey must be 32-byte hex');
  }
  return '0x' + cleaned;
}

function onChainStatusName(status: number): string {
  return (
    ['None', 'Created', 'Deposited', 'Released', 'Refunded', 'Cancelled'][status] ?? `Unknown(${status})`
  );
}

function isTradeExistsRevert(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes('trade exists')) return true;
  // ethers v6 surfaces revert reasons via `reason` and `revert.args[0]`.
  const reason = (error as { reason?: string; shortMessage?: string })?.reason
    ?? (error as { shortMessage?: string })?.shortMessage;
  if (typeof reason === 'string' && reason.toLowerCase().includes('trade exists')) return true;
  return false;
}
