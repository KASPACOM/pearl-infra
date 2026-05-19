# Pearl Wallet-Backed Simnet Evidence — 2026-05-19

This records the first wallet-backed PRL-side simnet escrow run. Unlike the
2026-05-18 fixture run, this run used an `oyster` wallet to fund a unique
escrow address and then spend that exact escrow outpoint to the buyer release
address.

This is still not the full `9.8.10` OTC application flow. Base deposit,
settlement-worker orchestration, Base release/refund, and public proof page
verification remain separate gates.

## Environment

- Host: `65.21.206.46`
- Temporary node: `kaspacom-pearld-simnet-wallet-e2e`
- Temporary wallet daemon: `oyster` on host-local `127.0.0.1:19554`
- Temporary indexer: `kaspacom-pearl-indexer-wallet-e2e`
- Temporary Postgres: `kaspacom-pearl-indexer-wallet-e2e-postgres`
- Network: `simnet`
- Indexer API: host-local `http://127.0.0.1:19088`

## Wallet Funding

- Wallet mining address: `rprl1px422q293jkq03wwgz5zas83eppq0ps0cv495yjl78ugsc59yhx0s6fvvy4`
- Oyster wallet balance after maturity: `277712.85167694 PRL`
- Watch ID: `wallet-e2e-1779184866`
- Escrow address: `rprl1p6j5eqtndefwp2vhp7fpz5cd5eypv9q8jzkk2z2qxwd78h877u5kqm80pw9`
- Buyer release address: `rprl1pxqu6hcrs6xzg2n60pjf2yruzr637p73zaettvsyzzzu27zvzhvxqt4xql0`
- Seller refund address: `rprl1pxsnlfuungl0kztjj2rmknxjxanhg5jvweuplxzxnuye6p3dj9g5sw0pp8q`

## Funding Observation

- Funding txid: `70fa6854784b7d58e90679416c65b251fd9aa63ba7857431779e6137d42e8436`
- Funding outpoint: `70fa6854784b7d58e90679416c65b251fd9aa63ba7857431779e6137d42e8436:1`
- Funding block: `08ab482659c15c3a06414a0050e21be0927e40aad6725ea52b91bd87bf1c4a80`
- Funding height: `186`
- Amount: `125000000` grains
- Indexer result before release: `matchStatus=confirmed`, `classification=on_time`

## Release Spend

- Release txid: `bfa470eef67c237364650c8bc8a55f8be97574d980ece0758d0f60b967548cf8`
- Confirming block: `853f5db63398cef269ecac553d4c768e09e0941384a8e3bb7e524a23c56f979f`
- Confirming height: `188`
- Spent outpoint: `70fa6854784b7d58e90679416c65b251fd9aa63ba7857431779e6137d42e8436:1`
- Buyer output amount: `124980000` grains
- Indexer result after release: funding observation moved to `matchStatus=spent`;
  spend classified as `release`, `matchedBy=release_address`.

## Notes

- The wallet-backed funding leg used `oyster` `sendmany`, not direct mining to
  the watched escrow address.
- This Oyster build exposes `signrawtransactionwithwallet` in command discovery
  but returns `Method not found`; the older `signrawtransaction` returns
  `signing arbitrary transactions is not currently implemented`.
- Because arbitrary raw signing is unavailable in this build, the release spend
  used Oyster's own `sendmany` path with all non-escrow wallet UTXOs locked so
  the exact escrow outpoint was spent.
- The repo now has a typed Oyster wallet RPC adapter and signer-client boundary
  wrapper. Real signer-boundary production use still needs either an Oyster
  build that supports raw tx signing or a local/KMS Taproot signer.
