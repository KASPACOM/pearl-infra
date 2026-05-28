import assert from 'node:assert/strict';
import test from 'node:test';

import { PearlRpcClient } from '@kaspacom/pearl-rpc';

const url = process.env.PEARL_LIVE_RPC_URL;

test('optional live pearld RPC smoke test', { skip: !url }, async () => {
  const client = new PearlRpcClient({
    url: url!,
    user: process.env.PEARL_LIVE_RPC_USER,
    pass: process.env.PEARL_LIVE_RPC_PASS,
  });

  const blockCount = await client.call<number>('getblockcount');

  assert.equal(Number.isInteger(blockCount), true);
  assert.equal(blockCount >= 0, true);
});
