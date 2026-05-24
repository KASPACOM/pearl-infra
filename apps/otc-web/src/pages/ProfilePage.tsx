import { useEffect, useState } from 'react';

import { createOtcClient } from '../api.js';
import { connectInjectedEvmWallet, signInjectedEvmMessage, type EvmWalletSnapshot } from '../evm-wallet.js';
import type { OtcNotificationPreference, OtcNotificationType, OtcUser, OtcUserDashboard } from '../otc-api-client.js';
import { BrandLoader, DataRow, Field } from '../components/Primitives.js';
import { readStoredReferralAttribution, readStoredUser, storeUser } from '../user-session.js';

const emailPreferenceTypes: Array<{ type: OtcNotificationType; label: string }> = [
  { type: 'trade_status', label: 'Trade status' },
  { type: 'deadline_warning', label: 'Deadline warnings' },
  { type: 'order_matched', label: 'Order matched' },
  { type: 'price_alert', label: 'Price alerts' },
  { type: 'new_good_order', label: 'New good orders' },
  { type: 'referral_event', label: 'Referral events' },
];

export function ProfilePage() {
  const [wallet, setWallet] = useState<EvmWalletSnapshot>({ connected: false });
  const [user, setUser] = useState<OtcUser | undefined>(() => readStoredUser());
  const [dashboard, setDashboard] = useState<OtcUserDashboard>();
  const [email, setEmail] = useState(() => readStoredUser()?.profile.email ?? '');
  const [emailVerificationToken, setEmailVerificationToken] = useState('');
  const [notificationPreferences, setNotificationPreferences] = useState<OtcNotificationPreference[]>([]);
  const [profileMessage, setProfileMessage] = useState<string>();
  const [orderSide, setOrderSide] = useState<'buy_prl' | 'sell_prl'>('buy_prl');
  const [orderAmountPrl, setOrderAmountPrl] = useState('');
  const [orderPrice, setOrderPrice] = useState('');
  const [orderMinFillPrl, setOrderMinFillPrl] = useState('');
  const [orderMakerPearlAddress, setOrderMakerPearlAddress] = useState('');
  const [orderMakerPearlPubkey, setOrderMakerPearlPubkey] = useState('');
  const [orderMakerPearlPubkeyProof, setOrderMakerPearlPubkeyProof] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [referralAttribution] = useState(() => readStoredReferralAttribution());

  useEffect(() => {
    if (!user || !wallet.connected) return;
    void loadDashboard(user);
    void loadNotificationPreferences(user);
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
        ...(referralAttribution?.referralCode ? { referralCode: referralAttribution.referralCode } : {}),
        sourceUrl: referralAttribution?.sourceUrl ?? (typeof window === 'undefined' ? undefined : window.location.href),
      });
      storeUser(registered);
      setUser(registered);
      setEmail(registered.profile.email ?? '');
      await loadDashboard(registered, snapshot);
      await loadNotificationPreferences(registered, snapshot);
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
      setProfileMessage('Contact saved.');
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
        makerPearlAddress: orderMakerPearlAddress,
        makerUsdcAddress: wallet.address,
        makerPearlPubkey: orderMakerPearlPubkey,
        makerPearlPubkeyProof: orderMakerPearlPubkeyProof,
        pearlReleaseSigningMode: 'manual_after_base_deposit',
        amountPrl: orderAmountPrl,
        priceUsdcPerPrl: orderPrice,
        ...(orderMinFillPrl ? { minFillPrl: orderMinFillPrl } : {}),
      });
      setOrderAmountPrl('');
      setOrderPrice('');
      setOrderMinFillPrl('');
      setOrderMakerPearlPubkeyProof('');
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

  async function loadNotificationPreferences(activeUser: OtcUser, activeWallet = wallet) {
    if (!activeWallet.address) return;
    const client = createOtcClient();
    const challenge = await client.createWalletChallenge({
      walletType: 'evm',
      network: 'base_sepolia',
      address: activeWallet.address,
    });
    const signature = await signInjectedEvmMessage(challenge.message, activeWallet.address);
    const response = await client.getNotificationPreferences(activeUser.userId, { challengeId: challenge.challengeId, signature });
    setNotificationPreferences(response.preferences);
  }

  async function requestEmailVerification() {
    if (!user || !wallet.address) return;
    setStatus('working');
    setError(undefined);
    setProfileMessage(undefined);
    try {
      const client = createOtcClient();
      const challenge = await client.createWalletChallenge({
        walletType: 'evm',
        network: 'base_sepolia',
        address: wallet.address,
      });
      const signature = await signInjectedEvmMessage(challenge.message, wallet.address);
      const response = await client.requestEmailVerification(user.userId, {
        challengeId: challenge.challengeId,
        signature,
        email,
      });
      setProfileMessage(`Verification queued for ${response.email}.`);
      setStatus('idle');
    } catch (verificationError) {
      setStatus('error');
      setError(verificationError instanceof Error ? verificationError.message : 'Email verification request failed.');
    }
  }

  async function verifyEmail() {
    if (!user) return;
    setStatus('working');
    setError(undefined);
    setProfileMessage(undefined);
    try {
      const profile = await createOtcClient().verifyEmail(user.userId, { token: emailVerificationToken });
      const updated = { ...user, profile };
      storeUser(updated);
      setUser(updated);
      setEmail(profile.email ?? email);
      setEmailVerificationToken('');
      setProfileMessage('Email verified.');
      if (wallet.address) await loadNotificationPreferences(updated);
      setStatus('idle');
    } catch (verificationError) {
      setStatus('error');
      setError(verificationError instanceof Error ? verificationError.message : 'Email verification failed.');
    }
  }

  async function saveNotificationPreferences() {
    if (!user || !wallet.address) return;
    setStatus('working');
    setError(undefined);
    setProfileMessage(undefined);
    try {
      const client = createOtcClient();
      const challenge = await client.createWalletChallenge({
        walletType: 'evm',
        network: 'base_sepolia',
        address: wallet.address,
      });
      const signature = await signInjectedEvmMessage(challenge.message, wallet.address);
      const response = await client.updateNotificationPreferences(user.userId, {
        challengeId: challenge.challengeId,
        signature,
        preferences: emailPreferenceTypes.map(({ type }) => ({
          notificationType: type,
          channel: 'email',
          enabled: isEmailPreferenceEnabled(type),
        })),
      });
      setNotificationPreferences(response.preferences);
      setProfileMessage('Notification preferences saved.');
      setStatus('idle');
    } catch (preferenceError) {
      setStatus('error');
      setError(preferenceError instanceof Error ? preferenceError.message : 'Notification preference update failed.');
    }
  }

  function isEmailPreferenceEnabled(type: OtcNotificationType): boolean {
    return notificationPreferences.some((preference) =>
      preference.notificationType === type && preference.channel === 'email' && preference.enabled,
    );
  }

  function setEmailPreference(type: OtcNotificationType, enabled: boolean) {
    setNotificationPreferences((current) => {
      const existing = current.find((preference) => preference.notificationType === type && preference.channel === 'email');
      if (existing) {
        return current.map((preference) =>
          preference.notificationType === type && preference.channel === 'email'
            ? { ...preference, enabled }
            : preference,
        );
      }
      const now = new Date().toISOString();
      return [...current, { userId: user?.userId ?? '', notificationType: type, channel: 'email', enabled, createdAt: now, updatedAt: now }];
    });
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
              <DataRow label="Linked wallets" value={getLinkedWallets(user).map(formatWalletLabel).join(', ')} />
              <DataRow label="Your referral code" value={user.referralCode} />
              <DataRow label="Referred by" value={user.referredBy?.referralCode ?? '-'} />
              <DataRow label="Captured ref" value={referralAttribution?.referralCode ?? '-'} />
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
          <DataRow label="Email verified" value={user?.profile.emailVerifiedAt ? 'yes' : 'no'} />
          <button className="om-button" disabled={!user || !wallet.address || !email || status === 'working'} onClick={requestEmailVerification}>
            Send verification
          </button>
          <Field label="Verification token">
            <input value={emailVerificationToken} onChange={(event) => setEmailVerificationToken(event.target.value)} spellCheck={false} />
          </Field>
          <button className="om-button" disabled={!user || !emailVerificationToken || status === 'working'} onClick={verifyEmail}>
            Verify email
          </button>
          <div className="profile-notification-list">
            {emailPreferenceTypes.map(({ type, label }) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={isEmailPreferenceEnabled(type)}
                  disabled={!user?.profile.emailVerifiedAt}
                  onChange={(event) => setEmailPreference(type, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <button className="om-button" disabled={!user?.profile.emailVerifiedAt || !wallet.address || status === 'working'} onClick={saveNotificationPreferences}>
            Save notifications
          </button>
          {profileMessage ? <p className="profile-note">{profileMessage}</p> : null}
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
            <Field label={orderSide === 'buy_prl' ? 'Buyer Pearl address' : 'Seller refund Pearl address'}>
              <input value={orderMakerPearlAddress} onChange={(event) => setOrderMakerPearlAddress(event.target.value)} placeholder="tprl1p..." />
            </Field>
            <Field label="Maker Pearl public key">
              <input value={orderMakerPearlPubkey} onChange={(event) => setOrderMakerPearlPubkey(event.target.value)} spellCheck={false} />
            </Field>
            <Field label="Maker signer proof signature">
              <input value={orderMakerPearlPubkeyProof} onChange={(event) => setOrderMakerPearlPubkeyProof(event.target.value)} spellCheck={false} />
            </Field>
          </div>
          <Field label="Maker signer proof message">
            <textarea
              value={user && wallet.address ? createOrderMakerSignerProofMessage({
                makerUserId: user.userId,
                side: orderSide,
                amountPrl: orderAmountPrl,
                priceUsdcPerPrl: orderPrice,
                minFillPrl: orderMinFillPrl,
                makerPearlAddress: orderMakerPearlAddress,
                makerUsdcAddress: wallet.address,
                makerPearlPubkey: orderMakerPearlPubkey,
              }) : ''}
              readOnly
              rows={9}
              spellCheck={false}
            />
          </Field>
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

function createOrderMakerSignerProofMessage(input: {
  makerUserId: string;
  side: 'buy_prl' | 'sell_prl';
  amountPrl: string;
  priceUsdcPerPrl: string;
  minFillPrl?: string;
  makerPearlAddress: string;
  makerUsdcAddress: string;
  makerPearlPubkey: string;
}): string {
  return [
    'Pearl OTC order signer proof v1',
    `maker_user_id=${input.makerUserId}`,
    `side=${input.side}`,
    `amount_prl=${input.amountPrl}`,
    `price_usdc_per_prl=${input.priceUsdcPerPrl}`,
    `min_fill_prl=${input.minFillPrl ?? ''}`,
    'expires_at=',
    `maker_role=${input.side === 'buy_prl' ? 'buyer' : 'seller'}`,
    `maker_pearl_address=${input.makerPearlAddress.trim()}`,
    `maker_usdc_address=${input.makerUsdcAddress.trim().toLowerCase()}`,
    `maker_pearl_pubkey=${normalizeProofPubkey(input.makerPearlPubkey)}`,
    'release_signing_mode=manual_after_base_deposit',
  ].join('\n');
}

function getLinkedWallets(user: OtcUser) {
  return user.wallets?.length ? user.wallets : [user.wallet];
}

function formatWalletLabel(wallet: OtcUser['wallet']): string {
  return `${wallet.walletType}:${wallet.network}:${shortAddress(wallet.address)}`;
}

function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}

function normalizeProofPubkey(value: string): string {
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  return normalized;
}
