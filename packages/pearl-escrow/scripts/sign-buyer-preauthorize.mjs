#!/usr/bin/env node
// Buyer-side helper for the preauthorized release path while no browser Pearl wallet
// exists. Fetches the unsigned PSBT template from the OTC API, signs with the buyer's
// private key in-process, and submits the signed PSBT back to /preauthorize-release.
//
// USAGE:
//   PEARL_API_BASE_URL=https://dev-api-oyster.kaspa.com \
//   BUYER_PEARL_PRIVKEY_HEX=... \
//   TRADE_ID=trade_... \
//   node packages/pearl-escrow/scripts/sign-buyer-preauthorize.mjs
//
// Treat this as a dev/test tool. The buyer key never touches the API; only the signed
// PSBT (which commits to the canonical release tx the API constructed) leaves the host.

import { initEccLib, Psbt } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { createScriptPathSigner } from '../dist/index.js';

initEccLib(ecc);

const API_BASE = required(process.env.PEARL_API_BASE_URL, 'PEARL_API_BASE_URL').replace(/\/+$/, '');
const TRADE_ID = required(process.env.TRADE_ID, 'TRADE_ID');
const BUYER_PRIVKEY_HEX = required(process.env.BUYER_PEARL_PRIVKEY_HEX, 'BUYER_PEARL_PRIVKEY_HEX');

const privkey = parsePrivateKeyHex(BUYER_PRIVKEY_HEX);
const signer = createScriptPathSigner(privkey);

const templateUrl = `${API_BASE}/otc/trades/${encodeURIComponent(TRADE_ID)}/pearl-release/presign-template`;
const submitUrl = `${API_BASE}/otc/trades/${encodeURIComponent(TRADE_ID)}/pearl-release/preauthorize`;

const templateResponse = await fetch(templateUrl);
if (!templateResponse.ok) {
  throw new Error(`presign template fetch failed: ${templateResponse.status} ${await templateResponse.text()}`);
}
const template = await templateResponse.json();
console.log(JSON.stringify({
  msg: 'fetched release presign template',
  tradeId: template.tradeId,
  destinationAddress: template.destinationAddress,
  outputAmountGrains: template.outputAmountGrains,
  feeGrains: template.feeGrains,
  fundingOutpoint: template.fundingOutpoint,
  expectedAmountGrains: template.expectedAmountGrains,
  leafKind: template.leafKind,
  buyerPubkey: template.buyerPubkey,
}, null, 2));

const psbt = Psbt.fromBase64(template.psbtBase64);
psbt.signTaprootInput(0, signer);
const signedPsbtBase64 = psbt.toBase64();

const submitResponse = await fetch(submitUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ psbtBase64: signedPsbtBase64 }),
});
if (!submitResponse.ok) {
  throw new Error(`presignature submit failed: ${submitResponse.status} ${await submitResponse.text()}`);
}
const result = await submitResponse.json();
console.log(JSON.stringify({
  msg: 'preauthorized release recorded',
  tradeId: result.tradeId,
  state: result.state,
  buyerPresignedAt: result.pearlEscrow?.buyerReleasePresignature?.signedAt,
}, null, 2));

function required(value, name) {
  if (!value || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePrivateKeyHex(value) {
  const normalized = String(value).trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('BUYER_PEARL_PRIVKEY_HEX must be 32-byte hex');
  }
  const bytes = Buffer.from(normalized, 'hex');
  if (!ecc.isPrivate(bytes)) {
    throw new Error('BUYER_PEARL_PRIVKEY_HEX is not a valid secp256k1 private key');
  }
  return bytes;
}
