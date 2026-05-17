import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePearlAddress } from '../src/addresses.ts';

test('validates Pearl P2TR address prefixes used by upstream wallet', () => {
  assert.deepEqual(validatePearlAddress('prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na'), {
    address: 'prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na',
    valid: true,
    network: 'mainnet',
    type: 'p2tr',
  });
  assert.deepEqual(validatePearlAddress('tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef'), {
    address: 'tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef',
    valid: true,
    network: 'testnet2',
    type: 'p2tr',
  });
  assert.deepEqual(validatePearlAddress('rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v'), {
    address: 'rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v',
    valid: true,
    network: 'simnet',
    type: 'p2tr',
  });
});
