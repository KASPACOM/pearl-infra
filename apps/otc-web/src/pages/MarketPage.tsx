import { useEffect, useState } from 'react';

import { createOtcClient } from '../api.js';
import type { MarketStats, OrderBookPage, RecentTradeSummary } from '../otc-api-client.js';
import { BrandLoader, DataRow } from '../components/Primitives.js';

const emptyStats: MarketStats = {
  successfulTrades: 0,
  totalVolumePrl: '0.00000000',
  totalVolumeUsdc: '0.000000',
  activeOrderVolumePrl: '0.00000000',
  activeEscrowVolumePrl: '0.00000000',
  verifiedUsers: 0,
  openOrders: 0,
};

export function MarketPage() {
  const [side, setSide] = useState<'buy_prl' | 'sell_prl'>('buy_prl');
  const [stats, setStats] = useState<MarketStats>(emptyStats);
  const [orders, setOrders] = useState<OrderBookPage>({ items: [], total: 0, limit: 25 });
  const [trades, setTrades] = useState<RecentTradeSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const client = createOtcClient();
    setStatus('loading');
    Promise.all([
      client.getMarketStats(),
      client.listOrders({ side, status: 'open', sort: 'best_price', limit: 25 }),
      client.listRecentTrades(12),
    ])
      .then(([apiStats, apiOrders, apiTrades]) => {
        if (!active) return;
        setStats(apiStats);
        setOrders(apiOrders);
        setTrades(apiTrades);
        setStatus('ready');
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Market data failed to load.');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [side]);

  return (
    <section className="market-page">
      <div className="om-page-title">
        <span>Market</span>
        <h1>Order book and settlement flow.</h1>
        <p>Offers are maker intents. Funds lock only after an accepted trade enters the Pearl or Base escrow path.</p>
      </div>

      <div className="market-stats">
        <div className="om-panel"><DataRow label="Successful trades" value={stats.successfulTrades} /></div>
        <div className="om-panel"><DataRow label="Total USDC volume" value={stats.totalVolumeUsdc} /></div>
        <div className="om-panel"><DataRow label="Active order PRL" value={stats.activeOrderVolumePrl} /></div>
        <div className="om-panel"><DataRow label="Verified users" value={stats.verifiedUsers} /></div>
      </div>

      <div className="market-grid">
        <section className="om-panel">
          <div className="market-panel-head">
            <div>
              <span className="om-kicker">Open offers</span>
              <h2>{side === 'buy_prl' ? 'Buy PRL offers' : 'Sell PRL offers'}</h2>
            </div>
            <div className="market-tabs">
              <button className={side === 'buy_prl' ? 'is-active' : ''} onClick={() => setSide('buy_prl')}>Buy</button>
              <button className={side === 'sell_prl' ? 'is-active' : ''} onClick={() => setSide('sell_prl')}>Sell</button>
            </div>
          </div>
          {status === 'loading' ? <BrandLoader label="Loading order book..." /> : null}
          {status === 'error' ? <p className="om-form-error">{error}</p> : null}
          <div className="market-table">
            <div className="market-table__row is-head">
              <span>Price</span>
              <span>PRL</span>
              <span>Locks</span>
              <span>Status</span>
            </div>
            {orders.items.map((order) => (
              <div className="market-table__row" key={order.orderId}>
                <strong>{order.priceUsdcPerPrl}</strong>
                <span>{order.remainingPrl}</span>
                <span>{order.fundingAsset}</span>
                <span>{order.status}</span>
              </div>
            ))}
            {orders.items.length === 0 && status !== 'loading' ? <div className="om-empty">No open offers yet.</div> : null}
          </div>
          <a className="om-button om-button--primary" href="/profile">Create offer</a>
        </section>

        <section className="om-panel">
          <span className="om-kicker">Recent trades</span>
          <h2>Settlement activity</h2>
          <div className="market-table">
            <div className="market-table__row is-head">
              <span>Side</span>
              <span>PRL</span>
              <span>USDC</span>
              <span>State</span>
            </div>
            {trades.map((trade) => (
              <a className="market-table__row" href={`/trades/${trade.tradeId}`} key={trade.tradeId}>
                <span>{trade.side === 'buy_prl' ? 'Buy' : 'Sell'}</span>
                <span>{trade.amountPrl}</span>
                <span>{trade.amountUsdc}</span>
                <span>{trade.state}</span>
              </a>
            ))}
            {trades.length === 0 && status !== 'loading' ? <div className="om-empty">No completed trade history yet.</div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
