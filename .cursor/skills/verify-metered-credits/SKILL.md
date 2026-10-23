---
name: verify-metered-credits
description: Model-check Everprimer's metered credit functions so a balance cannot go negative, drift from its ledger, or close one job twice. Use when a change touches reserve_credit, settle_credit, refund_credit, charge_usage, or credit_estimate in packages/db/supabase/migrations/0010_metered_credits.sql.
---

# Verify metered credits

A credit is a slice of API spend. Generation jobs hold an estimate, then settle or refund it. Character art and the live tutor charge as they go. The harm if this is wrong is an account spending credits it does not have, a Settings balance the ledger cannot explain, or one lesson being charged or refunded twice.

The check is a TLA+ model of one parent, run with TLC (tla2tools 1.7.4). Ordering bugs are the question, and the functions are SQL, so a model checker fits better than a solver that would need a translation of PL/pgSQL. The model is not the database. A pass covers the bounds below, not grants, expires, Stripe, or the live-tutor tick.

## When a change needs a rerun

Rerun when a diff touches any of these in `packages/db/supabase/migrations/0010_metered_credits.sql`:

- `credit_estimate`
- `reserve_credit`
- `settle_credit`
- `refund_credit`
- `charge_usage`

The TypeScript wrappers only call those functions. A change that is only in a wrapper still needs a look at whether the call still matches the action (same arguments, one call per user step).

## Coverage

Confirmed against the working tree of `0010_metered_credits.sql`, blob `c55c98b20bc1f48157bddb0769edc246bfe37f26`. `HEAD` at that confirmation was `570c49c112e30e44411349c499c992eec42cfc78`, which does not contain this migration. Move the sync commit forward only after you re-read the four functions and the model still describes them. If the blob or the function bodies changed and this line was not updated, the result is stale. Do not treat a stale pass as proof.

Each action is one indivisible step because each function takes `SELECT ... FOR UPDATE` on the parent row before it writes. `settle_credit` and `refund_credit` read the reserve row before that lock. The model still treats the call as one step: reserve rows are inserted once and never updated, and the "already closed" check happens after the lock.

| Action | Code | What one step does |
| --- | --- | --- |
| `Reserve(j, reason)` | `reserve_credit` | Second reserve of the same job posts nothing. Balance below 1 posts nothing. Otherwise hold `credit_estimate` (5 for `outline`, 80 otherwise), or the remaining balance when that is smaller. |
| `Settle(j, actual)` | `settle_credit` | No reserve, or a spend/refund already posted, posts nothing. Extra cost is taken only down to zero. Unused hold is returned. A zero extra still closes the job. |
| `Refund(j)` | `refund_credit` | Returns the whole hold, and only while that reserve is still open. |
| `Charge(amount)` | `charge_usage` | Takes `min(max(amount, 0), balance)`. A zero take posts no row. |

## Properties

State each of these in the words above. TLC checks them on every reachable state.

- **NonNegative.** `balance >= 0`. The account cannot spend credits it does not have. Guarded by `least(delta, balance)` in `settle_credit` and `least(amount, balance)` in `charge_usage`. `parents_credit_balance_check` in `0004_billing.sql` also rejects a stored negative balance, and the model does not include that constraint. Without the cap, the function would assign a negative number and Postgres would abort the update. `drop_cap` shows that assignment: charge 200 against a balance of 100.
- **Conserved.** `balance` equals the ledger sum, starting from a grant of 100 already posted. The Settings number stays explainable by the rows. Guarded by every insert that moves the balance.
- **ClosedOnce.** Each job's `closeCount` is at most 1. One lesson is settled or refunded once. Guarded by the `exists (... kind in ('spend','refund'))` check in `settle_credit` and `refund_credit`.

## Bounds and what is left out

- One parent. Initial balance 100, which stands in for a grant already in the ledger. No second grant, no `expire`.
- Two jobs, `j1` and `j2`.
- Reasons `outline` and `lesson`. Actual costs `0, 30, 80, 110`. Charges `0, 40, 200`.
- At most 5 calls. `CHECK_DEADLOCK FALSE`, because the step limit stops the run on purpose.
- Unknown `charge_usage` categories raise and write nothing. They are not a state change, so they are not an action.
- Two parents do not share a row. The parent lock does not serialize different parents; this model does not claim anything about that.
- `tickLiveTutor` in `apps/web/src/lib/live-tutor.ts` claims `credits_used` and then calls `charge_usage` as a later step. That gap is outside this model.

## Run

From `.cursor/skills/verify-metered-credits`:

```bash
./check.sh good
```

Exit 0 means all three properties held. Java 17 is enough. The script downloads `tools/tla2tools-1.7.4.jar` on first use. The other modes are the broken variants below, not product modes.

## Telling a bug from a modeling error

A TLC error prints a state trace: `Reserve`, `Settle`, `Refund`, or `Charge`, then the values of `balance`, `ledger`, `held`, and `closeCount`.

Read the trace as calls. `held[j] = 80` means a reserve row of `-80` exists for that job. `closeCount[j] = 2` means a second spend or refund was posted. `balance < 0` means a debit was not capped by the balance.

If the trace cannot be performed against the SQL (for example a second reserve changing `held`), the model has drifted. Fix the model, do not weaken a property. If the trace can be performed and the current SQL allows it, report it. Do not change the functions unless the user asks.

## Broken variants

`check.sh` selects `Mode`. The good mode is the code. The others delete one guard so the matching property fails. A broken mode that exits 0 means the check can no longer fail. Re-run `good` after any broken run; the spec file is not modified.

- `drop_close` skips the spend/refund existence check. `ClosedOnce` fails: reserve a job, settle it, settle it again.
- `drop_cap` removes `least(..., balance)` on settle and charge. `NonNegative` fails: charge 200 against a balance of 100, or settle an actual cost above the remaining balance.
- `drop_ledger` changes the balance and skips the ledger insert. `Conserved` fails on the first hold or charge that moves credits.

## Updating the model

After an intended change to the functions, edit `Credits.tla` so each action still matches the new body, run `./check.sh good`, and run the three broken modes. Then update the blob and the sync commit in this file. Only do that after the model matches the new code.
