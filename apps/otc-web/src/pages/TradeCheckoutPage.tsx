import { useEffect, useState } from 'react';
import type { OtcTrade, PublicTradeProof } from '@kaspacom/pearl-sdk';

import { createOtcClient } from '../api.js';
import { prepareEscrowDepositCall } from '../base-escrow-client.js';
import { demoProof, demoTrade, DEMO_NOW } from '../demo-data.js';
import { buildTradeCheckoutPageModel, type UsdcVerificationModel } from '../page-models.js';
import { BrandLoader, DataRow, DeadlineStrip, FailureBanner, StateBadge, Timeline } from '../components/Primitives.js';
import { getBrowserPathname, getTradeIdFromPath } from '../routing.js';

export function TradeCheckoutPage() {
  const routeTradeId = getTradeIdFromPath(getBrowserPathname());
  const [trade, setTrade] = useState<OtcTrade | undefined>(() => (routeTradeId ? undefined : demoTrade));
  const [proof, setProof] = useState<PublicTradeProof | undefined>(() => (routeTradeId ? undefined : demoProof));
  const [verification, setVerification] = useState<UsdcVerificationModel | undefined>(() =>
    routeTradeId ? undefined : { verified: true, depositAllowed: true, mismatches: [] },
  );
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!routeTradeId) {
      return undefined;
    }
    let active = true;
    const client = createOtcClient();
    void Promise.all([
      client.getTrade(routeTradeId),
      client.getProof(routeTradeId),
      client.verifyUsdcEscrowTerms(routeTradeId),
    ])
      .then(([apiTrade, apiProof, apiVerification]) => {
        if (!active) {
          return;
        }
        setTrade(apiTrade);
        setProof(apiProof);
        setVerification(apiVerification);
      })
      .catch((error) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Trade data failed to load.');
        }
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

  const model = buildTradeCheckoutPageModel(trade, {
    now: DEMO_NOW,
    proof,
    usdcVerification: verification,
    wallet: { connected: false },
  });

  let depositCall: ReturnType<typeof prepareEscrowDepositCall> | undefined;
  if (model.base.depositAction.kind === 'deposit_usdc') {
    try {
      depositCall = prepareEscrowDepositCall(trade.usdcEscrow.tradeKey, 'base_sepolia');
    } catch {
      depositCall = undefined;
    }
  }

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
          <DataRow label="Release tx" value={model.pearl.releaseTxid} />
          <DataRow label="Refund tx" value={model.pearl.refundTxid} />
        </section>

        <section className="om-panel">
          <h2>Base USDC leg</h2>
          <DataRow label="Chain" value={model.base.chainId} />
          <DataRow label="Contract" value={model.base.contract} />
          <DataRow label="Trade key" value={model.base.tradeKey} />
          <DataRow label="Deposit" value={model.base.depositTxHash} />
          <div className="checkout-action">
            <button
              className="om-button om-button--primary"
              disabled={model.base.depositAction.disabled || model.base.depositAction.kind !== 'deposit_usdc' || !depositCall}
            >
              {model.base.depositAction.label}
            </button>
            {model.base.depositAction.reason ? <small>{model.base.depositAction.reason}</small> : null}
            {depositCall ? <code>to {depositCall.to}</code> : null}
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
