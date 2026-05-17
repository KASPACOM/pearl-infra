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
import { createWatchedAddressHttpServer } from './watched-address-http.js';
import {
  MemoryWatchedAddressRepository,
  PgWatchedAddressRepository,
  type WatchedAddressRepository,
} from './watched-address-repository.js';

const config = readPearlIndexerServiceConfig();

const rpcClient = new PearlRpcClient({
  url: config.rpcUrl,
  user: config.rpcUser,
  pass: config.rpcPass,
});

let sink: PearlBlockSink;
let resumeFrom: number;
let watchRepo: WatchedAddressRepository;

if (config.databaseUrl) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const pgClient = pgPoolAdapter(pool);
  const pgSink = new PgBlockSink(pgClient);
  sink = pgSink;
  resumeFrom = await pgSink.loadNextHeight(config.startHeight);
  watchRepo = new PgWatchedAddressRepository(pgClient);
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
  watchRepo = new MemoryWatchedAddressRepository();
  console.warn(
    JSON.stringify({
      msg: 'pearl-indexer running with in-memory sink — state will NOT survive restart',
      hint: 'set PEARL_INDEXER_DATABASE_URL to enable restart-safe persistence',
    }),
  );
}

const httpServer = createWatchedAddressHttpServer(watchRepo);
httpServer.listen(config.httpPort, config.httpHost, () => {
  console.log(
    JSON.stringify({
      msg: 'pearl-indexer http server listening',
      host: config.httpHost,
      port: config.httpPort,
    }),
  );
});

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
