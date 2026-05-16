# Covenants on Pearl

> **TL;DR (read this first if nothing else):**
>
> 1. **Multisig, escrow, HTLCs, atomic swaps, MuSig2 — none of these need covenants.** They work on Pearl because Pearl is Taproot (BIP340/341/342), same as Bitcoin mainnet.
> 2. **Covenants are the Pearl bonus.** `OP_CAT` is re-enabled (Bitcoin doesn't have this active) and lets us build vaults, recovery wallets, amount-capped outputs, and other constraints that Bitcoin can't do today.
> 3. **Covenants on Pearl are research-grade.** No production system uses OP_CAT-based covenants anywhere yet. Keep them out of v1 products until externally reviewed.

## 1. What "covenant" actually means

A **covenant** is a constraint on **how a future output can be spent**, beyond "show the right signature." Examples:

- "This output can only ever be sent to address X."
- "This output can only release at most 10 PRL per spend."
- "This output must first sit in a 24-hour timelock before final spend."
- "This output must be spent in a transaction that also has property Y."

Standard Bitcoin script has almost no covenant power — once funds reach an address, the address's owner can send them anywhere. Covenants change that.

## 2. What Pearl supports vs Bitcoin

| Primitive | Bitcoin mainnet | Pearl | Notes |
|---|---|---|---|
| Taproot (P2TR) | ✅ | ✅ | Pearl is Taproot-only |
| BIP340 Schnorr | ✅ | ✅ | Required for Taproot |
| `OP_CHECKSIGADD` (k-of-n multisig in tapscript) | ✅ | ✅ | BIP342 |
| `OP_CHECKLOCKTIMEVERIFY` (absolute timelock) | ✅ | ✅ | BIP65 |
| `OP_CHECKSEQUENCEVERIFY` (relative timelock) | ✅ | ✅ | BIP112 |
| `OP_CAT` (concat) | ❌ disabled | ✅ **enabled** | 520-byte cap, cost `⌈len/64⌉` (Pearl whitepaper) |
| `OP_CHECKTEMPLATEVERIFY` (CTV / BIP119) | ❌ proposal | ❌ | Not in Pearl |
| `SIGHASH_ANYPREVOUT` (BIP118) | ❌ proposal | ❌ | Not in Pearl |
| `OP_CHECKSIGFROMSTACK` | ❌ | ⚠️ verify upstream | If present, covenants become much easier |
| `OP_CHECKXMSSSIG` (post-quantum) | ❌ | ✅ | Stateful — research-grade only |

**Headline:** Pearl's covenant power = standard Bitcoin Taproot **plus OP_CAT**. That puts Pearl in a more flexible place than Bitcoin mainnet (which has rejected OP_CAT) but less ergonomic than CTV-based proposals (which would need a dedicated opcode).

## 3. What does NOT need covenants

This is the most common confusion. The following are **all standard Taproot** — they work on Pearl, they work on Bitcoin mainnet, they need no Pearl-specific feature:

| Construction | What it uses | OP_CAT needed? |
|---|---|---|
| 2-of-3 multisig wallet | `OP_CHECKSIGADD` in tapscript leaf | ❌ |
| k-of-n multisig wallet | `OP_CHECKSIGADD` repeated | ❌ |
| Cooperative MuSig2 (multisig that looks like single-sig on-chain) | BIP340 + off-chain MuSig2 round protocol | ❌ |
| 2-of-3 buyer/seller/arbiter escrow | Tap-tree: multisig leaves + CSV timelock leaf | ❌ |
| HTLC (hash-time-locked contract) | `OP_SHA256` + CSV + multisig | ❌ |
| Atomic swap | Two HTLCs with a shared preimage | ❌ |
| Time-locked refund | `CLTV` or `CSV` | ❌ |
| Lightning-style payment channel (basic version) | Multisig + asymmetric revocation via timelock | ❌ |

If someone says "we need OP_CAT for escrow" — they're wrong. The escrow design in [`escrow-multisig-on-pearl.md`](escrow-multisig-on-pearl.md) is pure Taproot. OP_CAT is the *upgrade path* to v2 (e.g., adding a refund-destination constraint), not a v1 requirement.

## 4. What DOES need covenants (the OP_CAT use cases)

| Construction | Why covenants are needed |
|---|---|
| **Vault with cooling-off period** | Script must enforce: spend must first go to a "warm" address with a 24h timelock; warm address has an emergency revoke path. Requires the script to constrain the spending tx's outputs. |
| **Recovery wallet** | Primary key spends normally; recovery key spends *only* to a hardcoded safe address. Script must verify the destination. |
| **Amount-capped outputs** | "At most 10 PRL per spend." Script must inspect output amounts of the spending tx. |
| **Whitelisted-destination outputs** | Output may only be sent to addresses in a fixed list. Script must verify destination is in the list. |
| **Replay-protected commitments** | Output must be spent in a tx with a specific shape (e.g., must include a particular input or output). |
| **Trust-minimized bridges, BitVM-style constructions** | Heavy engineering; the on-chain piece enforces dispute-resolution protocols. |

## 5. How OP_CAT enables all that (one paragraph)

OP_CAT lets script concatenate stack items, which sounds boring but is the keystone of "covenant via introspection": the script can re-construct the **sighash** that's about to be verified, then use a Schnorr equation trick to assert "the signature being checked is over a sighash that has these properties." Because the sighash includes the spending tx's outputs, amounts, sequences, and locktimes, asserting properties of the sighash = asserting properties of the spending tx. This is the same technique behind BitVM and Bitcoin's "purrfect vaults" proposal. With OP_CAT alone (no `OP_CHECKSIGFROMSTACK`), the scripts get long (~kilobytes of witness data per spend) but are constructible.

## 6. Concrete pattern — Vault with cooling-off (sketch)

```text
Vault output script (committed to in a tap-tree leaf):

  IF spending to <warm-address> via key K_owner:
    OK
  ELSE IF spending immediately to <recovery-address> via key K_recovery:
    OK
  ELSE:
    fail

Warm-address script:

  IF >= 24 hours have passed since the warm-deposit AND signed by K_owner:
    spend anywhere
  ELSE IF signed by K_recovery (emergency):
    spend back to vault or to <recovery-address>
```

The first leaf is implementable today (multisig + timelock). The "spending to `<warm-address>`" constraint is the covenant — it requires OP_CAT-based output-destination introspection. Implementation effort: ~6–8 weeks of focused work for the script + a thorough test suite + an external review. **Not a v1 product.**

## 7. Status and risks

- **Production status:** zero shipped OP_CAT-based covenant systems exist anywhere as of repo verification date. We would be the reference implementation if we shipped one on Pearl.
- **Script size:** OP_CAT-based introspection produces large scripts (kilobytes). Fee cost is real. Witness discount helps but doesn't eliminate.
- **Relay risk:** `pearld`'s default mempool relay policy may treat unusual OP_CAT scripts as non-standard. Verify before depending. If they're non-standard, we'd need miner relationships.
- **Audit risk:** OP_CAT covenants are easy to write subtly wrong. A bug in a vault script can lock funds forever. No covenant goes to mainnet without external audit.
- **Pearl Research Labs alignment:** ask whether they plan to add CTV or `OP_CHECKSIGFROMSTACK` — either would dramatically simplify covenant scripts. If yes, defer custom OP_CAT work until they ship.

## 8. Practical guidance for KaspaCom products

| Product | Covenants needed? | Why |
|---|---|---|
| Pearl Pay (B3) | No | Plain P2TR payments |
| OTC Settlement Desk (B1) | No for v1 | Pure Taproot tap-trees for escrow |
| KRP-20 / KRP-721 inscriptions (B8/B9) | No | OP_RETURN / Taproot envelope; covenants don't apply |
| Custodial wPRL bridge (B2) | No | KaspaCom is the custodian; covenants are off-chain logic |
| Multi-party escrow v2 with destination constraints | Yes | Refund must go *only* to the buyer's pre-declared address |
| Vault-style cold wallet for KaspaCom treasury | Yes | The killer use case for covenants — if we ever hold significant PRL ourselves |
| BitVM-style trust-minimized compute marketplace | Yes | Long horizon; speculative |

**Bottom line:** ship multisig and escrow this quarter with standard Taproot. Pitch a "Pearl-native Vault" as a Track-A grant proposal in 2-3 quarters, after the covenant story has more validation.

## 9. References

- BIP340 / 341 / 342 — Taproot, tapscript, Schnorr
- Bitcoin "purrfect vaults" research: search "OP_CAT vaults bitcoin" for the canonical writeups
- BitVM: https://bitvm.org
- Pearl whitepaper §script — confirms OP_CAT is enabled with `⌈len/64⌉` cost rule
- This repo's [`escrow-multisig-on-pearl.md`](escrow-multisig-on-pearl.md) — what works *without* covenants
