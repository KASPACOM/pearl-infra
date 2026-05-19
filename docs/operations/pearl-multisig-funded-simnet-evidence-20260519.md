# Pearl Multisig Funded Simnet Evidence - 2026-05-19

This run proves funded Pearl simnet Taproot script-path custody for OTC release,
OTC timeout refund, and a bridge reserve release using the exposed KaspaCom
simnet node and public indexer read API.

## Environment

- Pearl RPC: `http://65.21.206.46:18556/`
- Indexer read API: `http://65.21.206.46:18088`
- Indexer watch registration API: `http://127.0.0.1:18080`
- Source fixture address: `rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v`
- Re-run inputs: `PEARL_SIMNET_RPC_USER`, `PEARL_SIMNET_RPC_PASS`, and
  `PEARL_SIMNET_SOURCE_PRIVATE_KEY_HEX` must be supplied from the environment.
- Source outpoint: `a65db0c51297ff8073c29c333e82d01ecde453d5e05f65e2b4d8925a9b5a24e5:0`
- Funding txid: `d96e430379ec1a47ee616ed2241ce12c636023aadc1b745776fb7448a3fc5882`
- Refund locktime: `154`

## OTC Release

- Watch ID: `multisig-1779211234372-otc-release`
- Escrow address: `rprl1pdgu2ngm8tm569l3307rtat2uylfq5yk0qh92s4z6uxv0cwgvfgwsk3kgp4`
- Funding outpoint: `d96e430379ec1a47ee616ed2241ce12c636023aadc1b745776fb7448a3fc5882:0`
- Release txid: `c653f1363e7ae80a6ef1005dc715e9020b635b1ff9b569c4f76bff64202f6574`
- Indexer classification: `release`

## OTC Refund

- Watch ID: `multisig-1779211234372-otc-refund`
- Escrow address: `rprl1pn8rju9awvm3p2ytzv2d4wv6tr88dnld6e87zaqc89wjqccanz7ps7g6pph`
- Funding outpoint: `d96e430379ec1a47ee616ed2241ce12c636023aadc1b745776fb7448a3fc5882:1`
- Refund txid: `0bfccc7207f778a6ab86cb2dacd2bf13311108eae1371203b55afad818998b19`
- Indexer classification: `refund`

## Bridge Reserve

- Watch ID: `multisig-1779211234372-bridge-reserve`
- Reserve address: `rprl1p6php9qmf0crzqccfjes5nln7uks5q6rxx0v6d6rnhmp2xtrgwdzscnymtr`
- Signer policy: simnet low-cap 2-of-3 P2TR script-path reserve; two reserve signers required for release
- Release txid: `84c8559efc60456f87b4ceae889d3c47102c111201a9fa4119de0149aeb21f8a`
- Indexer classification: `unknown_spend`
- Required `exit_release` classification for this run: `false`
- Deployed indexer has current `exit_release` classifier:
  `false`

## Result

- OTC release path: funded and spent through buyer/seller script-path signatures.
- OTC timeout refund path: funded and spent through seller timeout leaf after CLTV.
- Bridge reserve path: funded and spent through 2-of-3 script-path signatures;
  the deployed simnet indexer observed the spend. If the classification above
  is `unknown_spend`, the deployed scanner is older than the repo code that
  classifies `bridge_reserve` spends as `exit_release`.
- To use this runner as the bridge reserve classifier gate, re-run it with
  `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`; the command fails unless the deployed
  indexer classifies the reserve spend as `exit_release`.

Machine-readable evidence is in
[pearl-multisig-funded-simnet-evidence-20260519.json](./pearl-multisig-funded-simnet-evidence-20260519.json).
