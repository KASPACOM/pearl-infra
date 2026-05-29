import type { PearlPrefundSpendContract } from '@kaspacom/pearl-wallet';
import type { PearlPrefundEscrowLeaf, PearlScriptNetworkName } from '@kaspacom/pearl-script';

/**
 * Server contract for the Mode B sweep + CLTV refund flows. The shape is
 * fixed here — once the server-side C5/C6 PSBT builders ship, they MUST
 * return exactly these field names and types. The frontend wires straight
 * through.
 *
 * The endpoints don't exist on the server yet (see PR #129 and #130 — the
 * orchestration methods are in place but the concrete builders are deferred).
 * Once they ship, the createOrderSigningClient() in api.ts unblocks the UI
 * automatically.
 */

export interface PreparedPearlSpendResponse {
  /** Unsigned PSBT, base64. */
  psbtBase64: string;
  /** Taproot leaf the maker's key signs against. Must match the script in
   * the PSBT — the wallet's L-PR-3 validation will reject mismatches. */
  leaf: PearlPrefundEscrowLeaf;
  /** Pearl network. */
  network: PearlScriptNetworkName;
  /** L-PR-3 contract — what the wallet enforces before signing. */
  contract: PearlPrefundSpendContract;
  /** BIP86 derivation index the maker's wallet uses for this spend. */
  derivationIndex: number;
}

export interface SubmitSignedSpendRequest {
  signedPsbtBase64: string;
}

export interface SubmitSignedSpendResponse {
  /** Confirmed broadcast txid (if the server broadcasts immediately). */
  pearlTxid?: string;
  /** Whatever the server returns as the next status the UI should show. */
  status: 'broadcast' | 'awaiting_more_signatures' | 'rejected';
  /** Optional human-readable detail for the UI. */
  message?: string;
}

/**
 * Client surface for the order-signing endpoints. Wired up via api.ts;
 * components consume this via getOrderSigningClient(). Test-friendly because
 * the entire interface is injectable.
 */
export interface OrderSigningClient {
  /** Mode B: server prepares the sweep PSBT after a taker matches and the
   * sweep enters status='awaiting_maker_signature'. */
  getSweepPsbt(orderId: string, signal?: AbortSignal): Promise<PreparedPearlSpendResponse>;
  /** Mode B: maker submits the signed sweep. Server adds the operator
   * co-signature and broadcasts. */
  submitSignedSweep(
    orderId: string,
    request: SubmitSignedSpendRequest,
    signal?: AbortSignal,
  ): Promise<SubmitSignedSpendResponse>;
  /** Any mode: maker requests their CLTV refund. Server prepares the refund
   * PSBT spending the live prefund UTXO back to the maker. */
  getRefundPsbt(orderId: string, signal?: AbortSignal): Promise<PreparedPearlSpendResponse>;
  /** Maker submits the signed refund. Server broadcasts. */
  submitSignedRefund(
    orderId: string,
    request: SubmitSignedSpendRequest,
    signal?: AbortSignal,
  ): Promise<SubmitSignedSpendResponse>;
}

// ---------- Orchestration ----------

import { validateAndSignPearlPrefundPsbt } from '@kaspacom/pearl-wallet';

import type { PearlWalletSession } from './wallet-session.ts';

export interface SignAndSubmitOrderSpendInput {
  orderId: string;
  prepared: PreparedPearlSpendResponse;
  session: PearlWalletSession;
  client: OrderSigningClient;
  kind: 'sweep' | 'refund';
}

/**
 * Single entry point for both Mode B sweep and CLTV refund. The flow is the
 * same in both cases:
 *
 *   1. Re-derive the maker key for the order via the wallet session.
 *   2. Hand the privkey into validateAndSignPearlPrefundPsbt, which enforces
 *      the L-PR-3 contract BEFORE adding the signature.
 *   3. POST the signed PSBT back to the corresponding submit endpoint.
 *   4. Surface the server's reply for the UI to act on.
 *
 * Throws if anything in the chain fails — the UI shows the error verbatim
 * (matches what the user sees from SignPsbtPrompt).
 */
export async function signAndSubmitOrderSpend(input: SignAndSubmitOrderSpendInput): Promise<SubmitSignedSpendResponse> {
  const signedPsbtBase64 = await input.session.withOrderPrivkey(input.prepared.derivationIndex, (privkey) => {
    return validateAndSignPearlPrefundPsbt({
      psbtBase64: input.prepared.psbtBase64,
      leaf: input.prepared.leaf,
      privkey,
      network: input.prepared.network,
      contract: input.prepared.contract,
    }).signedPsbtBase64;
  });
  if (input.kind === 'sweep') {
    return input.client.submitSignedSweep(input.orderId, { signedPsbtBase64 });
  }
  return input.client.submitSignedRefund(input.orderId, { signedPsbtBase64 });
}
