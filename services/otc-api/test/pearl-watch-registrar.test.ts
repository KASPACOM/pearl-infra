import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage } from 'node:http';
import test from 'node:test';

import type { OtcTrade } from '@kaspacom/pearl-sdk';

import { createPearlEscrowWatchRegistration, HttpPearlEscrowWatchRegistrar } from '../src/pearl-watch-registrar.ts';

test('builds Pearl indexer watch registration metadata from an OTC trade', () => {
  const registration = createPearlEscrowWatchRegistration(trade);

  assert.equal(registration.watchId, `otc:${trade.tradeId}:pearl-escrow`);
  assert.equal(registration.purpose, 'otc_escrow');
  assert.equal(registration.address, trade.pearlEscrow.address);
  assert.equal(registration.requiredConfirmations, trade.pearlEscrow.requiredConfirmations);
  assert.equal(registration.metadata.expected_amount_grains, trade.pearlEscrow.expectedAmountGrains);
  assert.equal(registration.metadata.pearl_funding_deadline, trade.deadlines.pearlFundingDeadline);
  assert.equal(registration.metadata.taproot_output_script_hex, trade.pearlEscrow.taprootOutputScriptHex);
});

test('posts Pearl escrow watch registration to the indexer API', async () => {
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    requests.push(await readJson(request));
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    const registrar = new HttpPearlEscrowWatchRegistrar(`http://127.0.0.1:${address.port}`);
    await registrar.registerPearlEscrowWatch(trade);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    watch_id: `otc:${trade.tradeId}:pearl-escrow`,
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: trade.pearlEscrow.address,
    required_confirmations: 3,
    metadata: createPearlEscrowWatchRegistration(trade).metadata,
  });
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const trade: OtcTrade = {
  tradeId: 'trade-watch-1',
  quoteId: 'quote-watch-1',
  state: 'pearl_escrow_pending',
  side: 'buy_prl',
  amountPrl: '1000.00000000',
  amountUsdc: '170.000000',
  feePrl: '10.00000000',
  feeUsdc: '1.700000',
  buyerPearlAddress: 'tprl1pbuyer',
  buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
  sellerPearlRefundAddress: 'tprl1psellerrefund',
  sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
  pearlEscrow: {
    network: 'testnet2',
    address: 'tprl1pescrow',
    expectedAmountGrains: '101000000000',
    requiredConfirmations: 3,
    escrowScriptType: 'p2tr',
    taprootOutputScriptHex: `5120${'22'.repeat(32)}`,
  },
  usdcEscrow: {
    network: 'base',
    chainId: 84532,
    contract: '0x1111111111111111111111111111111111111111',
    usdcToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tradeKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedAmountMicros: '171700000',
    requiredConfirmations: 6,
    expiresAt: '2026-05-16T12:15:00.000Z',
  },
  deadlines: {
    quoteExpiresAt: '2026-05-16T12:05:00.000Z',
    pearlFundingDeadline: '2026-05-16T12:10:00.000Z',
    usdcDepositDeadline: '2026-05-16T12:15:00.000Z',
    settlementDeadline: '2026-05-16T12:30:00.000Z',
    refundAvailableAt: '2026-05-16T12:15:00.000Z',
  },
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
};
