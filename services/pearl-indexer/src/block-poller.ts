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

/**
 * Outcome of persisting a single block. `reorg` is the load-bearing case:
 * the sink detected that the new block's `previousHash` does not match the
 * indexed parent at `H-1` — the stale block has been marked detached and
 * the poller should restart fetching from `detachedFromHeight`.
 */
export type SaveBlockResult =
  | { kind: 'saved' }
  | { kind: 'duplicate' }
  | {
      kind: 'reorg';
      detachedFromHeight: number;
      indexedHash: string;
      newPreviousHash?: string;
    };

export interface PearlBlockSink {
  saveBlock(block: PearlBlockSummary): Promise<SaveBlockResult>;
}

export interface PollerState {
  nextHeight: number;
}

export interface PollerResult {
  fromHeight: number;
  toHeight: number;
  indexedBlocks: number;
  nextHeight: number;
  reorgDetected?: boolean;
  reorgDetachedFromHeight?: number;
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
      const result = await this.sink.saveBlock(block);

      if (result.kind === 'reorg') {
        // Sink marked the stale parent detached. Restart from the fork point;
        // the next pollOnce() iteration will re-fetch that height and either
        // succeed (shallow reorg) or detect a deeper mismatch, unwinding one
        // block at a time until the chains converge.
        return {
          fromHeight,
          toHeight: height - 1,
          indexedBlocks,
          nextHeight: result.detachedFromHeight,
          reorgDetected: true,
          reorgDetachedFromHeight: result.detachedFromHeight,
        };
      }

      if (result.kind === 'saved') {
        indexedBlocks += 1;
      }
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

  async saveBlock(block: PearlBlockSummary): Promise<SaveBlockResult> {
    this.blocks.push(block);
    return { kind: 'saved' };
  }
}
