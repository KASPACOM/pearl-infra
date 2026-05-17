import pg from 'pg';

import { InMemoryOtcRepository, PgOtcRepository } from './repository.js';
import { OtcTradeService } from './trade-service.js';
import { readOtcApiConfig } from './config.js';
import { createOtcHttpServer } from './http.js';
import { pgPoolAdapter } from './postgres.js';
import { EthersUsdcEscrowReader } from './usdc-escrow-reader.js';

const port = Number(process.env.OTC_API_PORT ?? 8080);
const config = readOtcApiConfig();
const repository = config.databaseUrl
  ? new PgOtcRepository(pgPoolAdapter(new pg.Pool({ connectionString: config.databaseUrl })))
  : new InMemoryOtcRepository();
const usdcEscrowReader = config.baseRpcUrl
  ? new EthersUsdcEscrowReader(config.baseRpcUrl, config.baseEscrowContract)
  : undefined;
const service = new OtcTradeService(repository, config, undefined, usdcEscrowReader);
const server = createOtcHttpServer(service);

server.listen(port, () => {
  console.log(
    JSON.stringify({
      msg: 'otc-api listening',
      port,
      persistence: config.databaseUrl ? 'postgres' : 'memory',
      usdcEscrowReader: config.baseRpcUrl ? 'ethers' : 'disabled',
    }),
  );
});
