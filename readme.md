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

1. An adult submits a goal, a **scope** (Quick overview, For fun, Test prep, Deep mastery, plus an
   optional note) and an optional **interest** (for example "dinosaurs"). That creates a `curricula`
   row and a `curriculum` job.
2. The job calls `generateCurriculum` → `topics` + `learning_objectives`, sized to the scope and the
   learner's age, then pre-warms the first two lessons.
3. Opening a topic calls `ensureArtifact`, which starts an `artifact` job (`generateLesson` in
   `packages/ai/src/pipelines.ts`):
   1. **Plan.** `generateLessonPlan` writes a `LessonPlan`: sessions of short bites, per-objective intent,
      and a final test sized to the age band. The plan is linted (`lintLessonPlan`) for session and bite
      counts, recall slots and the final test. It gets up to three attempts, then falls back to
      `defaultLessonPlan`.
   2. **Split, if needed.** If the plan says the topic is too big (`mode: "sub_index"`), the topic becomes
      a unit. Its parts are inserted as child topics (`split_topic_into_unit`), the credit is refunded and
      the first part is generated. A part is never split again.
   3. **Blueprint.** `generateBlueprint` turns the plan into an `ArtifactBlueprint` v3 (sessions of bites
      plus a final test). Every bite and question cites the `facts` it relies on. Lint checks the schema,
      the age limits, the conversational voice and fidelity to the plan.
   4. **Fact and safety check.** Gemini reviews the blueprint. A content issue triggers a repair; a
      plan-level issue triggers one replan. A safety issue blocks the lesson.
   5. **Player.** `renderBlueprintHtml` builds the page from the blueprint. There is no AI-written HTML
      and no generated images.
4. The blueprint is the source of truth. Up to two questions per lesson recall objectives from earlier
   lessons that are not yet secure (spaced recall). Every lesson ends with a final test covering every
   objective; 70% is a pass. The learner can stop after any session and resume later.
5. The player runs in `<iframe sandbox="allow-scripts">` with a strict CSP. It talks to the host only via
   `postMessage`; the host verifies the source window and a per-session nonce and batches events to
   `POST /api/events`.
6. Ingestion re-grades every answer against the blueprint (the server is authoritative), writes
   `responses`, updates `objective_mastery`, `topic_progress` and the lesson feedback, then refreshes
   learner memory.

Hard limits per age band (`packages/contracts/src/limits.ts`). Lint rejects anything over them:

| Age | Sessions | Min bites | Words per bite | Final-test questions |
| --- | --- | --- | --- | --- |
| 4-6 | 3 | 21 | 25 | 5 |
| 7-9 | 4 | 24 | 45 | 8 |
| 10-12 (and unknown age) | 4 | 24 | 60 | 10 |
| 13-18 | 5 | 25 | 80 | 12 |

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase URL, anon key, service role key
```

Create a Supabase project and apply the SQL in `packages/db/supabase/migrations/`
in order (`0001_core.sql` through `0009_lesson_tutor.sql`),
or `supabase db push` after `supabase link`. RLS and credit checks live in
`packages/db/supabase/tests/` (`supabase test db` with a linked local stack). In Auth settings, disable "Confirm email" for local
development if you want password sign-up to log in immediately.

```bash
pnpm dev            # http://localhost:3000
pnpm test           # unit tests (contracts, mastery, learnkit, ai, web)
pnpm typecheck
pnpm build
```

### AI providers

Without keys everything runs on a deterministic **mock** provider: any goal mentioning the solar
system gets hand-checked seed content; other goals get a structurally complete demo lesson. Set
`AI_PROVIDER=mock` to force the mock even when keys are present.

Every task on every tier uses Gemini (`gemini-3.8-flash`). Paid plans differ only by how many
credits they get. A missing Gemini key, or `AI_PROVIDER=mock`, runs the mock.

#### Setup guide: Gemini

All keys go in `apps/web/.env.local` (and in the deployment's environment variables). Restart
`pnpm dev` after changing them.

1. Create a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Set `GOOGLE_GENERATIVE_AI_API_KEY=...`. Billing on the Google Cloud project is recommended so
   you are not limited to the free-tier request cap.
3. Optional per-task override: `AI_MODEL_<TIER>_<TASK>=google:<model-id>`, where tier is `FREE`,
   `PAID` or `MAX` and task is `CURRICULUM`, `PLANNER`, `BLUEPRINT`, `FACTCHECK`, `REPORT` or `MEMORY`.

Costs: one lesson makes a planner call (up to 3 on lint failure), a blueprint call (plus repairs)
and a fact-check call. Check Gemini pricing before launch.

### Interactive tutor

Each lesson has a cartoon guide that speaks the lesson's lines in speech bubbles, and Max accounts
can open a live voice tutor from inside the lesson.

**Character art (all plans, charged as lesson usage).** After a lesson publishes, a separate
queue (`lesson_characters`) draws one character in two poses with fal.ai FLUX.2 Klein 9B: talking
(`fal-ai/flux-2/klein/9b`), then teaching with a raised finger (`fal-ai/flux-2/klein/9b/edit`, from
the talking image so it stays the same character). Each pose is then cut out of its white background
(`fal-ai/birefnet/v2`), so the character stands on the lesson page with a halo at its feet that lights
up while the live tutor listens, thinks or talks. Both images are stored in the private `lesson-art`
Storage bucket and reused on every slide. Lessons published before this existed get a character the
first time they are opened, and older characters are cut out by the job sweep. If a cutout fails, the
white-background poses are kept and the player blends the white away until the sweep retries. The
player shows plain text until both images load, and stays plain text if generation fails; nothing
about the lesson waits on art. Failed runs retry up to three times; content-filter hits, bad keys and
bad requests do not retry. The pictures are charged to the account's credits; art waits while the
balance is empty.

1. Create a key at [fal.ai](https://fal.ai/dashboard/keys) and set `FAL_KEY=...`.
2. Optional: `LESSON_ART_DAILY_LIMIT` (per account per UTC day), `LESSON_ART_CUTOUT_MODEL`,
   `LESSON_ART_ENABLED=false` to turn it off.

**Live voice tutor (Max only, paid with credits).** The "Live tutor" button in the lesson's top bar
opens a voice session with Gemini Live (`gemini-3.8-live`). `POST /api/tutor/live` checks the learner
owns the lesson session, the plan (`parents.tutor_enabled`), the grown-up switch
(`parents.live_tutor_allowed`, in Settings), that credits are left, and that no other session is open.
It then mints an ephemeral token with the model, voice, system instruction and context-window
compression locked in. The browser connects to Gemini with that token, never with the API key.

There is no time cap. Gemini moves long conversations to a new connection every few minutes; the
browser fetches a fresh token (`/renew`) and resumes with the latest session handle, or starts fresh
and re-sends the screen if the handle no longer works. Once a minute the browser reports Gemini's
token counts (`/tick`); the server holds that cost between a per-minute floor and ceiling for the
time actually spent and charges the difference as `live` usage. A conversation ends when the learner
ends it, after two quiet minutes, when credits run out, when the app is hidden, or when the learner
leaves the lesson (`/end` makes the final charge). A session that stops ticking is closed after two
minutes. The tutor is told the lesson, goals, age, reading level and progress, plus what is on screen,
but never the child's name. It does not get a question's explanation until the learner has answered.
Audio and transcripts are not stored; only times, token counts and credits are (`tutor_sessions`).

1. Set `GEMINI_API_KEY=...` (falls back to `GOOGLE_GENERATIVE_AI_API_KEY`). Use a billed project:
   Google's terms for unpaid usage allow it to use content to improve its products. Also check the
   [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) before launch: they bar use in
   services "directed towards or likely to be accessed by individuals under the age of 18". Get a
   legal review, or move to an offering whose terms cover children's services, before turning this on
   for real learners.
2. Optional: `TUTOR_LIVE_VOICE`, `TUTOR_LIVE_MODEL`, and `TUTOR_LIVE_API_VERSION` (ephemeral tokens
   are v1alpha in `@google/genai`).
3. Native apps need a new build for the microphone permission (`NSMicrophoneUsageDescription` on iOS,
   `RECORD_AUDIO` on Android).

### Billing

Free, Plus, and Max are monthly credit plans on `parents`. A credit is a fixed slice of real API
spend (`USD_PER_CREDIT` in `packages/ai/src/pricing.ts`), the same for every feature: lesson text and
page code are charged by their Gemini tokens, pictures per image, and the live tutor by its audio and
text tokens. A typical lesson with its pictures is about 100 credits. Pre-warming the next lesson
only happens while the balance is above zero. Regenerating a published lesson is Plus/Max only.
Replaying a published lesson and daily reports are free.

Generation jobs hold an estimate when enqueued (5 credits for an outline, 80 for a lesson), then
settle to the measured cost when they finish: unused credits go back, extra cost is taken only down
to zero. A hard failure refunds the whole hold. The same job cannot hold twice. Art and the live tutor
are charged as they happen. Every usage row in `credit_ledger` is tagged `lesson` or `live`, and
Settings shows the balance and both parts for the month, with live minutes and recent conversations.
An account can have two generation jobs in flight, and can start five curricula an hour. Free
includes 1,000 credits a month and 1 child. Plus is $12 for 5,000 credits. Max is $29 for 15,000
credits and the live tutor. Plus and Max allow 8 children. Grants do not roll over. Child logins
cannot buy.

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
`CRON_SECRET`). `apps/web/vercel.json` schedules that sweep daily at 12:00 UTC. In development,
`src/instrumentation.ts` calls the same route every 30 seconds so queued retries run on their own. To
sweep right away:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/run
```

A failed attempt is retried up to three times. Errors a retry cannot fix (a missing, invalid, or
revoked API key, or an unknown model) fail the job on the first attempt and refund its credit. While a
retry is pending, the curriculum or lesson row carries the error so the waiting screens can say so.

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

- Typed tutor chat. Voice is in; see "Interactive tutor".
- Separate sandbox origin — the iframe uses `srcdoc` + `sandbox` + CSP, which gives an opaque
  origin today; a dedicated domain is a deployment step, not a code change.
- Parent Q&A agent, a standalone review session (recall only happens inside new lessons), headless
  smoke test of generated code.
- Coparents, teacher accounts, memory, yearly billing, and credit packs.
