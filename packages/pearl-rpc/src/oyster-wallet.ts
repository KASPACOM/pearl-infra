import { Transaction } from 'bitcoinjs-lib';

import type { PearlRpcClient } from './rpc-client.js';

type PearlRpcCaller = Pick<PearlRpcClient, 'call'>;

export interface OysterWalletAddressInfo {
  isvalid: boolean;
  address: string;
  ismine?: boolean;
  pubkey?: string;
  iscompressed?: boolean;
  account?: string;
}

export interface OysterSignedRawTransaction {
  hex: string;
  complete: boolean;
  errors?: unknown[];
}

export interface OysterListUnspentOutput {
  txid: string;
  vout: number;
  address?: string;
  account?: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
}

export interface OysterWalletSignerClientOptions {
  signerKeyId: string;
  passphrase?: string;
  unlockSeconds?: number;
}

export class OysterWalletRpcClient {
  private readonly client: PearlRpcCaller;

  constructor(client: PearlRpcCaller) {
    this.client = client;
  }

  getNewAddress(account = 'default'): Promise<string> {
    return this.client.call<string>('getnewaddress', [account]);
  }

  getBalance(account = 'default', minConfirmations = 1): Promise<number> {
    return this.client.call<number>('getbalance', [account, minConfirmations]);
  }

  validateAddress(address: string): Promise<OysterWalletAddressInfo> {
    assertNonEmpty(address, 'address');
    return this.client.call<OysterWalletAddressInfo>('validateaddress', [address]);
  }

  listUnspent(input: {
    minConfirmations?: number;
    maxConfirmations?: number;
    addresses?: readonly string[];
  } = {}): Promise<readonly OysterListUnspentOutput[]> {
    return this.client.call<OysterListUnspentOutput[]>('listunspent', [
      input.minConfirmations ?? 1,
      input.maxConfirmations ?? 9999999,
      input.addresses ? [...input.addresses] : [],
    ]);
  }

  unlock(passphrase: string, timeoutSeconds: number): Promise<void> {
    assertNonEmpty(passphrase, 'passphrase');
    assertPositiveInteger(timeoutSeconds, 'timeoutSeconds');
    return this.client.call<void>('walletpassphrase', [passphrase, timeoutSeconds]);
  }

  lock(): Promise<void> {
    return this.client.call<void>('walletlock', []);
  }

  sendMany(input: {
    outputs: Record<string, number>;
    account?: string;
    feeRatePerKb?: number;
    minConfirmations?: number;
    comment?: string;
  }): Promise<string> {
    assertOutputs(input.outputs);
    return this.client.call<string>('sendmany', [
      input.account ?? 'default',
      input.outputs,
      input.feeRatePerKb ?? 0.0001,
      input.minConfirmations ?? 1,
      input.comment ?? '',
    ]);
  }

  signRawTransactionWithWallet(unsignedTxHex: string): Promise<OysterSignedRawTransaction> {
    assertHex(unsignedTxHex, 'unsignedTxHex');
    return this.client.call<OysterSignedRawTransaction>('signrawtransactionwithwallet', [unsignedTxHex]);
  }
}

export class OysterWalletSignerClient {
  private readonly wallet: OysterWalletRpcClient;
  private readonly signerKeyId: string;
  private readonly passphrase?: string;
  private readonly unlockSeconds: number;

  constructor(wallet: OysterWalletRpcClient, options: OysterWalletSignerClientOptions) {
    assertNonEmpty(options.signerKeyId, 'signerKeyId');
    this.wallet = wallet;
    this.signerKeyId = options.signerKeyId;
    this.passphrase = options.passphrase;
    this.unlockSeconds = options.unlockSeconds ?? 30;
  }

  async sign(request: {
    tradeId: string;
    action: 'release' | 'refund';
    idempotencyKey: string;
    unsignedTxHex: string;
  }): Promise<{
    tradeId: string;
    action: 'release' | 'refund';
    idempotencyKey: string;
    signedTxHex: string;
    signedTxid: string;
    signerKeyId: string;
    signedAt: string;
  }> {
    if (this.passphrase) {
      await this.wallet.unlock(this.passphrase, this.unlockSeconds);
    }
    try {
      const signed = await this.wallet.signRawTransactionWithWallet(request.unsignedTxHex);
      if (!signed.complete) {
        throw new Error('oyster wallet did not sign every input');
      }
      assertHex(signed.hex, 'signed.hex');
      return {
        tradeId: request.tradeId,
        action: request.action,
        idempotencyKey: request.idempotencyKey,
        signedTxHex: signed.hex,
        signedTxid: txidFromSignedHex(signed.hex),
        signerKeyId: this.signerKeyId,
        signedAt: new Date().toISOString(),
      };
    } finally {
      if (this.passphrase) {
        await this.wallet.lock();
      }
    }
  }
}

function txidFromSignedHex(signedTxHex: string): string {
  return Transaction.fromHex(signedTxHex).getId();
}

function assertOutputs(outputs: Record<string, number>): void {
  if (!outputs || typeof outputs !== 'object' || Object.keys(outputs).length === 0) {
    throw new Error('outputs must contain at least one destination');
  }
  for (const [address, amount] of Object.entries(outputs)) {
    assertNonEmpty(address, 'output address');
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`output amount must be positive for ${address}`);
    }
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be non-empty`);
  }
}

function assertHex(value: string, field: string): void {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!normalized || !/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${field} must be non-empty even-length hex`);
  }
}
