# Settings

A signed-in grown-up sees the credit balance, lesson usage, and live-tutor usage for the current period. Checkout, the customer portal, the grown-up PIN, and the live-tutor switch all write. They are not part of the read proof.

## Sub-features

- `settings-balance` shows credits left and the lesson and live split.
- `settings-writes` (Checkout, portal, PIN, tutor switch) are specified and not run here.

## How to get to it (user POV)

- From the parent home, choose `Settings` in the header. It goes to `/parent/settings`.
- Open `/parent/settings` while signed in as a grown-up.

## Driving it with control-everprimer

Preconditions:

- An isolated Supabase project whose parent balance and ledger are known.
- A grown-up session on the verification server.
- Migration `0010_metered_credits.sql` is applied, so usage has a category.

- **Open settings.** Visit `/parent/settings`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /parent/settings`. The heading is `Settings`.
- **Proof.** The usage control's accessible name matches `Used <lesson> credits on lessons and <live> on the live tutor; <balance> left.` Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser snapshot --path .cursor/skills/verify-everprimer/artifacts/settings/balance.aria.txt` and compare that name to the known balance.

This verification server has no session. `goto /parent/settings` redirects to `/login`. Report the journey failed because the session precondition is unmet.

## Gotchas

- Without migration 0010 the page still renders, and the usage split is absent. A missing split is not a balance of zero.
- Do not press Checkout, the portal, `Sign out`, the PIN save, or `Allow the voice tutor`. Each one writes.
- Child sessions never reach this page.
