export interface PearlBlockHeader {
  hash: string;
  height: number;
  time: number;
  previousblockhash?: string;
  confirmations?: number;
}

export interface PearlRawTransaction {
  txid: string;
  hash?: string;
  confirmations?: number;
  blockhash?: string;
  time?: number;
  hex?: string;
}

export interface PearlChainTip {
  height: number;
  hash: string;
  observedAt: string;
}
