import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { OtcQuote, PearlEscrowMode, PearlReleaseSigningMode } from '@kaspacom/pearl-sdk';

import { createClientRequestId, createOtcClient, getDefaultPearlEscrowMode } from '../api.js';
import { demoQuote, demoTrade, DEMO_NOW } from '../demo-data.js';
import { buildAcceptQuotePageModel } from '../page-models.js';
import { BrandLoader, Field } from '../components/Primitives.js';
import { getBrowserPathname, getBrowserSearch, getQuoteIdFromPath, getQuoteRoleFromSearch } from '../routing.js';

export function AcceptQuotePage() {
  const quoteId = getQuoteIdFromPath(getBrowserPathname()) ?? demoQuote.quoteId;
  const routeQuoteId = getQuoteIdFromPath(getBrowserPathname());
  const [quote, setQuote] = useState<OtcQuote | undefined>(() => (routeQuoteId ? undefined : demoQuote));
  const [buyerPearlAddress, setBuyerPearlAddress] = useState(demoTrade.buyerPearlAddress);
  const [buyerUsdcAddress, setBuyerUsdcAddress] = useState(demoTrade.buyerUsdcAddress);
  const [sellerPearlRefundAddress, setSellerPearlRefundAddress] = useState(demoTrade.sellerPearlRefundAddress);
  const [sellerUsdcReceiveAddress, setSellerUsdcReceiveAddress] = useState(demoTrade.sellerUsdcReceiveAddress);
  const [pearlEscrowMode, setPearlEscrowMode] = useState<PearlEscrowMode>(getDefaultPearlEscrowMode);
  const [pearlReleaseSigningMode, setPearlReleaseSigningMode] = useState<PearlReleaseSigningMode>('preauthorize_release');
  const [buyerPearlPubkey, setBuyerPearlPubkey] = useState('');
  const [sellerPearlPubkey, setSellerPearlPubkey] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'accepted' | 'error'>('idle');
  const [tradeId, setTradeId] = useState(demoTrade.tradeId);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const onSubmit = useCallback((event: FormEvent) => event.preventDefault(), []);
  const onBuyerPearlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setBuyerPearlAddress(event.target.value), []);
  const onBuyerUsdcChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setBuyerUsdcAddress(event.target.value), []);
  const onSellerPearlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setSellerPearlRefundAddress(event.target.value), []);
  const onSellerUsdcChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setSellerUsdcReceiveAddress(event.target.value), []);
  const onEscrowModeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => setPearlEscrowMode(event.target.value as PearlEscrowMode), []);
  const onReleaseSigningModeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setPearlReleaseSigningMode(event.target.value as PearlReleaseSigningMode),
    [],
  );
  const onBuyerPearlPubkeyChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setBuyerPearlPubkey(event.target.value), []);
  const onSellerPearlPubkeyChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setSellerPearlPubkey(event.target.value), []);

  useEffect(() => {
    if (!routeQuoteId) {
      return undefined;
    }
    let active = true;
    void createOtcClient()
      .getQuote(routeQuoteId)
      .then((apiQuote) => {
        if (active) {
          setQuote(apiQuote);
        }
      })
      .catch((loadErrorValue) => {
        if (active) {
          setLoadError(loadErrorValue instanceof Error ? loadErrorValue.message : 'Quote data failed to load.');
        }
      });
    return () => {
      active = false;
    };
  }, [routeQuoteId]);

  if (!quote) {
    return (
      <section className="accept-page">
        <div className="om-page-title">
          <span>Accept quote</span>
          <h1>{quoteId}</h1>
          {loadError ? (
            <p>{`Quote data unavailable: ${loadError}`}</p>
          ) : (
            <BrandLoader label="Loading server-authoritative quote terms..." variant="shell-breathe" />
          )}
        </div>
      </section>
    );
  }

  const role = getQuoteRoleFromSearch(getBrowserSearch());
  const model = buildAcceptQuotePageModel(
    quote,
    {
      buyerPearlAddress,
      buyerUsdcAddress,
      sellerPearlRefundAddress,
      sellerUsdcReceiveAddress,
      pearlEscrowMode,
      pearlReleaseSigningMode,
      buyerPearlPubkey,
      sellerPearlPubkey,
      clientRequestId: createClientRequestId('accept_preview'),
    },
    role,
    DEMO_NOW,
  );

  async function accept() {
    if (!model.canAccept) {
      setStatus('error');
      setError('Fix the highlighted fields before accepting.');
      return;
    }

    setStatus('submitting');
    setError(undefined);
    try {
      const trade = await createOtcClient().acceptQuote(quoteId, {
        buyerPearlAddress,
        buyerUsdcAddress,
        sellerPearlRefundAddress,
        sellerUsdcReceiveAddress,
        pearlEscrowMode,
        pearlReleaseSigningMode,
        ...(pearlEscrowMode === 'multisig' ? { buyerPearlPubkey, sellerPearlPubkey } : {}),
        clientRequestId: createClientRequestId('accept'),
      });
      setTradeId(trade.tradeId);
      setStatus('accepted');
    } catch (requestError) {
      setStatus('error');
      setError(requestError instanceof Error ? requestError.message : 'Accept request failed.');
    }
  }

  return (
    <section className="accept-page">
      <div className="om-page-title">
        <span>Accept quote</span>
        <h1>Confirm counterparties before escrow allocation</h1>
        <p>Seller fields stay hidden for buyer flow; the API receives the full typed accept request only on submit.</p>
      </div>

      <div className="accept-page__grid">
        <form className="om-panel accept-form" onSubmit={onSubmit}>
          <Field label="Buyer Pearl address" error={model.errors.buyerPearlAddress}>
            <input value={buyerPearlAddress} onChange={onBuyerPearlChange} />
          </Field>
          <Field label="Buyer USDC address" error={model.errors.buyerUsdcAddress}>
            <input value={buyerUsdcAddress} onChange={onBuyerUsdcChange} />
          </Field>

          {model.sellerFieldsVisible ? (
            <div className="accept-form__seller">
              <Field label="Seller Pearl refund address" error={model.errors.sellerPearlRefundAddress}>
                <input value={sellerPearlRefundAddress} onChange={onSellerPearlChange} />
              </Field>
              <Field label="Seller USDC receive address" error={model.errors.sellerUsdcReceiveAddress}>
                <input value={sellerUsdcReceiveAddress} onChange={onSellerUsdcChange} />
              </Field>
            </div>
          ) : (
            <div className="accept-form__note">Seller settlement addresses are managed by the desk and shown later on the proof page.</div>
          )}

          <Field label="Pearl escrow mode" error={model.errors.pearlEscrowMode}>
            <select value={pearlEscrowMode} onChange={onEscrowModeChange}>
              <option value="multisig">2-of-3 buyer / seller / arbiter</option>
              <option value="coordinator">Coordinator signer</option>
            </select>
          </Field>

          {pearlEscrowMode === 'multisig' ? (
            <div className="accept-form__seller">
              <Field label="Buyer Pearl public key" error={model.errors.buyerPearlPubkey}>
                <input value={buyerPearlPubkey} onChange={onBuyerPearlPubkeyChange} spellCheck={false} />
              </Field>
              <Field label="Seller Pearl public key" error={model.errors.sellerPearlPubkey}>
                <input value={sellerPearlPubkey} onChange={onSellerPearlPubkeyChange} spellCheck={false} />
              </Field>
              <Field label="Release signing" error={model.errors.pearlReleaseSigningMode}>
                <select value={pearlReleaseSigningMode} onChange={onReleaseSigningModeChange}>
                  <option value="preauthorize_release">Pre-sign after PRL funding</option>
                  <option value="manual_after_base_deposit">Sign after Base deposit</option>
                </select>
              </Field>
            </div>
          ) : null}

          <button className="om-button om-button--primary" type="button" disabled={status === 'submitting'} onClick={accept}>
            {status === 'submitting' ? <BrandLoader compact label="Allocating escrows..." /> : 'Accept and continue'}
          </button>
          {status === 'accepted' ? <a href={`/trades/${tradeId}`}>Open checkout for {tradeId}</a> : null}
          {error ? <p className="om-form-error">{error}</p> : null}
        </form>

        <aside className="om-panel accept-summary">
          <span className="om-kicker">Quote summary</span>
          <code>{model.summary.quoteId}</code>
          <strong>{model.summary.amountPrl} PRL</strong>
          <span>{model.summary.amountUsdc} USDC</span>
          <small>Expires {model.summary.expiresAt}</small>
        </aside>
      </div>
    </section>
  );
}
