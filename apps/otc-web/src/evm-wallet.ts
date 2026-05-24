import { BrowserProvider, getAddress, type TransactionRequest } from 'ethers';

export interface EvmWalletSnapshot {
  connected: boolean;
  address?: string;
  chainId?: number;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void;
  removeListener?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void;
}

export function hasInjectedEvmWallet(): boolean {
  return Boolean(getInjectedProvider());
}

export async function connectInjectedEvmWallet(): Promise<EvmWalletSnapshot> {
  const provider = getRequiredInjectedProvider();
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = parseFirstAccount(accounts);
  return readInjectedEvmWallet(address);
}

export async function readInjectedEvmWallet(knownAddress?: string): Promise<EvmWalletSnapshot> {
  const provider = getInjectedProvider();
  if (!provider) {
    return { connected: false };
  }

  const [accounts, chainId] = await Promise.all([
    provider.request({ method: 'eth_accounts' }),
    provider.request({ method: 'eth_chainId' }),
  ]);
  const address = knownAddress ?? parseFirstAccount(accounts);
  return {
    connected: Boolean(address),
    ...(address ? { address } : {}),
    chainId: parseChainId(chainId),
  };
}

export async function switchInjectedEvmChain(chainId: number): Promise<void> {
  const provider = getRequiredInjectedProvider();
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: toHexChainId(chainId) }],
  });
}

export async function sendInjectedEvmTransaction(request: TransactionRequest): Promise<string> {
  const provider = new BrowserProvider(getRequiredInjectedProvider());
  const signer = await provider.getSigner();
  const response = await signer.sendTransaction(request);
  return response.hash;
}

export async function sendAndWaitInjectedEvmTransaction(request: TransactionRequest, expectedFrom?: string): Promise<string> {
  const provider = new BrowserProvider(getRequiredInjectedProvider());
  const signer = expectedFrom ? await provider.getSigner(expectedFrom) : await provider.getSigner();
  const response = await signer.sendTransaction({
    ...request,
    ...(expectedFrom ? { from: expectedFrom } : {}),
  });
  await response.wait(1);
  return response.hash;
}

export async function signInjectedEvmMessage(message: string, expectedAddress?: string): Promise<string> {
  const provider = new BrowserProvider(getRequiredInjectedProvider());
  const signer = expectedAddress ? await provider.getSigner(expectedAddress) : await provider.getSigner();
  return signer.signMessage(message);
}

export function subscribeInjectedEvmWalletChanges(listener: () => void): () => void {
  const provider = getInjectedProvider();
  if (!provider?.on || !provider.removeListener) {
    return () => undefined;
  }
  const wrapped = () => listener();
  provider.on('accountsChanged', wrapped);
  provider.on('chainChanged', wrapped);
  return () => {
    provider.removeListener?.('accountsChanged', wrapped);
    provider.removeListener?.('chainChanged', wrapped);
  };
}

function getRequiredInjectedProvider(): Eip1193Provider {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error('No injected EVM wallet found.');
  }
  return provider;
}

function getInjectedProvider(): Eip1193Provider | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

function parseFirstAccount(value: unknown): string | undefined {
  if (!Array.isArray(value) || typeof value[0] !== 'string') {
    return undefined;
  }
  return getAddress(value[0]);
}

function parseChainId(value: unknown): number | undefined {
  if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
    return Number.parseInt(value, 16);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  return undefined;
}

function toHexChainId(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('chainId must be a positive safe integer');
  }
  return `0x${chainId.toString(16)}`;
}
