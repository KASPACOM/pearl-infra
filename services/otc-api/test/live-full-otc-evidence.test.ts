import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, JsonRpcProvider, type Log, type TransactionReceipt } from 'ethers';

import type { OtcTrade, PublicTradeProof } from '@kaspacom/pearl-sdk';
import {
  getUsdcEscrowNetworkConfig,
  InMemoryUsdcEscrowEventRepository,
  PRL_USDC_ESCROW_ABI,
  type UsdcEscrowEventName,
  type UsdcEscrowTradeEvent,
} from '@kaspacom/usdc-escrow-client';

import { projectPearlIndexedProof } from '../src/pearl-proof-reader.ts';
import { createPearlEscrowWatchId } from '../src/pearl-watch-registrar.ts';

import { baseEscrowEventStateFromUsdcTradeState } from '../../settlement-worker/dist/index.js';

const apiUrl = process.env.OTC_FULL_FLOW_API_URL;
const tradeId = process.env.OTC_FULL_FLOW_TRADE_ID;
const baseRpcUrl = process.env.OTC_FULL_FLOW_BASE_RPC_URL;
const configuredBaseTxHashes = parseCsv(process.env.OTC_FULL_FLOW_BASE_TX_HASHES);
const pearlIndexerUrl = process.env.OTC_FULL_FLOW_PEARL_INDEXER_URL;
const configuredExpectedStatus = parseExpectedStatus(process.env.OTC_FULL_FLOW_EXPECTED_STATUS);
const BASE_SEPOLIA_CONTRACT = '0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9';
const TRADE_KEY = `0x${'42'.repeat(32)}`;
const BUYER_USDC = '0x1111111111111111111111111111111111111111';
const SELLER_USDC = '0x2222222222222222222222222222222222222222';
const USDC_EXPIRY_UNIX_SECONDS = 1_779_184_800;

test('live evidence verifier normalizes Base receipt logs into worker-safe state', async () => {
  const trade = tradeFixture();
  const iface = new Interface(PRL_USDC_ESCROW_ABI);
  const network = getUsdcEscrowNetworkConfig('base_sepolia');
  const events = [
    parseSyntheticEscrowLog({ iface, eventName: 'TradeCreated', args: [TRADE_KEY, BUYER_USDC, SELLER_USDC, 85_000_000n, 0n, BigInt(USDC_EXPIRY_UNIX_SECONDS)], logIndex: 0 }),
    parseSyntheticEscrowLog({ iface, eventName: 'Deposited', args: [TRADE_KEY, BUYER_USDC, 85_000_000n], logIndex: 1 }),
    parseSyntheticEscrowLog({ iface, eventName: 'Released', args: [TRADE_KEY, SELLER_USDC, 85_000_000n, 0n], logIndex: 2 }),
  ].map((log, index) => parseEscrowLog({
    iface,
    log,
    receipt: {
      hash: `0x${String(index + 1).repeat(64)}`,
      blockNumber: 100 + index,
    } as TransactionReceipt,
    network,
    currentBlock: 112,
  }));

  assert.equal(events.every(Boolean), true);
  const repository = new InMemoryUsdcEscrowEventRepository();
  await repository.ingestEvents(events as UsdcEscrowTradeEvent[]);
  const state = await repository.getTradeState(TRADE_KEY);
  assert.ok(state);
  assert.equal(state.status, 'released');
  assert.equal(baseEscrowEventStateFromUsdcTradeState(state, trade).status, 'released');
});

test('live evidence verifier requires a complete Base lifecycle before accepting terminal evidence', () => {
  const trade = tradeFixture();
  const depositedOnly = baseTradeEvent({ eventName: 'Deposited', amountMicros: trade.usdcEscrow.expectedAmountMicros });
  const releasedWithoutDeposit = [
    baseTradeEvent({ eventName: 'TradeCreated', amountMicros: '85000000', feeMicros: '0' }),
    baseTradeEvent({ eventName: 'Released', sellerAmountMicros: '85000000', feeAmountMicros: '0' }),
  ];

  assert.throws(() => assertCompleteBaseLifecycle([depositedOnly], 'released'), /Base receipts must include TradeCreated/);
  assert.throws(() => assertCompleteBaseLifecycle(releasedWithoutDeposit, 'released'), /Base receipts must include Deposited/);
});

interface LiveProofEvidence {
  tradeId: string;
  expectedStatus: 'released' | 'refunded';
  baseTxHashes: string[];
  publicProofPath: string;
  proof: PublicTradeProof;
  recordedAt: string;
}

test('optional live full OTC evidence verifies public proof, Base receipts, and Pearl indexer history', { skip: !apiUrl || !tradeId || !baseRpcUrl || !pearlIndexerUrl }, async () => {
  const trade = await fetchJson<OtcTrade>(`${apiUrl}/otc/trades/${encodeURIComponent(tradeId!)}`);
  const proof = await fetchJson<PublicTradeProof>(`${apiUrl}/otc/trades/${encodeURIComponent(tradeId!)}/proof`);
  const storedEvidence = configuredBaseTxHashes.length > 0 && configuredExpectedStatus
    ? undefined
    : await fetchOptionalJson<LiveProofEvidence>(`${apiUrl}/otc/trades/${encodeURIComponent(tradeId!)}/live-proof-evidence`);
  const baseTxHashes = configuredBaseTxHashes.length > 0 ? configuredBaseTxHashes : storedEvidence?.baseTxHashes ?? [];
  const expectedStatus = configuredExpectedStatus ?? storedEvidence?.expectedStatus ?? 'released';

  assert.equal(trade.tradeId, tradeId);
  assert.equal(proof.tradeId, trade.tradeId);
  assert.ok(baseTxHashes.length > 0, 'Base tx hashes must be provided by OTC_FULL_FLOW_BASE_TX_HASHES or live-proof-evidence API');
  if (storedEvidence) {
    assert.equal(storedEvidence.tradeId, trade.tradeId);
    assert.equal(storedEvidence.publicProofPath, `/otc/trades/${encodeURIComponent(trade.tradeId)}/proof`);
    assert.equal(storedEvidence.proof.tradeId, trade.tradeId);
  }
  assert.equal(proof.status, expectedStatus);
  assert.equal(proof.base.tradeKey, trade.usdcEscrow.tradeKey);
  assert.equal(proof.base.contract.toLowerCase(), trade.usdcEscrow.contract.toLowerCase());
  assert.equal(proof.pearl.escrowAddress, trade.pearlEscrow.address);

  const provider = new JsonRpcProvider(baseRpcUrl);
  const baseEvents = await loadBaseEscrowEventsFromReceipts(provider, trade, baseTxHashes);
  assertCompleteBaseLifecycle(baseEvents, expectedStatus);
  const baseRepository = new InMemoryUsdcEscrowEventRepository();
  await baseRepository.ingestEvents(baseEvents);

  const baseState = await baseRepository.getTradeState(trade.usdcEscrow.tradeKey);
  assert.ok(baseState, 'Base receipts must include events for the trade key');
  const workerSafeState = baseEscrowEventStateFromUsdcTradeState(baseState, trade);
  assert.notEqual(workerSafeState.status, 'stale', workerSafeState.reason);
  assert.equal(workerSafeState.status, expectedStatus === 'refunded' ? 'refunded' : 'released');

  if (expectedStatus === 'released') {
    assert.equal(proof.base.releaseTxHash?.toLowerCase(), baseState.releaseTxHash?.toLowerCase());
    assert.ok(proof.pearl.releaseTxid, 'public proof must include Pearl release txid');
  } else if (expectedStatus === 'refunded') {
    assert.equal(proof.base.refundTxHash?.toLowerCase(), baseState.refundTxHash?.toLowerCase());
    assert.ok(proof.pearl.refundTxid, 'public proof must include Pearl refund txid');
  }
  assert.equal(proof.base.depositTxHash?.toLowerCase(), baseState.depositTxHash?.toLowerCase());

  const watchId = createPearlEscrowWatchId(trade.tradeId);
  const history = await fetchJson<unknown>(`${pearlIndexerUrl!.replace(/\/+$/, '')}/watches/${encodeURIComponent(watchId)}`);
  const indexedProof = projectPearlIndexedProof(trade, history);
  assert.equal(indexedProof.escrowOutpoint, proof.pearl.escrowOutpoint);
  assert.equal(indexedProof.releaseTxid, proof.pearl.releaseTxid);
  assert.equal(indexedProof.refundTxid, proof.pearl.refundTxid);
  assert.ok(indexedProof.escrowConfirmations >= trade.pearlEscrow.requiredConfirmations);
});

async function loadBaseEscrowEventsFromReceipts(
  provider: JsonRpcProvider,
  trade: OtcTrade,
  txHashes: readonly string[],
): Promise<readonly UsdcEscrowTradeEvent[]> {
  const network = getUsdcEscrowNetworkConfig(trade.usdcEscrow.chainId === 84532 ? 'base_sepolia' : 'base');
  const iface = new Interface(PRL_USDC_ESCROW_ABI);
  const providerNetwork = await provider.getNetwork();
  assert.equal(Number(providerNetwork.chainId), trade.usdcEscrow.chainId, 'Base RPC chain ID must match the OTC trade chain ID');
  const currentBlock = await provider.getBlockNumber();
  const events: UsdcEscrowTradeEvent[] = [];
  for (const txHash of txHashes) {
    const receipt = await provider.getTransactionReceipt(txHash);
    assert.ok(receipt, `Base receipt not found for ${txHash}`);
    assert.equal(receipt.status, 1, `Base transaction failed: ${txHash}`);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== trade.usdcEscrow.contract.toLowerCase()) continue;
      const event = parseEscrowLog({
        iface,
        log,
        receipt,
        network,
        currentBlock,
      });
      if (event?.tradeKey === trade.usdcEscrow.tradeKey) {
        events.push(event);
      }
    }
  }
  return events;
}

function assertCompleteBaseLifecycle(
  events: readonly UsdcEscrowTradeEvent[],
  status: 'released' | 'refunded',
): void {
  const eventNames = new Set(events.map((event) => event.eventName));
  assert.equal(eventNames.has('TradeCreated'), true, 'Base receipts must include TradeCreated');
  assert.equal(eventNames.has('Deposited'), true, 'Base receipts must include Deposited');
  assert.equal(eventNames.has(status === 'released' ? 'Released' : 'Refunded'), true, `Base receipts must include ${status === 'released' ? 'Released' : 'Refunded'}`);
  assert.equal(eventNames.has(status === 'released' ? 'Refunded' : 'Released'), false, 'Base receipts must not include both terminal outcomes');
}

function parseEscrowLog(input: {
  iface: Interface;
  log: Log;
  receipt: TransactionReceipt;
  network: ReturnType<typeof getUsdcEscrowNetworkConfig>;
  currentBlock: number;
}): UsdcEscrowTradeEvent | undefined {
  const parsed = input.iface.parseLog({ topics: [...input.log.topics], data: input.log.data });
  if (!parsed || !isTradeEventName(parsed.name)) return undefined;

  const base = {
    network: input.network.network,
    chainId: input.network.chainId,
    contractAddress: input.log.address,
    tradeKey: String(parsed.args.tradeId),
    txHash: input.receipt.hash,
    logIndex: input.log.index,
    blockNumber: input.receipt.blockNumber,
    blockHash: input.log.blockHash,
    confirmations: input.currentBlock - input.receipt.blockNumber + 1,
    observedAt: new Date().toISOString(),
  };

  switch (parsed.name) {
    case 'TradeCreated':
      return {
        ...base,
        eventName: parsed.name,
        buyer: String(parsed.args.buyer),
        seller: String(parsed.args.seller),
        amountMicros: parsed.args.amount.toString(),
        feeMicros: parsed.args.fee.toString(),
        expiryUnixSeconds: Number(parsed.args.expiry),
      };
    case 'Deposited':
      return {
        ...base,
        eventName: parsed.name,
        payer: String(parsed.args.payer),
        amountMicros: parsed.args.amount.toString(),
      };
    case 'Released':
      return {
        ...base,
        eventName: parsed.name,
        seller: String(parsed.args.seller),
        sellerAmountMicros: parsed.args.sellerAmount.toString(),
        feeAmountMicros: parsed.args.feeAmount.toString(),
      };
    case 'Refunded':
      return {
        ...base,
        eventName: parsed.name,
        buyer: String(parsed.args.buyer),
        amountMicros: parsed.args.amount.toString(),
      };
    case 'Cancelled':
      return {
        ...base,
        eventName: parsed.name,
      };
  }
}

function parseSyntheticEscrowLog(input: {
  iface: Interface;
  eventName: Exclude<UsdcEscrowEventName, 'Paused' | 'Unpaused'>;
  args: readonly unknown[];
  logIndex: number;
}): Log {
  const fragment = input.iface.getEvent(input.eventName);
  assert.ok(fragment);
  const encoded = input.iface.encodeEventLog(fragment, input.args);
  return {
    address: BASE_SEPOLIA_CONTRACT,
    topics: encoded.topics,
    data: encoded.data,
    index: input.logIndex,
    blockHash: `0x${'ab'.repeat(32)}`,
  } as Log;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function fetchOptionalJson<T>(url: string): Promise<T | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function parseCsv(value: string | undefined): readonly string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

function parseExpectedStatus(value: string | undefined): 'released' | 'refunded' | undefined {
  if (!value) return undefined;
  if (value === 'released' || value === 'refunded') return value;
  throw new Error('OTC_FULL_FLOW_EXPECTED_STATUS must be released or refunded');
}

function isTradeEventName(value: string): value is Exclude<UsdcEscrowEventName, 'Paused' | 'Unpaused'> {
  return value === 'TradeCreated' || value === 'Deposited' || value === 'Released' || value === 'Refunded' || value === 'Cancelled';
}

function baseTradeEvent(
  overrides: (
    | { eventName: 'TradeCreated'; amountMicros: string; feeMicros: string }
    | { eventName: 'Deposited'; amountMicros: string }
    | { eventName: 'Released'; sellerAmountMicros: string; feeAmountMicros: string }
    | { eventName: 'Refunded'; amountMicros: string }
  ),
): UsdcEscrowTradeEvent {
  const base = {
    network: 'base_sepolia',
    chainId: 84532,
    contractAddress: BASE_SEPOLIA_CONTRACT,
    tradeKey: TRADE_KEY,
    txHash: `0x${'11'.repeat(32)}`,
    logIndex: 0,
    blockNumber: 100,
    blockHash: `0x${'ab'.repeat(32)}`,
    confirmations: 12,
    observedAt: '2026-05-19T10:00:00.000Z',
  } as const;
  switch (overrides.eventName) {
    case 'TradeCreated':
      return {
        ...base,
        eventName: 'TradeCreated',
        buyer: BUYER_USDC,
        seller: SELLER_USDC,
        amountMicros: overrides.amountMicros,
        feeMicros: overrides.feeMicros,
        expiryUnixSeconds: USDC_EXPIRY_UNIX_SECONDS,
      };
    case 'Deposited':
      return {
        ...base,
        eventName: 'Deposited',
        payer: BUYER_USDC,
        amountMicros: overrides.amountMicros,
      };
    case 'Released':
      return {
        ...base,
        eventName: 'Released',
        seller: SELLER_USDC,
        sellerAmountMicros: overrides.sellerAmountMicros,
        feeAmountMicros: overrides.feeAmountMicros,
      };
    case 'Refunded':
      return {
        ...base,
        eventName: 'Refunded',
        buyer: BUYER_USDC,
        amountMicros: overrides.amountMicros,
      };
  }
}

function tradeFixture(): OtcTrade {
  return {
    tradeId: 'otc_live_verifier_fixture',
    quoteId: 'quote_live_verifier_fixture',
    state: 'usdc_escrow_confirmed',
    side: 'buy_prl',
    amountPrl: '500.00000000',
    amountUsdc: '85.000000',
    feePrl: '0.00000000',
    feeUsdc: '0.000000',
    buyerPearlAddress: 'rprl1pxqu6hcrs6xzg2n60pjf2yruzr637p73zaettvsyzzzu27zvzhvxqt4xql0',
    buyerUsdcAddress: BUYER_USDC,
    sellerPearlRefundAddress: 'rprl1pxsnlfuungl0kztjj2rmknxjxanhg5jvweuplxzxnuye6p3dj9g5sw0pp8q',
    sellerUsdcReceiveAddress: SELLER_USDC,
    pearlEscrow: {
      network: 'simnet',
      address: 'rprl1p6j5eqtndefwp2vhp7fpz5cd5eypv9q8jzkk2z2qxwd78h877u5kqm80pw9',
      expectedAmountGrains: '50000000000',
      requiredConfirmations: 1,
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: BASE_SEPOLIA_CONTRACT,
      usdcToken: getUsdcEscrowNetworkConfig('base_sepolia').usdcToken,
      tradeKey: TRADE_KEY,
      expectedAmountMicros: '85000000',
      requiredConfirmations: 6,
      expiresAt: '2026-05-19T10:00:00.000Z',
    },
    deadlines: {
      quoteExpiresAt: '2026-05-19T09:00:00.000Z',
      pearlFundingDeadline: '2026-05-19T09:15:00.000Z',
      usdcDepositDeadline: '2026-05-19T09:30:00.000Z',
      settlementDeadline: '2026-05-19T10:00:00.000Z',
      refundAvailableAt: '2026-05-19T10:00:00.000Z',
    },
    createdAt: '2026-05-19T08:55:00.000Z',
    updatedAt: '2026-05-19T09:35:00.000Z',
  };
}
