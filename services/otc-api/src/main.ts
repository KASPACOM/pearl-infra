import { InMemoryOtcRepository } from './repository.js';
import { OtcTradeService } from './trade-service.js';
import { readOtcApiConfig } from './config.js';
import { createOtcHttpServer } from './http.js';

const port = Number(process.env.OTC_API_PORT ?? 8080);
const service = new OtcTradeService(new InMemoryOtcRepository(), readOtcApiConfig());
const server = createOtcHttpServer(service);

server.listen(port, () => {
  console.log(JSON.stringify({ msg: 'otc-api listening', port }));
});
