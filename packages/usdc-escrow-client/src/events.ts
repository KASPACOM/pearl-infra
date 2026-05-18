import type {
  UsdcEscrowEventName,
  UsdcEscrowObservation,
  UsdcEscrowStatus,
  UsdcEscrowTradeEvent,
  UsdcEscrowTradeEventState,
} from './types.js';

export const USDC_ESCROW_EVENT_NAMES: readonly UsdcEscrowEventName[] = [
  'TradeCreated',
  'Deposited',
  'Released',
  'Refunded',
  'Cancelled',
  'Paused',
  'Unpaused',
] as const;

export function isUsdcEscrowEventName(value: string): value is UsdcEscrowEventName {
  return USDC_ESCROW_EVENT_NAMES.includes(value as UsdcEscrowEventName);
}

export function usdcEscrowObservationIsConfirmed(
  observation: Pick<UsdcEscrowObservation, 'confirmations'>,
  requiredConfirmations: number,
): boolean {
  return observation.confirmations >= requiredConfirmations;
}

export function createUsdcEscrowSourceEventId(
  event: Pick<UsdcEscrowTradeEvent, 'chainId' | 'tradeKey' | 'eventName' | 'txHash' | 'logIndex'>,
): string {
  return ['base', event.chainId, event.tradeKey, event.eventName, event.txHash, event.logIndex].join(':');
}

export function normalizeUsdcEscrowTradeEvents(
  events: readonly UsdcEscrowTradeEvent[],
): Map<string, UsdcEscrowTradeEventState> {
  const states = new Map<string, UsdcEscrowTradeEventState>();
  for (const event of [...events].sort(compareUsdcEscrowEvents)) {
    states.set(event.tradeKey, applyUsdcEscrowTradeEvent(states.get(event.tradeKey), event));
  }
  return states;
}

export function applyUsdcEscrowTradeEvent(
  previous: UsdcEscrowTradeEventState | undefined,
  event: UsdcEscrowTradeEvent,
): UsdcEscrowTradeEventState {
  if (previous && !eventBelongsToPreviousState(previous, event)) {
    throw new Error(`USDC escrow event does not match previous state for trade ${previous.tradeKey}`);
  }

  const base = {
    ...(previous ?? {}),
    network: event.network,
    chainId: event.chainId,
    contractAddress: event.contractAddress,
    tradeKey: event.tradeKey,
    sourceEventId: createUsdcEscrowSourceEventId(event),
    lastEventName: event.eventName,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    ...(event.blockHash ? { blockHash: event.blockHash } : {}),
    confirmations: event.confirmations,
    observedAt: event.observedAt,
  };

  switch (event.eventName) {
    case 'TradeCreated':
      return {
        ...base,
        status: 'created',
        buyer: event.buyer,
        seller: event.seller,
        amountMicros: event.amountMicros,
        feeMicros: event.feeMicros,
        expiryUnixSeconds: event.expiryUnixSeconds,
      };
    case 'Deposited':
      return {
        ...base,
        status: 'deposited',
        payer: event.payer,
        amountMicros: event.amountMicros,
        depositTxHash: event.txHash,
      };
    case 'Released':
      return {
        ...base,
        status: 'released',
        seller: event.seller,
        sellerAmountMicros: event.sellerAmountMicros,
        feeAmountMicros: event.feeAmountMicros,
        releaseTxHash: event.txHash,
      };
    case 'Refunded':
      return {
        ...base,
        status: 'refunded',
        buyer: event.buyer,
        amountMicros: event.amountMicros,
        refundTxHash: event.txHash,
      };
    case 'Cancelled':
      return {
        ...base,
        status: 'cancelled',
        cancelledTxHash: event.txHash,
      };
  }
}

export interface UsdcEscrowEventRepository {
  ingestEvents(events: readonly UsdcEscrowTradeEvent[]): Promise<readonly UsdcEscrowTradeEventState[]>;
  getTradeState(tradeKey: string): Promise<UsdcEscrowTradeEventState | undefined>;
}

export class InMemoryUsdcEscrowEventRepository implements UsdcEscrowEventRepository {
  private readonly eventsById = new Map<string, UsdcEscrowTradeEvent>();
  private readonly stateByTradeKey = new Map<string, UsdcEscrowTradeEventState>();

  async ingestEvents(events: readonly UsdcEscrowTradeEvent[]): Promise<readonly UsdcEscrowTradeEventState[]> {
    const inserted: UsdcEscrowTradeEvent[] = [];
    for (const event of events) {
      const eventId = createUsdcEscrowSourceEventId(event);
      if (!this.eventsById.has(eventId)) {
        this.eventsById.set(eventId, event);
        inserted.push(event);
      }
    }

    const affectedTradeKeys = new Set(inserted.map((event) => event.tradeKey));
    for (const tradeKey of affectedTradeKeys) {
      const eventsForTrade = [...this.eventsById.values()].filter((event) => event.tradeKey === tradeKey);
      const nextState = normalizeUsdcEscrowTradeEvents(eventsForTrade).get(tradeKey);
      if (nextState) {
        this.stateByTradeKey.set(tradeKey, nextState);
      }
    }

    return [...affectedTradeKeys]
      .map((tradeKey) => this.stateByTradeKey.get(tradeKey))
      .filter((state): state is UsdcEscrowTradeEventState => Boolean(state));
  }

  async getTradeState(tradeKey: string): Promise<UsdcEscrowTradeEventState | undefined> {
    return this.stateByTradeKey.get(tradeKey);
  }
}

const EVENT_ORDER: Readonly<Record<UsdcEscrowTradeEvent['eventName'], number>> = {
  TradeCreated: 0,
  Deposited: 1,
  Released: 2,
  Refunded: 2,
  Cancelled: 2,
};

const STATUS_BY_EVENT: Readonly<Record<UsdcEscrowTradeEvent['eventName'], UsdcEscrowStatus>> = {
  TradeCreated: 'created',
  Deposited: 'deposited',
  Released: 'released',
  Refunded: 'refunded',
  Cancelled: 'cancelled',
};

function compareUsdcEscrowEvents(left: UsdcEscrowTradeEvent, right: UsdcEscrowTradeEvent): number {
  return (
    left.blockNumber - right.blockNumber ||
    left.logIndex - right.logIndex ||
    EVENT_ORDER[left.eventName] - EVENT_ORDER[right.eventName]
  );
}

function eventBelongsToPreviousState(previous: UsdcEscrowTradeEventState, event: UsdcEscrowTradeEvent): boolean {
  return (
    previous.network === event.network &&
    previous.chainId === event.chainId &&
    previous.contractAddress.toLowerCase() === event.contractAddress.toLowerCase() &&
    previous.tradeKey === event.tradeKey
  );
}

export function usdcEscrowStatusFromEvent(eventName: UsdcEscrowTradeEvent['eventName']): UsdcEscrowStatus {
  return STATUS_BY_EVENT[eventName];
}
