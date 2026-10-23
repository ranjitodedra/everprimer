# Sign in

A visitor can open the sign-in chooser, pick a parent account, and see the email form. Submitting that form is a different journey and needs an isolated Supabase project.

## Sub-features

- `signin-chooser` lists who is signing in.
- `signin-parent-form` shows the parent email and password fields.
- `signin-submit` is specified and not run here.

## How to get to it (user POV)

- Choose `Sign in` in the landing header. It goes to `/login?mode=signin`.
- Open `/login` and choose `Sign in`, then who is signing in.

## Driving it with control-everprimer

Preconditions:

- Doctor reports the landing page on port 4173.
- No session cookie is set. `/parent` redirects to login.

- **Header entry.** Choose `Sign in`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role link --name "Sign in"`. The heading is `Who's signing in?`
- **Parent form.** Choose `I'm a parent`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role button --name "I'm a parent"`. The heading is `Welcome back.` and the fields are labeled `Email` and `Password`.
- **Proof of the form.** Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --text "Welcome back."` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser snapshot --path .cursor/skills/verify-everprimer/artifacts/sign-in/parent-form.aria.txt`.
- **Submit.** Stop. A successful sign-in needs a parent account in an isolated database. This instance uses the shared Supabase project, so the journey fails here. Do not press the `Sign in` button on the form.

## Gotchas

- The header `Sign in` link is unique. The form also has a `Sign in` button. Click the link before the form exists.
- `/login` without `mode` shows `Hello.` and `Create an account` / `Sign in`. The header link skips that step because it sets `mode=signin`.
- `Create an account` and `Start free` would insert an auth user. Do not choose them.
- Child sign-in (`I'm a kid with a PIN`) submits a username and PIN. Do not submit it.
