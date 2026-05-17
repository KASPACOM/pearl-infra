# Pearl Development Docs

Start here if you are new to Pearl or this repo.

## Guides

0. **[`quickstart.md`](quickstart.md) — Start here if you are about to write code.** The agent build manual: exact deps, network config, copy-paste hello-world examples (read chain, derive address, build+sign tx, broadcast), anti-patterns, done-criteria.
1. [`local-dev-guide.md`](local-dev-guide.md) — clone, initialize submodule, install toolchains, build upstream Pearl, run local node/wallet, use public APIs.
2. [`pearl-chain-primer.md`](pearl-chain-primer.md) — how Pearl works: UTXO ledger, node/wallet split, RPCs, mining, SPV, and current smart-contract limitations.
3. [`pearl-app-development.md`](pearl-app-development.md) — how KaspaCom should build Pearl apps: chain-data adapters, wallet SDK, Pearl Pay, OTC tools, compute marketplace control plane.
4. [`escrow-multisig-on-pearl.md`](escrow-multisig-on-pearl.md) — multisig wallets, escrow patterns, tapscript construction, 2-of-3 worked example. **Pure Taproot, no OP_CAT needed.**
5. [`public-endpoints.md`](public-endpoints.md) — what public Pearl endpoints exist, when public Blockbook is enough, and when KaspaCom needs its own node/indexer.
6. [`covenants-on-pearl.md`](covenants-on-pearl.md) — what OP_CAT unlocks (vaults, recovery wallets, amount-caps) and what it is NOT needed for (escrow/multisig).
7. [`pearl-escrow-signer-custody.md`](pearl-escrow-signer-custody.md) — MVP OTC signer boundary, custody model, XMSS policy, and recovery-package rules.

## Golden Rules

- Treat Pearl as Bitcoin-style UTXO until proven otherwise.
- Do not assume EVM/Solidity/WASM smart contracts.
- Do not duplicate Pearl’s public explorer UI unless a product gap is proven.
- Build SDK/data/payment rails first; browser extension later when apps need signing.
- Never commit seeds, private keys, wallet DBs, RPC passwords, generated certs, or `.env` files.
