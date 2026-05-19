# Bridge Simnet Rehearsal Evidence - 2026-05-19

This rehearsal uses real Pearl simnet txids from the public Pearl indexer and fresh local Anvil receipts for the Igra bridge contracts.

Limitation: this session did not have writable `pearld` RPC or wallet credentials, so the Pearl deposit/release txids are reused public simnet evidence rather than newly-created Pearl transactions.

## Pearl Evidence

- Deposit txid: `442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164`
- Deposit outpoint: `442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164:0`
- Deposit amount grains: `322963140676`
- Release txid: `22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1`
- Release amount grains: `322963139676`
- Reserve address: `rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v`
- Pearl recipient: `rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye`

## Igra Evidence

- Chain id: `19416`
- WrappedPearl: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- PearlBridge: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- Mint tx: `0x018cc035963b5fe6db9fe0534430adca53cf0b2d9a29019b64ecac28e73500f7`
- Exit request tx: `0x08ad6b0ffaf39f5560f7b428c1f160116339c19b9083f3adceceb87617687cdd`
- Exit process tx: `0xefe16f724a6ac75e55261313191d14bfccf8f65872ca1aab469d6d41a757e8e6`
- Exit id: `0x308b04708492382ce8bca9ca72d1f1a02938fb0a81cb78d4b6cae345b40b9896`

## Results

- Deposit decision: `prepare_mint`
- Exit decision: `prepare_exit_release`
- Igra logs read: `6`
- Spend match: `matched_exit_release`
- Final minted supply grains: `1000`
- Confirmed reserve grains: `322963140676`
- Known reserve spend grains: `322963139676`
- Reserve available grains: `1000`
- Reserve deficit grains: `0`
- Reserve blockers: `none`

Full machine-readable evidence is in [bridge-simnet-rehearsal-evidence-20260519.json](./bridge-simnet-rehearsal-evidence-20260519.json).
