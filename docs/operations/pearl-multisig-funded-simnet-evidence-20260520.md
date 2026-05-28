# Pearl Multisig Funded Simnet Evidence - 2026-05-20

This run proves funded Pearl simnet Taproot script-path custody for OTC release,
OTC timeout refund, and a bridge reserve release using the exposed KaspaCom
simnet node and indexer.

## Environment

- Pearl RPC: `http://kaspacom-pearld-simnet-e2e:18556/` from the host Docker network.
- Indexer read API: `http://kaspacom-pearl-indexer-simnet:8088/` from the host Docker network.
- Indexer watch registration API: `http://kaspacom-pearl-indexer-simnet:8088/` from the host Docker network.
- Source fixture address: `rprl1p87zy95nv4u36xjjc4d6t9daqde90a73naqwjhh8dmntz0wzen4csg9s9zg`
- Source outpoint: `2610adfb5cc6f3294753e363d84e75e111e0402ff7ab858f0c19325188d9af2d:0`
- Funding txid: `f1a315b9fb9d3a220e5ec097bfb3e8633f458fb256fe42e4f6ad063d9825a02e`
- Refund locktime: `274`

## OTC Release

- Watch ID: `multisig-pr88-1779272704-otc-release`
- Escrow address: `rprl1pardjhv5qrye8eh9xzevs7pfu4kge4v9ns2780tvjm6257fxd63hs38tzwg`
- Funding outpoint: `f1a315b9fb9d3a220e5ec097bfb3e8633f458fb256fe42e4f6ad063d9825a02e:0`
- Release txid: `31673ee5314349fcbe87dfcae3f79f5de3fdb340a3f4359d5bf14f78385d4de6`
- Indexer classification: `release`

## OTC Refund

- Watch ID: `multisig-pr88-1779272704-otc-refund`
- Escrow address: `rprl1pd3g702df6elc8z07ps658t6h29rvgrsuz4ycqu3yynea9ytpnjmsegk2lp`
- Funding outpoint: `f1a315b9fb9d3a220e5ec097bfb3e8633f458fb256fe42e4f6ad063d9825a02e:1`
- Refund txid: `af83c722411a822eb0644dfdfd4dbdb59cee98dc1e251f7ef0a4981f83261dda`
- Indexer classification: `refund`

## Bridge Reserve

- Watch ID: `multisig-pr88-1779272704-bridge-reserve`
- Reserve address: `rprl1p4p2cgjcda76fg3vt74tjt5dcat3mteu9gl7lu7ewexcekq6em6lqjhs0wj`
- Signer policy: simnet low-cap 2-of-3 P2TR script-path reserve; two reserve signers required for release
- Release txid: `8dfcc3c78c839fe9954d553bb9b7ffd76dfb8471d61a5a7b7d14747d536c517a`
- Indexer classification: `exit_release`
- Required `exit_release` classification for this run:
  `true`
- Deployed indexer has current `exit_release` classifier:
  `true`

## Result

- OTC release path: funded and spent through buyer/seller script-path signatures.
- OTC timeout refund path: funded and spent through seller timeout leaf after CLTV.
- Bridge reserve path: funded and spent through 2-of-3 script-path signatures;
  the redeployed simnet indexer observed the spend and classified it as
  `exit_release` with `amount_grains` and `pearl_recipient` metadata.
  The proof was run with `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`, so it would have
  failed closed if the deployed scanner still returned `unknown_spend`.

Machine-readable evidence is in
[pearl-multisig-funded-simnet-evidence-20260520.json](./pearl-multisig-funded-simnet-evidence-20260520.json).
