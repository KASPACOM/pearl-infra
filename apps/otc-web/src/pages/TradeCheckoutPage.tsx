import { useEffect, useState } from 'react';
import { type OtcTrade, type PublicTradeProof } from '@kaspacom/pearl-sdk';

import { createOtcClient } from '../api.js';
import { buildEscrowDepositCallFromTrade, prepareUsdcApprovalCall, toTransactionRequest } from '../base-escrow-client.js';
import { demoProof, demoTrade, DEMO_NOW } from '../demo-data.js';
import {
  connectInjectedEvmWallet,
  hasInjectedEvmWallet,
  readInjectedEvmWallet,
  sendAndWaitInjectedEvmTransaction,
  subscribeInjectedEvmWalletChanges,
  switchInjectedEvmChain,
  type EvmWalletSnapshot,
} from '../evm-wallet.js';
import { buildTradeCheckoutPageModel, type UsdcVerificationModel } from '../page-models.js';
import { BrandLoader, DataRow, DeadlineStrip, FailureBanner, StateBadge, Timeline } from '../components/Primitives.js';
import type { PearlReleaseSigningIntent } from '../otc-api-client.js';
import { getBrowserPathname, getTradeIdFromPath } from '../routing.js';

type CheckoutActionStatus = 'idle' | 'connecting' | 'switching' | 'validating' | 'approving' | 'depositing' | 'submitted' | 'error';
type ReleaseSubmitStatus = 'idle' | 'submitting' | 'submitted' | 'error';

export function TradeCheckoutPage() {
  const routeTradeId = getTradeIdFromPath(getBrowserPathname());
  const [trade, setTrade] = useState<OtcTrade | undefined>(() => (routeTradeId ? undefined : demoTrade));
  const [proof, setProof] = useState<PublicTradeProof | undefined>(() => (routeTradeId ? undefined : demoProof));
  const [verification, setVerification] = useState<UsdcVerificationModel | undefined>(() =>
    routeTradeId ? undefined : { verified: true, depositAllowed: true, mismatches: [] },
  );
  const [wallet, setWallet] = useState<EvmWalletSnapshot>({ connected: false });
  const [now, setNow] = useState(() => (routeTradeId ? new Date() : DEMO_NOW));
  const [actionStatus, setActionStatus] = useState<CheckoutActionStatus>('idle');
  const [actionError, setActionError] = useState<string>();
  const [approvalTxHash, setApprovalTxHash] = useState<string>();
  const [depositTxHash, setDepositTxHash] = useState<string>();
  const [releaseIntent, setReleaseIntent] = useState<PearlReleaseSigningIntent>();
  const [signedReleaseTxHex, setSignedReleaseTxHex] = useState('');
  const [releaseSubmitStatus, setReleaseSubmitStatus] = useState<ReleaseSubmitStatus>('idle');
  const [releaseSubmitTxid, setReleaseSubmitTxid] = useState<string>();
  const [releaseSubmitError, setReleaseSubmitError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    let active = true;
    const refreshWallet = () => {
      void readInjectedEvmWallet()
        .then((snapshot) => {
          if (active) {
            setWallet(snapshot);
          }
        })
        .catch(() => {
          if (active) {
            setWallet({ connected: false });
          }
        });
    };
    refreshWallet();
    const unsubscribe = subscribeInjectedEvmWalletChanges(refreshWallet);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!routeTradeId) {
      setNow(DEMO_NOW);
      return undefined;
    }
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, [routeTradeId]);

  useEffect(() => {
    if (!routeTradeId) {
      return undefined;
    }
    let active = true;
    const client = createOtcClient();
    void client
      .getTrade(routeTradeId)
      .then((apiTrade) => {
        if (active) {
          setTrade(apiTrade);
        }
        return Promise.allSettled([
          client.getProof(routeTradeId),
          client.verifyUsdcEscrowTerms(routeTradeId),
          client.getPearlReleaseSigningIntent(routeTradeId),
        ]);
      })
      .then((results) => {
        if (!active) return;
        const [proofResult, verificationResult, releaseIntentResult] = results;
        if (proofResult?.status === 'fulfilled') {
          setProof(proofResult.value);
        }
        if (verificationResult?.status === 'fulfilled') {
          setVerification(verificationResult.value);
        }
        if (releaseIntentResult?.status === 'fulfilled') {
          setReleaseIntent(releaseIntentResult.value);
        }
        const firstFailure = results.find((result) => result.status === 'rejected');
        if (firstFailure?.status === 'rejected') {
          setLoadError(firstFailure.reason instanceof Error ? firstFailure.reason.message : 'Some checkout data failed to load.');
        }
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Trade data failed to load.');
      });
    return () => {
      active = false;
    };
  }, [routeTradeId]);

  if (!trade || !proof) {
    return (
      <section className="checkout-page">
        <div className="checkout-page__header">
          <div>
            <span className="om-kicker">Checkout</span>
            <h1>{routeTradeId ?? 'Loading trade'}</h1>
          </div>
        </div>
        <div className="checkout-page__notice">
          {loadError ? (
            `Trade data unavailable: ${loadError}`
          ) : (
            <BrandLoader label="Loading server-authoritative trade state..." variant="shell-breathe" />
          )}
        </div>
      </section>
    );
  }

  const loadedTrade = trade;
  const loadedProof = proof;
  const model = buildTradeCheckoutPageModel(loadedTrade, {
    now,
    proof: loadedProof,
    usdcVerification: verification,
    wallet,
  });

  let depositCall: ReturnType<typeof buildEscrowDepositCallFromTrade> | undefined;
  let approvalCall: ReturnType<typeof prepareUsdcApprovalCall> | undefined;
  if (model.base.depositAction.kind === 'deposit_usdc') {
    try {
      const callConfig = getTradeEscrowCallConfig(loadedTrade);
      approvalCall = prepareUsdcApprovalCall(loadedTrade.usdcEscrow.expectedAmountMicros, callConfig);
      depositCall = buildEscrowDepositCallFromTrade(loadedTrade, callConfig);
    } catch {
      depositCall = undefined;
      approvalCall = undefined;
    }
  }

  async function connectWallet() {
    setActionStatus('connecting');
    setActionError(undefined);
    try {
      setWallet(await connectInjectedEvmWallet());
      setActionStatus('idle');
    } catch (error) {
      setActionStatus('error');
      setActionError(error instanceof Error ? error.message : 'Wallet connection failed.');
    }
  }

  async function switchNetwork() {
    setActionStatus('switching');
    setActionError(undefined);
    try {
      await switchInjectedEvmChain(loadedTrade.usdcEscrow.chainId);
      setWallet(await readInjectedEvmWallet());
      setActionStatus('idle');
    } catch (error) {
      setActionStatus('error');
      setActionError(error instanceof Error ? error.message : 'Network switch failed.');
    }
  }

  async function refreshAndAssertDepositReady(tradeId: string, proof: PublicTradeProof) {
    const readiness = await loadCheckoutReadiness(tradeId);
    const checkedAt = new Date();
    setTrade(readiness.trade);
    setVerification(readiness.verification);
    setWallet(readiness.wallet);
    setNow(checkedAt);

    const checkedModel = buildTradeCheckoutPageModel(readiness.trade, {
      now: checkedAt,
      proof,
      usdcVerification: readiness.verification,
      wallet: readiness.wallet,
    });
    if (checkedModel.base.depositAction.kind !== 'deposit_usdc') {
      throw new Error(checkedModel.base.depositAction.reason ?? checkedModel.base.depositAction.label);
    }
    return readiness;
  }

  async function approveAndDeposit() {
    setActionError(undefined);
    try {
      setActionStatus('validating');
      const readyBeforeApproval = await refreshAndAssertDepositReady(loadedTrade.tradeId, loadedProof);
      const approvalCall = prepareUsdcApprovalCall(readyBeforeApproval.trade.usdcEscrow.expectedAmountMicros, getTradeEscrowCallConfig(readyBeforeApproval.trade));
      const depositCall = buildEscrowDepositCallFromTrade(readyBeforeApproval.trade, getTradeEscrowCallConfig(readyBeforeApproval.trade));
      setActionStatus('approving');
      const approvalHash = await sendAndWaitInjectedEvmTransaction(toTransactionRequest(approvalCall), readyBeforeApproval.wallet.address);
      setApprovalTxHash(approvalHash);
      setActionStatus('validating');
      const readyBeforeDeposit = await refreshAndAssertDepositReady(readyBeforeApproval.trade.tradeId, loadedProof);
      const refreshedDepositCall = buildEscrowDepositCallFromTrade(readyBeforeDeposit.trade, getTradeEscrowCallConfig(readyBeforeDeposit.trade));
      setActionStatus('depositing');
      const depositHash = await sendAndWaitInjectedEvmTransaction(toTransactionRequest(refreshedDepositCall), readyBeforeDeposit.wallet.address);
      setDepositTxHash(depositHash);
      setActionStatus('submitted');
    } catch (error) {
      setActionStatus('error');
      setActionError(error instanceof Error ? error.message : 'Base deposit transaction failed.');
    }
  }

  async function handleBaseAction() {
    if (model.base.depositAction.kind === 'connect_wallet') {
      await connectWallet();
      return;
    }
    if (model.base.depositAction.kind === 'switch_network') {
      await switchNetwork();
      return;
    }
    if (model.base.depositAction.kind === 'deposit_usdc') {
      await approveAndDeposit();
    }
  }

  async function submitSignedReleaseTransaction() {
    if (!routeTradeId || releaseIntent?.status !== 'ready' || !signedReleaseTxHex.trim()) return;
    setReleaseSubmitStatus('submitting');
    setReleaseSubmitError(undefined);
    try {
      const response = await createOtcClient().submitPearlSignedTransaction(routeTradeId, 'release', {
        idempotencyKey: `checkout:${routeTradeId}:release:${Date.now()}`,
        signedTxHex: signedReleaseTxHex,
      });
      setReleaseSubmitTxid(response.broadcastTxid);
      setReleaseSubmitStatus('submitted');
    } catch (error) {
      setReleaseSubmitStatus('error');
      setReleaseSubmitError(error instanceof Error ? error.message : 'Signed Pearl release transaction failed to broadcast.');
    }
  }

  const baseActionBusy = actionStatus !== 'idle' && actionStatus !== 'submitted' && actionStatus !== 'error';
  const baseActionDisabled =
    baseActionBusy ||
    actionStatus === 'submitted' ||
    Boolean(depositTxHash) ||
    model.base.depositAction.disabled ||
    (model.base.depositAction.kind === 'deposit_usdc' && (!approvalCall || !depositCall));
  const baseActionLabel = getBaseActionLabel(model.base.depositAction.label, actionStatus);
  const releaseBroadcastAvailable = releaseIntent?.status === 'ready' && trade.state === 'release_pending';
  const releaseSubmitReady = Boolean(routeTradeId && releaseBroadcastAvailable && signedReleaseTxHex.trim());

  return (
    <section className="checkout-page">
      <div className="checkout-page__header">
        <div>
          <span className="om-kicker">Checkout</span>
          <h1>{model.tradeId}</h1>
        </div>
        <StateBadge badge={model.stateBadge} />
      </div>
      {loadError ? <p className="checkout-page__notice">API unavailable: {loadError}. Showing demo state.</p> : null}
      <FailureBanner banner={model.failureBanner} />
      <DeadlineStrip deadlines={model.deadlines} />

      <div className="checkout-page__grid">
        <section className="om-panel">
          <h2>Pearl leg</h2>
          <DataRow label="Status" value={model.pearl.statusLabel} />
          <DataRow label="Network" value={model.pearl.network} />
          <DataRow label="Escrow" value={model.pearl.escrowAddress} />
          <DataRow label="Funding" value={model.pearl.fundingOutpoint} />
          <DataRow label="Custody" value={model.pearl.escrowMode ?? 'coordinator'} />
          <DataRow label="Release policy" value={model.pearl.releaseSigningMode ?? 'manual_after_base_deposit'} />
          <DataRow label="Signer sets" value={model.pearl.signerSets.join(' / ') || 'not available'} />
          <DataRow label="Release tx" value={model.pearl.releaseTxid} />
          <DataRow label="Refund tx" value={model.pearl.refundTxid} />
          <div className="checkout-release-package">
            <h3>Release signing package</h3>
            <DataRow label="Intent" value={releaseIntent?.status ?? 'not loaded'} />
            <DataRow label="Mode" value={releaseIntent?.signingMode ?? model.pearl.releaseSigningMode ?? 'manual_after_base_deposit'} />
            <DataRow label="Template" value={releaseIntent?.txTemplateHash ?? releaseIntent?.reason ?? '-'} />
            <DataRow label="Input" value={releaseIntent?.inputOutpoint ?? '-'} />
            <DataRow label="Destination" value={releaseIntent?.destinationAddress ?? '-'} />
            <DataRow label="Output grains" value={releaseIntent?.outputAmountGrains ?? '-'} />
            <DataRow label="Fee grains" value={releaseIntent?.feeGrains ?? '-'} />
            <DataRow label="Signer sets" value={releaseIntent?.signerSets.map((set) => set.join(' + ')).join(' / ') || model.pearl.signerSets.join(' / ') || '-'} />
            <DataRow label="Arbiter path" value={releaseIntent?.workerCanFinishWithArbiter ? 'available' : 'not available'} />
            {releaseIntent?.unsignedTxHex ? (
              <label className="checkout-release-package__unsigned">
                <span>Unsigned transaction</span>
                <textarea readOnly value={releaseIntent.unsignedTxHex} rows={4} />
              </label>
            ) : null}
            {releaseBroadcastAvailable ? (
              <div className="checkout-release-package__submit">
                <label className="checkout-release-package__unsigned">
                  <span>Signed transaction</span>
                  <textarea
                    value={signedReleaseTxHex}
                    rows={4}
                    onChange={(event) => setSignedReleaseTxHex(event.target.value)}
                  />
                </label>
                <button
                  className="om-button"
                  type="button"
                  disabled={!releaseSubmitReady || releaseSubmitStatus === 'submitting' || releaseSubmitStatus === 'submitted'}
                  onClick={submitSignedReleaseTransaction}
                >
                  {releaseSubmitStatus === 'submitting' ? <BrandLoader compact label="Broadcasting..." /> : 'Broadcast signed transaction'}
                </button>
                {releaseSubmitTxid ? <small>Broadcast txid: <code>{releaseSubmitTxid}</code></small> : null}
                {releaseSubmitError ? <small className="checkout-action__error">{releaseSubmitError}</small> : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className="om-panel">
          <h2>Base USDC leg</h2>
          <DataRow label="Chain" value={model.base.chainId} />
          <DataRow label="Contract" value={model.base.contract} />
          <DataRow label="Trade key" value={model.base.tradeKey} />
          <DataRow label="Deposit" value={model.base.depositTxHash} />
          <DataRow label="Wallet" value={wallet.address ?? (hasInjectedEvmWallet() ? 'Disconnected' : 'No injected wallet')} />
          <DataRow label="Expected total" value={`${model.base.expectedAmountMicros} USDC micros`} />
          <div className="checkout-action">
            <button
              className="om-button om-button--primary"
              disabled={baseActionDisabled}
              onClick={handleBaseAction}
            >
              {baseActionBusy ? <BrandLoader compact label={baseActionLabel} /> : baseActionLabel}
            </button>
            {model.base.depositAction.reason ? <small>{model.base.depositAction.reason}</small> : null}
            {approvalCall ? <code>approve {approvalCall.to}</code> : null}
            {depositCall ? <code>deposit {depositCall.to}</code> : null}
            {approvalTxHash ? <code>approval tx {approvalTxHash}</code> : null}
            {depositTxHash ? <code>deposit tx {depositTxHash}</code> : null}
            {actionError ? <small className="checkout-action__error">{actionError}</small> : null}
          </div>
        </section>
      </div>

      <section className="om-panel">
        <div className="checkout-page__panel-title">
          <h2>Activity</h2>
          <span>server-authoritative timeline</span>
        </div>
        <Timeline events={model.timeline} />
      </section>
    </section>
  );
}

function getTradeEscrowCallConfig(trade: OtcTrade) {
  return {
    chainId: trade.usdcEscrow.chainId,
    usdcToken: trade.usdcEscrow.usdcToken,
    escrowContract: trade.usdcEscrow.contract,
  };
}

function getBaseActionLabel(defaultLabel: string, status: CheckoutActionStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting wallet...';
    case 'switching':
      return 'Switching network...';
    case 'validating':
      return 'Checking trade...';
    case 'approving':
      return 'Approving USDC...';
    case 'depositing':
      return 'Depositing USDC...';
    case 'submitted':
      return 'Deposit submitted';
    default:
      return defaultLabel;
  }
}

async function loadCheckoutReadiness(tradeId: string): Promise<{
  trade: OtcTrade;
  verification: UsdcVerificationModel;
  wallet: EvmWalletSnapshot;
}> {
  const client = createOtcClient();
  const [trade, verification, wallet] = await Promise.all([
    client.getTrade(tradeId),
    client.verifyUsdcEscrowTerms(tradeId),
    readInjectedEvmWallet(),
  ]);
  return { trade, verification, wallet };
}
