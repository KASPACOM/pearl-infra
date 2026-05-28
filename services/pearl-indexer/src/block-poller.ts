export interface PearlBlockOutput {
  txid: string;
  vout: number;
  amountGrains: string;
  scriptPubKey: {
    hex: string;
    type?: string;
    address?: string;
  };
}

export interface PearlBlockInput {
  txid: string;
  vin: number;
  spentOutpoint?: string;
  sequence?: number;
}

export interface PearlBlockSummary {
  hash: string;
  height: number;
  previousHash?: string;
  txids: string[];
  inputs: PearlBlockInput[];
  outputs: PearlBlockOutput[];
  timestamp: string;
}

export interface PearlBlockSource {
  getBlockCount(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlock(hash: string): Promise<PearlBlockSummary>;
}

interface PearlRpcCaller {
  call<T>(method: string, params?: unknown[]): Promise<T>;
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

interface PearldVerboseVout {
  value: number | string;
  n: number;
  scriptPubKey: {
    hex: string;
    type?: string;
    address?: string;
  };
}

interface PearldVerboseTx {
  txid: string;
  vin: Array<{
    txid?: string;
    vout?: number;
    sequence?: number;
    coinbase?: string;
  }>;
  vout: PearldVerboseVout[];
}

interface PearldVerboseBlock {
  hash: string;
  height: number;
  previousblockhash?: string;
  tx?: PearldVerboseTx[];
  rawtx?: PearldVerboseTx[];
  time: number;
}

function valueToGrains(value: number | string): string {
  // Pearl follows the Bitcoin 8-decimal convention: 1 PRL = 1e8 grains.
  // pearld returns the value as a number in some responses, a decimal string in
  // others. Parse via fixed-string to avoid floating-point rounding (a value of
  // 0.00000001 must round-trip exactly to 1n, not 0n).
  const str = typeof value === 'number' ? value.toFixed(8) : value;
  const [whole, fractionRaw = ''] = str.split('.');
  const fraction = (fractionRaw + '00000000').slice(0, 8);
  return (BigInt(whole) * 100_000_000n + BigInt(fraction)).toString();
}

export function createPearldBlockSource(client: PearlRpcCaller): PearlBlockSource {
  return {
    getBlockCount: () => client.call<number>('getblockcount'),
    getBlockHash: (height) => client.call<string>('getblockhash', [height]),
    async getBlock(hash) {
      // verbosity=2 returns full tx data with vout[] so the funding scanner can
      // match decoded P2TR addresses without a second RPC per tx.
      const block = await client.call<PearldVerboseBlock>('getblock', [hash, 2]);
      const txids: string[] = [];
      const inputs: PearlBlockInput[] = [];
      const outputs: PearlBlockOutput[] = [];
      const transactions = block.rawtx ?? block.tx;
      if (!Array.isArray(transactions)) {
        throw new Error('pearld getblock response missing tx/rawtx array');
      }
      for (const tx of transactions) {
        txids.push(tx.txid);
        for (let vin = 0; vin < tx.vin.length; vin += 1) {
          const input = tx.vin[vin];
          inputs.push({
            txid: tx.txid,
            vin,
            ...(input.txid !== undefined && input.vout !== undefined
              ? { spentOutpoint: `${input.txid}:${input.vout}` }
              : {}),
            ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
          });
        }
        for (const vout of tx.vout) {
          outputs.push({
            txid: tx.txid,
            vout: vout.n,
            amountGrains: valueToGrains(vout.value),
            scriptPubKey: {
              hex: vout.scriptPubKey.hex,
              type: vout.scriptPubKey.type,
              address: vout.scriptPubKey.address,
            },
          });
        }
      }
      return {
        hash: block.hash,
        height: block.height,
        previousHash: block.previousblockhash,
        txids,
        inputs,
        outputs,
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
