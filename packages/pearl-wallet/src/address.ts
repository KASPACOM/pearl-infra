import { createPearlP2trPayment, type PearlScriptNetworkName } from '@kaspacom/pearl-script';

/**
 * Per BIP86, a Taproot address derived from a single key uses that key as the
 * internal pubkey (no script tree). Pearl follows BIP86 directly via
 * createPearlP2trPayment.
 *
 * Returns the bech32m-encoded Pearl address (prl1p... mainnet, tprl1p...
 * testnet/testnet2, rprl1p... simnet/regtest).
 */
export function pearlAddressFromXOnlyPubkey(
  xOnlyPubkey: Uint8Array,
  network: PearlScriptNetworkName,
): string {
  if (xOnlyPubkey.length !== 32) {
    throw new Error(`expected 32-byte x-only pubkey, got ${xOnlyPubkey.length} bytes`);
  }
  return createPearlP2trPayment({ network, internalPubkey: xOnlyPubkey }).address;
}
