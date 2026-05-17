# Pearl OTC Operator Runbook

This runbook is for the human operator path while Pearl OTC is still in MVP mode. The default rule is fail closed: when a chain observation is late, stale, ambiguous, or inconsistent, do not release either escrow leg automatically.

## Normal Release Checklist

Before releasing funds, confirm all of the following from the trade API, Pearl indexer, and Base escrow contract:

- trade state is an active settlement state, not an edge/manual-review state;
- current time is before `settlement_deadline`;
- Pearl funding was observed before `pearl_funding_deadline`;
- USDC deposit was observed before `usdc_deposit_deadline`;
- Pearl funding amount matches expected grains and required confirmations;
- USDC deposit amount, seller, buyer, fee, expiry, contract, token, chain ID, and trade key match backend terms;
- neither leg is reorged, detached, stale, underpaid, overpaid, duplicated, refunded, released, cancelled, or unknown;
- no release/refund side-effect idempotency key has already succeeded.

Only after this checklist passes may the settlement worker broadcast PRL release and release USDC.

## Late PRL Funding

Trigger: Pearl funding output is first observed after `pearl_funding_deadline`, or funding becomes valid only after the deadline due to reorg/replay.

Operator action:

- move the trade to `late_prl_funding` and then `failed_manual_review`;
- never release late PRL to the buyer;
- verify whether the USDC leg is still deposited, refunded, or expired;
- if USDC is still escrowed and no PRL release happened, prefer buyer USDC refund;
- coordinate seller PRL refund through the Pearl refund path once it is eligible;
- record the late outpoint, observed height, observed time, and decision note.

Protection goal: a buyer who already recovered USDC cannot receive late seller PRL.

## Refunded USDC

Trigger: Base escrow reports `Refunded`, buyer refund tx confirms, or the contract state is no longer `Deposited`.

Operator action:

- move the trade to `usdc_refunded` and then `failed_manual_review`;
- block PRL release, even if Pearl funding appears later;
- verify whether Pearl funds exist and whether the seller refund path is available;
- if PRL is funded, return PRL to seller through the Pearl refund path;
- record refund tx hash, block number, refund actor, and contract state.

Protection goal: PRL release requires USDC still deposited. Once USDC is refunded, buyer PRL release is permanently disallowed for that trade.

## Failed PRL Release

Trigger: the settlement worker attempted PRL release and broadcast failed, produced no txid, or produced a txid that did not confirm inside the configured window.

Operator action:

- move the trade to `prl_release_failed` and then `failed_manual_review`;
- keep USDC escrowed if it is still `Deposited`;
- do not release USDC to the seller until Pearl release is confirmed;
- inspect the failed transaction package for signing, fee, input, sequence, locktime, and policy errors;
- if PRL release cannot be repaired, refund USDC according to the contract path and return PRL through the Pearl refund path when eligible;
- record attempted txid or broadcast error, worker idempotency key, and final operator decision.

Protection goal: seller USDC release requires confirmed PRL release, not just an attempted broadcast.

## Unknown Pearl Spend

Trigger: a watched Pearl escrow outpoint is spent, but the indexer cannot classify the spend as the expected buyer release or seller refund.

Operator action:

- move the trade to `unknown_spend` and then `failed_manual_review`;
- pause automatic settlement for the trade;
- resolve prevouts and scripts from the KaspaCom-owned Pearl node, not Blockbook alone;
- compare spend destination, amount, signature path, and script path against the expected escrow package;
- if spend cannot be classified, keep the USDC leg escrowed or refund it, never release based on ambiguous PRL evidence;
- record spend txid, input index, raw spend evidence, and classification gap.

Protection goal: unknown PRL movement cannot authorize USDC release.

## Stale Indexer

Trigger: Pearl node lag, indexer lag, Base event lag, missed polling, or stale watch data exceeds the configured freshness threshold.

Operator action:

- move affected trades to `stale_indexer` and then `failed_manual_review`;
- stop automatic release/refund decisions for affected watches;
- compare node tip, indexed height, last indexed block time, and latest Base event block;
- restart only the indexer service if needed; do not restart shared gateway services from this runbook;
- after recovery, replay from the last safe height and confirm no detached observations were used;
- record lag duration, last safe height/block, and recovery command.

Protection goal: stale or replaying data cannot trigger a release.

## Emergency Pause

Use emergency pause when any of these are true:

- Base escrow contract terms do not match backend trade terms;
- multiple trades enter edge states in a short window;
- Pearl indexer reorg replay touches an already-settled trade;
- unknown spends appear on reserve or escrow addresses;
- an operator key, deployer key, or settlement worker credential is suspected compromised.

Operator action:

- pause the Base USDC escrow contract if the owner/multisig policy allows it;
- disable new quote acceptance in the OTC API;
- keep read-only proof/status endpoints online;
- stop settlement worker release/refund side effects;
- snapshot open trades, deposits, refunds, releases, and edge-state backlog;
- resume only after the cause is documented and one dry-run replay matches chain state.

Protection goal: stop new risk while preserving auditability for existing trades.
