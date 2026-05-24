import { useEffect, useState } from 'react';

import { createOtcClient } from '../api.js';
import { connectInjectedEvmWallet, signInjectedEvmMessage, type EvmWalletSnapshot } from '../evm-wallet.js';
import type { OtcUser, OtcUserDashboard } from '../otc-api-client.js';
import { BrandLoader, DataRow, Field } from '../components/Primitives.js';
import { getBrowserSearch } from '../routing.js';

const USER_STORAGE_KEY = 'oysters.otc.user';
const REFERRAL_STORAGE_KEY = 'oysters.otc.referral';

export function ProfilePage() {
  const [wallet, setWallet] = useState<EvmWalletSnapshot>({ connected: false });
  const [user, setUser] = useState<OtcUser | undefined>(() => readStoredUser());
  const [dashboard, setDashboard] = useState<OtcUserDashboard>();
  const [email, setEmail] = useState(() => readStoredUser()?.profile.email ?? '');
  const [orderSide, setOrderSide] = useState<'buy_prl' | 'sell_prl'>('buy_prl');
  const [orderAmountPrl, setOrderAmountPrl] = useState('');
  const [orderPrice, setOrderPrice] = useState('');
  const [orderMinFillPrl, setOrderMinFillPrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [refCode] = useState(() => readStoredReferralCode());

  useEffect(() => {
    if (!user || !wallet.connected) return;
    void loadDashboard(user);
  }, [user?.userId, wallet.connected]);

  async function connectProfile() {
    setStatus('working');
    setError(undefined);
    try {
      const snapshot = await connectInjectedEvmWallet();
      setWallet(snapshot);
      if (!snapshot.address) throw new Error('Wallet did not return an address.');
      const client = createOtcClient();
      const challenge = await client.createWalletChallenge({
        walletType: 'evm',
        network: 'base_sepolia',
        address: snapshot.address,
      });
      const signature = await signInjectedEvmMessage(challenge.message, snapshot.address);
      const registered = await client.registerUser({
        challengeId: challenge.challengeId,
        signature,
        ...(refCode ? { referralCode: refCode } : {}),
        sourceUrl: typeof window === 'undefined' ? undefined : window.location.href,
      });
      storeUser(registered);
      setUser(registered);
      setEmail(registered.profile.email ?? '');
      await loadDashboard(registered, snapshot);
      setStatus('idle');
    } catch (connectError) {
      setStatus('error');
      setError(connectError instanceof Error ? connectError.message : 'Profile connection failed.');
    }
  }

  async function saveProfile() {
    if (!user || !wallet.address) return;
    setStatus('working');
    setError(undefined);
    try {
      const client = createOtcClient();
      const challenge = await client.createWalletChallenge({
        walletType: 'evm',
        network: 'base_sepolia',
        address: wallet.address,
      });
      const signature = await signInjectedEvmMessage(challenge.message, wallet.address);
      const profile = await client.updateUserProfile(user.userId, {
        challengeId: challenge.challengeId,
        signature,
        email,
        notificationEmailEnabled: false,
      });
      const updated = { ...user, profile };
      storeUser(updated);
      setUser(updated);
      await loadDashboard(updated);
      setStatus('idle');
    } catch (saveError) {
      setStatus('error');
      setError(saveError instanceof Error ? saveError.message : 'Profile update failed.');
    }
  }

  async function createOffer() {
    if (!user || !wallet.address) return;
    setStatus('working');
    setError(undefined);
    try {
      const client = createOtcClient();
      const challenge = await client.createWalletChallenge({
        walletType: 'evm',
        network: 'base_sepolia',
        address: wallet.address,
      });
      const signature = await signInjectedEvmMessage(challenge.message, wallet.address);
      await client.createOrder({
        userId: user.userId,
        challengeId: challenge.challengeId,
        signature,
        side: orderSide,
        amountPrl: orderAmountPrl,
        priceUsdcPerPrl: orderPrice,
        ...(orderMinFillPrl ? { minFillPrl: orderMinFillPrl } : {}),
      });
      setOrderAmountPrl('');
      setOrderPrice('');
      setOrderMinFillPrl('');
      await loadDashboard(user);
      setStatus('idle');
    } catch (orderError) {
      setStatus('error');
      setError(orderError instanceof Error ? orderError.message : 'Offer creation failed.');
    }
  }

  async function loadDashboard(activeUser: OtcUser, activeWallet = wallet) {
    if (!activeWallet.address) return;
    const client = createOtcClient();
    const challenge = await client.createWalletChallenge({
      walletType: 'evm',
      network: 'base_sepolia',
      address: activeWallet.address,
    });
    const signature = await signInjectedEvmMessage(challenge.message, activeWallet.address);
    setDashboard(await client.getUserDashboard(activeUser.userId, { challengeId: challenge.challengeId, signature }));
  }

  return (
    <section className="profile-page">
      <div className="om-page-title">
        <span>Profile</span>
        <h1>Wallet, referrals, points, and trades.</h1>
        <p>Your wallet owns the profile. Email is optional contact metadata until verification and delivery jobs are enabled.</p>
      </div>

      <div className="profile-grid">
        <section className="om-panel">
          <span className="om-kicker">Wallet user</span>
          {user ? (
            <>
              <DataRow label="User" value={user.userId} />
              <DataRow label="Wallet" value={user.wallet.address} />
              <DataRow label="Your referral code" value={user.referralCode} />
              <DataRow label="Referred by" value={user.referredBy?.referralCode ?? '-'} />
              <DataRow label="Captured ref" value={refCode ?? '-'} />
            </>
          ) : (
            <p className="om-empty">Connect an EVM wallet to create or load your profile.</p>
          )}
          <button className="om-button om-button--primary" onClick={connectProfile} disabled={status === 'working'}>
            {status === 'working' ? <BrandLoader compact label="Signing..." /> : 'Connect wallet'}
          </button>
          {error ? <p className="om-form-error">{error}</p> : null}
        </section>

        <section className="om-panel">
          <span className="om-kicker">Points</span>
          <h2>{dashboard?.points.totalPoints ?? 0}</h2>
          <DataRow label="Signup" value={dashboard?.points.bySource.signup ?? 0} />
          <DataRow label="Orders" value={dashboard?.points.bySource.order_created ?? 0} />
          <DataRow label="Trades" value={dashboard?.points.bySource.trade_completed ?? 0} />
          <DataRow label="Referral bonuses" value={(dashboard?.points.bySource.referral_signup ?? 0) + (dashboard?.points.bySource.referral_activity_bonus ?? 0)} />
        </section>

        <section className="om-panel">
          <span className="om-kicker">Contact</span>
          <Field label="Email">
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          </Field>
          <button className="om-button" disabled={!user || !wallet.address || status === 'working'} onClick={saveProfile}>
            Save contact
          </button>
        </section>

        <section className="om-panel profile-wide">
          <div className="market-panel-head">
            <div>
              <span className="om-kicker">Create offer</span>
              <h2>{orderSide === 'buy_prl' ? 'Buy PRL with USDC' : 'Sell PRL for USDC'}</h2>
            </div>
            <div className="market-tabs">
              <button className={orderSide === 'buy_prl' ? 'is-active' : ''} onClick={() => setOrderSide('buy_prl')}>Buy</button>
              <button className={orderSide === 'sell_prl' ? 'is-active' : ''} onClick={() => setOrderSide('sell_prl')}>Sell</button>
            </div>
          </div>
          <div className="profile-order-form">
            <Field label="Amount PRL">
              <input inputMode="decimal" value={orderAmountPrl} onChange={(event) => setOrderAmountPrl(event.target.value)} placeholder="1000" />
            </Field>
            <Field label="USDC per PRL">
              <input inputMode="decimal" value={orderPrice} onChange={(event) => setOrderPrice(event.target.value)} placeholder="0.05" />
            </Field>
            <Field label="Minimum fill PRL">
              <input inputMode="decimal" value={orderMinFillPrl} onChange={(event) => setOrderMinFillPrl(event.target.value)} placeholder="Optional" />
            </Field>
          </div>
          <p className="profile-note">
            {orderSide === 'sell_prl'
              ? 'Sell offers advertise PRL liquidity; PRL locks when the taker accepts and the Pearl escrow is allocated.'
              : 'Buy offers advertise USDC liquidity; USDC locks when the accepted quote enters the Base escrow path.'}
          </p>
          <button className="om-button om-button--primary" disabled={!user || !wallet.address || status === 'working'} onClick={createOffer}>
            Create offer
          </button>
        </section>

        <section className="om-panel profile-wide">
          <span className="om-kicker">My offers</span>
          <div className="market-table">
            <div className="market-table__row is-head">
              <span>Side</span>
              <span>PRL</span>
              <span>Price</span>
              <span>Status</span>
            </div>
            {(dashboard?.orders ?? []).map((order) => (
              <div className="market-table__row" key={order.orderId}>
                <span>{order.side === 'buy_prl' ? 'Buy' : 'Sell'}</span>
                <span>{order.remainingPrl}</span>
                <span>{order.priceUsdcPerPrl}</span>
                <span>{order.status}</span>
              </div>
            ))}
            {dashboard?.orders.length === 0 ? <div className="om-empty">No open offers from this wallet yet.</div> : null}
          </div>
        </section>

        <section className="om-panel profile-wide">
          <span className="om-kicker">My trades</span>
          <div className="market-table">
            <div className="market-table__row is-head">
              <span>Trade</span>
              <span>PRL</span>
              <span>USDC</span>
              <span>State</span>
            </div>
            {(dashboard?.trades ?? []).map((trade) => (
              <a className="market-table__row" href={`/trades/${trade.tradeId}`} key={trade.tradeId}>
                <span>{trade.tradeId}</span>
                <span>{trade.amountPrl}</span>
                <span>{trade.amountUsdc}</span>
                <span>{trade.state}</span>
              </a>
            ))}
            {dashboard?.trades.length === 0 ? <div className="om-empty">No wallet-linked trades yet.</div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function readStoredUser(): OtcUser | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as OtcUser;
  } catch {
    return undefined;
  }
}

function storeUser(user: OtcUser): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  }
}

function readStoredReferralCode(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromUrl = new URLSearchParams(getBrowserSearch()).get('ref')?.trim();
  if (fromUrl) {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return window.localStorage.getItem(REFERRAL_STORAGE_KEY)?.trim() || undefined;
}
