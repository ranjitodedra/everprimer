# Everprimer — AI learning app (MVP)

Adults describe a learning goal; the app turns it into a curriculum and generates a
self-contained interactive lesson for every topic, which learners play in a sandboxed
iframe. Learning events flow back to compute per-objective mastery and daily parent
summaries. Full specification: [rules.md](rules.md). Architecture plan:
[ai_learning_app_architecture_929890fe.plan.md](ai_learning_app_architecture_929890fe.plan.md).

## Account kinds

The original model is unchanged: every adult `auth.users` row has a `parents` row
(the paying account; `tier` lives here), and every learner is a `children` row
whose learning data hangs off `child_id`. Existing users stay **parent** accounts
on a shared device.

| Kind | Who signs up | Where they land | Notes |
| --- | --- | --- | --- |
| Individual | Adult, 13+ | `/learn/[selfId]` | One `self` learner profile. No child switcher. |
| Parent | Adult, 18+ attestation | `/parent` | Manages children, goals, reports, billing. May also add one `self` profile. |
| Child login | Parent creates it | `/learn/[childId]` only | Username + PIN. No parent UI, billing, or profile edits. |
| Shared device | (current parent session) | Kid picker, then `/learn/[childId]` | No child password. Leaving kid mode requires the grown-up PIN. |

A child profile can be shared-device only, child-login only, or both. Child usage
counts against the parent's tier. Child auth users never get a `parents` row.

`CHILD_LOGIN_SECRET` (32+ characters) derives the hidden Supabase password from a
PIN. `CHILD_LOGIN_EMAIL_DOMAIN` is optional and defaults to
`child-login.everprimer.invalid`.

## Layout

```
apps/web                 Next.js 16 app: parent dashboard, child surface, API routes, job runner
apps/mobile              Capacitor iOS/Android shell that loads the hosted Next.js app
packages/contracts       Zod schemas: curriculum, ArtifactBlueprint, LearningEvent, postMessage envelope
packages/learnkit        In-artifact runtime (LearnKit), blueprint player/fallback renderer, HTML validator
packages/ai              Tier/task model routing (Gemini / Claude / mock), prompts, pipelines, mock seed content
packages/mastery         Pure grading + explainable mastery engine (tested)
packages/db              Supabase migration (schema + RLS) and row types
```

## How a lesson gets made

1. Parent submits a goal → `curricula` row + `curriculum` job.
2. Job calls `generateCurriculum` → `topics` + `learning_objectives`; pre-warms the first two lessons.
3. Opening a topic calls `ensureArtifact` → `artifact` job: `generateBlueprint` (schema + lint +
   cross-provider fact-check, repair loop) → `generateArtifactHtml` (codegen → normalise → static
   validation, up to 2 attempts) → published. If codegen is rejected, the deterministic blueprint
   player is published instead, so the child always gets a working lesson.
4. The player runs in `<iframe sandbox="allow-scripts">` with a strict CSP. It talks to the host only via
   `postMessage`; the host verifies the source window and a per-session nonce and batches events to
   `POST /api/events`.
5. Ingestion re-grades every answer against the blueprint (server is authoritative), writes
   `responses`, updates `objective_mastery` and `topic_progress`.

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase URL, anon key, service role key
```

Create a Supabase project and apply the SQL in `packages/db/supabase/migrations/`
in order (`0001_core.sql` through `0004_billing.sql`),
or `supabase db push` after `supabase link`. RLS and credit checks live in
`packages/db/supabase/tests/` (`supabase test db` with a linked local stack). In Auth settings, disable "Confirm email" for local
development if you want password sign-up to log in immediately.

```bash
pnpm dev            # http://localhost:3000
pnpm test           # unit tests (mastery, learnkit, ai)
pnpm typecheck
pnpm build
```

### AI providers

Without keys everything runs on a deterministic **mock** provider: any goal mentioning the solar
system gets hand-checked seed content; other goals get a structurally complete demo lesson.
Set `GOOGLE_GENERATIVE_AI_API_KEY` and/or `ANTHROPIC_API_KEY` to generate real content. Model
choice per `(tier, task)` lives in `packages/ai/src/provider.ts` and can be overridden with env vars
such as `AI_MODEL_PAID_CODEGEN=anthropic:claude-opus-4-1`. The free tier never calls Anthropic, including
when its Gemini key is missing or `AI_MODEL_FREE_*` names Claude. Plus (`paid`) and Max share the Plus
routing table: Claude for blueprint and codegen, Gemini for curriculum, fact-check, and reports.

### Billing

Free, Plus, and Max are monthly lesson-credit plans on `parents`. A credit is one published lesson.
Creating a curriculum also costs one credit. Opening a topic that has no lesson costs one. Pre-warming
the next lesson costs one only when the balance is above zero; otherwise it is skipped. Regenerating a
published lesson costs one and is Plus/Max only. Replaying a published lesson and daily reports are free.

Credits are reserved when the job is enqueued, spent when it publishes, and refunded after a hard failure.
The same job cannot reserve twice. An account can have two generation jobs in flight, and can start five
curricula an hour. Free includes 10 credits and 1 child. Plus is $12 for 50 credits. Max is $29 for 150
credits. Plus and Max allow 8 children. Grants do not roll over. Child logins cannot buy.

Stripe Checkout and the Customer Portal are hosted redirects. The webhook
(`POST /api/stripe/webhook`) is the only writer of `tier`, Stripe ids, and credit grants. Set:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PLUS`
- `STRIPE_PRICE_MAX`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Past-due and cancel-at-period-end keep the paid tier until the period ends, then the account returns to
Free. Published lessons stay playable. The daily job sweep also refreshes free monthly credits and
downgrades lapsed subscriptions.

### Background jobs

Jobs are kicked immediately with `after()` and swept by `GET /api/jobs/run` (protected by
`CRON_SECRET`). `apps/web/vercel.json` schedules that sweep daily at 12:00 UTC. Locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/run
```

## Mobile (Capacitor)

The native apps are a WebView around the **hosted** Next.js site. They do not statically export the web app, so cookies, server actions, jobs, and `/api/*` keep working.

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
# iOS Simulator:     CAPACITOR_SERVER_URL=http://localhost:3000
# Android emulator:  CAPACITOR_SERVER_URL=http://10.0.2.2:3000
# Physical device:   CAPACITOR_SERVER_URL=http://YOUR_LAN_IP:3000
# Production:        CAPACITOR_SERVER_URL=https://your-app.vercel.app

pnpm mobile:sync          # bake the URL + plugins into ios/ and android/
pnpm mobile:apk           # debug APK, no Android Studio required
pnpm mobile:ios           # open Xcode (full Xcode app required to build)
pnpm mobile:android       # open Android Studio
```

The debug APK is written to:

`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

Install it with `adb install -r` or by copying it onto a phone. `pnpm mobile:android` only opens Android Studio at `/Applications/Android Studio.app`; if Studio lives somewhere else, set `CAPACITOR_ANDROID_STUDIO_PATH`.

Keep `pnpm dev` running when the URL is localhost, `10.0.2.2`, or a LAN IP. Changing `CAPACITOR_SERVER_URL` requires `pnpm mobile:sync` and a new native build. For a physical phone, bind Next to all interfaces (`pnpm --filter web dev -- --hostname 0.0.0.0`) and use the Mac’s LAN IP.

iOS uses Swift Package Manager (no CocoaPods). Building the iOS app needs the Xcode **app**, not only Command Line Tools.

## Not in this MVP

- Tutor chat and voice. Max sets `parents.tutor_enabled` for a later task.
- Separate sandbox origin — the iframe uses `srcdoc` + `sandbox` + CSP, which gives an opaque
  origin today; a dedicated domain is a deployment step, not a code change.
- Parent Q&A agent, spaced-review queue, headless smoke test of generated code.
- Coparents, teacher accounts, memory, yearly billing, and credit packs.
