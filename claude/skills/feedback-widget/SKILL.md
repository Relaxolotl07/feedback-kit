---
name: feedback-widget
description: Install the in-app feedback widget into a target project. For Next.js App Router + Postgres projects, copies the reference module verbatim and wires the API route + button. For any other stack (Vite + React + FastAPI, Django, Rails, etc.), follows the port path against SPEC.md so the row that lands in `feedback` is byte-identical to the reference. Use when a project wants non-engineers to send structured feedback (path + page context + comment + severity + passive focus + clicked pointers) from any authed page.
---

# Install the feedback widget

Goal: stand up the widget in a target project — either by dropping the
reference module in (Next.js App Router) or by porting against `SPEC.md`
(anything else). End state: an authed user sees a "Feedback" pill on every
page; submitting writes one row to a `feedback` table whose shape matches
the spec **exactly** so cross-project triage via `/feedback` continues to work.

## Find the kit on disk before doing anything

The kit globally installs only this `SKILL.md` to `~/.claude/skills/feedback-widget/`.
The actual templates, SPEC, and helper scripts live in the kit repo on disk.
**You need that repo open to do the install properly.**

Look in (in order):
1. `~/Documents/GitHub/feedback-kit/` (default Windows GitHub Desktop / `gh repo clone` location)
2. `~/code/feedback-kit/`, `~/src/feedback-kit/`, `~/repos/feedback-kit/` (common Unix patterns)
3. Current working directory (in case it's a monorepo with the kit alongside)
4. If nowhere on disk: `git clone https://github.com/Relaxolotl07/feedback-kit /tmp/feedback-kit`
   (or any scratch path) and read from there.

Once found, the canonical files are:
- `<kit>/SPEC.md` — architecture-agnostic source of truth. **Read this first.**
- `<kit>/templates/feedback/` — the reference Next.js+Postgres module.
  Copy verbatim for Next projects; use as a porting template otherwise.
- `<kit>/scripts/apply-feedback-schema.mjs` — DDL helper.

## Parity constraints (non-negotiable across all ports)

Regardless of stack, these must match `SPEC.md` exactly — they're what
makes one `/feedback` skill able to triage across every consumer project:

- **Severity values are exactly `nice`, `bug`, `blocker`** (lowercase, no
  synonyms — *not* `minor/major/blocker`, *not* `low/med/high`).
- **The row carries `focus` and `pointers` columns** (jsonb on Postgres,
  JSON on SQLite). Don't ship a v1-style "comment + severity + page_context"
  port — it omits the whole reason DOM-pointer + passive capture exists,
  and rows from your project won't be locatable by the `/feedback` skill.
- **Wire format is camelCase** at the network boundary (per SPEC §3):
  `pagePath`, `pageQuery`, `pageContext`, etc. Server may snake_case to
  columns internally.
- **Submitter email comes from the session, never the payload.**
- **Constants from SPEC §7** (max comment 4000, max pointers 20,
  recentClicks ring buffer 5 in 60s, consoleErrors 20 in 30s, intersection
  threshold 0.4, selector depth ≤5).

If you find yourself dropping any of the above to "fit the project", stop
and surface it — the answer is an adapter, not a smaller spec.

The module is project-agnostic — it never imports anything from the host app —
so this skill is mostly about *finding the right wires to plug it into*.

## Operating principles
- **Additive and reviewable.** Never overwrite an existing `feedback/` directory,
  API route, or layout edit without showing a diff and getting OK. If files
  exist, refresh in place rather than replace.
- **Derive from the actual code.** Don't assume the project uses `@/lib/db` or
  `@/lib/auth/guard` — find the project's real `sql` export and auth helper by
  searching the codebase. Naming conventions vary across projects.
- **Propose, then do.** Present the plan (step 1) and get a nod before writing
  files or applying DDL.

## Procedure

1. **Audit the target project + plan (read-only first).** Determine and report
   back:
   - Look for: Next.js App Router (`app/` directory + `next.config.*`).
     - **If yes:** the kit's `templates/feedback/` drops in verbatim — proceed
       through the rest of this procedure.
     - **If no** (Pages Router, Vite + React, plain React, SvelteKit, Remix,
       any backend without a JS frontend, etc.): don't bail. Switch to the
       **port path** below.
   - The project's **`sql` client**: a tagged-template Postgres client.
     Search likely paths: `src/lib/db.ts`, `src/db/index.ts`, `lib/db.*`,
     anything importing `@neondatabase/serverless`. Capture the exact import
     path (e.g. `@/lib/db`). Different projects name them differently.
   - The project's **auth helper**: a function that returns
     `{ error, userId, email }` or equivalent for a route handler. Search:
     `requireAuth`, `getSession`, `auth()`, `currentUser`. Capture the exact
     import path and the function's actual return shape — you may need to write
     a tiny adapter if it doesn't match `{ error, userId, email }`.
   - The **root layout** or app shell — where `<FeedbackButton/>` should mount.
     Look for `app/layout.tsx`, any `AppShell`/`RootShell`/`Providers` client
     component the layout wraps everything in. Prefer mounting in the client
     shell over the server layout so `usePathname` works without adapting.
   - The **project name** to record on each feedback row (e.g. the repo name).
     Default to the repo name.
   - Whether a `feedback` table already exists (`\d feedback` or a SQL probe).

   Then present a short plan: which files you'll create, the API-route content,
   where you'll mount the button, and whether to apply the schema now or hand
   it off. **Pause for OK.**

2. **Copy the module.** Place the kit's `templates/feedback/` into
   `<target>/src/feedback/` (or wherever the project's source root lives — match
   the existing pattern, e.g. some projects use `src/`, others use bare
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

6. **Survey for click context — required pass.** Walk the host project's
   frontend and identify the surfaces where reviewers will likely receive
   feedback. For each, add the context the row will need to be acted on:

   - **`data-feedback-*` attrs (per-element)** — for tables / lists / grids
     keyed on a domain entity. Annotate the **row** with the entity's
     identity (id, primary identifier) and the displayed value the user is
     reacting to (score, weight, status). Use the `feedbackData({...})`
     spread helper from `./client`:

     ```tsx
     import { feedbackData } from "@/feedback/client";

     <tr {...feedbackData({ entityId: e.id, ticker: e.ticker, score: e.score })}>
       <td><MomentumCell score={e.score} /></td>
       ...
     </tr>
     ```

     The widget walks the clicked element + 5 ancestors at pin time and
     harvests every `data-feedback-*` attr into the pointer's `data` field
     (SPEC §3, §4.7). Reviewer sees `entityId=42, ticker=AAPL, score=73`
     next to the pin — no reverse-engineering. Closer-to-target wins, so a
     row-level annotation is the right default and per-cell overrides work
     when needed.

   - **`useFeedbackContext({...})` (per-page)** — for genuinely page-global
     state that doesn't belong on any single element (the active tab, the
     selected book, the date range). Mount in the page component so the
     singleton updates on each render.

   - **`<FeedbackRegion name="...">` (per-section)** — for named panels
     that should appear in `focus.visibleRegions` when ≥40% of the section
     is on screen. Cheap insurance when several panels share a page.

   **Heuristic for what to annotate**: rows/cells/items that represent a
   domain entity (anything with a stable id), computed values the user is
   likely to react to (scores, ratings, status badges), and panels with
   their own selectable state. If a row landing in `feedback` would need
   the reviewer to grep the codebase to figure out *which entity*, you
   missed an annotation.

   **Pause and list the annotated surfaces** in the proposed plan before
   editing. Surface the heuristic decisions so the user can flag misses.

7. **Verify + summarize.** Confirm types compile (`tsc --noEmit` if the project
   uses TS). Summarize: what was created, where the button lives, what
   page-context fields were registered, **which surfaces got
   `data-feedback-*` annotations** (so the triage skill knows what context
   to expect), and the production-DDL step the user still needs to do.
   Optionally suggest a `/admin/feedback` dashboard as a follow-up.

## Done when

Regardless of which path you took:

- A `feedback` table exists in the dev DB with the columns from SPEC §2:
  at minimum `id, created_at, submitter_email, project, page_path,
  page_query, page_context, comment, severity, focus, pointers, status`,
  plus the resolution fields. Production DDL handoff is queued.
- An API endpoint accepts the SPEC §3 wire format (camelCase fields,
  optional `focus` + `pointers`, max-20 pointers, comment 1-4000 chars).
- A floating "Feedback" pill renders on every authed page (SPEC §4.1).
- The modal includes severity radios (`nice|bug|blocker`), textarea,
  "Point at it" CTA + chips, captured-context disclosure (SPEC §4.2).
- Submitting writes a row whose severity, focus, and pointers values match
  the spec exactly. Probe: SELECT a test row and confirm it parses against
  the same shape that `<kit>/templates/feedback/types.ts` describes.
- The project's type-checker / linter is clean (`tsc --noEmit`, `mypy`,
  `ruff`, whatever applies).

## Port path (project isn't Next.js App Router)

The widget's *design* is portable — only the reference implementation is
Next-specific. Walk the user through the port instead of stopping:

1. **Open `SPEC.md` from the kit on disk** (resolve `<kit>` per the "Find
   the kit on disk" section above — *don't* assume it's empty just because
   `~/.claude/skills/feedback-widget/` only contains this SKILL.md; the kit
   repo is somewhere else on the filesystem). The spec describes the data
   model, wire format, client behavior, server validation, and triage flow
   in stack-agnostic terms. §9 has sketches for common stacks (Vite +
   React + FastAPI, Django, Rails, etc.). Read it before proposing anything.
2. **Inventory what the project gives you** — client framework + router
   (so you know what to swap `usePathname()` for), backend framework +
   ORM (so you know how to write the route + INSERT), session/auth shape,
   DB dialect.
3. **Propose a port plan.** Concretely: which files you'll create on the
   server (route + model + migration), which on the client (the React
   component still works almost verbatim if it's React; otherwise an
   equivalent in the project's framework), and any constants from §7 of
   the SPEC that need translation (e.g. column types for non-Postgres
   DBs). **Pause for OK.**
4. **Port file-by-file.** The client modules in `templates/feedback/` are
   mostly pure React + DOM:
   - `focus.ts`, `client.ts`, `types.ts`, `FeedbackRegion.tsx`,
     `FeedbackButton.tsx` — all portable to any React app with minor swaps
     (drop `next/navigation`, use the project's router hooks for the
     pathname).
   - `server.ts` — rewrite in the project's backend language; keep the
     validation rules and INSERT shape per §5.2 of the SPEC.
   - `schema.sql` — translate `jsonb` and `timestamptz` to the project's
     DB types (§2 of the SPEC has the table for guidance).
5. **Validate against the spec.** Once the port compiles, do a quick pass:
   does each constant in §7 match? Does the wire format in §3 match? Does
   the floating pill behave as in §4.1?
6. **Apply DDL + smoke-test + summarize**, same as the Next path.

The point is the row that lands in `feedback` should be byte-identical
between a Next consumer and a ported consumer. That's what makes
cross-project triage work.

## Anti-patterns
- **Don't fork the module to "fit" the project.** If auth has the wrong shape,
  write an adapter at the route level. The whole point is that future updates
  to `templates/feedback/` propagate cleanly.
- **Don't apply prod DDL without explicit chat confirmation.** Dev DB is fine
  if the user said "go ahead"; prod always asks first.
- **Don't add screenshot capture, GitHub mirroring, or a dashboard in this
  install pass.** Those are deliberately deferred — see the module README for
  why. Suggest them as follow-ups if the user asks.
- **Don't bail on non-Next projects.** Read `SPEC.md` and follow the port path
  above. Only stop if the user explicitly says "skip it" after seeing the plan.
