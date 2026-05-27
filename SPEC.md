# Feedback Widget — Specification

This file is the architecture-agnostic source of truth for the widget. The
Next.js + Postgres + Radix module under `templates/feedback/` is **one
implementation**. Anyone porting to a different stack should match the
behavior + wire format described here; the React code is illustrative,
not normative.

The spec is intentionally short. If you can't implement it from this file
alone, that's a bug in the spec — open an issue.

## 1. What it is

A floating "Feedback" pill on every authenticated page of an app. Clicking
it opens a modal where a non-engineer types a comment, picks a severity,
optionally clicks an element on the page to pin it, and hits Send. The
submission writes one row to a `feedback` table with rich auto-captured
context so a reviewer (a human or a future Claude session) can locate the
relevant code without the user having to describe where they were.

The widget never uploads images. All context is structured JSON — typically
1–2 KB per submission.

## 2. Data model

One table, `feedback`. Schema (Postgres dialect; translate types as needed):

```sql
CREATE TABLE feedback (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Submitter (from app session)
  submitter_email text NOT NULL,
  submitter_sub   text,           -- opaque user id (e.g. OAuth sub) — optional

  -- Where they were
  project         text NOT NULL,  -- identifier for the host app, e.g. 'my-app'
  page_path       text NOT NULL,  -- e.g. '/backtest'
  page_query      text,           -- raw '?from=...&to=...' or NULL
  page_context    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- What they said
  comment         text NOT NULL CHECK (length(comment) BETWEEN 1 AND 4000),
  severity        text NOT NULL DEFAULT 'nice'
                    CHECK (severity IN ('nice', 'bug', 'blocker')),

  -- Captured context
  focus           jsonb NOT NULL DEFAULT '{}'::jsonb,
  pointers        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Triage
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'triaged', 'fixed', 'wontfix')),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);

CREATE INDEX feedback_open_idx    ON feedback (created_at DESC) WHERE status = 'open';
CREATE INDEX feedback_project_idx ON feedback (project, created_at DESC);
```

**Translation notes**:
- `jsonb` → any structured/JSON column (`json`, `JSONB`, `JSONField`, etc.).
- `timestamptz` → any timezone-aware timestamp.
- `bigserial` → any auto-increment integer.
- Severity and status checks: enforce in app code if your DB doesn't support
  enum-like constraints (e.g. SQLite < 3.31).

## 3. Wire format

The client POSTs JSON to `/api/feedback` (or your app's equivalent). All
fields are camelCase on the wire; server may snake_case them to columns.

```ts
interface FeedbackSubmission {
  comment:       string;                 // 1..4000 chars, required
  severity:      "nice" | "bug" | "blocker";
  pagePath:      string;                 // e.g. "/backtest"
  pageQuery?:    string;                 // includes leading "?" or omitted
  pageContext?:  Record<string, unknown>;
  focus?:        FocusSnapshot;          // see §5
  pointers?:     ElementSummary[];       // max 20 entries
}
```

`ElementSummary` (used inside `focus.cursorTarget`, `focus.recentClicks[]`,
and the top-level `pointers[]`):

```ts
interface ElementSummary {
  tag:       string;                     // uppercase, e.g. "BUTTON"
  text:      string;                     // trimmed, collapsed whitespace, ≤ 120 chars
  selector:  string;                     // CSS-ish path, ≤ 5 levels deep
  ariaLabel: string | null;
  role:      string | null;
  rect:      { x: number; y: number; w: number; h: number }; // viewport coords, integers
}
```

Server response on success: `201` with `{ id, createdAt }`.
On invalid payload: `400` with `{ error }`.
On unauthenticated: `401`.

## 4. Client behavior

### 4.1 Floating pill

- Position: fixed, bottom-right of the viewport, `~16px` inset.
- Visible on every page that's behind authentication.
- Hidden on the app's sign-in / auth flow pages (whatever pre-session
  routes exist in your app).
- Hidden while pointer mode (§4.3) is active.
- Sized to be unmistakable but not visually heavy — a small chip with an
  icon and the word "Feedback". The reference implementation uses Radix
  Dialog + Tailwind; any equivalent works.

### 4.2 Modal

On click, opens a centered modal containing:

1. **Title** "Send feedback" + a one-line subtitle.
2. **Severity radios** — three mutually exclusive options:
   `Nice-to-have` (`nice`), `Bug` (`bug`), `Blocker` (`blocker`).
   Default: `nice`.
3. **Comment textarea** — required, 1–4000 chars, autofocus.
4. **"Point at it" CTA** — full-width button that enters pointer mode (§4.3).
   Below it, a list of chips for any already-pinned elements (each chip
   removable; tag + truncated text).
5. **Captured-context disclosure** — collapsed by default. When expanded,
   shows the user what's being sent: page path, page_context keys, focus
   summary (hovered element, text selection, visible regions, recent
   clicks, console error count). Lets the user audit the payload.
6. **Cancel + Send buttons**. Send is disabled while comment is empty or
   request is in flight. Success state replaces the form with a "Thanks —
   logged" message and a Close button.

### 4.3 Point-at-it mode

Triggered by the CTA in §4.2.

- Dialog and pill hide. Cursor switches to crosshair.
- A persistent banner at the top of the viewport says "Click any element
  to pin it · press Esc to cancel".
- A blue highlight rectangle follows the element under the cursor
  (`pointer-events: none` so it doesn't intercept clicks).
- On click: capture-phase listener fires `preventDefault` +
  `stopPropagation` (so the underlying click doesn't navigate / submit / open
  a menu), summarizes the clicked element into an `ElementSummary`, appends
  it to `pointers[]`, exits pointer mode, dialog reopens.
- On `Escape`: exits pointer mode without pinning, dialog reopens.
- Multiple pins allowed (cap: 20). Each pin shows as a removable chip in
  the modal.

### 4.4 Passive focus capture

Always on once the widget mounts. Snapshotted into the `focus` payload
at modal-open time (not at submit time — so the user can still scroll /
type / browse while composing without disturbing what was captured).

**Tracked signals**:

- **`cursorTarget`** — element under the cursor, updated on every
  `mousemove` (rAF-throttled). Stored as `ElementSummary`.
- **`textSelection`** — `window.getSelection().toString()` trimmed; `null`
  if empty. Truncate to 500 chars.
- **`recentClicks`** — ring buffer of the last 5 clicked elements in the
  last 60 seconds. Stored in capture phase so framework synthetic events
  can't swap the target. Each entry: `ElementSummary` + `at` (ms ago at
  snapshot time).
- **`visibleRegions`** — array of names of registered regions that are
  ≥ 40% visible at snapshot time. See §4.5.
- **`consoleErrors`** — ring buffer of the last 20 `console.error` calls
  + window `error` events + `unhandledrejection`s in the last 30 seconds.
  Each entry: `{ at: ms-ago, message: string (≤ 500 chars) }`.
- **`viewport`** — `{ w, h, scrollY }` integers at snapshot time.

`focus` is always a JSON object (possibly empty if nothing was captured).

### 4.5 Named regions

Wrap any meaningful UI block (a tab content, a panel, a section) so
submissions know it was on screen:

```jsx
<FeedbackRegion name="composition.actual">
  <CompositionTable ... />
</FeedbackRegion>
```

Implementation: an `IntersectionObserver` with a 40% visibility threshold
tracks `[data-feedback-region]` elements. The region is added to
`focus.visibleRegions` while ≥ 40% is in viewport. No-op if no regions
are registered.

Naming convention is up to the host app. `<area>.<sub>` (e.g.
`orr.backtest`, `composition.actual`) is concise and groupable.

### 4.6 Page context

A host page can register a JSON object describing its current state. The
object rides along with the submission:

```jsx
useFeedbackContext({ from, to, book, selectedTicker });
```

The hook (or equivalent) writes to a module-singleton; the modal reads it
at mount time. Any JSON-serializable value works. The reviewer sees this
as `page_context` — useful for things like "which book was selected" or
"what date range was active" that aren't in the URL.

## 5. Server behavior

### 5.1 Auth

The endpoint requires an authenticated session. The widget never accepts
the submitter's email from the client payload — it's always read from the
session.

Map your project's auth helper to a return shape of
`{ error | null, userId | null, email | null }` (or the equivalent for
your stack — concept matters, not exact names).

### 5.2 Validation

Reject (`400`) submissions that:

- Have a `comment` outside 1–4000 chars after trim.
- Have a `severity` not in the enum.
- Have a `pagePath` empty or > 500 chars.
- Have > 20 `pointers`.
- Have a `pageQuery` > 2000 chars.

Use any schema validator (Zod, Pydantic, Marshmallow, Yup, ...). The
reference uses Zod.

### 5.3 Insert

On valid payload: `INSERT INTO feedback (...) VALUES (...)`. `created_at`
and `status` default in the DB. The server provides `project` (configured
per-deployment) and `submitter_email` + `submitter_sub` from the session.

Return `201` with `{ id, createdAt }`.

## 6. Triage

The reviewer's workflow runs against the `feedback` table directly. No
admin dashboard is shipped; SQL is sufficient until volume justifies one.

### 6.1 Reading the queue

Sort blocker first, then by age:

```sql
SELECT id, created_at, submitter_email, severity, page_path, page_query,
       page_context, focus, pointers, comment, status
FROM feedback
WHERE status = 'open'
ORDER BY array_position(ARRAY['blocker','bug','nice']::text[], severity),
         created_at
LIMIT 40;
```

(Use a CASE expression instead of `array_position` on engines without it.)

### 6.2 Resolving a row

After the fix is committed:

```sql
UPDATE feedback SET
  status         = 'fixed',          -- or 'triaged' / 'wontfix'
  resolved_at    = now(),
  resolved_by    = '<handle>',
  resolution_note = '<commit-sha>'   -- or a short explanation
WHERE id = $1;
```

Commit convention: subject line `Closes feedback #<id>: <one-liner>`, body
quoting the original comment.

## 7. Constants

These numbers matter for behavior parity — keep them when porting:

| Constant                              | Value     |
|---------------------------------------|-----------|
| Max comment length                    | 4000      |
| Max page_path length                  | 500       |
| Max page_query length                 | 2000      |
| Max element text                      | 120 chars |
| Max textSelection                     | 500 chars |
| Max consoleErrors message length      | 500 chars |
| recentClicks buffer size              | 5         |
| recentClicks window                   | 60 seconds|
| consoleErrors buffer size             | 20        |
| consoleErrors window                  | 30 seconds|
| Max pointers per submission           | 20        |
| IntersectionObserver threshold        | 0.4       |
| selector max depth                    | 5         |

## 8. Out of scope (deliberately)

- **Screenshots / image capture** — the focus + pointer payload covers
  most cases; if added later it should be optional per submission, with
  blob storage external to the table.
- **GitHub Issue mirror** — a post-insert hook is easy to add; not part
  of the spec.
- **Admin dashboard UI** — SQL is enough until it isn't.
- **Multi-tenant / multi-project DB** — `project` column supports it
  schema-side, but no UI / scope-resolution flow is specified.

## 9. Stack notes

Same behavior, different primitives. Each section sketches the boundary
mapping for a stack; fill in the rest from the spec above.

### 9.1 Next.js (App Router) + Postgres

The reference. See `templates/feedback/`.
- Auth helper returns `{ error: Response | null, userId, email }`.
- `sql` is a Neon-style tagged template.
- API route: `app/api/feedback/route.ts` exports `POST`.

### 9.2 Vite + React (any router) + FastAPI

- Client: same React component (Radix Dialog is portable). Drop the
  Next-only imports — replace `usePathname()` with `useLocation().pathname`
  (React Router) and remove the `next/navigation` import. The
  `setupFocusTracking()` / `useFeedbackContext()` modules are pure
  React + DOM, no changes needed.
- Submit URL: whatever your FastAPI route is, e.g. `/api/feedback`.
- Server: a FastAPI endpoint with a Pydantic submission model, an auth
  dependency that returns the session's user, and a SQLAlchemy insert.
- DB: SQLite is fine for dev; use `JSON` (SQLAlchemy's `JSON` type) for the
  three jsonb columns. Index on `(created_at DESC) WHERE status='open'`.

```python
# routes/feedback.py — sketch
class Submission(BaseModel):
    comment: constr(min_length=1, max_length=4000)
    severity: Literal["nice", "bug", "blocker"] = "nice"
    pagePath: constr(min_length=1, max_length=500)
    pageQuery: constr(max_length=2000) | None = None
    pageContext: dict[str, Any] | None = None
    focus: dict[str, Any] | None = None
    pointers: list[dict[str, Any]] | None = None  # validate elements client-side; loose server-side

@router.post("/api/feedback", status_code=201)
async def submit(body: Submission, user = Depends(require_user), db = Depends(get_db)):
    if body.pointers and len(body.pointers) > 20:
        raise HTTPException(400, "Too many pointers")
    row = Feedback(
        submitter_email=user.email, submitter_sub=user.sub,
        project="<your-app>",
        page_path=body.pagePath, page_query=body.pageQuery,
        page_context=body.pageContext or {},
        comment=body.comment, severity=body.severity,
        focus=body.focus or {}, pointers=body.pointers or [],
    )
    db.add(row); await db.commit()
    return {"id": row.id, "createdAt": row.created_at}
```

### 9.3 Django / DRF

- Model: `Feedback` with three `JSONField`s and the same shape.
- View: a single `@api_view(['POST'])` with a serializer and an
  `IsAuthenticated` permission. Pull email from `request.user`.
- URL: `path("api/feedback/", ...)`.

### 9.4 Rails

- Migration: `create_table :feedback` with `t.jsonb`s.
- Controller: `FeedbacksController#create` with strong params + a
  `before_action :authenticate_user`.
- Route: `post "/api/feedback"`.

### 9.5 Anything else

If your stack isn't listed: implement §2–§6 directly. The widget code is
React but the design lives entirely in this document.
