# Build-On-Pearl Quickstart (Agent Manual)

> **Read this first.** If you are an AI agent (or human dev) told to "build something on Pearl," this is your starting point. Skip the planning docs. They're for the team meeting. This is the build manual.

## What you need to know before you write a line of code

1. **Pearl has no on-chain VM.** No EVM, no WASM, no Solidity. Don't try to "deploy a contract" — there is nowhere to deploy. All your app logic lives in your own backend.
2. **Pearl is a Bitcoin Taproot fork.** Every operation (build address, build tx, sign, broadcast) maps to a Bitcoin operation with a small config swap. Use Bitcoin libraries.
3. **There is no official Pearl JS/TS SDK.** Don't go looking for one. You wire up 4 standard libraries and you're done.
4. **The only address type is Taproot (P2TR).** All Pearl addresses look like `prl1p…`. Bech32m encoded, HRP is `prl` on mainnet.
5. **All starter code in this file is unverified against Pearl.** It follows Bitcoin Taproot patterns and *should* work for Pearl, but you MUST test on simnet before pointing it at mainnet. See §7.

## 1. Stack and dependencies

Pick this exactly unless you have a documented reason to deviate:

| Tool | Why | Notes |
|---|---|---|
| Node.js 22+ | Matches Pearl desktop wallet's Node version; modern crypto APIs | use `nvm install 22 && nvm use 22` |
| TypeScript 5+ | Type safety for tx construction | strict mode on |
| `bitcoinjs-lib@^6.1.0` | Mature Bitcoin Taproot library; covers tap-trees, PSBT, address derivation | Patch the network config for Pearl HRP |
| `@noble/secp256k1@^2` | BIP340 Schnorr signing (Taproot requires Schnorr, not ECDSA) | Pure JS, no native deps |
| `@noble/hashes@^1` | SHA256, BLAKE3, tagged hashes for Taproot | Peer of `@noble/secp256k1` |
| `axios` or native `fetch` | JSON-RPC calls to `pearld` | Either works |

Install:

```bash
npm init -y
npm install bitcoinjs-lib@^6 @noble/secp256k1@^2 @noble/hashes@^1 axios
npm install --save-dev typescript @types/node ts-node
npx tsc --init --target es2022 --module commonjs --strict --esModuleInterop true
```

## 2. The Pearl network config (copy-paste)

Bitcoin libraries default to Bitcoin mainnet. Override these constants:

```ts
// src/pearl/network.ts
import type { Network } from 'bitcoinjs-lib';

// Mainnet
export const PEARL_MAINNET: Network = {
  messagePrefix: '\x18Pearl Signed Message:\n',
  bech32: 'prl',                  // <-- the only thing that really matters for P2TR
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },  // BIP32 xpub/xprv prefixes — same as Bitcoin (verify upstream)
  pubKeyHash: 0x00,               // legacy P2PKH version — Pearl is Taproot-only, unused
  scriptHash: 0x05,               // legacy P2SH version — unused
  wif: 0x80,                      // WIF private-key prefix — verify upstream/pearl/chaincfg
};

// Mining is currently on a small set of public testnets too; HRPs not yet documented.
// When you need testnet, grep upstream/pearl/chaincfg for `bech32HRPSegwit`.

// pearld JSON-RPC endpoint. Use your own pearld in dev; mainnet RPC requires auth.
export const PEARL_RPC = {
  url: process.env.PEARL_RPC_URL ?? 'http://127.0.0.1:44107',
  user: process.env.PEARL_RPC_USER ?? '',
  pass: process.env.PEARL_RPC_PASS ?? '',
};
```

> ⚠️ The `bip32` / `pubKeyHash` / `scriptHash` / `wif` values above are inherited from Bitcoin. Pearl may have its own values — **verify by grepping `upstream/pearl/` for `chaincfg` / `params.go`** before relying on them. For pure P2TR operations only `bech32` matters.

## 3. JSON-RPC client (copy-paste)

```ts
// src/pearl/rpc.ts
import axios from 'axios';
import { PEARL_RPC } from './network';

let nextId = 1;

export async function pearlRpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await axios.post(
    PEARL_RPC.url,
    { jsonrpc: '2.0', id: nextId++, method, params },
    {
      auth: PEARL_RPC.user ? { username: PEARL_RPC.user, password: PEARL_RPC.pass } : undefined,
      timeout: 10_000,
    }
  );
  if (res.data.error) throw new Error(`pearld ${method}: ${res.data.error.message}`);
  return res.data.result as T;
}
```

## 4. Hello-world #1 — read chain state

```ts
// src/examples/01-read-chain.ts
import { pearlRpc } from '../pearl/rpc';

async function main() {
  const height = await pearlRpc<number>('getblockcount');
  const tipHash = await pearlRpc<string>('getbestblockhash');
  const tip = await pearlRpc<{ height: number; time: number; tx: string[] }>('getblock', [tipHash]);

  console.log(`Pearl chain tip: height=${height} hash=${tipHash}`);
  console.log(`  mined at ${new Date(tip.time * 1000).toISOString()}, ${tip.tx.length} txs`);
}

main().catch(console.error);
```

Run: `ts-node src/examples/01-read-chain.ts`

Expected: prints current height and tip hash. If this works, your RPC connection is good.

## 5. Hello-world #2 — derive a Pearl address from a private key

```ts
// src/examples/02-derive-address.ts
import * as secp from '@noble/secp256k1';
import { payments } from 'bitcoinjs-lib';
import { PEARL_MAINNET } from '../pearl/network';

function deriveP2TR(privateKeyHex: string): string {
  const privKey = Buffer.from(privateKeyHex, 'hex');
  // BIP340: x-only public key (32 bytes), drop the 02/03 prefix byte
  const fullPubKey = secp.getPublicKey(privKey, true);     // 33-byte compressed
  const xOnlyPubKey = Buffer.from(fullPubKey.slice(1));    // 32-byte x-only

  const { address } = payments.p2tr({
    internalPubkey: xOnlyPubKey,
    network: PEARL_MAINNET,
  });

  if (!address) throw new Error('payments.p2tr returned no address');
  return address;
}

const SAMPLE_PRIV = '0000000000000000000000000000000000000000000000000000000000000001'; // DO NOT USE IN PROD
console.log('Pearl address:', deriveP2TR(SAMPLE_PRIV));
```

Run: `ts-node src/examples/02-derive-address.ts`

Expected: prints a `prl1p…` address. **Verify** by pasting into the Pearl explorer at `https://explorer.pearlresearch.ai/` — it should parse the address (likely empty balance).

> If the output address starts with `bc1p…` instead of `prl1p…`, your network override didn't take effect — check that you imported `PEARL_MAINNET` and passed it as `network:`.

## 6. Hello-world #3 — build and sign a P2TR transaction (do not broadcast yet)

This is a key-path spend (the simplest Taproot spend). It assumes you have a UTXO sitting at the address derived above.

```ts
// src/examples/03-build-sign-tx.ts
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { Psbt, payments } from 'bitcoinjs-lib';
import { PEARL_MAINNET } from '../pearl/network';

interface Utxo {
  txid: string;
  vout: number;
  valueSats: bigint;  // Pearl uses 8-decimal units like BTC; "sats" here means grains
  scriptPubKey: Buffer;
}

async function buildAndSign(
  privateKeyHex: string,
  utxo: Utxo,
  destinationAddress: string,
  amountSats: bigint,
  feeSats: bigint,
): Promise<string> {
  const privKey = Buffer.from(privateKeyHex, 'hex');
  const fullPubKey = secp.getPublicKey(privKey, true);
  const xOnlyPubKey = Buffer.from(fullPubKey.slice(1));

  const { address: fromAddress, output: fromScript } = payments.p2tr({
    internalPubkey: xOnlyPubKey,
    network: PEARL_MAINNET,
  });
  if (!fromAddress || !fromScript) throw new Error('cannot derive from-address');

  const psbt = new Psbt({ network: PEARL_MAINNET });

  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { script: utxo.scriptPubKey, value: Number(utxo.valueSats) },
    tapInternalKey: xOnlyPubKey,
  });

  psbt.addOutput({ address: destinationAddress, value: Number(amountSats) });
  const change = utxo.valueSats - amountSats - feeSats;
  if (change < 0n) throw new Error(`insufficient funds: have ${utxo.valueSats}, need ${amountSats + feeSats}`);
  if (change > 546n) {  // dust threshold; tune for Pearl's policy
    psbt.addOutput({ address: fromAddress, value: Number(change) });
  }

  // Tweak the private key with the Taproot tweak (BIP341)
  const tweakedPriv = Buffer.from(tweakPrivateKey(privKey, xOnlyPubKey));
  psbt.signInput(0, {
    publicKey: xOnlyPubKey,
    network: PEARL_MAINNET,
    sign: (hash) => Buffer.from(secp.schnorr.signSync(hash, tweakedPriv)),
  });

  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

// BIP341 tweak — see https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
function tweakPrivateKey(privKey: Buffer, xOnlyPubKey: Buffer): Uint8Array {
  // Standard tagged hash: TapTweak(internalPubkey || merkleRoot?)
  // For key-only spend (no script tree), no merkle root.
  const tag = sha256(Buffer.from('TapTweak'));
  const tweak = sha256(Buffer.concat([tag, tag, xOnlyPubKey]));
  return secp.utils.privateAdd(privKey, tweak);
}
```

**Do not broadcast this in production without:**
- Running it against simnet first.
- Confirming Pearl's tweak/sighash semantics match Bitcoin BIP341 exactly. The signing code follows BIP341; if Pearl modified the tweak (the whitepaper doesn't say so but verify), this will fail validation.
- Adding fee estimation (see §8).

## 7. Hello-world #4 — broadcast a signed transaction

```ts
// src/examples/04-broadcast.ts
import { pearlRpc } from '../pearl/rpc';

async function broadcast(signedTxHex: string): Promise<string> {
  const txid = await pearlRpc<string>('sendrawtransaction', [signedTxHex]);
  console.log('Broadcast OK, txid:', txid);
  return txid;
}
```

After broadcast, watch for confirmations:

```ts
async function waitForConfirmations(txid: string, target: number = 3) {
  for (;;) {
    const tx = await pearlRpc<{ confirmations?: number }>('getrawtransaction', [txid, true]);
    const confs = tx.confirmations ?? 0;
    console.log(`  confirmations: ${confs}/${target}`);
    if (confs >= target) return;
    await new Promise(r => setTimeout(r, 30_000));  // 30s poll, blocks come every ~194s
  }
}
```

## 8. Things you need to do before going to mainnet

In rough order:

1. **Build `pearld` from source and run a simnet.** Follow `docs/development/local-dev-guide.md` §4–§5.
2. **Run examples 1–4 against your simnet.** Mine yourself some PRL and self-send it. Confirm the txid lands.
3. **Implement fee estimation.** Use Blockbook's `/api/v1/estimatefee/{numBlocks}` against `blockbook.pearlresearch.ai` as a starting point, or build a mempool-aware estimator on top of `pearld`'s `getmempoolinfo`.
4. **Pick a confirmation threshold.** Default to **3 confirmations** (~10 minutes at 194 s/block) for low-value sends, more for high-value. See `docs/FAQ.md` for guidance.
5. **Verify Pearl's `chaincfg` values.** Confirm `bech32`, `wif`, and BIP32 prefixes against `upstream/pearl/` rather than trusting the Bitcoin defaults in §2.
6. **Wire up reorg handling.** Pearl is young; assume occasional 1–2 block reorgs. Make any external side effect (callbacks, DB writes that affect user balance) idempotent on `txid + confirmations`.
7. **Never put a private key in code.** Use env vars in dev, KMS / HashiCorp Vault / hardware wallets in prod.

## 9. What about multisig / escrow / advanced script?

See [`escrow-multisig-on-pearl.md`](escrow-multisig-on-pearl.md). The TL;DR is: same `bitcoinjs-lib` library, you build a tap-tree with `OP_CHECKSIGADD` leaves and optional `OP_CAT` for covenants. Concrete 2-of-3 escrow walkthrough is in that doc.

## 10. What about reading address history / balances?

`pearld` does not expose `getaddressbalance` style RPCs out of the box (it's not an indexer). You have three options:

| Option | When to use |
|---|---|
| Blockbook endpoints at `blockbook.pearlresearch.ai` | Quick dev; **community-operated, don't depend in production** |
| Index the chain yourself by scanning blocks | Production; medium effort |
| Use `oyster` wallet daemon and only track wallet-owned addresses | When the addresses are your wallet's, not arbitrary ones |

## 11. Anti-patterns to avoid

- ❌ **Trying to "deploy a contract" to Pearl.** There is no VM. Re-frame the requirement as off-chain logic with on-chain settlement.
- ❌ **Using ECDSA signatures.** Pearl is Taproot-only; signatures must be BIP340 Schnorr.
- ❌ **Reusing addresses for invoices.** Generate a fresh P2TR per invoice. (Privacy + accounting.)
- ❌ **Treating `api.pearl-otc.com` as an official Pearl data source.** It's a community project. Convenient for dev, don't depend on in prod.
- ❌ **Bumping the upstream submodule without a deliberate task.** Internal doc references break silently.
- ❌ **Building a browser extension before there's a web app that needs signing.** Premature.
- ❌ **Using `OP_CHECKXMSSSIG` in a hot wallet.** XMSS is stateful — reuse of a one-time-signing index leaks the key. Cold-storage / HSM-managed only, and only after a security review.

## 12. Done-criteria for "I built a Pearl app"

A task is done when:

- [ ] Code typechecks and lints clean.
- [ ] Tests cover happy path + at least one failure path.
- [ ] At least one end-to-end run against **simnet** is recorded (txids, screenshots, or logs).
- [ ] No secrets, seeds, or RPC passwords are in the repo.
- [ ] The chain-config values used were verified against `upstream/pearl/` (or the discrepancy is documented).
- [ ] A 1-paragraph README explains how to run it.

## 13. When stuck

1. Read `docs/development/pearl-chain-primer.md` for chain-level mechanics.
2. Read `docs/FAQ.md` for "can I do X" questions.
3. Read `docs/GLOSSARY.md` for unfamiliar terms.
4. Grep `upstream/pearl/` for ground truth.
5. Ask in the Pearl Discord (`discord.gg/joinpearl`) for protocol clarifications.

Don't guess and ship. Pearl is young; the cost of a bug is high.
