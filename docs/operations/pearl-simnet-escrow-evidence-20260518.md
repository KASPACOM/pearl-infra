# Pearl Simnet Escrow Evidence — 2026-05-18

This records a real PRL-side simnet escrow run on the Hetzner Pearl host
`65.21.206.46`. It proves live `pearld` transaction acceptance, mining, indexer
funding detection, and spend classification for release and refund paths.

This is not the full OTC app flow from `9.8.10`: quote acceptance, Base escrow
deposit/release/refund, settlement-worker orchestration, and public proof
projection still need a separate full run.

## Environment

- Host: `65.21.206.46`
- Temporary node: `kaspacom-pearld-simnet-e2e`
- Temporary indexer: `kaspacom-pearl-indexer-simnet`
- Temporary Postgres: `kaspacom-pearl-indexer-simnet-postgres`
- Network: `simnet`
- Escrow address: `rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v`
- Release address: `rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye`
- Refund address: `rprl1pmfyaqrefev5e5qjvaaazcc08rcrqll9lcq8s2kdwd55psu6a244sa3tedd`

## Funding Observation

- Watch ID: `simnet-e2e-1779131665`
- Funding block: `4ad7c6cce159d28b8467a87efd6cfe08beb24785eb8fa0a97686a67a4d581b9e`
- Funding height: `2`
- Funding outpoint: `442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164:0`
- Amount: `322963140676` grains
- Indexer result: `classification=on_time`, `matchStatus=confirmed`

## Release Spend

- Release txid: `22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1`
- Confirming block: `549eaf125f7c846b32f2cd21cca2c7500c09f6caacc3f24b8ca89b3c24eff099`
- Confirming height: `103`
- Spent outpoint: `442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164:0`
- Output amount: `322963139676` grains
- Indexer result: `classification=release`, `matchedBy=release_address`

## Refund Spend

- Refund txid: `3299a44bf67846ffda160d79b59196b97a788238714b7154b574d785cf09936d`
- Confirming block: `3149ba54f6f58a1900af2bd43d4a7a8780eb05a96956fcfd3484cc0385b9a76a`
- Confirming height: `145`
- Spent outpoint: `06fc95bf605d6d06d6b260e28fe5ec6b0a6aac3fe85799173e0c8e753ae9163e:0`
- Output amount: `322962145293` grains
- Locktime: `144`
- Indexer result: `classification=refund`, `matchedBy=refund_address`

## Notes

- Discrete `generate` RPC worked on simnet after disabling continuous CPU
  mining with `setgenerate false`.
- The release/refund transactions were real signed Taproot key-path spends
  accepted by `pearld` through `sendrawtransaction` and mined into simnet
  blocks.
- A same-address duplicate-watch attempt showed that one observed outpoint is
  owned by one `watch_id`; production must continue allocating unique escrow
  addresses per trade.
