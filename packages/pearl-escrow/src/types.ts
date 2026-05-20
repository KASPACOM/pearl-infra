import type { PearlScriptNetworkName } from '@kaspacom/pearl-script';

export type PearlEscrowScriptType = 'p2tr';
export type PearlEscrowTemplateKind = 'release' | 'refund';
export type PearlEscrowSignerRole = 'buyer' | 'seller' | 'arbiter' | 'desk';
export type PearlEscrowSideEffectAction = 'release' | 'refund';
export type PearlEscrowBroadcastStatus = 'prepared' | 'signed' | 'submitted' | 'confirmed' | 'failed';

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
    alternativeSignerSets?: PearlEscrowSignerRole[][];
    timelockSatisfied?: boolean;
  };
}

export interface PearlEscrowKeyMetadata {
  internalPubkeyHex: string;
  internalKeyPolicy?: 'bip341_nums_script_path_only';
  taprootOutputScriptHex: string;
  signerPubkeys: Partial<Record<PearlEscrowSignerRole, string>>;
  taprootScriptLeaves?: PearlEscrowTaprootScriptLeaf[];
}

export interface PearlEscrowTaprootScriptLeaf {
  kind: string;
  requiredSigners: PearlEscrowSignerRole[];
  scriptHex: string;
  leafVersion?: number;
  controlBlockHex?: string;
  lockTime?: number;
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

export interface PearlEscrowSignerPolicyInput {
  escrow: PearlEscrowPackage;
  action: PearlEscrowSideEffectAction;
  unsignedTx: PearlEscrowUnsignedTx;
  destinationAddress: string;
  feeGrains: string;
  feeCapGrains: string;
  policyVersion: string;
  decisionEventId: string;
  derivationPath?: string;
  signerKeyId?: string;
  observedStateHash: string;
}

export interface PearlEscrowSignerRequest {
  tradeId: string;
  action: PearlEscrowSideEffectAction;
  network: PearlScriptNetworkName;
  fundingOutpoint: string;
  unsignedTxHex: string;
  txTemplateHash: string;
  policyVersion: string;
  decisionEventId: string;
  idempotencyKey: string;
  derivationPath?: string;
  signerKeyId?: string;
  expected: {
    destinationAddress: string;
    feeGrains: string;
    feeCapGrains: string;
    outputAmountGrains: string;
    observedStateHash: string;
  };
  createdAt: string;
}

export interface PearlEscrowSignerResponse {
  tradeId: string;
  action: PearlEscrowSideEffectAction;
  idempotencyKey: string;
  signedTxHex: string;
  signedTxid: string;
  signerKeyId: string;
  signedAt: string;
}

export interface PearlEscrowBroadcastAttempt {
  tradeId: string;
  action: PearlEscrowSideEffectAction;
  idempotencyKey: string;
  status: PearlEscrowBroadcastStatus;
  attempt: number;
  signedTxid?: string;
  signedTxHex?: string;
  broadcastTxid?: string;
  error?: string;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
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

export interface CreatePearlMultisigEscrowPackageInput extends Omit<CreatePearlEscrowPackageInput, 'internalPubkey' | 'signerPubkeys'> {
  internalPubkey?: never;
  buyerPubkey: string | Uint8Array;
  sellerPubkey: string | Uint8Array;
  arbiterPubkey: string | Uint8Array;
}
