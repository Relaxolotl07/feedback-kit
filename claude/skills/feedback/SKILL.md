---
name: feedback
description: Walk the open feedback queue and address items one by one. For each row in the project's `feedback` table — locate the code via the captured pointer / cursor / region / page-context signals, propose a fix, get user OK, apply, commit, and mark the row resolved with the commit SHA. Use when an operator wants to clear what users have submitted via the in-app feedback widget (the companion to /feedback-widget).
---

# Walk the feedback queue

Goal: clear open rows in the `feedback` table — turn each into a (small) change with
the row marked resolved at the end. The widget captures enough structured context
per row (path, pinned element, hovered element, recent clicks, visible regions,
page state) that most rows are locatable in code in under a minute.

## Operating principles

- **Read-only first.** Pull the queue, present one-line summaries, confirm which
  DB scope (dev-local vs prod) and which item(s) to start with before doing
  anything. Default DB scope is **prod** — that's where real submissions live.
- **One row at a time.** No batching. Each fix gets reviewed, applied, and
  committed separately so the resolved-by trail is precise.
- **Derive locations from the row.** Pointer `text` / `selector` / `outerHTML`,
  focus `cursorTarget`, `visibleRegions`, `page_path` — grep on these against
  the project's `src/` before opening files at random.
- **Propose, then do.** Always pause for OK before writing or committing.
- **Mark resolved exactly when fixed.** The UPDATE happens immediately after the
  commit, with the SHA recorded in `resolution_note`. Never mark before the
  commit lands.

## Procedure

1. **Pull prod env (or use dev-local).**
   - Most consumer projects use Vercel; the canonical way to grab prod creds is:
     ```powershell
     npx -y vercel env pull --environment=production --scope <vercel-team> .env.production
     ```
     Ask the user for the Vercel team/scope name if it isn't obvious from
     `package.json` / `vercel.json`.
   - If the project doesn't use Vercel, ask the user how they'd like the prod
     `DATABASE_URL` provided.
   - For dev-local: just use `--env-file=.env.local`.
   - **Always delete `.env.production` at the end of the session.** Don't leave
     prod creds on disk.

2. **Read the queue.** If the project ships `scripts/read-feedback.mjs` (kit
   convention), use it:
   ```powershell
   node --env-file=.env.production scripts/read-feedback.mjs
   ```
   Otherwise run an inline query:
   ```sql
   SELECT id, severity, page_path, page_context, focus, pointers, comment, submitter_email, created_at
   FROM feedback WHERE status = 'open'
   ORDER BY array_position(ARRAY['blocker','bug','nice']::text[], severity), created_at;
   ```
   Present one-line summaries (id, severity, page, submitter, first ~80 chars
   of comment) and ask which to tackle. Default ordering: oldest blocker →
   newest nice.

3. **For each row, work through it:**
   - **Locate the code.** Use the captured signals — in this order of
     specificity:
     - `pointers[].data` and `focus.cursorTarget.data` → the most actionable
       signal when present. Domain identity ridden along from the
       `data-feedback-*` attrs at click time (SPEC §4.7). If the pin carries
       `{ entityId: 42, ticker: "AAPL", score: 73 }`, you already know the
       row's referent without grepping.
     - `pointers[].outerHTML` and `pointers[].text` → grep `src/` literally
       (precise — the user clicked exactly this element).
     - `focus.cursorTarget.text` → same (the user was hovering this).
     - `focus.textSelection` → if they selected text, it's gold; grep for it.
     - `pointers[].selector` → extract the deepest tag, grep that.
     - `focus.visibleRegions` → find the `<FeedbackRegion name="X">` declaration
       to narrow down the file.
     - `page_path` → `src/app/<path>/page.tsx`.
     - `page_context` keys → often map to component state / prop names.
   - **Read the candidate file(s).** Don't fix blind.
   - **Propose the fix in chat** — quote the user's comment, summarize where
     the issue lives, sketch the change in a few lines. **Pause for OK.**
   - **Apply.** Match surrounding style. Type-check (`tsc --noEmit`) and lint
     if the project has those gates wired up.
   - **Commit.** Use the form `Closes feedback #<id>: <one-line summary>` for
     the subject. Body: quote the user's comment + a sentence on the change.
     Don't add a `Co-Authored-By: Claude` trailer unless the project's
     conventions explicitly want one.
   - **Adaptive-context check.** If you reached this row and the captured
     signals were *not* enough to pin the referent (no entity id in
     `pointers[].data`, no useful `text`, only a generic selector like
     `div > div > svg`), the fix isn't only the code change — it's also a
     missing annotation on the component that rendered the click target.
     Add the appropriate `data-feedback-*` attrs (or a `useFeedbackContext`
     at the page level if the state is page-global) and bundle them into
     the same commit, or a tiny preparatory commit immediately before. The
     point is the **next** submission from the same surface arrives with
     the context this row was missing. Note the addition in the resolution
     summary so the user sees the contract growing.

   - **Mark the row resolved.** Immediately after the commit lands:
     ```sql
     UPDATE feedback SET
       status = 'fixed',
       resolved_at = now(),
       resolved_by = '<your handle>',
       resolution_note = '<commit-sha>'
     WHERE id = <id>;
     ```
     If the user wants to defer rather than fix, set `status='triaged'`
     (still on the radar) or `status='wontfix'` (closed without change) with
     a note explaining why.

4. **Ask before continuing.** Don't auto-advance through the queue. After each
   row, summarize what happened and ask whether to tackle the next.

5. **Cleanup at the end.**
   - `Remove-Item .env.production` (if it was pulled).
   - Final summary: items resolved + their commit SHAs, items deferred + reason,
     items left open.

## Done when

- Each addressed row has a non-`open` status with `resolution_note` populated.
- Corresponding commits exist using the `Closes feedback #N` convention.
- No prod env file is left on disk.

## Anti-patterns

- **Don't fix without locating.** If the captured context isn't enough to pin
  the code down, ask the user — don't guess.
- **Don't batch UPDATEs without confirmation.** One row, one commit, one UPDATE.
- **Don't push to `main` unprompted.** Commit locally; let the user decide
  when to merge / deploy.
- **Don't treat `page_context` JSON keys as the contract** — they're free-form;
  use them as hints, not as a schema.
- **Don't widen scope.** If the user said "fix this column", don't refactor the
  whole table. Track adjacent ideas as new feedback rows instead.
