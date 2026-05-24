import { useEffect, useState } from 'react';

import { createClientRequestId, createOtcClient } from '../api.js';
import { connectInjectedEvmWallet, signInjectedEvmMessage, type EvmWalletSnapshot } from '../evm-wallet.js';
import type { MarketStats, OrderBookPage, OtcOrder, OtcUser, RecentTradeSummary } from '../otc-api-client.js';
import { BrandLoader, DataRow } from '../components/Primitives.js';
import { readStoredReferralCode, readStoredUser, storeOrderQuoteDraft, storeUser } from '../user-session.js';

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
  const [wallet, setWallet] = useState<EvmWalletSnapshot>({ connected: false });
  const [user, setUser] = useState<OtcUser | undefined>(() => readStoredUser());
  const [selectedOrder, setSelectedOrder] = useState<OtcOrder>();
  const [fillAmountPrl, setFillAmountPrl] = useState('');
  const [takerPearlAddress, setTakerPearlAddress] = useState('');
  const [takerUsdcAddress, setTakerUsdcAddress] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'quoting'>('loading');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const client = createOtcClient();
    setStatus('loading');
    Promise.all([
      client.getMarketStats(),
      client.listOrders({ side, status: 'open', sort: 'best_price', limit: 25 }),
      client.listOrders({ side, status: 'partially_filled', sort: 'best_price', limit: 25 }),
      client.listRecentTrades(12),
    ])
      .then(([apiStats, openOrders, partiallyFilledOrders, apiTrades]) => {
        if (!active) return;
        const mergedOrders = [...openOrders.items, ...partiallyFilledOrders.items].sort(compareMarketOrders);
        setStats(apiStats);
        setOrders({
          items: mergedOrders,
          total: openOrders.total + partiallyFilledOrders.total,
          limit: openOrders.limit + partiallyFilledOrders.limit,
        });
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

  function openTicket(order: OtcOrder) {
    setSelectedOrder(order);
    setFillAmountPrl(order.minFillPrl ?? order.remainingPrl);
    setTakerPearlAddress('');
    setTakerUsdcAddress(wallet.address ?? user?.wallet.address ?? '');
    setError(undefined);
  }

  async function ensureWalletUser(): Promise<{ wallet: EvmWalletSnapshot & { address: string }; user: OtcUser }> {
    const snapshot = await connectInjectedEvmWallet();
    if (!snapshot.address) throw new Error('Wallet did not return an address.');
    setWallet(snapshot);
    const client = createOtcClient();
    const referralCode = readStoredReferralCode();
    const challenge = await client.createWalletChallenge({
      walletType: 'evm',
      network: 'base_sepolia',
      address: snapshot.address,
    });
    const signature = await signInjectedEvmMessage(challenge.message, snapshot.address);
    const registered = await client.registerUser({
      challengeId: challenge.challengeId,
      signature,
      ...(referralCode ? { referralCode } : {}),
      sourceUrl: typeof window === 'undefined' ? undefined : window.location.href,
    });
    storeUser(registered);
    setUser(registered);
    return { wallet: { ...snapshot, address: snapshot.address }, user: registered };
  }

  async function createTicketQuote() {
    if (!selectedOrder) return;
    setStatus('quoting');
    setError(undefined);
    try {
      const active = await ensureWalletUser();
      const usdcAddress = takerUsdcAddress.trim() || active.wallet.address;
      const client = createOtcClient();
      const challenge = await client.createWalletChallenge({
        walletType: 'evm',
        network: 'base_sepolia',
        address: active.wallet.address,
      });
      const signature = await signInjectedEvmMessage(challenge.message, active.wallet.address);
      const response = await client.createOrderQuote(selectedOrder.orderId, {
        userId: active.user.userId,
        challengeId: challenge.challengeId,
        signature,
        amountPrl: fillAmountPrl,
        pearlAddress: takerPearlAddress,
        usdcAddress,
        clientRequestId: createClientRequestId('order_quote'),
      });
      storeOrderQuoteDraft({
        quoteId: response.quote.quoteId,
        orderId: response.order.orderId,
        makerRole: response.makerRole,
        acceptPrefill: response.acceptPrefill,
      });
      const takerRole = response.makerRole === 'buyer' ? 'seller' : 'buyer';
      if (typeof window !== 'undefined') {
        window.location.assign(`/quote/${encodeURIComponent(response.quote.quoteId)}/accept?role=${takerRole}`);
      }
    } catch (quoteError) {
      setStatus('error');
      setError(quoteError instanceof Error ? quoteError.message : 'Order quote creation failed.');
    }
  }

  const takerRole = selectedOrder?.side === 'buy_prl' ? 'seller' : 'buyer';

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
              <span>Action</span>
            </div>
            {orders.items.map((order) => (
              <div className="market-table__row" key={order.orderId}>
                <strong>{order.priceUsdcPerPrl}</strong>
                <span>{order.remainingPrl}</span>
                <span>{order.fundingAsset}</span>
                <button className="market-fill-button" onClick={() => openTicket(order)}>Fill</button>
              </div>
            ))}
            {orders.items.length === 0 && status !== 'loading' ? <div className="om-empty">No open offers yet.</div> : null}
          </div>
          <a className="om-button om-button--primary" href="/profile">Create offer</a>
          {selectedOrder ? (
            <div className="market-ticket">
              <span className="om-kicker">{takerRole === 'seller' ? 'Sell into this bid' : 'Buy from this ask'}</span>
              <div className="market-ticket__summary">
                <DataRow label="Price" value={selectedOrder.priceUsdcPerPrl} />
                <DataRow label="Available PRL" value={selectedOrder.remainingPrl} />
              </div>
              <label>
                <span>Fill amount PRL</span>
                <input inputMode="decimal" value={fillAmountPrl} onChange={(event) => setFillAmountPrl(event.target.value)} />
              </label>
              <label>
                <span>{takerRole === 'seller' ? 'Seller refund Pearl address' : 'Buyer receive Pearl address'}</span>
                <input value={takerPearlAddress} onChange={(event) => setTakerPearlAddress(event.target.value)} placeholder="tprl1p..." />
              </label>
              <label>
                <span>{takerRole === 'seller' ? 'Seller USDC receive address' : 'Buyer USDC refund address'}</span>
                <input value={takerUsdcAddress} onChange={(event) => setTakerUsdcAddress(event.target.value)} placeholder="0x..." />
              </label>
              <button className="om-button om-button--primary" disabled={status === 'quoting'} onClick={createTicketQuote}>
                {status === 'quoting' ? <BrandLoader compact label="Creating quote..." /> : 'Create quote'}
              </button>
            </div>
          ) : null}
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

function compareMarketOrders(left: OtcOrder, right: OtcOrder): number {
  const leftPrice = Number(left.priceUsdcPerPrl);
  const rightPrice = Number(right.priceUsdcPerPrl);
  const priceOrder = left.side === 'buy_prl' ? rightPrice - leftPrice : leftPrice - rightPrice;
  if (priceOrder !== 0) return priceOrder;
  const sizeOrder = Number(right.remainingPrl) - Number(left.remainingPrl);
  if (sizeOrder !== 0) return sizeOrder;
  return right.createdAt.localeCompare(left.createdAt);
}
