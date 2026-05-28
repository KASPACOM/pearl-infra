import pg from 'pg';

import { assertOtcApiStartupConfig, readOtcApiConfig, readOtcApiRuntimeConfig } from './config.js';
import {
  createConfiguredEmailNotificationProvider,
  NotificationDeliveryProcessor,
} from './notification-dispatcher.js';
import { createConfiguredPearlEscrowAllocator } from './pearl-escrow-allocator.js';
import { pgPoolAdapter } from './postgres.js';
import { InMemoryOtcRepository, PgOtcRepository } from './repository.js';
import { OtcTradeService } from './trade-service.js';

const config = readOtcApiConfig();
const runtime = readOtcApiRuntimeConfig();
assertOtcApiStartupConfig(config, runtime);

const repository = config.databaseUrl
  ? new PgOtcRepository(pgPoolAdapter(new pg.Pool({ connectionString: config.databaseUrl })))
  : new InMemoryOtcRepository();
const service = new OtcTradeService(
  repository,
  config,
  createConfiguredPearlEscrowAllocator(config, repository),
);
const processor = new NotificationDeliveryProcessor(repository, {
  emailProvider: createConfiguredEmailNotificationProvider(config),
  batchSize: config.notificationWorkerBatchSize ?? 50,
  maxAttempts: config.notificationWorkerMaxAttempts ?? 5,
  retryBaseMs: config.notificationRetryBaseMs ?? 60_000,
});

async function runOnce(): Promise<void> {
  const scannedDeadlines = await service.enqueueDeadlineWarningNotifications();
  const result = await processor.processPending();
  console.log(JSON.stringify({
    msg: 'otc notification worker iteration complete',
    ...result,
    scannedDeadlines,
  }));
}

await runOnce();

if ((config.notificationWorkerIntervalMs ?? 60_000) > 0) {
  setInterval(() => {
    runOnce().catch((error) => {
      console.error(JSON.stringify({
        msg: 'otc notification worker iteration failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }, config.notificationWorkerIntervalMs ?? 60_000);
}
