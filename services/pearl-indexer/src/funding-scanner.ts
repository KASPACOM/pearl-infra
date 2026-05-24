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
  | 'reorged'
  | 'unknown_funding';

export interface FundingMatch {
  watchId: string;
  outpoint: string;
  classification: FundingClassification;
}

export type SpendClassification = 'release' | 'refund' | 'exit_release' | 'unknown_spend';

export interface SpendMatch {
  watchId: string;
  spentOutpoint: string;
  spendTxid: string;
  classification: string;
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
    if (result.kind === 'duplicate') {
      return result;
    }

    const matches: FundingMatch[] = [];
    for (const output of block.outputs) {
      const address = output.scriptPubKey.address;
      if (!address) continue;
      const watches = await this.repo.findActiveByAddress(this.network, address);
      for (const watch of watches) {
        const outpoint = `${output.txid}:${output.vout}`;
        const hasPriorLiveObservation = await this.hasPriorLiveObservation(watch, outpoint);
        const classification = hasPriorLiveObservation ? 'duplicate' : classifyFunding(output, block, watch);
        const obs = await this.repo.recordObservation({
          outpoint,
          watchId: watch.watchId,
          blockHash: block.hash,
          height: block.height,
          amountGrains: output.amountGrains,
          classification,
        });
        matches.push({ watchId: watch.watchId, outpoint: obs.outpoint, classification });
      }
    }

    const spendMatches = await this.scanSpends(block);
    const advanced = await this.repo.advanceConfirmations(block.height);

    if (matches.length > 0 || spendMatches.length > 0 || advanced > 0) {
      this.logger({
        msg: 'funding-scanner block scan complete',
        network: this.network,
        height: block.height,
        matches,
        spendMatches,
        confirmationsAdvanced: advanced,
      });
    }

    return result;
  }

  private async hasPriorLiveObservation(watch: WatchedAddress, outpoint: string): Promise<boolean> {
    const history = await this.repo.get(watch.watchId);
    return Boolean(history?.observations.some((observation) => (
      observation.outpoint !== outpoint && observation.matchStatus !== 'detached'
    )));
  }

  private async scanSpends(block: PearlBlockSummary): Promise<SpendMatch[]> {
    const matches: SpendMatch[] = [];
    for (const input of block.inputs) {
      if (!input.spentOutpoint) continue;
      const observed = await this.repo.findObservedOutpoint(input.spentOutpoint);
      if (!observed) continue;

      const spendingOutputs = block.outputs.filter((output) => output.txid === input.txid);
      const classified = classifySpend({
        watch: observed.watch,
        spendTxid: input.txid,
        spentOutpoint: input.spentOutpoint,
        spendingOutputs,
      });
      const spend = await this.repo.recordSpend({
        spendTxid: input.txid,
        spentOutpoint: input.spentOutpoint,
        blockHash: block.hash,
        height: block.height,
        classification: classified.classification,
        classificationData: classified.classificationData,
      });
      matches.push({
        watchId: observed.watch.watchId,
        spentOutpoint: input.spentOutpoint,
        spendTxid: input.txid,
        classification: spend.classification,
      });
    }
    return matches;
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
  const deadlineHeight =
    readNumberMetadata(watch, 'pearl_funding_deadline_height') ??
    readNumberMetadata(watch, 'expiry_height');
  const deadlineTs =
    readStringMetadata(watch, 'pearl_funding_deadline_ts') ??
    readStringMetadata(watch, 'pearl_funding_deadline') ??
    readStringMetadata(watch, 'expiry_ts');

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

export function classifySpend(input: {
  watch: WatchedAddress;
  spendTxid: string;
  spentOutpoint: string;
  spendingOutputs: PearlBlockOutput[];
}): { classification: SpendClassification; classificationData: Record<string, unknown> } {
  if (input.watch.purpose === 'bridge_reserve') {
    return classifyBridgeReserveSpend(input.watch, input.spentOutpoint, input.spendingOutputs);
  }

  if (input.watch.purpose !== 'otc_escrow') {
    return {
      classification: 'unknown_spend',
      classificationData: {
        reason: 'unsupported_watch_purpose',
        purpose: input.watch.purpose,
      },
    };
  }

  const txidMatch = classifyByExpectedTxid(input.watch, input.spendTxid);
  const releaseMatch = outputMatchesExpected(input.watch, 'release', input.spendingOutputs);
  const refundMatch = outputMatchesExpected(input.watch, 'refund', input.spendingOutputs);
  if (txidMatch) {
    const expectedMatch = txidMatch === 'release' ? releaseMatch : refundMatch;
    const oppositeMatch = txidMatch === 'release' ? refundMatch : releaseMatch;
    if (expectedMatch.matched && !oppositeMatch.matched) {
      return {
        classification: txidMatch,
        classificationData: {
          matchedBy: `${txidMatch}_txid_and_${expectedMatch.matchedBy}`,
          spendTxid: input.spendTxid,
          output: expectedMatch.output,
        },
      };
    }
    return {
      classification: 'unknown_spend',
      classificationData: {
        reason: expectedMatch.matched && oppositeMatch.matched ? 'ambiguous_template_match' : 'txid_output_policy_mismatch',
        matchedTxidKind: txidMatch,
        spentOutpoint: input.spentOutpoint,
        spendTxid: input.spendTxid,
      },
    };
  }

  if (releaseMatch.matched && !refundMatch.matched) {
    return {
      classification: 'release',
      classificationData: {
        matchedBy: releaseMatch.matchedBy,
        output: releaseMatch.output,
      },
    };
  }
  if (refundMatch.matched && !releaseMatch.matched) {
    return {
      classification: 'refund',
      classificationData: {
        matchedBy: refundMatch.matchedBy,
        output: refundMatch.output,
      },
    };
  }

  return {
    classification: 'unknown_spend',
    classificationData: {
      reason: releaseMatch.matched && refundMatch.matched ? 'ambiguous_template_match' : 'no_release_or_refund_template_match',
      spentOutpoint: input.spentOutpoint,
      spendTxid: input.spendTxid,
    },
  };
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

function classifyByExpectedTxid(
  watch: WatchedAddress,
  spendTxid: string,
): SpendClassification | undefined {
  if (readStringMetadata(watch, 'release_txid') === spendTxid) return 'release';
  if (readStringMetadata(watch, 'pearl_release_txid') === spendTxid) return 'release';
  if (readStringMetadata(watch, 'refund_txid') === spendTxid) return 'refund';
  if (readStringMetadata(watch, 'pearl_refund_txid') === spendTxid) return 'refund';
  return undefined;
}

function classifyBridgeReserveSpend(
  watch: WatchedAddress,
  spentOutpoint: string,
  outputs: PearlBlockOutput[],
): { classification: SpendClassification; classificationData: Record<string, unknown> } {
  const changeAddresses = new Set(
    [
      watch.address,
      readStringMetadata(watch, 'reserve_address'),
      readStringMetadata(watch, 'change_address'),
      readStringMetadata(watch, 'reserve_change_address'),
    ].filter((address): address is string => Boolean(address)),
  );
  const externalOutputs = outputs.filter((output) => {
    const address = output.scriptPubKey.address;
    return address && !changeAddresses.has(address);
  });
  if (externalOutputs.length !== 1) {
    return {
      classification: 'unknown_spend',
      classificationData: {
        reason: externalOutputs.length === 0 ? 'no_external_release_output' : 'ambiguous_external_release_outputs',
        spentOutpoint,
        externalOutputCount: externalOutputs.length,
      },
    };
  }

  const output = externalOutputs[0];
  return {
    classification: 'exit_release',
    classificationData: {
      matchedBy: 'single_external_reserve_output',
      amount_grains: output.amountGrains,
      pearl_recipient: output.scriptPubKey.address,
      output: {
        txid: output.txid,
        vout: output.vout,
        address: output.scriptPubKey.address,
        amountGrains: output.amountGrains,
      },
    },
  };
}

function outputMatchesExpected(
  watch: WatchedAddress,
  kind: 'release' | 'refund',
  outputs: PearlBlockOutput[],
): { matched: boolean; matchedBy?: string; output?: Record<string, unknown> } {
  const expected = readExpectedOutputs(watch, kind);
  for (const candidate of expected) {
    const match = outputs.find((output) => {
      const addressMatches = candidate.address === undefined || output.scriptPubKey.address === candidate.address;
      const amountMatches = outputAmountMatches(output.amountGrains, candidate);
      return addressMatches && amountMatches;
    });
    if (match) {
      return {
        matched: true,
        matchedBy: candidate.source,
        output: {
          txid: match.txid,
          vout: match.vout,
          address: match.scriptPubKey.address,
          amountGrains: match.amountGrains,
        },
      };
    }
  }
  return { matched: false };
}

function readExpectedOutputs(
  watch: WatchedAddress,
  kind: 'release' | 'refund',
): ExpectedSpendOutput[] {
  const directKeys = kind === 'release'
    ? ['release_address', 'release_destination_address', 'buyer_pearl_address', 'buyerPearlAddress']
    : ['refund_address', 'refund_destination_address', 'seller_pearl_refund_address', 'sellerPearlRefundAddress'];
  const directBounds = readDirectSpendAmountBounds(watch, kind);
  const direct = directKeys
    .map((key) => readStringMetadata(watch, key))
    .filter((address): address is string => Boolean(address))
    .flatMap((address) => directBounds
      ? [{ source: `${kind}_address`, address, ...directBounds }]
      : []);

  const templateKeys = kind === 'release'
    ? ['release_template', 'releaseTemplate']
    : ['refund_template', 'refundTemplate'];
  const templateOutputs = templateKeys.flatMap((key) => readTemplateOutputs(watch.metadata?.[key], `${kind}_template`));
  return [...direct, ...templateOutputs];
}

interface ExpectedSpendOutput {
  source: string;
  address?: string;
  amountGrains?: string;
  minAmountGrains?: string;
  maxAmountGrains?: string;
}

function readDirectSpendAmountBounds(
  watch: WatchedAddress,
  kind: 'release' | 'refund',
): Pick<ExpectedSpendOutput, 'minAmountGrains' | 'maxAmountGrains'> | undefined {
  const minAmountGrains = readStringMetadata(watch, `${kind}_amount_min_grains`);
  const maxAmountGrains = readStringMetadata(watch, `${kind}_amount_max_grains`);
  if (!minAmountGrains || !maxAmountGrains) return undefined;
  if (!isUnsignedIntegerString(minAmountGrains) || !isUnsignedIntegerString(maxAmountGrains)) return undefined;
  if (BigInt(minAmountGrains) > BigInt(maxAmountGrains)) return undefined;
  return { minAmountGrains, maxAmountGrains };
}

function outputAmountMatches(outputAmountGrains: string, expected: ExpectedSpendOutput): boolean {
  if (expected.amountGrains !== undefined) return outputAmountGrains === expected.amountGrains;
  if (expected.minAmountGrains === undefined || expected.maxAmountGrains === undefined) return false;
  if (!isUnsignedIntegerString(outputAmountGrains)) return false;
  const amount = BigInt(outputAmountGrains);
  return amount >= BigInt(expected.minAmountGrains) && amount <= BigInt(expected.maxAmountGrains);
}

function isUnsignedIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

function readTemplateOutputs(value: unknown, source: string): ExpectedSpendOutput[] {
  if (!value || typeof value !== 'object') return [];
  const outputs = (value as { outputs?: unknown }).outputs;
  if (!Array.isArray(outputs)) return [];
  return outputs.flatMap((output) => {
    if (!output || typeof output !== 'object') return [];
    const raw = output as Record<string, unknown>;
    const address = typeof raw.address === 'string' && raw.address.length > 0 ? raw.address : undefined;
    const amountRaw = raw.amountGrains ?? raw.amount_grains;
    const amountGrains = typeof amountRaw === 'string' && amountRaw.length > 0
      ? amountRaw
      : typeof amountRaw === 'number'
        ? String(amountRaw)
        : undefined;
    if (!address && !amountGrains) return [];
    return [{ source, ...(address ? { address } : {}), ...(amountGrains ? { amountGrains } : {}) }];
  });
}

function defaultLogger(entry: FundingScannerLog): void {
  console.log(JSON.stringify(entry));
}
