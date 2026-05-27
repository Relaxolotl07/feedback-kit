# Feedback widget

A self-contained, portable feedback collector for any Next.js app.

Non-engineers click a floating "Feedback" pill → modal pops up with their
current path + automatically-captured context (where their cursor was, what
they just clicked, what's on screen) → they type a comment and hit Send. The
row lands in the project's `feedback` table for the dev team to review in
the next session.

Two opt-in extras that make the row even more actionable for reviewers:
- **Page context** — pages can register a JSON blob of their state via
  `useFeedbackContext({...})`.
- **Named regions** — wrap any meaningful UI block in `<FeedbackRegion name="...">`
  so submissions know it was on screen.

There's also an explicit **"Point at it"** mode — the user clicks any element
on the page to pin it as part of the submission. Stack as many pins as needed.

## Files

```
src/feedback/
├── schema.sql            ← table DDL (apply once per project DB)
├── types.ts              ← wire formats (no React/Next/DB imports)
├── client.ts             ← useFeedbackContext hook + submit fetcher
├── server.ts             ← createFeedbackPOST handler factory
├── focus.ts              ← passive cursor/click/region/error trackers
├── FeedbackButton.tsx    ← floating button + modal + pointer mode
├── FeedbackRegion.tsx    ← optional <FeedbackRegion name="..."> helper
└── README.md             ← you are here
```

The module has no project-specific imports. To use it in another project,
copy this directory wholesale and follow the install steps below.

## Install in a new project (3 steps)

### 1. Apply the schema

```powershell
psql "$env:DATABASE_URL" -f src/feedback/schema.sql
```

Idempotent — re-running just brings older deployments forward (e.g. adds the
`focus` and `pointers` columns added in v2).

### 2. Wire the API route

`src/app/api/feedback/route.ts`:

```ts
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";
import { createFeedbackPOST } from "@/feedback/server";

export const POST = createFeedbackPOST({
  sql,
  requireAuth,
  project: "<this-project>",          // e.g. the repo name
});
```

The `sql` callable must be a Neon-style tagged template (or anything with
that interface). `requireAuth` must return `{ error, userId, email }` —
adjust the names to match your project's auth helper.

### 3. Mount the button

Drop `<FeedbackButton />` into the app shell — once, at the root layout
or any always-rendered client component:

```tsx
import { FeedbackButton } from "@/feedback/FeedbackButton";
// ...
<FeedbackButton />
```

That's it. Authenticated users will see the floating pill on every
non-`/auth/*` page.

## Capturing page context (optional but recommended)

Pages can register a structured JSON object that helps disambiguate where
the user was when they hit Feedback:

```tsx
"use client";
import { useFeedbackContext } from "@/feedback/client";

export function BacktestPanel() {
  const [from, setFrom] = useState("2025-01-01");
  const [book, setBook] = useState<"raw" | "matched" | "actual">("raw");
  useFeedbackContext({ from, book });
  // ...
}
```

Any JSON-serializable shape works. Skip the hook where the page doesn't have
meaningful state — path, query, and the passive focus signals (cursor, recent
clicks, text selection, console errors, viewport) are always captured.

## Named regions (optional, dirt cheap)

Wrap any meaningful UI block so submissions know it was on screen:

```tsx
import { FeedbackRegion } from "@/feedback/FeedbackRegion";

<FeedbackRegion name="composition.actual">
  <CompositionTable book="actual" ... />
</FeedbackRegion>
```

When the user is looking at this section (≥40% in viewport), `composition.actual`
shows up in `focus.visibleRegions`. Free if no `<FeedbackRegion>`s are present.

## Reading feedback

Sorted by severity then age, with focus + pointers expanded:

```sql
SELECT id, created_at, submitter_email, severity, page_path, comment,
       page_context, focus, pointers
FROM feedback
WHERE status = 'open'
ORDER BY array_position(ARRAY['blocker','bug','nice'], severity), created_at DESC;
```

Mark resolved:

```sql
UPDATE feedback SET status='fixed', resolved_at=now(), resolved_by='<you>',
       resolution_note='fixed in <commit-sha>'
WHERE id = $1;
```

A `/admin/feedback` dashboard is a natural follow-up; it isn't shipped in
this module so the install stays minimal.

## What's intentionally NOT here (yet)

- **Screenshots.** Adds an `html2canvas` dep and a blob-storage hop. The
  focus + pointer payload covers most cases at zero infra cost. If we ever
  add image capture, it should be optional and opt-in per submission.
- **GitHub Issue mirror.** A POST-write hook in `server.ts` could call the
  GitHub API to mirror each row as an Issue. Easy to add later; not shipped
  because we picked "DB only" for v1.
- **`/admin/feedback` dashboard.** SQL above is enough until volume justifies a UI.
