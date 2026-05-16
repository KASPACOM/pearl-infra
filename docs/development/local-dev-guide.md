# Pearl Local Development Guide

This guide is for KaspaCom developers who need to run this repo locally, inspect upstream Pearl, and start building Pearl apps safely.

## 0. What This Repo Is

`pearl-infra` is not a production app yet. It is the KaspaCom learning, planning, and integration repo for Pearl ecosystem apps.

It contains:

- planning specs under `docs/openspec/pearl-infra-ecosystem/`;
- resource maps under `docs/resources.md`;
- a pinned upstream Pearl submodule at `upstream/pearl`;
- developer learning guides under `docs/development/`.

Do not commit secrets, wallets, seeds, private keys, RPC passwords, `.env` files, or real mainnet custody material.

## 1. Clone And Initialize

```bash
git clone git@github.com:marciano147/Pearl-infra-ecosystem.git
cd Pearl-infra-ecosystem
git submodule update --init --recursive
```

The upstream Pearl source is pinned here:

```bash
git -C upstream/pearl rev-parse HEAD
# expected: 0c8cef72da75d10ffd52ac20d3c0b075d9d9f1f7
```

If the submodule is missing or empty:

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

## 2. Read These First

In this repo:

1. `README.md` — repo purpose and non-goals.
2. `docs/resources.md` — all important links, API endpoints, and source paths.
3. `docs/development/pearl-chain-primer.md` — how Pearl works.
4. `docs/development/pearl-app-development.md` — how to build apps on Pearl.
5. `docs/next-steps.md` — current recommended build order.

In upstream Pearl:

1. `upstream/pearl/README.md`
2. `upstream/pearl/node/docs/json_rpc_api.md`
3. `upstream/pearl/wallet/README.md`
4. `upstream/pearl/wallet/rpc/documentation/api.md`
5. `upstream/pearl/apps/apps/pearl-desktop-wallet/README.md`
6. `upstream/pearl/miner/README.md`
7. `upstream/pearl/miner/pearl-gateway/README.md`
8. `upstream/pearl/spv/README.md`

## 3. Toolchain Requirements

For reading docs and building KaspaCom app scaffolds, normal Node/TypeScript tooling is enough once implementation starts.

For building upstream Pearl itself, upstream currently requires:

- Go `1.26` or newer;
- Rust stable toolchain;
- C/C++ compiler;
- `task` / `go-task` runner;
- Python `3.12` and `uv` for miner packages;
- Node.js `22+` and `pnpm` for desktop wallet apps;
- CUDA + NVIDIA GPU only for GPU miner/vLLM work.

Check local versions:

```bash
go version
rustc --version
cargo --version
task --version
python3 --version
uv --version
node --version
pnpm --version
```

If a developer only needs to work on app SDKs, they do **not** need CUDA.

## 4. Build Upstream Pearl Blockchain Binaries

From the upstream submodule root:

```bash
cd upstream/pearl
task build:blockchain
```

This builds:

- `bin/pearld` — full node;
- `bin/prlctl` — CLI/RPC tool;
- `bin/oyster` — wallet daemon.

If this fails, read the full error. Common causes:

- Go version too old;
- Rust/C compiler missing;
- `task` missing;
- CGO/XMSS/ZK FFI build dependency missing.

Do not mark local setup complete until `task build:blockchain` succeeds or the exact blocker is documented.

## 5. Run A Safe Local Node

Prefer `simnet` or `regtest` while learning. Do not use mainnet wallets for experiments.

### 5.1 Create A Wallet

```bash
cd upstream/pearl
./bin/oyster -u rpcuser -P rpcpass --simnet --create
```

Record the generated seed somewhere safe **outside git**. For throwaway dev work, use only temporary/local wallets.

### 5.2 Start Oyster Wallet Daemon

```bash
./bin/oyster \
  -u rpcuser \
  -P rpcpass \
  --simnet \
  --rpcconnect=127.0.0.1:18556 \
  --noservertls \
  --noclienttls
```

Notes:

- Oyster is the wallet process.
- It talks to `pearld` over websocket RPC.
- `--noservertls` and `--noclienttls` are acceptable only for localhost throwaway development. Do not use them for public/mainnet services.
- For TLS mode, use `pearld`'s generated RPC cert. Upstream defaults point at the Pearl node cert when available; see `upstream/pearl/wallet/sample-oyster.conf` and `wallet/config.go`.

### 5.3 Get A Mining Address

In another terminal:

```bash
cd upstream/pearl
./bin/prlctl \
  -u rpcuser \
  -P rpcpass \
  -s http://localhost:18554 \
  getnewaddress
```

Use the returned Taproot address as the mining address.

### 5.4 Start pearld

```bash
./bin/pearld \
  --simnet \
  --rpcuser=rpcuser \
  --rpcpass=rpcpass \
  --rpclisten=127.0.0.1:18556 \
  --listen=127.0.0.1:18555 \
  --miningaddr=<your-taproot-address> \
  --txindex \
  --notls \
  --debuglevel=info
```

Port reference from upstream README:

| Network | Node RPC | P2P | Wallet server |
|---|---:|---:|---:|
| Mainnet | `44107` | `44108` | `44207` |
| Testnet | `44109` | `44110` | `44209` |
| Testnet2 | `44111` | `44112` | `44211` |
| Simnet | `18556` | `18555` | `18554` |
| Regtest | `18334` | `18444` | `18332` |

### 5.5 Query The Node

```bash
./bin/prlctl \
  -u rpcuser \
  -P rpcpass \
  -s http://localhost:18556 \
  getblockcount

./bin/prlctl \
  -u rpcuser \
  -P rpcpass \
  -s http://localhost:18556 \
  getmininginfo
```

Useful node RPCs for app developers:

- `getblockcount`
- `getbestblockhash`
- `getblockhash`
- `getblock`
- `getblockheader`
- `getrawtransaction`
- `getrawmempool`
- `getmempoolinfo`
- `getmininginfo`
- `validateaddress`
- `sendrawtransaction`

## 6. Run The Desktop Wallet App

The upstream desktop wallet is useful as a reference for UX, wallet process orchestration, and RPC usage.

```bash
cd upstream/pearl
task build:blockchain

# Linux x64 example
cp bin/oyster apps/apps/pearl-desktop-wallet/bin/oyster-linux-x64

cd apps
pnpm install
pnpm --filter @pearl/pearl-desktop-wallet dev
```

Platform binary names:

| Platform | File expected in `apps/apps/pearl-desktop-wallet/bin/` |
|---|---|
| macOS Apple Silicon | `oyster-darwin-arm64` |
| macOS Intel | `oyster-darwin-x64` |
| Linux x64 | `oyster-linux-x64` |
| Windows x64 | `oyster-windows-x64.exe` |

Reference files:

- `upstream/pearl/apps/apps/pearl-desktop-wallet/src/main/services/rpc-client.ts`
- `upstream/pearl/apps/apps/pearl-desktop-wallet/src/main/services/wallet-service/wallet-rpc-methods.ts`
- `upstream/pearl/apps/apps/pearl-desktop-wallet/src/types/app-bridge.ts`
- `upstream/pearl/apps/apps/pearl-desktop-wallet/src/main/clients/blockbook-client.ts`
- `upstream/pearl/apps/apps/pearl-desktop-wallet/src/main/config/network-config.ts`

## 7. Use Public Read-Only Data While Learning

Existing public surfaces:

```bash
curl -s https://api.pearl-otc.com/chain/stats | jq .
curl -s 'https://api.pearl-otc.com/chain/recent-blocks?limit=3' | jq .
curl -s 'https://api.pearl-otc.com/chain/recent-txs?limit=10' | jq .
curl -s 'https://api.pearl-otc.com/chain/top-miners?window_blocks=500&limit=10' | jq .
curl -s https://api.pearl-otc.com/offers | jq '.[0:5]'
curl -s 'https://huggingface.co/api/models?author=pearl-ai' | jq 'map({id, downloads, likes, tags})'
```

Explorer:

- `https://explorer.pearlresearch.ai/?network=mainnet`

Blockbook-style endpoints seen in wallet source:

- `http://blockbook.pearlresearch.ai`
- `http://blockbook.testnet.pearlresearch.ai`
- known path: `/api/v1/estimatefee/{numBlocks}`

## 8. What To Build Locally First

Do not start with a duplicate explorer UI or a browser extension.

Recommended first implementation work:

1. `packages/pearl-rpc`
   - typed JSON-RPC client for `pearld`;
   - typed Blockbook/public data adapter;
   - network config constants;
   - mock fixtures.
2. `packages/pearl-sdk`
   - address validation wrapper;
   - payment request schema;
   - transaction lifecycle types.
3. `services/chain-data-api`
   - `/health`;
   - `/chain/stats`;
   - `/blocks/recent`;
   - `/tx/:txid`;
   - `/address/:address`;
   - self-hosted `pearld` adapter first for OTC;
   - public Blockbook adapter as fallback/cross-check.

## 9. Verification Checklist For Devs

Before saying local setup works:

- [ ] repo cloned;
- [ ] submodule initialized;
- [ ] `git -C upstream/pearl rev-parse HEAD` matches pinned commit;
- [ ] required tool versions checked;
- [ ] upstream blockchain binaries built or blocker documented;
- [ ] a safe simnet/regtest/testnet path is used;
- [ ] no seeds/passwords committed;
- [ ] at least one public data command or local RPC command returns data.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| submodule folder empty | submodule not initialized | `git submodule update --init --recursive` |
| `task: command not found` | go-task missing | install Task from https://taskfile.dev |
| build fails on Go version | Go too old | install upstream-required Go `1.26+` |
| Rust/FFI errors | Rust/C compiler missing | install Rust stable + build-essential/Xcode tools |
| wallet cannot connect to node | wrong port/network/TLS cert | match `--simnet`/`--testnet`, RPC port, and cert settings |
| RPC auth failure | wrong `rpcuser`/`rpcpass` | keep same credentials for `pearld`, `oyster`, and `prlctl` |
| desktop wallet cannot find oyster | binary not copied/renamed | copy `bin/oyster` to expected platform filename |
| CUDA/miner failures | no supported GPU/toolchain | skip miner work unless specifically assigned |
