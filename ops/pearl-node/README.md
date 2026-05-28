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

## Hardware Sizing

These are MVP operator targets, not upstream Pearl protocol minimums.

### Testnet / Simnet Development

- 2 vCPU
- 4 GB RAM
- 50-100 GB SSD
- Docker on Ubuntu 22.04/24.04
- RPC bound to localhost or a private network

### Mainnet Node + Marketplace Indexer

- 4 vCPU minimum; 8 vCPU preferred once indexer load grows
- 8 GB RAM minimum; 16 GB preferred
- 200-500 GB NVMe SSD with room to grow
- 100 Mbps network minimum
- static IP or stable private networking
- volume snapshots/backups for node and indexer data
- separate Postgres volume/database for marketplace state

No GPU is required for a non-mining OTC node/indexer. GPU hardware is only needed if KaspaCom also runs Pearl useful-work mining or inference services.

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

## Testnet2 Deployment Checklist

Use this checklist before any `testnet2-base-sepolia` OTC evidence run.

- Create secrets using the names in
  [`otc-deployment-env-contract.md`](../../docs/operations/otc-deployment-env-contract.md):
  `pearl-node-testnet2-rpc` and `pearl-indexer-testnet2-db`.
- Confirm `PEARLD_MINING_ADDRESS` is a testnet2 address, not a mainnet address.
- Start `pearld` with RPC bound to localhost or the private Docker/Kubernetes
  network only.
- Confirm P2P `44112` is reachable from peers when using the single-machine
  Docker profile.
- Confirm RPC `44111` is not publicly reachable.
- Run `getblockcount`, `getbestblockhash`, and `getrawmempool`.
- Record node image tag/digest, volume name, RPC bind address, P2P bind address,
  and first healthy block height in the evidence note.
- Start the Pearl indexer against this node and confirm it advances
  `indexer_state.next_height`.
- Register and close one disposable watched-address entry through the private
  watched-address API.
- Compare one recent block or tx against public Blockbook as a cross-check only.

## MVP Definition Of Done

- `pearld` starts and syncs.
- RPC is reachable only from localhost or private network.
- `getblockcount`, `getbestblockhash`, and `getrawmempool` return data.
- Indexer can ingest tip and registered escrow watches from this node.
- Public Blockbook can be used for cross-checking, not primary state.
