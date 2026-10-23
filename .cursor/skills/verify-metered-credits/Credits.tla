------------------------------ MODULE Credits ------------------------------
\* Model of one parent's metered credits.
\*
\* Each action is one call, because every function locks the parent row before
\* it mutates (SELECT ... FOR UPDATE). Reserve rows are inserted once and never
\* updated, so the pre-lock read in settle and refund is stable.
\*
\* reserve_credit   packages/db/supabase/migrations/0010_metered_credits.sql:78
\* settle_credit    same file :113
\* refund_credit    same file :161
\* charge_usage     same file :201
\* credit_estimate  same file :62  (outline = 5, anything else = 80)

EXTENDS Integers

CONSTANTS InitialBalance, Mode
ASSUME InitialBalance \in Nat
ASSUME Mode \in {"good", "drop_close", "drop_cap", "drop_ledger"}

Jobs == {"j1", "j2"}
Reasons == {"outline", "lesson"}
Actuals == {0, 30, 80, 110}
Charges == {0, 40, 200}

VARIABLES balance, ledger, held, closeCount, steps

Estimate(reason) == IF reason = "outline" THEN 5 ELSE 80

Init ==
  /\ balance = InitialBalance
  /\ ledger = InitialBalance
  /\ held = [j \in Jobs |-> 0]
  /\ closeCount = [j \in Jobs |-> 0]
  /\ steps = 0

\* A second reserve for the same job returns true and posts nothing (:93).
\* A zero balance returns false and posts nothing (:97).
\* The hold is the estimate, or whatever is left when that is smaller (:101).
Reserve(j, reason) ==
  /\ steps' = steps + 1
  /\ IF held[j] > 0 \/ balance < 1
     THEN UNCHANGED <<balance, ledger, held, closeCount>>
     ELSE LET h == IF Estimate(reason) < balance THEN Estimate(reason) ELSE balance
               posted == IF Mode = "drop_ledger" THEN 0 ELSE h
          IN /\ balance' = balance - h
             /\ ledger' = ledger - posted
             /\ held' = [held EXCEPT ![j] = h]
             /\ UNCHANGED closeCount

\* No reserve, or an existing spend/refund, returns false (:130, :136).
\* Extra cost is taken only down to zero (:146). Unused hold is returned (:150).
\* drop_close removes the spend/refund guard. drop_cap removes least(delta, balance).
Settle(j, actual) ==
  /\ steps' = steps + 1
  /\ IF \/ held[j] = 0
        \/ (closeCount[j] > 0 /\ Mode # "drop_close")
     THEN UNCHANGED <<balance, ledger, held, closeCount>>
     ELSE LET raw == IF actual > 0 THEN actual ELSE 0
               delta == raw - held[j]
          IN IF delta >= 0
             THEN LET capped == IF delta < balance THEN delta ELSE balance
                       take == IF Mode = "drop_cap" THEN delta ELSE capped
                       posted == IF Mode = "drop_ledger" THEN 0 ELSE take
                  IN /\ balance' = balance - take
                     /\ ledger' = ledger - posted
                     /\ closeCount' = [closeCount EXCEPT ![j] = closeCount[j] + 1]
                     /\ UNCHANGED held
             ELSE LET posted == IF Mode = "drop_ledger" THEN 0 ELSE -delta
                  IN /\ balance' = balance - delta
                     /\ ledger' = ledger + posted
                     /\ closeCount' = [closeCount EXCEPT ![j] = closeCount[j] + 1]
                     /\ UNCHANGED held

\* Whole hold comes back, and only while the reserve is still open (:181, :188).
Refund(j) ==
  /\ steps' = steps + 1
  /\ IF \/ held[j] = 0
        \/ (closeCount[j] > 0 /\ Mode # "drop_close")
     THEN UNCHANGED <<balance, ledger, held, closeCount>>
     ELSE LET posted == IF Mode = "drop_ledger" THEN 0 ELSE held[j]
          IN /\ balance' = balance + held[j]
             /\ ledger' = ledger + posted
             /\ closeCount' = [closeCount EXCEPT ![j] = closeCount[j] + 1]
             /\ UNCHANGED held

\* Takes at most the balance. A zero take posts no row (:227, :228).
Charge(amount) ==
  /\ steps' = steps + 1
  /\ LET raw == IF amount > 0 THEN amount ELSE 0
         capped == IF raw < balance THEN raw ELSE balance
         take == IF Mode = "drop_cap" THEN raw ELSE capped
         posted == IF Mode = "drop_ledger" THEN 0 ELSE take
     IN IF take = 0
        THEN UNCHANGED <<balance, ledger, held, closeCount>>
        ELSE /\ balance' = balance - take
             /\ ledger' = ledger - posted
             /\ UNCHANGED <<held, closeCount>>

Next ==
  \/ \E j \in Jobs, r \in Reasons : Reserve(j, r)
  \/ \E j \in Jobs, a \in Actuals : Settle(j, a)
  \/ \E j \in Jobs : Refund(j)
  \/ \E c \in Charges : Charge(c)

vars == <<balance, ledger, held, closeCount, steps>>
Spec == Init /\ [][Next]_vars

NonNegative == balance >= 0
Conserved == balance = ledger
ClosedOnce == \A j \in Jobs : closeCount[j] <= 1
StepsBound == steps <= 5

=============================================================================
