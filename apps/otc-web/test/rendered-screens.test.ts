import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminTradesPage } from '../dist/pages/AdminTradesPage.js';
import { AcceptQuotePage } from '../dist/pages/AcceptQuotePage.js';
import { PublicProofPage } from '../dist/pages/PublicProofPage.js';
import { RfqPage } from '../dist/pages/RfqPage.js';
import { TradeCheckoutPage } from '../dist/pages/TradeCheckoutPage.js';
import { getQuoteIdFromPath, getTradeIdFromPath } from '../dist/routing.js';

test('renders Oysters Market RFQ screen from the real quote model', () => {
  const html = renderToStaticMarkup(createElement(RfqPage));

  assert.match(html, /Oysters Market/);
  assert.match(html, /Request quote/);
  assert.match(html, /Settlement network/);
  assert.match(html, /base/);
});

test('checkout, proof, and admin screens expose no release or refund buttons', () => {
  const html = [
    renderToStaticMarkup(createElement(TradeCheckoutPage)),
    renderToStaticMarkup(createElement(PublicProofPage)),
    renderToStaticMarkup(createElement(AdminTradesPage)),
  ].join('\n');

  assert.doesNotMatch(html, /<button[^>]*>\s*(?:Release|Refund)/i);
  assert.match(html, /No release or refund actions are available/);
  assert.match(html, /manual review/i);
});

test('real trade routes do not render demo proof or checkout data before API data loads', () => {
  withWindow('/trades/trade_real_1', '', () => {
    const checkoutHtml = renderToStaticMarkup(createElement(TradeCheckoutPage));

    assert.match(checkoutHtml, /Loading server-authoritative trade state/);
    assert.doesNotMatch(checkoutHtml, /trade_demo_1/);
  });

  withWindow('/trades/trade_real_1/proof', '', () => {
    const proofHtml = renderToStaticMarkup(createElement(PublicProofPage));

    assert.match(proofHtml, /Loading server-authoritative proof/);
    assert.doesNotMatch(proofHtml, /trade_demo_1/);
  });
});

test('quote and trade route ids are decoded from URLs instead of falling back to demo ids', () => {
  assert.equal(getQuoteIdFromPath('/quote/quote_live_1/accept'), 'quote_live_1');
  assert.equal(getQuoteIdFromPath('/quote/quote%2Fwith%2Fslash/accept'), 'quote/with/slash');
  assert.equal(getTradeIdFromPath('/trades/trade_live_1/proof'), 'trade_live_1');

  withWindow('/quote/quote_live_1/accept', '?role=seller', () => {
    const html = renderToStaticMarkup(createElement(AcceptQuotePage));

    assert.match(html, /Loading server-authoritative quote terms/);
    assert.match(html, /quote_live_1/);
    assert.doesNotMatch(html, /quote_demo_1/);
  });
});

function withWindow(pathname: string, search: string, run: () => void) {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: { location: { pathname, search } },
    configurable: true,
  });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
}
