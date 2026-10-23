# Plans

A visitor can open the prices on the landing page. Free is $0 for 1,000 credits and 1 learner. Plus is $12 a month for 5,000 credits and up to 8 learners. Max is $29 a month for 15,000 credits and up to 8 learners.

## Sub-features

- `plans-open` shows the three prices.
- `plans-close` hides them again.

## How to get to it (user POV)

- Open `/` and expand the disclosure headed `Free to start.`

## Driving it with control-everprimer

Preconditions:

- Doctor reports the landing page on port 4173.
- The disclosure is closed, so `See plans` is visible and `Hide plans` is not.

- **Open prices.** Choose `See plans`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role summary --name "Free to start."`. The page shows `See plans` replaced by `Hide plans`, plus `Free`, `$0`, `1,000 credits a month (about 10 lessons)`, `1 learner`, `Plus`, `$12`, `5,000 credits a month (about 50 lessons)`, `Max`, `$29`, and `15,000 credits a month (about 150 lessons)`.
- **Proof.** Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --text "5,000 credits a month (about 50 lessons)"` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser screenshot --path .cursor/skills/verify-everprimer/artifacts/plans/open.png`.
- **Close prices.** Choose `Hide plans`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role summary --name "Free to start."`. `See plans` is visible again.

## Gotchas

- The summary's accessible name includes both the heading `Free to start.` and the current toggle label. Match `Free to start.`
- Credit amounts use thousands separators (`1,000`, `5,000`, `15,000`). Assert those strings, not the raw integers.
- Opening plans does not start Checkout. Do not follow a price into Stripe.
