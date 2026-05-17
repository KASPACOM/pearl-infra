import assert from 'node:assert/strict';
import test from 'node:test';

import { PearlRpcTransactionBroadcaster } from '../src/broadcast.ts';

test('broadcasts signed raw transactions through pearld RPC', async () => {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const broadcaster = new PearlRpcTransactionBroadcaster({
    async call<T>(method: string, params: unknown[]): Promise<T> {
      calls.push({ method, params });
      return 'aa'.repeat(32) as T;
    },
  });

  const txid = await broadcaster.sendRawTransaction('020000000001');

  assert.equal(txid, 'aa'.repeat(32));
  assert.deepEqual(calls, [{ method: 'sendrawtransaction', params: ['020000000001'] }]);
});

test('rejects malformed raw transaction hex before RPC call', async () => {
  const broadcaster = new PearlRpcTransactionBroadcaster({
    async call<T>(): Promise<T> {
      throw new Error('should not call RPC');
    },
  });

  await assert.rejects(() => broadcaster.sendRawTransaction('not hex'), /signedTxHex must be non-empty even-length hex/);
});
