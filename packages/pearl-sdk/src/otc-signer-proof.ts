import type { PearlReleaseSigningMode } from './otc.js';

export type PearlSignerProofRole = 'buyer' | 'seller';

export interface PearlSignerProofMessageInput {
  quoteId: string;
  role: PearlSignerProofRole;
  pearlAddress: string;
  usdcAddress: string;
  pearlPubkey: string;
  releaseSigningMode: PearlReleaseSigningMode;
}

export function createPearlSignerProofMessage(input: PearlSignerProofMessageInput): string {
  return [
    'Pearl OTC signer proof v1',
    `quote_id=${input.quoteId}`,
    `role=${input.role}`,
    `pearl_address=${input.pearlAddress.trim()}`,
    `usdc_address=${input.usdcAddress.trim().toLowerCase()}`,
    `pearl_pubkey=${normalizeProofPubkey(input.pearlPubkey)}`,
    `release_signing_mode=${input.releaseSigningMode}`,
  ].join('\n');
}

export function normalizeProofPubkey(value: string): string {
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  return normalized;
}
