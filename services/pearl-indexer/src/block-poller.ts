import type { PearlRpcClient } from '@kaspacom/pearl-rpc';

export interface PearlBlockSummary {
  hash: string;
  height: number;
  previousHash?: string;
  txids: string[];
  timestamp: string;
}

export interface PearlBlockSource {
  getBlockCount(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlock(hash: string): Promise<PearlBlockSummary>;
}

export interface PearlBlockSink {
  saveBlock(block: PearlBlockSummary): Promise<void>;
}

export interface PollerState {
  nextHeight: number;
}

export interface PollerResult {
  fromHeight: number;
  toHeight: number;
  indexedBlocks: number;
  nextHeight: number;
}

export class PearlBlockPoller {
  private readonly source: PearlBlockSource;
  private readonly sink: PearlBlockSink;

  constructor(source: PearlBlockSource, sink: PearlBlockSink) {
    this.source = source;
    this.sink = sink;
  }

  async pollOnce(state: PollerState): Promise<PollerResult> {
    const tipHeight = await this.source.getBlockCount();
    const fromHeight = state.nextHeight;

    if (fromHeight > tipHeight) {
      return {
        fromHeight,
        toHeight: tipHeight,
        indexedBlocks: 0,
        nextHeight: fromHeight,
      };
    }

    let indexedBlocks = 0;
    for (let height = fromHeight; height <= tipHeight; height += 1) {
      const hash = await this.source.getBlockHash(height);
      const block = await this.source.getBlock(hash);
      await this.sink.saveBlock(block);
      indexedBlocks += 1;
    }

    return {
      fromHeight,
      toHeight: tipHeight,
      indexedBlocks,
      nextHeight: tipHeight + 1,
    };
  }
}

interface PearldVerboseBlock {
  hash: string;
  height: number;
  previousblockhash?: string;
  tx: string[];
  time: number;
}

export function createPearldBlockSource(client: PearlRpcClient): PearlBlockSource {
  return {
    getBlockCount: () => client.call<number>('getblockcount'),
    getBlockHash: (height) => client.call<string>('getblockhash', [height]),
    async getBlock(hash) {
      const block = await client.call<PearldVerboseBlock>('getblock', [hash, true]);
      return {
        hash: block.hash,
        height: block.height,
        previousHash: block.previousblockhash,
        txids: block.tx,
        timestamp: new Date(block.time * 1000).toISOString(),
      };
    },
  };
}

export class MemoryBlockSink implements PearlBlockSink {
  readonly blocks: PearlBlockSummary[] = [];

  async saveBlock(block: PearlBlockSummary): Promise<void> {
    this.blocks.push(block);
  }
}
