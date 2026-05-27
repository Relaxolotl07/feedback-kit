# Feedback widget

A self-contained, portable feedback collector for any Next.js app.

Non-engineers click a floating "Feedback" pill → modal pops up with their
current path + structured page context pre-filled → they type a comment and
hit Send. The row lands in the project's `feedback` table for the dev team
to review in the next session.

## Files

```
src/feedback/
├── schema.sql          ← table DDL (apply once per project DB)
├── types.ts            ← wire formats (no React/Next/DB imports)
├── client.ts           ← useFeedbackContext hook + submit fetcher
├── server.ts           ← createFeedbackPOST handler factory
├── FeedbackButton.tsx  ← the floating button + modal
└── README.md           ← you are here
```

The module has no project-specific imports. To use it in another project,
copy this directory wholesale and follow the install steps below.

## Install in a new project (3 steps)

### 1. Apply the schema

```powershell
psql "$env:DATABASE_URL" -f src/feedback/schema.sql
```

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
the user was when they hit Feedback. It rides along with the submission
and shows up in `feedback.page_context` for the reviewer.

```tsx
"use client";
import { useFeedbackContext } from "@/feedback/client";

export function BacktestPanel() {
  const [from, setFrom] = useState("2025-01-01");
  const [to, setTo] = useState("2025-12-31");
  const [book, setBook] = useState<"raw" | "matched" | "actual">("raw");

  useFeedbackContext({ from, to, book });
  // ...
}
```

Any JSON-serializable shape works. Skip the hook entirely if the page
doesn't have meaningful state — the path + query string are always
captured automatically.

## Reading feedback

Sorted by severity (blocker first) then age:

```sql
SELECT id, created_at, submitter_email, severity, page_path, comment, page_context
FROM feedback
WHERE status = 'open'
ORDER BY array_position(ARRAY['blocker','bug','nice'], severity), created_at DESC;
```

Mark resolved:

```sql
UPDATE feedback SET status='fixed', resolved_at=now(), resolved_by='hunter',
       resolution_note='fixed in <commit-sha>'
WHERE id = $1;
```

A `/admin/feedback` dashboard is a natural follow-up; it isn't shipped
in this module so the install stays minimal.

## What's intentionally NOT here (yet)

- **Screenshots.** Adds an `html2canvas` dep and a blob-storage hop.
  Path + page context covers most cases; revisit if it turns out we
  need it.
- **GitHub Issue mirror.** A POST-write hook in `server.ts` could call
  the GitHub API to mirror each row as an Issue. Easy to add later;
  not shipped because we picked "DB only" for v1.
- **`/admin/feedback` dashboard.** SQL above is enough until volume
  justifies a UI.
