import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { OtcQuote, PearlEscrowMode, PearlReleaseSigningMode } from '@kaspacom/pearl-sdk';
import { createPearlSignerProofMessage } from '@kaspacom/pearl-sdk/otc-signer-proof';

import { createClientRequestId, createOtcClient, getDefaultPearlEscrowMode } from '../api.js';
import { demoQuote, demoTrade, DEMO_NOW } from '../demo-data.js';
import { buildAcceptQuotePageModel } from '../page-models.js';
import { BrandLoader, Field } from '../components/Primitives.js';
import { getBrowserPathname, getBrowserSearch, getQuoteIdFromPath, getQuoteRoleFromSearch } from '../routing.js';
import type { AcceptQuoteRequest, OrderQuoteAcceptContext } from '../otc-api-client.js';
import { readOrderQuoteDraft, storeOrderQuoteDraft } from '../user-session.js';

type AcceptOrderQuoteContext = Pick<OrderQuoteAcceptContext, 'quoteId' | 'makerRole' | 'acceptPrefill'>;

export function AcceptQuotePage() {
  const quoteId = getQuoteIdFromPath(getBrowserPathname()) ?? demoQuote.quoteId;
  const routeQuoteId = getQuoteIdFromPath(getBrowserPathname());
  const [orderQuoteContext, setOrderQuoteContext] = useState<AcceptOrderQuoteContext | undefined>(() => readOrderQuoteDraft(routeQuoteId));
  const acceptPrefill = orderQuoteContext?.acceptPrefill;
  const [quote, setQuote] = useState<OtcQuote | undefined>(() => (routeQuoteId ? undefined : demoQuote));
  const [buyerPearlAddress, setBuyerPearlAddress] = useState(routeQuoteId ? acceptPrefill?.buyerPearlAddress ?? '' : demoTrade.buyerPearlAddress);
  const [buyerUsdcAddress, setBuyerUsdcAddress] = useState(routeQuoteId ? acceptPrefill?.buyerUsdcAddress ?? '' : demoTrade.buyerUsdcAddress);
  const [sellerPearlRefundAddress, setSellerPearlRefundAddress] = useState(
    routeQuoteId ? acceptPrefill?.sellerPearlRefundAddress ?? '' : demoTrade.sellerPearlRefundAddress,
  );
  const [sellerUsdcReceiveAddress, setSellerUsdcReceiveAddress] = useState(
    routeQuoteId ? acceptPrefill?.sellerUsdcReceiveAddress ?? '' : demoTrade.sellerUsdcReceiveAddress,
  );
  const [pearlEscrowMode, setPearlEscrowMode] = useState<PearlEscrowMode>(
    routeQuoteId && orderQuoteContext ? 'multisig' : getDefaultPearlEscrowMode,
  );
  const [pearlReleaseSigningMode, setPearlReleaseSigningMode] = useState<PearlReleaseSigningMode>(
    acceptPrefill?.pearlReleaseSigningMode ?? 'preauthorize_release',
  );
  const [buyerPearlPubkey, setBuyerPearlPubkey] = useState(acceptPrefill?.buyerPearlPubkey ?? '');
  const [sellerPearlPubkey, setSellerPearlPubkey] = useState(acceptPrefill?.sellerPearlPubkey ?? '');
  const [buyerPearlPubkeyProof, setBuyerPearlPubkeyProof] = useState('');
  const [sellerPearlPubkeyProof, setSellerPearlPubkeyProof] = useState('');
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
  const onBuyerPearlPubkeyProofChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setBuyerPearlPubkeyProof(event.target.value), []);
  const onSellerPearlPubkeyProofChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setSellerPearlPubkeyProof(event.target.value), []);

  useEffect(() => {
    if (!routeQuoteId) {
      return undefined;
    }
    let active = true;
    const client = createOtcClient();
    void Promise.all([
      client.getQuote(routeQuoteId),
      client.getOrderQuoteAcceptContext(routeQuoteId).catch(() => undefined),
    ])
      .then(([apiQuote, apiOrderContext]) => {
        if (!active) return;
        setQuote(apiQuote);
        if (apiOrderContext) {
          setOrderQuoteContext(apiOrderContext);
          storeOrderQuoteDraft({
            quoteId: apiOrderContext.quoteId,
            orderId: apiOrderContext.order.orderId,
            makerRole: apiOrderContext.makerRole,
            acceptPrefill: apiOrderContext.acceptPrefill,
          });
          applyAcceptPrefill(apiOrderContext.acceptPrefill, {
            setBuyerPearlAddress,
            setBuyerUsdcAddress,
            setSellerPearlRefundAddress,
            setSellerUsdcReceiveAddress,
            setBuyerPearlPubkey,
            setSellerPearlPubkey,
            setPearlReleaseSigningMode,
          });
          setPearlEscrowMode('multisig');
        } else {
          setOrderQuoteContext(undefined);
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
      buyerPearlPubkeyProof,
      sellerPearlPubkeyProof,
      clientRequestId: createClientRequestId('accept_preview'),
    },
    role,
    routeQuoteId ? new Date() : DEMO_NOW,
    { makerRole: orderQuoteContext?.makerRole },
  );
  const buyerSignerProofMessage = createPearlSignerProofMessage({
    quoteId,
    role: 'buyer',
    pearlAddress: buyerPearlAddress,
    usdcAddress: buyerUsdcAddress,
    pearlPubkey: buyerPearlPubkey,
    releaseSigningMode: pearlReleaseSigningMode,
  });
  const sellerSignerProofMessage = createPearlSignerProofMessage({
    quoteId,
    role: 'seller',
    pearlAddress: sellerPearlRefundAddress,
    usdcAddress: sellerUsdcReceiveAddress,
    pearlPubkey: sellerPearlPubkey,
    releaseSigningMode: pearlReleaseSigningMode,
  });

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
        ...(pearlEscrowMode === 'multisig'
          ? {
              buyerPearlPubkey,
              sellerPearlPubkey,
              ...(buyerPearlPubkeyProof ? { buyerPearlPubkeyProof } : {}),
              ...(sellerPearlPubkeyProof ? { sellerPearlPubkeyProof } : {}),
            }
          : {}),
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
        <p>Both sides confirm settlement addresses before the API allocates the Pearl escrow.</p>
      </div>

      <div className="accept-page__grid">
        <form className="om-panel accept-form" onSubmit={onSubmit}>
          <Field label="Buyer Pearl address" error={model.errors.buyerPearlAddress}>
            <input value={buyerPearlAddress} onChange={onBuyerPearlChange} />
          </Field>
          <Field label="Buyer USDC address" error={model.errors.buyerUsdcAddress}>
            <input value={buyerUsdcAddress} onChange={onBuyerUsdcChange} />
          </Field>

          <div className="accept-form__seller">
            <Field label="Seller Pearl refund address" error={model.errors.sellerPearlRefundAddress}>
              <input value={sellerPearlRefundAddress} onChange={onSellerPearlChange} />
            </Field>
            <Field label="Seller USDC receive address" error={model.errors.sellerUsdcReceiveAddress}>
              <input value={sellerUsdcReceiveAddress} onChange={onSellerUsdcChange} />
            </Field>
          </div>

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
              {orderQuoteContext?.makerRole !== 'buyer' ? (
                <>
                  <Field label="Buyer signer proof message">
                    <textarea value={buyerSignerProofMessage} readOnly rows={7} spellCheck={false} />
                  </Field>
                  <Field label="Buyer signer proof signature" error={model.errors.buyerPearlPubkeyProof}>
                    <input value={buyerPearlPubkeyProof} onChange={onBuyerPearlPubkeyProofChange} spellCheck={false} />
                  </Field>
                </>
              ) : null}
              {orderQuoteContext?.makerRole !== 'seller' ? (
                <>
                  <Field label="Seller signer proof message">
                    <textarea value={sellerSignerProofMessage} readOnly rows={7} spellCheck={false} />
                  </Field>
                  <Field label="Seller signer proof signature" error={model.errors.sellerPearlPubkeyProof}>
                    <input value={sellerPearlPubkeyProof} onChange={onSellerPearlPubkeyProofChange} spellCheck={false} />
                  </Field>
                </>
              ) : null}
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

function applyAcceptPrefill(
  prefill: Partial<AcceptQuoteRequest>,
  setters: {
    setBuyerPearlAddress(value: string): void;
    setBuyerUsdcAddress(value: string): void;
    setSellerPearlRefundAddress(value: string): void;
    setSellerUsdcReceiveAddress(value: string): void;
    setBuyerPearlPubkey(value: string): void;
    setSellerPearlPubkey(value: string): void;
    setPearlReleaseSigningMode(value: PearlReleaseSigningMode): void;
  },
): void {
  if (prefill.buyerPearlAddress) setters.setBuyerPearlAddress(prefill.buyerPearlAddress);
  if (prefill.buyerUsdcAddress) setters.setBuyerUsdcAddress(prefill.buyerUsdcAddress);
  if (prefill.sellerPearlRefundAddress) setters.setSellerPearlRefundAddress(prefill.sellerPearlRefundAddress);
  if (prefill.sellerUsdcReceiveAddress) setters.setSellerUsdcReceiveAddress(prefill.sellerUsdcReceiveAddress);
  if (prefill.buyerPearlPubkey) setters.setBuyerPearlPubkey(prefill.buyerPearlPubkey);
  if (prefill.sellerPearlPubkey) setters.setSellerPearlPubkey(prefill.sellerPearlPubkey);
  if (prefill.pearlReleaseSigningMode) setters.setPearlReleaseSigningMode(prefill.pearlReleaseSigningMode);
}
