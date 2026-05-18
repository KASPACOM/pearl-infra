import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import test from 'node:test';

import type { OtcTrade } from '@kaspacom/pearl-sdk';

import { HttpPearlProofReader, projectPearlIndexedProof } from '../src/pearl-proof-reader.ts';

test('projects Pearl proof fields from active indexer observations and classified spends', () => {
  const proof = projectPearlIndexedProof(trade, {
    observations: [
      {
        outpoint: 'detached:0',
        blockHash: 'old',
        height: 90,
        amountGrains: '101000000000',
        confirmations: 0,
        matchStatus: 'detached',
        observedAt: '2026-05-16T11:59:00.000Z',
      },
      {
        outpoint: 'funding:0',
        blockHash: 'block1',
        height: 100,
        amountGrains: '101000000000',
        confirmations: 5,
        matchStatus: 'spent',
        observedAt: '2026-05-16T12:01:00.000Z',
      },
    ],
    spends: [
      {
        spendTxid: 'release_tx',
        spentOutpoint: 'funding:0',
        blockHash: 'block2',
        height: 110,
        classification: 'release',
        observedAt: '2026-05-16T12:20:00.000Z',
      },
    ],
  });

  assert.equal(proof.escrowOutpoint, 'funding:0');
  assert.equal(proof.escrowConfirmations, 5);
  assert.equal(proof.releaseTxid, 'release_tx');
  assert.equal(proof.refundTxid, undefined);
  assert.equal(proof.events.length, 2);
  assert.equal(proof.events[0].source, 'pearl_indexer');
  assert.equal(proof.events[1].txHash, 'release_tx');
});

test('fetches Pearl proof history from indexer watch API', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      observations: [
        {
          outpoint: 'funding:0',
          blockHash: 'block1',
          height: 100,
          amountGrains: '101000000000',
          confirmations: 3,
          matchStatus: 'confirmed',
          observedAt: '2026-05-16T12:01:00.000Z',
        },
      ],
      spends: [],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    const reader = new HttpPearlProofReader(`http://127.0.0.1:${address.port}`);
    const proof = await reader.getPearlIndexedProof(trade);
    assert.equal(proof.escrowOutpoint, 'funding:0');
    assert.equal(proof.escrowConfirmations, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

const trade: OtcTrade = {
  tradeId: 'trade-proof-1',
  quoteId: 'quote-proof-1',
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
