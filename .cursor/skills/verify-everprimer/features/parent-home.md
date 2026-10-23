# Parent home

A signed-in parent sees `Your family`, each child, and a way to add a child. An individual account is sent to their own learn page instead.

## Sub-features

- `parent-empty` shows `Who's learning?` when the parent has no child profiles.
- `parent-list` shows each child by display name.
- `parent-add` opens `Add a child`. This writes a row, so it is not run on the shared database.

## How to get to it (user POV)

- After sign-in, a parent account lands on `/parent`.
- The wordmark on parent pages links back to `/parent`.

## Driving it with control-everprimer

Preconditions:

- An isolated Supabase project with one parent and no children.
- A session cookie for that parent on the verification server.

- **Open parent home.** Visit `/parent`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /parent`. The heading is `Your family` and the empty state says `Who's learning?`
- **Proof.** Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --text "Who's learning?"` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser screenshot --path .cursor/skills/verify-everprimer/artifacts/parent-home/empty.png`.

This verification server has no isolated project and no session. `goto /parent` redirects to `/login`. Report the journey failed because the session precondition is unmet. Do not create an account to satisfy it.

## Gotchas

- Driving `/parent` on port 3000, or signing up against `apps/web/.env.local`, writes to the operator's real project.
- An individual account with a self profile never sees `Your family`; they are redirected to `/learn/<selfId>`.
- `Add a child` inserts a `children` row. Leave it unpressed.
