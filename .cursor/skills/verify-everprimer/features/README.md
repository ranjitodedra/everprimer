# Everprimer verification map

This directory is the maintained source for verifying the user-facing behavior of the Everprimer web app. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs launch` so the app is at `http://127.0.0.1:4173`.
- The instance uses `apps/web/.env.local` and `EVERPRIMER_VERIFY_DIST=.next-verify`. It is a separate Next process. It is not a separate database.
- Run `control-everprimer.mjs doctor` and require the landing heading on port 4173.
- Never drive an instance that was not started by this verification run. In particular, do not drive port 3000.
- Do not create an account, sign in, add a child, or change settings. Those writes go to the shared Supabase project.

## Driving conventions

- Start every recipe from the landing page unless its preconditions say otherwise.
- Prefer role and accessible name. The helper fails a click that is not unique.
- Treat every command as literal.
- Run browser actions through `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser ...`.
- Restore nothing on the server: the proved journeys do not write. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot.
- The example lesson must also show a reload where the star count is `0 stars`.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-everprimer` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Example lesson](./example-lesson.md) covers the public landing demo: interest, correct answer, star, and a reload that forgets it.
- [Plans](./plans.md) covers opening and closing the Free, Plus, and Max prices on the landing page.
- [Sign in](./sign-in.md) covers the login chooser up to the parent form, and stops before submit.
- [Parent home](./parent-home.md) covers the signed-in family page. This instance cannot reach it.
- [Settings](./settings.md) covers the signed-in credit balance. This instance cannot reach it.
