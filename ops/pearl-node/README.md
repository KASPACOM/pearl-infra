# Pearl Node MVP Runbook

## Goal

Run a KaspaCom-owned Pearl node for the OTC MVP so escrow funding, release, refund, and proof decisions are not dependent on third-party public endpoints.

Public Blockbook remains useful for comparison and fallback, but the trade state machine should read from our own indexed node first.

## MVP Topology

```text
pearld mainnet/testnet2
  |
  | JSON-RPC, localhost/private network only
  v
pearl-indexer
  |
  v
otc trade state machine / proof API
```

## Ports

| Network | RPC | P2P | Wallet Server |
|---|---:|---:|---:|
| Mainnet | 44107 | 44108 | 44207 |
| Testnet | 44109 | 44110 | 44209 |
| Testnet2 | 44111 | 44112 | 44211 |
| Simnet | 18556 | 18555 | 18554 |
| Regtest | 18334 | 18444 | 18332 |

## Secrets

Do not commit a real `.env`.

Required runtime environment:

```bash
PEARLD_RPC_USER=...
PEARLD_RPC_PASS=...
PEARLD_MINING_ADDRESS=prl1p...
```

The mining address can be an operator-controlled address. For non-mining indexer use, it is still required by the startup pattern in upstream docs when block template/mining paths are enabled.

## Mainnet Docker Compose

Use `docker-compose.mainnet.yml` as the starting template.

Important defaults:

- P2P is exposed on `44108`.
- RPC is bound to `127.0.0.1:44107` on the host.
- `--txindex` is enabled for transaction lookup.
- RPC credentials come from environment variables.

Start:

```bash
cd ops/pearl-node
docker compose -f docker-compose.mainnet.yml up -d
```

Health check:

```bash
curl --user "$PEARLD_RPC_USER:$PEARLD_RPC_PASS" \
  --data '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' \
  -H 'content-type: application/json' \
  http://127.0.0.1:44107
```

## Testnet2 Docker Compose

Use `docker-compose.testnet2.yml`.

Start:

```bash
cd ops/pearl-node
docker compose -f docker-compose.testnet2.yml up -d
```

Health check uses port `44111`.

## MVP Definition Of Done

- `pearld` starts and syncs.
- RPC is reachable only from localhost or private network.
- `getblockcount`, `getbestblockhash`, and `getrawmempool` return data.
- Indexer can ingest tip and registered escrow watches from this node.
- Public Blockbook can be used for cross-checking, not primary state.
