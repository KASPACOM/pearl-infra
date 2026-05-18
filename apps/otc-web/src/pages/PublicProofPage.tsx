import { useEffect, useState } from 'react';
import type { PublicTradeProof } from '@kaspacom/pearl-sdk';

import { createOtcClient } from '../api.js';
import { demoProof, DEMO_NOW } from '../demo-data.js';
import { buildPublicProofPageModel } from '../page-models.js';
import { DataRow, DeadlineStrip, FailureBanner, StateBadge, Timeline } from '../components/Primitives.js';
import { getBrowserPathname, getTradeIdFromPath } from '../routing.js';

export function PublicProofPage() {
  const routeTradeId = getTradeIdFromPath(getBrowserPathname());
  const [proof, setProof] = useState<PublicTradeProof | undefined>(() => (routeTradeId ? undefined : demoProof));
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!routeTradeId) {
      return undefined;
    }
    let active = true;
    void createOtcClient()
      .getProof(routeTradeId)
      .then((apiProof) => {
        if (active) {
          setProof(apiProof);
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Proof data failed to load.');
        }
      });
    return () => {
      active = false;
    };
  }, [routeTradeId]);

  if (!proof) {
    return (
      <article className="proof-page">
        <header className="proof-page__header">
          <div>
            <span className="om-kicker">Public proof</span>
            <h1>{routeTradeId ?? 'Loading proof'}</h1>
          </div>
        </header>
        <p className="proof-page__notice">
          {loadError ? `Proof data unavailable: ${loadError}` : 'Loading server-authoritative proof...'}
        </p>
      </article>
    );
  }

  const model = buildPublicProofPageModel(proof, DEMO_NOW);

  return (
    <article className="proof-page">
      <header className="proof-page__header">
        <div>
          <span className="om-kicker">Public proof</span>
          <h1>Verifiable receipt for {model.tradeId}</h1>
        </div>
        <StateBadge badge={model.stateBadge} />
      </header>
      {loadError ? <p className="proof-page__notice">API unavailable: {loadError}. Showing demo proof.</p> : null}
      <FailureBanner banner={model.failureBanner} />

      <section className="om-panel">
        <h2>Quote terms</h2>
        <DataRow label="Side" value={model.quote.side} />
        <DataRow label="PRL" value={model.quote.amountPrl} />
        <DataRow label="USDC" value={model.quote.amountUsdc} />
        <DataRow label="Price" value={model.quote.priceUsdcPerPrl} />
      </section>

      <DeadlineStrip deadlines={model.deadlines} />

      <div className="proof-page__grid">
        <section className="om-panel">
          <h2>Pearl facts</h2>
          <DataRow label="Escrow" value={model.pearl.escrowAddress} />
          <DataRow label="Outpoint" value={model.pearl.escrowOutpoint} />
          <DataRow label="Confirmations" value={model.pearl.escrowConfirmations} />
          <DataRow label="Release tx" value={model.pearl.releaseTxid} />
          <DataRow label="Refund tx" value={model.pearl.refundTxid} />
        </section>

        <section className="om-panel">
          <h2>Base facts</h2>
          <DataRow label="Chain" value={model.base.chainId} />
          <DataRow label="Contract" value={model.base.contract} />
          <DataRow label="Trade key" value={model.base.tradeKey} />
          <DataRow label="Deposit tx" value={model.base.depositTxHash} />
          <DataRow label="Release tx" value={model.base.releaseTxHash} />
          <DataRow label="Refund tx" value={model.base.refundTxHash} />
        </section>
      </div>

      <section className="om-panel">
        <h2>Timeline</h2>
        <Timeline events={model.timeline} />
      </section>
    </article>
  );
}
