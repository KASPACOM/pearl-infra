import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  HttpPearlBridgeIndexerClient,
  parseWatchHistory,
  toIndexerRequest,
} from '../dist/pearl-indexer-client.js';
import type { RegisterBridgeWatchInput } from '../src/types.ts';

test('serializes bridge watch registration into the indexer HTTP contract', () => {
  const request = toIndexerRequest({
    watchId: 'bridge-deposit-1',
    purpose: 'bridge_deposit',
    network: 'testnet2',
    address: 'tprl1pdeposit',
    requiredConfirmations: 6,
    metadata: { expected_amount_min_grains: '100' },
  });

  assert.deepEqual(request, {
    watch_id: 'bridge-deposit-1',
    purpose: 'bridge_deposit',
    network: 'testnet2',
    address: 'tprl1pdeposit',
    required_confirmations: 6,
    metadata: { expected_amount_min_grains: '100' },
  });
});

test('registers deposit and reserve watches through the Pearl indexer API', async () => {
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/watches') {
      response.writeHead(404).end();
      return;
    }
    requests.push(JSON.parse(await readBody(request)));
    response.writeHead(requests.length === 1 ? 201 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });

  const baseUrl = await listen(server);
  try {
    const client = new HttpPearlBridgeIndexerClient({ baseUrl });
    const deposit = await client.registerDepositWatch({
      depositId: 'deposit-1',
      network: 'testnet2',
      depositAddress: 'tprl1pdeposit',
      igraRecipient: '0x1111111111111111111111111111111111111111',
      expectedAmountMinGrains: '100',
      expectedAmountMaxGrains: '200',
      expiryHeight: 1200,
      requiredConfirmations: 6,
    });
    const reserve = await client.registerReserveWatch({
      reserveId: 'reserve-hot-1',
      network: 'testnet2',
      reserveAddress: 'tprl1preserve',
      custodyTier: 'hot',
      activeFromHeight: 1000,
      requiredConfirmations: 6,
    });

    assert.equal(deposit.purpose, 'bridge_deposit');
    assert.equal(reserve.purpose, 'bridge_reserve');
    assert.equal(requests.length, 2);
    assert.equal((requests[0] as RegisterBridgeWatchInput).purpose, 'bridge_deposit');
    assert.equal((requests[1] as RegisterBridgeWatchInput).purpose, 'bridge_reserve');
  } finally {
    await close(server);
  }
});

test('reads typed bridge watch history from the Pearl indexer API', async () => {
  const history = sampleWatchHistory();
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/watches/deposit-1') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(history));
      return;
    }
    response.writeHead(404).end();
  });

  const baseUrl = await listen(server);
  try {
    const client = new HttpPearlBridgeIndexerClient({ baseUrl });
    const parsed = await client.getWatchHistory('deposit-1');
    assert.equal(parsed.watchId, 'deposit-1');
    assert.equal(parsed.observations[0].matchStatus, 'confirmed');
    assert.equal(parsed.spends[0].classificationData?.amount_grains, '150');
  } finally {
    await close(server);
  }
});

test('rejects malformed indexer watch history before reconciliation', () => {
  assert.throws(
    () => parseWatchHistory({ ...sampleWatchHistory(), observations: [{ outpoint: 'missing-fields' }] }),
    /watchId must be a string/,
  );
});

function sampleWatchHistory() {
  return {
    watchId: 'deposit-1',
    purpose: 'bridge_deposit',
    network: 'testnet2',
    address: 'tprl1pdeposit',
    requiredConfirmations: 6,
    status: 'active',
    metadata: { expected_amount_min_grains: '100', expected_amount_max_grains: '200' },
    createdAt: '2026-05-18T17:59:00.000Z',
    updatedAt: '2026-05-18T17:59:00.000Z',
    observations: [
      {
        outpoint: 'tx:0',
        watchId: 'deposit-1',
        blockHash: 'block',
        height: 100,
        amountGrains: '150',
        confirmations: 6,
        matchStatus: 'confirmed',
        classification: 'on_time',
        observedAt: '2026-05-18T18:00:00.000Z',
      },
    ],
    spends: [
      {
        spendTxid: 'claim-1',
        spentOutpoint: 'tx:0',
        blockHash: 'block-claim',
        height: 120,
        classification: 'claim',
        classificationData: { amount_grains: '150' },
        observedAt: '2026-05-18T18:10:00.000Z',
      },
    ],
  };
}

async function readBody(request: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
