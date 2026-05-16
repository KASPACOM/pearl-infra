# Pearl Public Endpoints And Node Strategy

## Short Answer

For the Pearl OTC desk, the MVP SHALL run a KaspaCom-owned Pearl node and indexer. Pearl Research Labs' public Blockbook endpoints are useful for comparison, development acceleration, and fallback reads, but they must not be the primary source for release/refund decisions.

For simple non-money apps, public Blockbook can still be enough. For escrow, we self-host from day one.

## Endpoint Map

| Endpoint | Operator | Status | Use |
|---|---|---|---|
| `https://blockbook.pearlresearch.ai` | Pearl Research Labs | Public mainnet Blockbook | Mainnet reads, address history, UTXOs, fee estimation, possible tx broadcast after verification |
| `https://blockbook.testnet.pearlresearch.ai` | Pearl Research Labs | Public testnet Blockbook | Testnet/Testnet2 reads and testing |
| `https://explorer.pearlresearch.ai` | Pearl Research Labs | Public UI | Human explorer UI, not an app API dependency |
| `https://api.pearl-otc.com/chain/*` | Third-party/community OTC app | Public but not canonical | Quick dev and market comparison only |
| Public `pearld` JSON-RPC | None currently documented | Not available | Run our own for direct node RPC |

## Do We Need Our Own Node?

| Operation | Need our own node? | Reason |
|---|---|---|
| Read chain stats | Not strictly | Blockbook/public APIs can serve reads, but OTC MVP should read from our own node first |
| Look up tx by ID | Not strictly | Blockbook can serve it, but OTC proof state should use our indexer |
| Address balance, UTXOs, history | Not strictly | Blockbook can serve it, but escrow watches should use our indexer |
| Fee estimation | Not strictly | Blockbook exposes `/api/v1/estimatefee/{numBlocks}`; our node should provide fallback estimator data |
| Broadcast signed tx | Use our node for OTC | Blockbook-style `sendtx` can be a fallback only after verification |
| Subscribe to new blocks | Better with our own | Public websocket reliability is unknown |
| Custom indexing, inscriptions, OP_RETURN parsing | Yes | Public endpoints do not provide KaspaCom-specific indexes |
| Escrow watcher with reorg handling | Yes eventually | Money flows should not rely on a third-party indexer |
| Paid product SLA | Yes | We cannot be down because someone else's indexer is down |

## Product Guidance

### MVP

Run our own node/indexer and use public Blockbook as a secondary source:

- chain tip
- tx lookup
- address UTXOs
- fee estimate
- dev/test broadcast cross-checks after verifying `sendtx`

The MVP must keep a clean adapter boundary so public Blockbook and our own node can be compared without changing product logic.

### Production OTC Desk

Run:

- at least one mainnet `pearld`
- one marketplace-focused indexer
- one Arbitrum RPC/indexer path for USDC escrow events
- alerting for lag, reorgs, and failed broadcasts

Recommended production rule:

- Blockbook is acceptable as a fallback data source.
- Our own indexed node is the primary source for release/refund decisions.

### Inscriptions Or Custom Protocols

Run our own indexer from day one. Public Blockbook can tell us transactions and scripts, but it will not maintain application-specific protocol state.

## Known Network Notes

- Mainnet Bech32m HRP: `prl`, addresses start `prl1p`.
- Testnet address prefix observed from upstream notes: `tprl1`.
- Current public testnet should be treated as Testnet2 (`--testnet2`) until upstream says otherwise.

## Verification Still Needed

- Confirm Pearl Blockbook supports `POST /api/v2/sendtx/` on testnet with a harmless signed testnet transaction.
- Confirm exact testnet/testnet2 HRP from `upstream/pearl/node/chaincfg/params.go`.
- Confirm websocket subscription behavior and reconnect semantics.
- Confirm whether Blockbook reports enough script details for escrow proof pages.
