export type PearlEscrowTemplateKind = 'release' | 'refund' | 'dispute_release';

export interface PearlEscrowOutput {
  address: string;
  amountGrains: string;
  role: 'buyer' | 'seller' | 'fee' | 'refund';
}

export interface PearlEscrowTxTemplate {
  kind: PearlEscrowTemplateKind;
  unsignedTxHex?: string;
  psbtBase64?: string;
  outputs: PearlEscrowOutput[];
  lockTime?: number;
  sequence?: number;
}

export interface PearlEscrowSignature {
  signerRole: 'buyer' | 'seller' | 'arbiter' | 'desk';
  signerPubkey: string;
  templateKind: PearlEscrowTemplateKind;
  signatureHex: string;
  signedAt: string;
}

export interface PearlEscrowPackage {
  tradeId: string;
  network: 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';
  escrowAddress: string;
  escrowScriptType: 'p2tr';
  expectedAmountGrains: string;
  requiredConfirmations: number;
  refundEligibleAfterHeight?: number;
  refundEligibleAfterUnixTime?: number;
  releaseTemplate: PearlEscrowTxTemplate;
  refundTemplate: PearlEscrowTxTemplate;
  signatures: PearlEscrowSignature[];
  verification: {
    simnetVerified: boolean;
    verifiedAt?: string;
    verificationTxids?: string[];
  };
}
