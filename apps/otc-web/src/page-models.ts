import type {
  OtcQuote,
  OtcQuoteSide,
  OtcTrade,
  PearlEscrowMode,
  PearlReleaseSigningMode,
  PublicTradeProof,
  TradeEvent,
  TradeState,
} from '@kaspacom/pearl-sdk';

import type { CreateQuoteRequest } from './otc-api-client.js';

export type QuoteRole = 'buyer' | 'seller' | 'admin';
export type StateFamily = 'happy' | 'pending' | 'refund' | 'terminal_neutral' | 'manual_review';
export type DeadlineStatus = 'open' | 'closed';
export type DepositActionKind = 'connect_wallet' | 'switch_network' | 'deposit_usdc' | 'deposit_confirmed' | 'blocked';

export interface QuoteFormInput {
  side: OtcQuoteSide;
  amountPrl: string;
  buyerPearlAddress: string;
  usdcRefundAddress: string;
  clientRequestId: string;
}

export interface QuotePageModel {
  tabs: Array<{ side: OtcQuoteSide; label: string; selected: boolean }>;
  lockedSettlement: { asset: 'USDC'; network: 'base' };
  errors: Partial<Record<keyof QuoteFormInput, string>>;
  canSubmit: boolean;
  request?: CreateQuoteRequest;
}

export interface AcceptQuoteFormInput {
  buyerPearlAddress: string;
  buyerUsdcAddress: string;
  sellerPearlRefundAddress?: string;
  sellerUsdcReceiveAddress?: string;
  pearlEscrowMode?: PearlEscrowMode;
  pearlReleaseSigningMode?: PearlReleaseSigningMode;
  buyerPearlPubkey?: string;
  sellerPearlPubkey?: string;
  buyerPearlPubkeyProof?: string;
  sellerPearlPubkeyProof?: string;
  clientRequestId: string;
}

export interface AcceptQuotePageModel {
  role: QuoteRole;
  sellerFieldsVisible: boolean;
  quoteExpired: boolean;
  errors: Partial<Record<keyof AcceptQuoteFormInput, string>>;
  canAccept: boolean;
  summary: QuoteSummaryModel;
}

export interface QuoteSummaryModel {
  quoteId: string;
  side: OtcQuoteSide;
  amountPrl: string;
  amountUsdc: string;
  feePrl: string;
  feeUsdc: string;
  priceUsdcPerPrl: string;
  expiresAt: string;
}

export interface DeadlineModel {
  key: keyof OtcTrade['deadlines'];
  label: string;
  iso: string;
  status: DeadlineStatus;
  msRemaining: number;
}

export interface StateBadgeModel {
  state: TradeState;
  label: string;
  family: StateFamily;
}

export interface FailureBannerModel {
  state: TradeState;
  severity: 'warning' | 'danger';
  headline: string;
  supportHref: string;
}

export interface UsdcVerificationModel {
  verified: boolean;
  depositAllowed: boolean;
  mismatches: string[];
}

export interface WalletModel {
  connected: boolean;
  chainId?: number;
  address?: string;
}

export interface TradeCheckoutPageModel {
  tradeId: string;
  stateBadge: StateBadgeModel;
  failureBanner?: FailureBannerModel;
  deadlines: DeadlineModel[];
  pearl: {
    network: OtcTrade['pearlEscrow']['network'];
    escrowAddress: string;
    expectedAmountGrains: string;
    requiredConfirmations: number;
    fundingOutpoint?: string;
    releaseTxid?: string;
    refundTxid?: string;
    escrowMode?: PearlEscrowMode;
    releaseSigningMode?: PearlReleaseSigningMode;
    signerSets: string[];
    statusLabel: string;
  };
  base: {
    network: OtcTrade['usdcEscrow']['network'];
    chainId: number;
    contract: string;
    tradeKey: string;
    expectedAmountMicros: string;
    requiredConfirmations: number;
    depositTxHash?: string;
    releaseTxHash?: string;
    refundTxHash?: string;
    depositAction: { kind: DepositActionKind; label: string; disabled: boolean; reason?: string };
    statusPills: Array<{ label: string; status: 'ok' | 'warning' | 'blocked' }>;
  };
  timeline: TimelineEventModel[];
  releaseActionsVisible: false;
}

export interface PublicProofPageModel {
  tradeId: string;
  stateBadge: StateBadgeModel;
  failureBanner?: FailureBannerModel;
  quote: PublicTradeProof['quote'];
  deadlines: DeadlineModel[];
  pearl: PublicTradeProof['pearl'];
  base: PublicTradeProof['base'];
  timeline: TimelineEventModel[];
  actionsVisible: false;
}

export interface TimelineEventModel {
  label: string;
  observedAt: string;
  chain: 'pearl' | 'base' | 'system';
  txHash?: string;
  outpoint?: string;
  confirmations?: number;
}

const STATE_META: Record<TradeState, Omit<StateBadgeModel, 'state'>> = {
  quoted: { label: 'Quoted', family: 'pending' },
  quote_expired: { label: 'Quote expired', family: 'terminal_neutral' },
  pearl_escrow_pending: { label: 'Awaiting PRL funding', family: 'pending' },
  pearl_escrow_seen: { label: 'PRL funding observed', family: 'pending' },
  pearl_escrow_confirmed: { label: 'PRL funding confirmed', family: 'happy' },
  usdc_escrow_pending: { label: 'Awaiting USDC deposit', family: 'pending' },
  usdc_escrow_confirmed: { label: 'Both legs confirmed', family: 'happy' },
  release_pending: { label: 'Release pending', family: 'pending' },
  released: { label: 'Released', family: 'happy' },
  refund_available: { label: 'Refund available', family: 'refund' },
  refund_pending: { label: 'Refund pending', family: 'refund' },
  refunded: { label: 'Refunded', family: 'refund' },
  disputed: { label: 'Disputed', family: 'manual_review' },
  cancelled: { label: 'Cancelled', family: 'terminal_neutral' },
  failed_manual_review: { label: 'Manual review', family: 'manual_review' },
  late_prl_funding: { label: 'Late PRL funding', family: 'manual_review' },
  usdc_refunded: { label: 'USDC refunded', family: 'manual_review' },
  prl_release_failed: { label: 'PRL release failed', family: 'manual_review' },
  amount_mismatch: { label: 'Amount mismatch', family: 'manual_review' },
  reorged: { label: 'Reorged', family: 'manual_review' },
  stale_indexer: { label: 'Stale indexer', family: 'manual_review' },
  unknown_spend: { label: 'Unknown spend', family: 'manual_review' },
};

const FAILURE_BANNERS: Partial<Record<TradeState, { severity: FailureBannerModel['severity']; headline: string }>> = {
  late_prl_funding: { severity: 'danger', headline: 'PRL was funded after the deadline. This trade will not auto-release.' },
  usdc_refunded: { severity: 'warning', headline: 'USDC was refunded. PRL release is blocked.' },
  prl_release_failed: { severity: 'danger', headline: 'PRL release transaction failed to broadcast. Manual review required.' },
  amount_mismatch: { severity: 'danger', headline: 'Funded amount does not match the expected escrow amount.' },
  reorged: { severity: 'warning', headline: 'A funding block was orphaned by a chain reorg. Awaiting re-confirmation.' },
  stale_indexer: { severity: 'warning', headline: 'Indexer lag exceeds threshold. Status may be stale.' },
  unknown_spend: { severity: 'danger', headline: 'Escrow output was spent by an unrecognized transaction. Audit pending.' },
  failed_manual_review: { severity: 'danger', headline: 'Trade flagged for manual review.' },
  disputed: { severity: 'danger', headline: 'Trade is under dispute.' },
};

const DEADLINE_LABELS: Record<keyof OtcTrade['deadlines'], string> = {
  quoteExpiresAt: 'Quote expires',
  pearlFundingDeadline: 'PRL funding cutoff',
  usdcDepositDeadline: 'USDC deposit cutoff',
  settlementDeadline: 'Settlement cutoff',
  refundAvailableAt: 'Refund available',
};

const DEPOSIT_ENABLED_STATES = new Set<TradeState>(['pearl_escrow_confirmed', 'usdc_escrow_pending']);
const DEPOSIT_CONFIRMED_STATES = new Set<TradeState>(['usdc_escrow_confirmed', 'release_pending', 'released']);

export function buildQuotePageModel(input: QuoteFormInput): QuotePageModel {
  const errors: QuotePageModel['errors'] = {};
  if (!isPositivePrlAmount(input.amountPrl)) {
    errors.amountPrl = 'Enter a positive PRL amount with up to 8 decimals.';
  }
  if (!isLikelyPearlAddress(input.buyerPearlAddress)) {
    errors.buyerPearlAddress = 'Enter a Pearl bech32m address.';
  }
  if (!isLikelyEvmAddress(input.usdcRefundAddress)) {
    errors.usdcRefundAddress = 'Enter a Base refund address.';
  }
  if (!input.clientRequestId.trim()) {
    errors.clientRequestId = 'Client request id is required.';
  }

  const canSubmit = Object.keys(errors).length === 0;
  return {
    tabs: [
      { side: 'buy_prl', label: 'Buy PRL', selected: input.side === 'buy_prl' },
      { side: 'sell_prl', label: 'Sell PRL', selected: input.side === 'sell_prl' },
    ],
    lockedSettlement: { asset: 'USDC', network: 'base' },
    errors,
    canSubmit,
    request: canSubmit
      ? {
          side: input.side,
          amountPrl: input.amountPrl,
          settlementAsset: 'USDC',
          settlementNetwork: 'base',
          buyerPearlAddress: input.buyerPearlAddress,
          usdcRefundAddress: input.usdcRefundAddress,
          clientRequestId: input.clientRequestId,
        }
      : undefined,
  };
}

export function buildAcceptQuotePageModel(
  quote: OtcQuote,
  input: AcceptQuoteFormInput,
  role: QuoteRole,
  now = new Date(),
  options: { makerRole?: 'buyer' | 'seller' } = {},
): AcceptQuotePageModel {
  const sellerFieldsVisible = true;
  const quoteExpired = new Date(quote.expiresAt).getTime() <= now.getTime() || quote.status !== 'active';
  const errors: AcceptQuotePageModel['errors'] = {};

  if (!isLikelyPearlAddress(input.buyerPearlAddress)) {
    errors.buyerPearlAddress = 'Enter a Pearl receive address.';
  }
  if (!isLikelyEvmAddress(input.buyerUsdcAddress)) {
    errors.buyerUsdcAddress = 'Enter a Base wallet address.';
  }
  if (!isLikelyPearlAddress(input.sellerPearlRefundAddress ?? '')) {
    errors.sellerPearlRefundAddress = 'Enter a Pearl seller refund address.';
  }
  if (!isLikelyEvmAddress(input.sellerUsdcReceiveAddress ?? '')) {
    errors.sellerUsdcReceiveAddress = 'Enter a seller USDC receive address.';
  }
  if (input.pearlEscrowMode === 'multisig') {
    if (!isLikelyPearlPubkey(input.buyerPearlPubkey ?? '')) {
      errors.buyerPearlPubkey = 'Enter the buyer Pearl x-only public key.';
    }
    if (!isLikelyPearlPubkey(input.sellerPearlPubkey ?? '')) {
      errors.sellerPearlPubkey = 'Enter the seller Pearl x-only public key.';
    }
    if (options.makerRole !== 'buyer' && !isLikelySchnorrSignature(input.buyerPearlPubkeyProof ?? '')) {
      errors.buyerPearlPubkeyProof = 'Enter the buyer signer proof signature.';
    }
    if (options.makerRole !== 'seller' && !isLikelySchnorrSignature(input.sellerPearlPubkeyProof ?? '')) {
      errors.sellerPearlPubkeyProof = 'Enter the seller signer proof signature.';
    }
  }
  if (!input.clientRequestId.trim()) {
    errors.clientRequestId = 'Client request id is required.';
  }

  return {
    role,
    sellerFieldsVisible,
    quoteExpired,
    errors,
    canAccept: !quoteExpired && Object.keys(errors).length === 0,
    summary: toQuoteSummary(quote),
  };
}

export function buildTradeCheckoutPageModel(
  trade: OtcTrade,
  options: { now?: Date; proof?: PublicTradeProof; usdcVerification?: UsdcVerificationModel; wallet?: WalletModel } = {},
): TradeCheckoutPageModel {
  const now = options.now ?? new Date();
  const stateBadge = buildStateBadge(trade.state);
  const failureBanner = buildFailureBanner(trade.state, trade.tradeId);

  return {
    tradeId: trade.tradeId,
    stateBadge,
    failureBanner,
    deadlines: buildDeadlineModels(trade.deadlines, now),
    pearl: {
      network: trade.pearlEscrow.network,
      escrowAddress: trade.pearlEscrow.address,
      expectedAmountGrains: trade.pearlEscrow.expectedAmountGrains,
      requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
      fundingOutpoint: trade.pearlEscrow.fundingOutpoint,
      releaseTxid: trade.pearlEscrow.releaseTxid,
      refundTxid: trade.pearlEscrow.refundTxid,
      escrowMode: trade.pearlEscrowMode,
      releaseSigningMode: trade.pearlReleaseSigningMode,
      signerSets: describePearlSignerSets(trade),
      statusLabel: getPearlStatusLabel(trade),
    },
    base: {
      network: trade.usdcEscrow.network,
      chainId: trade.usdcEscrow.chainId,
      contract: trade.usdcEscrow.contract,
      tradeKey: trade.usdcEscrow.tradeKey,
      expectedAmountMicros: trade.usdcEscrow.expectedAmountMicros,
      requiredConfirmations: trade.usdcEscrow.requiredConfirmations,
      depositTxHash: trade.usdcEscrow.depositTxHash,
      releaseTxHash: trade.usdcEscrow.releaseTxHash,
      refundTxHash: trade.usdcEscrow.refundTxHash,
      depositAction: getDepositAction(trade, now, options.wallet, options.usdcVerification),
      statusPills: getBaseStatusPills(trade, options.wallet, options.usdcVerification),
    },
    timeline: (options.proof?.events ?? []).map(toTimelineEvent),
    releaseActionsVisible: false,
  };
}

export function buildPublicProofPageModel(proof: PublicTradeProof, now = new Date()): PublicProofPageModel {
  const stateBadge = buildStateBadge(proof.status);
  return {
    tradeId: proof.tradeId,
    stateBadge,
    failureBanner: buildFailureBanner(proof.status, proof.tradeId),
    quote: proof.quote,
    deadlines: buildDeadlineModels(proof.deadlines, now),
    pearl: proof.pearl,
    base: proof.base,
    timeline: proof.events.map(toTimelineEvent),
    actionsVisible: false,
  };
}

export function buildStateBadge(state: TradeState): StateBadgeModel {
  return { state, ...STATE_META[state] };
}

export function buildFailureBanner(state: TradeState, tradeId: string): FailureBannerModel | undefined {
  const banner = FAILURE_BANNERS[state];
  if (!banner) {
    return undefined;
  }
  const subject = encodeURIComponent(`Oysters Market trade ${tradeId} needs review`);
  const body = encodeURIComponent(`Trade: ${tradeId}\nState: ${state}`);
  return {
    state,
    severity: banner.severity,
    headline: banner.headline,
    supportHref: `mailto:support@kaspa.com?subject=${subject}&body=${body}`,
  };
}

function buildDeadlineModels(deadlines: OtcTrade['deadlines'], now: Date): DeadlineModel[] {
  return (Object.keys(DEADLINE_LABELS) as Array<keyof OtcTrade['deadlines']>).map((key) => {
    const iso = deadlines[key];
    const msRemaining = new Date(iso).getTime() - now.getTime();
    return {
      key,
      label: DEADLINE_LABELS[key],
      iso,
      status: msRemaining > 0 ? 'open' : 'closed',
      msRemaining,
    };
  });
}

function getDepositAction(
  trade: OtcTrade,
  now: Date,
  wallet?: WalletModel,
  usdcVerification?: UsdcVerificationModel,
): TradeCheckoutPageModel['base']['depositAction'] {
  if (DEPOSIT_CONFIRMED_STATES.has(trade.state) || trade.usdcEscrow.depositTxHash) {
    return { kind: 'deposit_confirmed', label: 'Deposit confirmed', disabled: true };
  }
  if (!DEPOSIT_ENABLED_STATES.has(trade.state)) {
    return { kind: 'blocked', label: 'Deposit unavailable', disabled: true, reason: `Trade state is ${trade.state}.` };
  }
  if (new Date(trade.deadlines.usdcDepositDeadline).getTime() <= now.getTime()) {
    return { kind: 'blocked', label: 'Deposit window closed', disabled: true, reason: 'USDC deposit deadline has passed.' };
  }
  if (usdcVerification && (!usdcVerification.verified || !usdcVerification.depositAllowed)) {
    return {
      kind: 'blocked',
      label: 'Deposit blocked',
      disabled: true,
      reason: usdcVerification.mismatches.join('; ') || 'On-chain escrow terms do not match backend terms.',
    };
  }
  if (!usdcVerification) {
    return { kind: 'blocked', label: 'Deposit blocked', disabled: true, reason: 'On-chain escrow terms have not been verified.' };
  }
  if (!wallet?.connected) {
    return { kind: 'connect_wallet', label: 'Connect wallet', disabled: false };
  }
  if (wallet.chainId !== trade.usdcEscrow.chainId) {
    return { kind: 'switch_network', label: `Switch to chain ${trade.usdcEscrow.chainId}`, disabled: false };
  }
  if (!sameEvmAddress(wallet.address, trade.buyerUsdcAddress)) {
    return {
      kind: 'blocked',
      label: 'Wallet mismatch',
      disabled: true,
      reason: 'Connected wallet must match the buyer USDC address on this trade.',
    };
  }
  return { kind: 'deposit_usdc', label: 'Deposit USDC', disabled: false };
}

function getBaseStatusPills(trade: OtcTrade, wallet?: WalletModel, usdcVerification?: UsdcVerificationModel): TradeCheckoutPageModel['base']['statusPills'] {
  return [
    { label: wallet?.connected ? 'Wallet connected' : 'Wallet disconnected', status: wallet?.connected ? 'ok' : 'warning' },
    {
      label: wallet?.chainId === trade.usdcEscrow.chainId ? 'Network matched' : 'Network mismatch',
      status: wallet?.chainId === trade.usdcEscrow.chainId ? 'ok' : 'warning',
    },
    {
      label: usdcVerification?.verified ? 'Terms verified' : 'Terms unverified',
      status: usdcVerification?.verified ? 'ok' : usdcVerification ? 'blocked' : 'warning',
    },
    {
      label: sameEvmAddress(wallet?.address, trade.buyerUsdcAddress) ? 'Buyer wallet matched' : 'Buyer wallet mismatch',
      status: sameEvmAddress(wallet?.address, trade.buyerUsdcAddress) ? 'ok' : 'blocked',
    },
  ];
}

function getPearlStatusLabel(trade: OtcTrade): string {
  if (trade.pearlEscrow.refundTxid) {
    return 'PRL refund submitted';
  }
  if (trade.pearlEscrow.releaseTxid) {
    return 'PRL release submitted';
  }
  if (trade.state === 'pearl_escrow_seen') {
    return 'Funding observed';
  }
  if (trade.state === 'pearl_escrow_confirmed' || trade.state === 'usdc_escrow_pending' || trade.state === 'usdc_escrow_confirmed') {
    return 'Funding confirmed';
  }
  if (trade.state === 'late_prl_funding') {
    return 'Funding arrived late';
  }
  return 'Awaiting funding';
}

function toTimelineEvent(event: TradeEvent): TimelineEventModel {
  return {
    label: `${event.fromState} -> ${event.toState}`,
    observedAt: event.observedAt,
    chain: event.source === 'pearl_indexer' || event.outpoint ? 'pearl' : event.source === 'evm_indexer' || event.txHash ? 'base' : 'system',
    txHash: event.txHash,
    outpoint: event.outpoint,
    confirmations: event.confirmations,
  };
}

function toQuoteSummary(quote: OtcQuote): QuoteSummaryModel {
  return {
    quoteId: quote.quoteId,
    side: quote.side,
    amountPrl: quote.amountPrl,
    amountUsdc: quote.amountUsdc,
    feePrl: quote.feePrl,
    feeUsdc: quote.feeUsdc,
    priceUsdcPerPrl: quote.priceUsdcPerPrl,
    expiresAt: quote.expiresAt,
  };
}

function isPositivePrlAmount(value: string): boolean {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value)) {
    return false;
  }
  return Number(value) > 0;
}

function isLikelyPearlAddress(value: string): boolean {
  return /^(?:prl1p|tprl1p|prlsim1p)[a-z0-9]{6,}$/i.test(value);
}

function isLikelyEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function sameEvmAddress(left?: string, right?: string): boolean {
  return Boolean(left && right && isLikelyEvmAddress(left) && isLikelyEvmAddress(right) && left.toLowerCase() === right.toLowerCase());
}

function isLikelyPearlPubkey(value: string): boolean {
  return /^(?:0x)?(?:[0-9a-fA-F]{64}|0[23][0-9a-fA-F]{64})$/.test(value.trim());
}

function isLikelySchnorrSignature(value: string): boolean {
  return /^(?:0x)?[0-9a-fA-F]{128}$/.test(value.trim());
}

function describePearlSignerSets(trade: OtcTrade): string[] {
  const policy = trade.pearlEscrow.releaseTemplate && typeof trade.pearlEscrow.releaseTemplate === 'object'
    ? (trade.pearlEscrow.releaseTemplate as { signingPolicy?: { requiredSigners?: string[]; alternativeSignerSets?: string[][] } }).signingPolicy
    : undefined;
  const sets = [
    ...(policy?.requiredSigners?.length ? [policy.requiredSigners] : []),
    ...(policy?.alternativeSignerSets ?? []),
  ];
  return sets.map((set) => set.join(' + '));
}
