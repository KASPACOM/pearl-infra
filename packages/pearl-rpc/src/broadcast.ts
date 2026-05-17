import type { PearlRpcClient } from './rpc-client.js';

type PearlRpcCaller = Pick<PearlRpcClient, 'call'>;

export interface PearlTransactionBroadcaster {
  sendRawTransaction(signedTxHex: string): Promise<string>;
}

export class PearlRpcTransactionBroadcaster implements PearlTransactionBroadcaster {
  private readonly client: PearlRpcCaller;

  constructor(client: PearlRpcCaller) {
    this.client = client;
  }

  async sendRawTransaction(signedTxHex: string): Promise<string> {
    assertHex(signedTxHex, 'signedTxHex');
    return this.client.call<string>('sendrawtransaction', [signedTxHex]);
  }
}

function assertHex(value: string, field: string): void {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!normalized || !/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${field} must be non-empty even-length hex`);
  }
}
