# Full OTC Testnet2 Evidence - 2026-05-21

This run proves the quote -> accept -> wallet-funded PRL -> Base Sepolia
deposit -> PRL release -> Base release -> public proof path with real
testnet2/Base Sepolia transactions.

## Result

- Status: `released`
- Run ID: `20260521160437`
- Trade ID: `trade_f674c08e2d0a278abed79e3e`
- Quote ID: `quote_78f4fc19cb4563074b380b36`
- Pearl escrow: `tprl1p0j2slufysxav9nytd39rmuwyr00yu33c64s4unzdv03pltx85y5s5rq6av`
- Pearl indexer watch: `otc:trade_f674c08e2d0a278abed79e3e:pearl-escrow`
- Base Sepolia escrow: `0xF415eF3bB4b4BF6378ffc5D2D5FCa6b1Ef16f58E`
- Base trade key: `0x4b042261c3e33cc9a7dfc785a1d109ae2e3d1f7450fa94e079d6909f70e3bd73`

## Pearl Proof

- Funding tx: `7001c24759cc1916f720457252ce96ec67882e7211ebea0fbde71bf3f215540a`
- Funding outpoint: `7001c24759cc1916f720457252ce96ec67882e7211ebea0fbde71bf3f215540a:0`
- Release tx: `c919a5d720480166e1dd23ebd638fb38dfd6d40fe573f6e77d14b03715666596`
- Indexed release classification: `release`
- Indexed match: `release_address`
- Release amount: `999889` grains after the required `111` grain Pearl fee.

## Base Sepolia Proof

- Create trade tx: `0x4c83b30320c4118ee4cccc8a434f9a83b6d87d6cdf2b45e314ad86fa4e4940e5`
- Approve USDC tx: `0x6f4f5443d2d567a3bd9fc6de6542f2592e23845f000fc9b08005cee4d380cea9`
- Deposit USDC tx: `0x76fa379bf8ea7696b5ff612e1922211e8f6422a3c5b8aabeec57fa37cbfdd5d0`
- Release USDC tx: `0x32cf31b751a808d98c6694c4463735a1c2d03921818b5756cf397915a95380f6`
- Base terms verification: passed with no mismatches.
- USDC amount: `1700` micros.

## Notes

- The run used the delegated Base Sepolia owner/funder
  `0x537dB45aC71bf8e1f1e28530732FAeabD607778E`; no Sione wallet signature was
  required.
- The final watch was pre-registered with distinct `release_address` and
  `refund_address` metadata. Without that, fee-adjusted Pearl spends can be
  indexed as `unknown_spend` or ambiguous when release/refund addresses are the
  same.
- The one-off local API process used in-memory state, so the opt-in
  `live-full-otc-evidence.test.ts` verifier cannot be rerun after the process
  exits. The runner captured the same public-proof fields before shutdown.
