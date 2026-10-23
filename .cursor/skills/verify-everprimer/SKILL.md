---
name: verify-everprimer
description: Drive the Everprimer Next.js web app the way a visitor does — landing demo, plans, and sign-in — and capture proof. Use when a change touches apps/web pages, auth entry, or the public landing, and a unit test would not show what the user sees.
---

# Verify Everprimer

Primary surface is the Next.js app in `apps/web` (parent home, learner, login, public landing). The Capacitor app in `apps/mobile` is a WebView around that site; this skill does not drive a simulator. Authenticated parent and learner pages share the Supabase project in `apps/web/.env.local`. This skill does not start a second database, so it only proves journeys that write nothing.

## Launch

From the repo root:

```bash
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs launch
```

This starts `next dev` on `127.0.0.1:4173` with `EVERPRIMER_VERIFY_DIST=.next-verify`, so it does not share `apps/web/.next` with a dev server already on port 3000. Ready means `GET /` returns 200 and the HTML contains `Learning tailored to every child.` A database health check is not enough: `/` calls Supabase Auth, and a missing session must still render the landing page.

`apps/web/.env.local` must already exist (Supabase URL, anon key, service role key, `CHILD_LOGIN_SECRET` of at least 32 characters). There is no empty data directory. Public pages do not need seed rows.

Launch refuses to bind port 4173 when another process owns it. It refuses to start when its own pid file is alive but the landing page is not being served.

## Doctor

```bash
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs doctor
```

Prints `ok` only when the pid in `.cursor/skills/verify-everprimer/run/next.pid` is alive, that process tree owns port 4173, and `/` still contains the landing heading. Run this first whenever a later command looks wrong. Do not drive port 3000 or any server this launch did not start.

## Drive

The harness is `control-everprimer.mjs browser`. It talks to headless Chrome on DevTools port 9333, started by the first browser command, with a profile under `run/chrome`. Match controls by role and accessible name. A click that matches zero or more than one control fails.

```bash
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role button --name "Football"
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --text "Yes! Two equal parts."
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --aria-label "1 stars"
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser snapshot --path .cursor/skills/verify-everprimer/artifacts/example-lesson/after.aria.txt
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser screenshot --path .cursor/skills/verify-everprimer/artifacts/example-lesson/after.png
```

Recipes for each feature are in `features/`. Start from the landing page unless that file names another entry. Paths that need a signed-in parent (`/parent`, `/parent/settings`) redirect to `/login` on this instance. Report that as a failed journey. Do not sign up, sign in, add a child, or change settings against the shared Supabase project.

## Evidence

Write proof under `.cursor/skills/verify-everprimer/artifacts/<feature-id>/`. Capture the action and the state after it: an ARIA snapshot and a screenshot. For the example lesson, also reload `/` and record that the star count is back to `0 stars`, which shows the answer was not stored.

A passing proof uses the real page. Do not call server actions, set React state from the console, or hit test-only routes. There is no dry-run mode. Public clicks on the landing page and the login chooser do not write rows. Anything that submits a form does.

## Cleanup

```bash
node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs stop
```

Sends `SIGTERM` to the next process group and the Chrome process group recorded in `run/`. It checks the command line before killing, and it deletes `apps/web/.next-verify` and `run/chrome`. It does not delete `artifacts/`. It does not kill by process name, and it does not touch a server on port 3000.

## Helpers

`scripts/control-everprimer.mjs` is the only helper. Commands: `launch`, `doctor`, `stop`, and `browser` with `goto`, `click`, `assert`, `snapshot`, `screenshot`.
