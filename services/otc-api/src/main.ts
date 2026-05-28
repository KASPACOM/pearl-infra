import pg from 'pg';

import { PearlRpcClient, PearlRpcTransactionBroadcaster } from '@kaspacom/pearl-rpc';

import { InMemoryOtcRepository, PgOtcRepository } from './repository.js';
import { OtcTradeService } from './trade-service.js';
import { assertOtcApiStartupConfig, readOtcApiConfig, readOtcApiRuntimeConfig } from './config.js';
import { createOtcHttpServer, parseAdminApiTokens } from './http.js';
import { createConfiguredPearlEscrowAllocator } from './pearl-escrow-allocator.js';
import { HttpPearlProofReader } from './pearl-proof-reader.js';
import { HttpPearlEscrowWatchRegistrar } from './pearl-watch-registrar.js';
import { pgPoolAdapter } from './postgres.js';
import { createConfiguredSupportAlertNotifier } from './support-alert-notifier.js';
import { EthersUsdcEscrowReader } from './usdc-escrow-reader.js';

const port = Number(process.env.OTC_API_PORT ?? 8080);
const config = readOtcApiConfig();
const runtime = readOtcApiRuntimeConfig();
assertOtcApiStartupConfig(config, runtime);
const repository = config.databaseUrl
  ? new PgOtcRepository(pgPoolAdapter(new pg.Pool({ connectionString: config.databaseUrl })))
  : new InMemoryOtcRepository();
const usdcEscrowReader = config.baseRpcUrl
  ? new EthersUsdcEscrowReader(config.baseRpcUrl, config.baseEscrowContract)
  : undefined;
const pearlEscrowAllocator = createConfiguredPearlEscrowAllocator(config, repository);
const pearlEscrowWatchRegistrar = config.pearlIndexerWatchUrl
  ? new HttpPearlEscrowWatchRegistrar(config.pearlIndexerWatchUrl, config.pearlIndexerWatchTimeoutMs)
  : undefined;
const pearlProofReader = config.pearlIndexerWatchUrl
  ? new HttpPearlProofReader(config.pearlIndexerWatchUrl, config.pearlIndexerWatchTimeoutMs)
  : undefined;
const pearlSignedTransactionBroadcaster = config.pearlRpcUrl
  ? new PearlRpcTransactionBroadcaster(new PearlRpcClient({
      url: config.pearlRpcUrl,
      user: config.pearlRpcUser,
      pass: config.pearlRpcPass,
    }))
  : undefined;
const supportAlertNotifier = createConfiguredSupportAlertNotifier(config);
const service = new OtcTradeService(
  repository,
  config,
  pearlEscrowAllocator,
  usdcEscrowReader,
  undefined,
  pearlEscrowWatchRegistrar,
  pearlProofReader,
  supportAlertNotifier,
  pearlSignedTransactionBroadcaster,
);
const server = createOtcHttpServer(service, {
  adminToken: config.adminApiToken,
  adminCredentials: parseAdminApiTokens(config.adminApiTokens),
});

server.listen(port, () => {
  console.log(
    JSON.stringify({
      msg: 'otc-api listening',
      port,
      persistence: config.databaseUrl ? 'postgres' : 'memory',
      pearlEscrowAllocator: config.pearlEscrowAllocator,
      pearlEscrowWatchRegistrar: config.pearlIndexerWatchUrl ? 'http' : 'disabled',
      pearlSignedTransactionBroadcaster: pearlSignedTransactionBroadcaster ? 'rpc' : 'disabled',
      usdcEscrowReader: config.baseRpcUrl ? 'ethers' : 'disabled',
      supportAlertNotifier: supportAlertNotifier ? 'enabled' : 'disabled',
      productionConfigRequired: runtime.production,
    }),
  );
});
