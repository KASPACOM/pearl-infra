import type {
  PearlBlockOutput,
  PearlBlockSink,
  PearlBlockSummary,
  SaveBlockResult,
} from './block-poller.js';
import type { WatchedAddressRepository } from './watched-address-repository.js';
import type { WatchedAddress } from './watched-address-types.js';

export type FundingClassification =
  | 'on_time'
  | 'late'
  | 'underpaid'
  | 'overpaid'
  | 'duplicate'
  | 'unknown_funding';

export interface FundingMatch {
  watchId: string;
  outpoint: string;
  classification: FundingClassification;
}

export interface FundingScannerLog {
  msg: string;
  [key: string]: unknown;
}

export interface FundingScannerLogger {
  (entry: FundingScannerLog): void;
}

export interface FundingScannerSinkOptions {
  inner: PearlBlockSink;
  repo: WatchedAddressRepository;
  network: string;
  logger?: FundingScannerLogger;
}

/**
 * Composite sink: delegates block storage to `inner` (typically a PgBlockSink),
 * then matches block outputs against active watches and writes observations.
 * On `kind: 'reorg'` from inner, no match logic runs — the next pollOnce
 * iteration replays the fork point and the detached parent's observations are
 * marked detached via the block hash.
 */
export class FundingScannerSink implements PearlBlockSink {
  private readonly inner: PearlBlockSink;
  private readonly repo: WatchedAddressRepository;
  private readonly network: string;
  private readonly logger: FundingScannerLogger;

  constructor(options: FundingScannerSinkOptions) {
    this.inner = options.inner;
    this.repo = options.repo;
    this.network = options.network;
    this.logger = options.logger ?? defaultLogger;
  }

  async saveBlock(block: PearlBlockSummary): Promise<SaveBlockResult> {
    const result = await this.inner.saveBlock(block);

    if (result.kind === 'reorg') {
      if (result.indexedHash) {
        const detached = await this.repo.detachObservationsForBlock(result.indexedHash);
        if (detached > 0) {
          this.logger({
            msg: 'funding-scanner observations detached on reorg',
            blockHash: result.indexedHash,
            detached,
          });
        }
      }
      return result;
    }

    const matches: FundingMatch[] = [];
    for (const output of block.outputs) {
      const address = output.scriptPubKey.address;
      if (!address) continue;
      const watches = await this.repo.findActiveByAddress(this.network, address);
      for (const watch of watches) {
        const classification = classifyFunding(output, block, watch);
        const obs = await this.repo.recordObservation({
          outpoint: `${output.txid}:${output.vout}`,
          watchId: watch.watchId,
          blockHash: block.hash,
          height: block.height,
          amountGrains: output.amountGrains,
          classification,
        });
        matches.push({ watchId: watch.watchId, outpoint: obs.outpoint, classification });
      }
    }

    const advanced = await this.repo.advanceConfirmations(block.height);

    if (matches.length > 0 || advanced > 0) {
      this.logger({
        msg: 'funding-scanner block scan complete',
        network: this.network,
        height: block.height,
        matches,
        confirmationsAdvanced: advanced,
      });
    }

    return result;
  }
}

/**
 * Pure function: classify an observed output against its watch metadata.
 * `match_status` is set by the scanner's lifecycle path (always 'pending' at
 * insert; advanced by `advanceConfirmations`). This function only decides the
 * correctness verdict, which is frozen at observation time.
 */
export function classifyFunding(
  output: PearlBlockOutput,
  block: PearlBlockSummary,
  watch: WatchedAddress,
): FundingClassification {
  const expectedRaw = readStringMetadata(watch, 'expected_amount_grains');
  const deadlineHeight = readNumberMetadata(watch, 'pearl_funding_deadline_height');
  const deadlineTs = readStringMetadata(watch, 'pearl_funding_deadline_ts');

  const hasAmount = expectedRaw !== undefined;
  const hasDeadline = deadlineHeight !== undefined || deadlineTs !== undefined;
  if (!hasAmount || !hasDeadline) return 'unknown_funding';

  const observed = BigInt(output.amountGrains);
  const expected = BigInt(expectedRaw as string);

  const past = isPastDeadline(block, deadlineHeight, deadlineTs);
  if (past) return 'late';

  if (observed < expected) return 'underpaid';
  if (observed > expected) return 'overpaid';
  return 'on_time';
}

function isPastDeadline(
  block: PearlBlockSummary,
  deadlineHeight: number | undefined,
  deadlineTs: string | undefined,
): boolean {
  if (deadlineHeight !== undefined) {
    return block.height > deadlineHeight;
  }
  if (deadlineTs !== undefined) {
    return new Date(block.timestamp).getTime() > new Date(deadlineTs).getTime();
  }
  return false;
}

function readStringMetadata(watch: WatchedAddress, key: string): string | undefined {
  const v = watch.metadata?.[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function readNumberMetadata(watch: WatchedAddress, key: string): number | undefined {
  const v = watch.metadata?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

function defaultLogger(entry: FundingScannerLog): void {
  console.log(JSON.stringify(entry));
}
