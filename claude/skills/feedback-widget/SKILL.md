---
name: feedback-widget
description: Install the Militia in-app feedback widget into a Next.js project. Copies a self-contained `feedback/` module (Radix Dialog + Postgres), generates the API route wired with the project's own sql + auth helpers, mounts the floating <FeedbackButton/>, and applies the schema. Use when a project wants non-engineers to send structured feedback (path + page context + comment + severity) from any authed page.
---

# Install the Militia feedback widget

Goal: drop the portable `feedback/` module into a target Next.js (App Router)
project, wire it to that project's existing `sql` client and auth helper, mount
the floating button globally, and apply the schema. End state: an authed user
sees a "Feedback" pill on every page; submitting writes one row to a `feedback`
table in the project's Postgres.

The module is project-agnostic — it never imports anything from the host app —
so this skill is mostly about *finding the right wires to plug it into*.

## Operating principles
- **Additive and reviewable.** Never overwrite an existing `feedback/` directory,
  API route, or layout edit without showing a diff and getting OK. If files
  exist, refresh in place rather than replace.
- **Derive from the actual code.** Don't assume the project uses `@/lib/db` or
  `@/lib/auth/guard` — find the project's real `sql` export and auth helper by
  searching the codebase. Different Militia projects name them differently.
- **Propose, then do.** Present the plan (step 1) and get a nod before writing
  files or applying DDL.

## Procedure

1. **Audit the target project + plan (read-only first).** Determine and report
   back:
   - Confirm: Next.js App Router (look for `app/` directory, `next.config.*`).
     Bail out cleanly if Pages Router or non-Next — note the kit doesn't support
     those yet.
   - The project's **`sql` client**: a tagged-template Postgres client.
     Search likely paths: `src/lib/db.ts`, `src/db/index.ts`, `lib/db.*`,
     anything importing `@neondatabase/serverless`. Capture the exact import
     path (e.g. `@/lib/db`).
   - The project's **auth helper**: a function that returns
     `{ error, userId, email }` or equivalent for a route handler. Search:
     `requireAuth`, `getSession`, `auth()`, `currentUser`. Capture the exact
     import path and the function's actual return shape — you may need to write
     a tiny adapter if it doesn't match `{ error, userId, email }`.
   - The **root layout** or app shell — where `<FeedbackButton/>` should mount.
     Look for `app/layout.tsx`, any `AppShell`/`RootShell`/`Providers` client
     component the layout wraps everything in. Prefer mounting in the client
     shell over the server layout so `usePathname` works without adapting.
   - The **project name** to record on each feedback row (e.g. `"militiahub"`,
     `"forensic-earnings"`). Default to the repo name.
   - Whether a `feedback` table already exists (`\d feedback` or a SQL probe).

   Then present a short plan: which files you'll create, the API-route content,
   where you'll mount the button, and whether to apply the schema now or hand
   it off. **Pause for OK.**

2. **Copy the module.** Place the kit's `templates/feedback/` into
   `<target>/src/feedback/` (or wherever the project's source root lives — match
   the existing pattern, e.g. some Militia projects use `src/`, others use bare
   `app/`). Do not modify any file in the module — it's intentionally
   project-agnostic.

3. **Generate the API route.** Create `<src>/app/api/feedback/route.ts` with the
   project's actual imports, e.g.:

   ```ts
   import { sql } from "<project's sql import path>";
   import { requireAuth } from "<project's auth helper path>";
   import { createFeedbackPOST } from "<project's feedback import path>/server";

   export const POST = createFeedbackPOST({ sql, requireAuth, project: "<name>" });
   ```

   If the project's auth helper has a different return shape, write a small
   adapter inline rather than modifying `server.ts`:

   ```ts
   const requireAuthAdapter = async () => {
     const session = await getSession();
     if (!session) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }), userId: null, email: null };
     return { error: null, userId: session.user.id, email: session.user.email };
   };
   ```

4. **Mount the button.** Add `<FeedbackButton/>` to the root client shell.
   Import it from the module path. Show a diff before editing the layout file.

5. **Apply the schema.** Run the DDL against the dev DB (or the env's
   `DATABASE_URL`). Prefer the project's existing migration tooling if it has
   one; otherwise paste the SQL into the Neon SQL Editor or use the helper
   script bundled with the kit:

   ```powershell
   node --env-file=.env.local <kit>/scripts/apply-feedback-schema.mjs
   ```

   Production: instruct the user to apply the same DDL to their prod branch
   before the first deploy. *Do not* run prod DDL on the user's behalf without
   explicit confirmation in chat.

6. **(Optional) Register page context on one page.** Pick a high-value page
   (e.g. a dashboard with date pickers, a back-test tool with selected book) and
   add `useFeedbackContext({ ... })` to demonstrate the pattern. Cite the
   module's README for how other pages can opt in.

7. **Verify + summarize.** Confirm types compile (`tsc --noEmit` if the project
   uses TS). Summarize: what was created, where the button lives, what
   page-context fields were registered, and the production-DDL step the user
   still needs to do. Optionally suggest a `/admin/feedback` dashboard as a
   follow-up.

## Done when
- `src/feedback/` exists in the target with the module verbatim from
  `templates/feedback/`.
- `src/app/api/feedback/route.ts` imports the project's actual `sql` + auth
  and calls `createFeedbackPOST`.
- `<FeedbackButton/>` is mounted globally and renders on non-`/auth/*` pages.
- DDL is applied to the dev DB; production DDL handoff is queued.
- `tsc --noEmit` is clean.

## Anti-patterns
- **Don't fork the module to "fit" the project.** If auth has the wrong shape,
  write an adapter at the route level. The whole point is that future updates
  to `templates/feedback/` propagate cleanly.
- **Don't apply prod DDL without explicit chat confirmation.** Dev DB is fine
  if the user said "go ahead"; prod always asks first.
- **Don't add screenshot capture, GitHub mirroring, or a dashboard in this
  install pass.** Those are deliberately deferred — see the module README for
  why. Suggest them as follow-ups if the user asks.
