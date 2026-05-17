import { PearlRpcClient } from '@kaspacom/pearl-rpc';
import pg from 'pg';

import {
  MemoryBlockSink,
  PearlBlockPoller,
  createPearldBlockSource,
  type PearlBlockSink,
} from './block-poller.js';
import { readPearlIndexerServiceConfig } from './config.js';
import { PgBlockSink, pgPoolAdapter } from './postgres-sink.js';

const config = readPearlIndexerServiceConfig();

const rpcClient = new PearlRpcClient({
  url: config.rpcUrl,
  user: config.rpcUser,
  pass: config.rpcPass,
});

let sink: PearlBlockSink;
let resumeFrom: number;

if (config.databaseUrl) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const pgSink = new PgBlockSink(pgPoolAdapter(pool));
  sink = pgSink;
  resumeFrom = await pgSink.loadNextHeight(config.startHeight);
  console.log(
    JSON.stringify({
      msg: 'pearl-indexer postgres sink ready',
      network: config.network,
      resumeFromHeight: resumeFrom,
      configuredStartHeight: config.startHeight,
    }),
  );
} else {
  sink = new MemoryBlockSink();
  resumeFrom = config.startHeight;
  console.warn(
    JSON.stringify({
      msg: 'pearl-indexer running with in-memory sink — state will NOT survive restart',
      hint: 'set PEARL_INDEXER_DATABASE_URL to enable restart-safe persistence',
    }),
  );
}

const poller = new PearlBlockPoller(createPearldBlockSource(rpcClient), sink);
let nextHeight = resumeFrom;

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
        ...(result.reorgDetected
          ? { reorgDetected: true, reorgDetachedFromHeight: result.reorgDetachedFromHeight }
          : {}),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

pollForever().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
