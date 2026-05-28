# Pearl OTC Monitoring Contract

This document defines the minimum monitoring checks that must be live before
production-like OTC settlement runs. Alerts should fail closed: automatic
release/refund preparation stops for affected trades until the signal recovers
and an operator records the replay result.

## Alert Routing

- Route critical alerts to the OTC operator channel and an on-call page.
- Include environment, trade ID or watch ID when available, latest observed
  height/block, and the runbook section to follow.
- Do not include RPC credentials, xpubs, signer paths, or raw environment
  values in alert payloads.

## Node And Indexer Checks

| Check | Query/source | Critical threshold | Action |
|---|---|---|---|
| Pearl node RPC health | `getblockcount`, `getbestblockhash` | RPC unavailable for 2 polling intervals | pause settlement worker |
| Pearl node lag | compare node height to trusted/public reference | node behind by `> 12` blocks for 10 minutes | stale indexer/manual review |
| Indexer lag | `indexer_state.next_height` vs node tip | behind by `> 6` blocks for 5 minutes | stale indexer/manual review |
| Indexer poll stale | last indexed block update time | no update for `> 2 * PEARL_INDEXER_POLL_INTERVAL_MS` while node advances | restart indexer after snapshot |
| Reorg replay active | detached observations/spends in recent window | any open trade touched by detach | block auto settlement |
| Watched-address API | `GET /healthz` and read known watch | unavailable for 2 intervals | block new quote acceptance |

Postgres check examples:

```sql
-- latest indexed height per environment
SELECT key, value, updated_at
FROM indexer_state
WHERE key IN ('next_height');

-- stale active watches without recent observations
SELECT watch_id, address, purpose, created_at, updated_at
FROM watched_addresses
WHERE status = 'active'
  AND updated_at < NOW() - INTERVAL '30 minutes';

-- reorged or unsafe observations on open watches
SELECT watch_id, txid, vout, status, match_status, block_height, updated_at
FROM address_observations
WHERE status IN ('detached', 'reorged')
   OR match_status IN ('late', 'underpaid', 'overpaid', 'duplicate', 'unknown');
```

## OTC API Checks

| Check | Query/source | Critical threshold | Action |
|---|---|---|---|
| API health | HTTP health route | unavailable for 2 intervals | block new quotes |
| Production config | startup logs / config check | any mock allocator or zero Base contract in production | fail deploy |
| Quote acceptance failures | app logs / side-effect table | watch registration failures `> 0` in 5 minutes | block acceptance |
| Idempotency conflicts | API 409 count | sudden increase or repeated client key | inspect clients |
| Term verification mismatch | side-effect or API error logs | any open trade mismatch | manual review |

Operational SQL examples:

```sql
-- side effects that failed or changed payload under same idempotency key
SELECT trade_id, effect_type, idempotency_key, status, error, updated_at
FROM otc_side_effects
WHERE status IN ('failed', 'conflict')
ORDER BY updated_at DESC;

-- trades whose deadlines have passed but are not terminal
SELECT trade_id, state, deadlines, updated_at
FROM otc_trades
WHERE state NOT IN ('released', 'refunded', 'cancelled', 'failed_manual_review')
  AND (
    (payload->'deadlines'->>'pearlFundingDeadline')::timestamptz < NOW()
    OR (payload->'deadlines'->>'usdcDepositDeadline')::timestamptz < NOW()
    OR (payload->'deadlines'->>'settlementDeadline')::timestamptz < NOW()
  );
```

## Settlement Worker And Signer Checks

| Check | Query/source | Critical threshold | Action |
|---|---|---|---|
| Worker iteration freshness | worker heartbeat/log timestamp | no iteration for `> 2 * SETTLEMENT_WORKER_POLL_INTERVAL_MS` | stop auto settlement |
| Decision duplicate rate | decision repository | duplicate decisions for same new source event | inspect idempotency |
| Failed broadcasts | broadcast attempt ledger | any failed PRL or USDC broadcast | manual review |
| Pending signed tx age | signer request store + broadcast ledger | signed for `> 5 minutes` without broadcast result | pause worker |
| Signer paused | `PEARL_SIGNER_PAUSED=true` | informational unless unexpected | keep worker read-only |
| Signer policy mismatch | audit record vs configured key/caps | any mismatch | emergency pause |

Signer audit checks:

```text
- every signed record has exactly one idempotency key;
- `signerKeyId` is in `PEARL_SIGNER_ALLOWED_KEY_IDS`;
- fee is <= action cap;
- tx template hash matches the recovery package;
- signed txid is present before broadcaster handoff;
- no signer audit record contains raw private key, seed, mnemonic, or RPC URL.
```

## Base Escrow Checks

| Check | Query/source | Critical threshold | Action |
|---|---|---|---|
| Base RPC health | latest block / chain ID | unavailable for 2 intervals | block deposit verification |
| Escrow event lag | last indexed Base event block vs RPC head | behind by `> 20` Base blocks | stale Base/manual review |
| Duplicate events | same source event ID or trade key transition replay | any conflict | inspect event store |
| Deadline breach | deposits close to expiry or past expiry | deposit window `< 5 minutes`; past expiry and still pending | alert operator |
| Mismatched terms | contract state vs backend quote | any mismatch | hide deposit action/manual review |

## Manual-Review Backlog

Page when any of these are true:

- `failed_manual_review` trades exceed 5 open items;
- any manual-review item is older than 30 minutes;
- any trade is in `late_prl_funding`, `unknown_spend`, `reorged`, or
  `prl_release_failed`;
- any open trade has both a Pearl spend and Base refund/release event that do
  not match the expected sequence.

Operator response:

1. Open the trade detail and compare Pearl watch history, Base event history,
   side effects, and signer audit record.
2. Stop new quote acceptance if more than one trade shares the same failure
   mode.
3. Record the final decision with source txids/outpoints and operator note.

## Pre-Settlement Dashboard

The minimum dashboard before live evidence runs:

- Pearl node height, best hash, RPC status;
- Pearl indexer next height, last indexed block time, active watch count;
- stale/late/underpaid/overpaid/duplicate/unknown watch counts;
- Base RPC chain ID/head, escrow event lag, duplicate event count;
- open trades by state and age;
- deadline breach counts for Pearl funding, USDC deposit, settlement, refund;
- signer request counts by status and oldest pending age;
- broadcast attempts by status and oldest failed attempt;
- manual-review count and oldest item age.
