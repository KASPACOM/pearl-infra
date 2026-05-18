import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import type { OtcQuoteSide } from '@kaspacom/pearl-sdk';

import { createClientRequestId, createOtcClient } from '../api.js';
import { demoQuote } from '../demo-data.js';
import { buildQuotePageModel } from '../page-models.js';
import { Field } from '../components/Primitives.js';

export function RfqPage() {
  const [side, setSide] = useState<OtcQuoteSide>('buy_prl');
  const [amountPrl, setAmountPrl] = useState('12500.00000000');
  const [buyerPearlAddress, setBuyerPearlAddress] = useState('tprl1pbuyer01');
  const [usdcRefundAddress, setUsdcRefundAddress] = useState('0x3333333333333333333333333333333333333333');
  const [quote, setQuote] = useState(demoQuote);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const onSubmit = useCallback((event: FormEvent) => event.preventDefault(), []);
  const onSideClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setSide(event.currentTarget.dataset.side as OtcQuoteSide);
  }, []);
  const onAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setAmountPrl(event.target.value), []);
  const onPearlAddressChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setBuyerPearlAddress(event.target.value), []);
  const onRefundAddressChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setUsdcRefundAddress(event.target.value), []);

  const model = useMemo(
    () =>
      buildQuotePageModel({
        side,
        amountPrl,
        buyerPearlAddress,
        usdcRefundAddress,
        clientRequestId: createClientRequestId('quote_preview'),
      }),
    [amountPrl, buyerPearlAddress, side, usdcRefundAddress],
  );

  async function submit() {
    if (!model.canSubmit || !model.request) {
      setStatus('error');
      setError('Fix the highlighted fields before requesting a quote.');
      return;
    }

    setStatus('submitting');
    setError(undefined);
    try {
      const created = await createOtcClient().createQuote({
        ...model.request,
        clientRequestId: createClientRequestId('quote'),
      });
      setQuote(created);
      setStatus('ready');
    } catch (requestError) {
      setStatus('error');
      setError(requestError instanceof Error ? requestError.message : 'Quote request failed.');
    }
  }

  return (
    <section className="rfq-page">
      <div className="om-page-title">
        <span>Request for quote</span>
        <h1>Price a PRL / USDC settlement</h1>
        <p>Oysters Market keeps settlement terms locked to USDC on Base and validates the request before it reaches the desk API.</p>
      </div>

      <div className="rfq-page__grid">
        <form className="om-panel rfq-form" onSubmit={onSubmit}>
          <div className="rfq-form__tabs" role="tablist" aria-label="Quote side">
            {model.tabs.map((tab) => (
              <button
                key={tab.side}
                type="button"
                data-side={tab.side}
                className={tab.selected ? 'is-selected' : ''}
                onClick={onSideClick}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Field label="Amount in PRL" error={model.errors.amountPrl}>
            <input value={amountPrl} onChange={onAmountChange} inputMode="decimal" />
          </Field>
          <Field label="Buyer Pearl address" error={model.errors.buyerPearlAddress}>
            <input value={buyerPearlAddress} onChange={onPearlAddressChange} />
          </Field>
          <Field label="Refund Base address" error={model.errors.usdcRefundAddress}>
            <input value={usdcRefundAddress} onChange={onRefundAddressChange} />
          </Field>

          <div className="rfq-form__locked">
            <div>
              <span>Settlement asset</span>
              <strong>{model.lockedSettlement.asset}</strong>
            </div>
            <div>
              <span>Settlement network</span>
              <strong>{model.lockedSettlement.network}</strong>
            </div>
          </div>

          <button className="om-button om-button--primary" type="button" disabled={status === 'submitting'} onClick={submit}>
            {status === 'submitting' ? 'Requesting quote...' : 'Request quote'}
          </button>
          {error ? <p className="om-form-error">{error}</p> : null}
        </form>

        <aside className="om-panel rfq-result">
          <span className="om-kicker">Quote</span>
          <h2>{quote.amountPrl} PRL</h2>
          <dl>
            <div>
              <dt>USDC</dt>
              <dd>{quote.amountUsdc}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{quote.priceUsdcPerPrl}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{quote.expiresAt}</dd>
            </div>
          </dl>
          <a className="om-button" href={`/quote/${quote.quoteId}/accept`}>
            Accept quote
          </a>
        </aside>
      </div>
    </section>
  );
}
