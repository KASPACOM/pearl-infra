import { address as bitcoinAddress } from 'bitcoinjs-lib';

export interface PearlAddressValidation {
  address: string;
  valid: boolean;
  network?: 'mainnet' | 'simnet' | 'testnet' | 'testnet2' | 'regtest';
  type?: 'p2tr';
  reason?: string;
}

export function validatePearlAddress(address: string): PearlAddressValidation {
  const normalized = address.trim();
  if (!normalized) {
    return { address, valid: false, reason: 'empty address' };
  }

  try {
    const decoded = bitcoinAddress.fromBech32(normalized);
    const network = networkFromPrefix(decoded.prefix);
    if (!network) {
      return { address: normalized, valid: false, reason: `unsupported Pearl prefix: ${decoded.prefix}` };
    }
    if (decoded.version !== 1) {
      return { address: normalized, valid: false, reason: `expected Taproot witness version 1, got ${decoded.version}` };
    }
    if (decoded.data.length !== 32) {
      return { address: normalized, valid: false, reason: `expected 32-byte Taproot program, got ${decoded.data.length}` };
    }

    return { address: normalized, valid: true, network, type: 'p2tr' };
  } catch (error) {
    return {
      address: normalized,
      valid: false,
      reason: error instanceof Error ? error.message : 'invalid Bech32m address',
    };
  }
}

function networkFromPrefix(prefix: string): PearlAddressValidation['network'] | undefined {
  switch (prefix) {
    case 'prl':
      return 'mainnet';
    case 'tprl':
      return 'testnet2';
    case 'rprl':
      return 'simnet';
    default:
      return undefined;
  }
}
