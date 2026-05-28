import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryBlockSink,
  PearlBlockPoller,
  createPearldBlockSource,
  type PearlBlockSink,
  type PearlBlockSource,
  type PearlBlockSummary,
  type SaveBlockResult,
} from '../src/block-poller.ts';

function createMockSource(tipHeight: number): PearlBlockSource {
  return {
    async getBlockCount() {
      return tipHeight;
    },
    async getBlockHash(height) {
      return `hash-${height}`;
    },
    async getBlock(hash) {
      const height = Number(hash.split('-')[1]);
      return {
        hash,
        height,
        previousHash: height > 0 ? `hash-${height - 1}` : undefined,
        txids: [`tx-${height}`],
        inputs: [],
        outputs: [],
        timestamp: new Date(height * 1000).toISOString(),
      };
    },
  };
}

test('polls missing blocks from next height through tip', async () => {
  const sink = new MemoryBlockSink();
  const poller = new PearlBlockPoller(createMockSource(3), sink);

  const result = await poller.pollOnce({ nextHeight: 1 });

  assert.equal(result.indexedBlocks, 3);
  assert.equal(result.nextHeight, 4);
  assert.deepEqual(
    sink.blocks.map((block) => block.height),
    [1, 2, 3],
  );
});

test('does not reindex when next height is past tip', async () => {
  const sink = new MemoryBlockSink();
  const poller = new PearlBlockPoller(createMockSource(3), sink);

  const result = await poller.pollOnce({ nextHeight: 4 });

  assert.equal(result.indexedBlocks, 0);
  assert.equal(result.nextHeight, 4);
  assert.deepEqual(sink.blocks, []);
});

test('stops at fork point and rewinds nextHeight when sink reports a reorg', async () => {
  const reorgSink: PearlBlockSink = {
    async saveBlock(block: PearlBlockSummary): Promise<SaveBlockResult> {
      if (block.height === 2) {
        return {
          kind: 'reorg',
          detachedFromHeight: 1,
          indexedHash: 'hash-1-stale',
          newPreviousHash: block.previousHash,
        };
      }
      return { kind: 'saved' };
    },
  };
  const poller = new PearlBlockPoller(createMockSource(5), reorgSink);

  const result = await poller.pollOnce({ nextHeight: 1 });

  // Block 1 saved. Block 2 detected reorg → stop, rewind nextHeight to 1.
  assert.equal(result.indexedBlocks, 1);
  assert.equal(result.reorgDetected, true);
  assert.equal(result.reorgDetachedFromHeight, 1);
  assert.equal(result.nextHeight, 1);
});

test('createPearldBlockSource reads full transactions from pearld rawtx verbosity', async () => {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const source = createPearldBlockSource({
    async call(method: string, params: unknown[] = []) {
      calls.push({ method, params });
      if (method === 'getblockcount') return 10;
      if (method === 'getblockhash') return 'hash-7';
      if (method === 'getblock') {
        return {
          hash: 'hash-7',
          height: 7,
          previousblockhash: 'hash-6',
          time: 1_700_000_000,
          rawtx: [
            {
              txid: 'tx-7',
              vin: [{ txid: 'prev-tx', vout: 1, sequence: 42 }],
              vout: [
                {
                  value: '1.25000000',
                  n: 0,
                  scriptPubKey: {
                    hex: '5120abcd',
                    type: 'witness_v1_taproot',
                    address: 'prl1pexample',
                  },
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    },
  });

  const block = await source.getBlock('hash-7');

  assert.deepEqual(calls.at(-1), { method: 'getblock', params: ['hash-7', 2] });
  assert.deepEqual(block.txids, ['tx-7']);
  assert.deepEqual(block.inputs, [
    { txid: 'tx-7', vin: 0, spentOutpoint: 'prev-tx:1', sequence: 42 },
  ]);
  assert.deepEqual(block.outputs, [
    {
      txid: 'tx-7',
      vout: 0,
      amountGrains: '125000000',
      scriptPubKey: {
        hex: '5120abcd',
        type: 'witness_v1_taproot',
        address: 'prl1pexample',
      },
    },
  ]);
});
