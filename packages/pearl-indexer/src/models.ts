export type PearlScriptType = 'p2tr' | 'p2mr' | 'op_return' | 'unknown';

export interface IndexedPearlBlock {
  hash: string;
  height: number;
  previousHash?: string;
  timestamp: string;
  txids: string[];
  indexedAt: string;
  detached?: boolean;
}

export interface IndexedPearlTransaction {
  txid: string;
  blockHash?: string;
  blockHeight?: number;
  confirmations: number;
  rawHex?: string;
  firstSeenAt: string;
  indexedAt: string;
}

export interface IndexedPearlInput {
  txid: string;
  inputIndex: number;
  spentTxid: string;
  spentVout: number;
}

export interface IndexedPearlOutput {
  txid: string;
  vout: number;
  valueGrains: string;
  scriptType: PearlScriptType;
  address?: string;
  scriptPubKeyHex: string;
  opReturnHex?: string;
  spentByTxid?: string;
  spentByInputIndex?: number;
  blockHeight?: number;
  confirmations: number;
}

export interface PearlChainTip {
  hash: string;
  height: number;
  observedAt: string;
}
