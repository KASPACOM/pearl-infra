import { PearlRpcClient } from '@kaspacom/pearl-rpc';

import { PearlBlockPoller, MemoryBlockSink, createPearldBlockSource } from './block-poller.js';
import { readPearlIndexerServiceConfig } from './config.js';

const config = readPearlIndexerServiceConfig();
const rpcClient = new PearlRpcClient({
  url: config.rpcUrl,
  user: config.rpcUser,
  pass: config.rpcPass,
});
const sink = new MemoryBlockSink();
const poller = new PearlBlockPoller(createPearldBlockSource(rpcClient), sink);

let nextHeight = config.startHeight;

async function pollForever(): Promise<void> {
  for (;;) {
    const result = await poller.pollOnce({ nextHeight });
    nextHeight = result.nextHeight;
    console.log(
      JSON.stringify({
        msg: 'pearl-indexer poll complete',
        network: config.network,
        fromHeight: result.fromHeight,
        toHeight: result.toHeight,
        indexedBlocks: result.indexedBlocks,
        nextHeight,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

pollForever().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
