# Bridge Simnet Rehearsal Evidence - 2026-05-20

This rehearsal uses fresh Pearl simnet txids from the writable multisig proof evidence and fresh local Anvil receipts for the Igra bridge contracts.

Limitation: Igra is exercised on local Anvil while Galleon is unavailable; the Pearl reserve deposit/release txids come from the latest writable simnet proof artifact.

## Pearl Evidence

- Deposit txid: `f1a315b9fb9d3a220e5ec097bfb3e8633f458fb256fe42e4f6ad063d9825a02e`
- Deposit outpoint: `f1a315b9fb9d3a220e5ec097bfb3e8633f458fb256fe42e4f6ad063d9825a02e:2`
- Deposit amount grains: `127000000`
- Pearl evidence source: `/root/work/pearl-fresh-simnet/docs/operations/pearl-multisig-funded-simnet-evidence-20260520.json`
- Pearl evidence run id: `multisig-pr88-1779272704`
- Release txid: `8dfcc3c78c839fe9954d553bb9b7ffd76dfb8471d61a5a7b7d14747d536c517a`
- Release amount grains: `126990000`
- Reserve address: `rprl1p4p2cgjcda76fg3vt74tjt5dcat3mteu9gl7lu7ewexcekq6em6lqjhs0wj`
- Pearl recipient: `rprl1pxvzzgg6epudglal2hxundqs4euxvsjjsz5uxmfmeaj2ydvgx8kysnyc4gp`

## Igra Evidence

- Chain id: `19416`
- WrappedPearl: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- PearlBridge: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- Mint tx: `0x0243886d2d8e759d282dc180fb2bf28bf08061c7178ae0b913cbfb2564eb5fa1`
- Exit request tx: `0x876a706e78f9fb8dd386b3641a13220b8dcf7dc90a928eae0e84aa13463eb33e`
- Exit process tx: `0xf0f401150c88f5a4f95b9be6d0f7174f595a6bfb8c9e294a6b92f735796b9d7b`
- Exit id: `0x4b4d5b8f3b313d6bf8e909e22d0c18232ac63baa3d118f3e77b5199da73a7c17`

## Results

- Deposit decision: `prepare_mint`
- Exit decision: `prepare_exit_release`
- Igra logs read: `6`
- Spend match: `matched_exit_release`
- Final minted supply grains: `10000`
- Confirmed reserve grains: `127000000`
- Known reserve spend grains: `126990000`
- Reserve available grains: `10000`
- Reserve deficit grains: `0`
- Reserve blockers: `none`

Full machine-readable evidence is in [bridge-simnet-rehearsal-evidence-20260520.json](./bridge-simnet-rehearsal-evidence-20260520.json).
