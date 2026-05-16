export interface ReorgEvent {
  detachedBlockHash: string;
  detachedHeight: number;
  replacementBlockHash?: string;
  observedAt: string;
}

export interface ConfirmationView {
  txid: string;
  confirmations: number;
  blockHeight?: number;
  detached: boolean;
}

export function applyDetachedBlock(view: ConfirmationView, detachedHeight: number): ConfirmationView {
  if (view.blockHeight === detachedHeight) {
    return {
      ...view,
      confirmations: 0,
      detached: true,
    };
  }

  return view;
}
