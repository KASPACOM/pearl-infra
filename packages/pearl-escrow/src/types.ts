import type { PearlScriptNetworkName } from '@kaspacom/pearl-script';

export type PearlEscrowScriptType = 'p2tr';
export type PearlEscrowTemplateKind = 'release' | 'refund';
export type PearlEscrowSignerRole = 'buyer' | 'seller' | 'arbiter' | 'desk';

export interface PearlEscrowOutput {
  address: string;
  amountGrains: string;
  role: 'buyer' | 'seller' | 'fee' | 'refund';
}

export interface PearlEscrowInputTemplate {
  outpoint?: string;
  amountGrains: string;
  sequence?: number;
}

export interface PearlEscrowTxTemplate {
  kind: PearlEscrowTemplateKind;
  inputs: PearlEscrowInputTemplate[];
  outputs: PearlEscrowOutput[];
  lockTime?: number;
  psbtBase64?: string;
  unsignedTxHex?: string;
  signingPolicy: {
    path: 'taproot_key_path' | 'taproot_script_path';
    requiredSigners: PearlEscrowSignerRole[];
    timelockSatisfied?: boolean;
  };
}

export interface PearlEscrowKeyMetadata {
  internalPubkeyHex: string;
  taprootOutputScriptHex: string;
  signerPubkeys: Partial<Record<PearlEscrowSignerRole, string>>;
}

export interface PearlEscrowPackage {
  tradeId: string;
  network: PearlScriptNetworkName;
  escrowAddress: string;
  escrowScriptType: PearlEscrowScriptType;
  expectedAmountGrains: string;
  requiredConfirmations: number;
  fundingOutpoint?: string;
  refundEligibleAfterHeight?: number;
  refundEligibleAfterUnixTime?: number;
  releaseTemplate: PearlEscrowTxTemplate;
  refundTemplate: PearlEscrowTxTemplate;
  keys: PearlEscrowKeyMetadata;
  createdAt: string;
  verification: {
    simnetVerified: boolean;
    verifiedAt?: string;
    verificationTxids?: string[];
  };
}

export interface PearlEscrowFundingCandidate {
  txid: string;
  vout: number;
  amountGrains: string;
  address?: string;
  scriptPubKeyHex?: string;
  blockHeight?: number;
  confirmations?: number;
}

export interface PearlEscrowFundingMatch {
  matched: boolean;
  status: 'matched' | 'underpaid' | 'overpaid' | 'script_mismatch' | 'outpoint_mismatch';
  outpoint: string;
  expectedAmountGrains: string;
  observedAmountGrains: string;
  scriptPubKeyHex?: string;
  blockHeight?: number;
  confirmations?: number;
}

export interface CreatePearlEscrowUnsignedTxInput {
  escrow: PearlEscrowPackage;
  kind: PearlEscrowTemplateKind;
  feeGrains?: string;
  sequence?: number;
}

export interface PearlEscrowUnsignedTx {
  kind: PearlEscrowTemplateKind;
  unsignedTxHex: string;
  inputOutpoint: string;
  inputAmountGrains: string;
  outputAmountGrains: string;
  feeGrains: string;
  lockTime: number;
}

export interface CreatePearlEscrowPackageInput {
  tradeId: string;
  network: PearlScriptNetworkName;
  internalPubkey: string | Uint8Array;
  expectedAmountGrains: string;
  requiredConfirmations: number;
  releaseAddress: string;
  refundAddress: string;
  fundingOutpoint?: string;
  refundEligibleAfterHeight?: number;
  refundEligibleAfterUnixTime?: number;
  signerPubkeys?: Partial<Record<PearlEscrowSignerRole, string>>;
  createdAt?: string;
  allowMainnet?: boolean;
}
