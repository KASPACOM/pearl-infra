import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryBlockSink,
  PearlBlockPoller,
  type PearlBlockSource,
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
