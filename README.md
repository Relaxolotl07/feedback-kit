# Feedback Kit

A portable in-app feedback widget for Next.js (App Router) projects, packaged
for one-command install and an optional `/feedback-widget` Claude Code skill.
Built for the messy reality of one-person side projects, vibe-coded internal
tools, and prototypes you'd never bother filing GitHub Issues against — but
where you still want someone non-technical to be able to say "this looks
weird, here's why" with one click.

Non-engineers click a floating **Feedback** pill → modal pre-fills their path
+ the page's registered structured context → they type a comment and pick a
severity → row lands in the project's Postgres `feedback` table for the dev
team (or future-you) to review.

| Part | What it is | Use it when |
|------|-----------|-------------|
| **[templates/feedback/](templates/feedback/)** | The self-contained module (schema + types + client hook + server handler + Radix Dialog component) | You want to drop it into a project by hand |
| **[claude/skills/feedback-widget/](claude/skills/feedback-widget/SKILL.md)** | A `/feedback-widget` Claude Code skill that audits the target project and wires the module to its real `sql` + auth helpers | You want a "add feedback to this app" button |
| **[scripts/apply-feedback-schema.mjs](scripts/apply-feedback-schema.mjs)** | A reusable DDL applier (`node` + `@neondatabase/serverless`) | You don't want to copy SQL into the Neon console |

## The idea in one paragraph

The module is **project-agnostic** — `templates/feedback/*` has no imports
of any consumer project. Each consuming app supplies its own `sql` client and
`requireAuth` helper at the API route boundary. That means installing it is
the same three actions everywhere: copy the module, wire one API route, mount
one component. The skill exists to do those three actions from the actual code
in the target repo, in case the project's auth helper has a slightly different
shape and needs an inline adapter.

## Quickstart

**Install the skill globally (recommended):**

```powershell
./install.ps1 -Global
```

```bash
./install.sh --global
```

Copies `SKILL.md` to `~/.claude/skills/feedback-widget/SKILL.md`. Inert until
you invoke it; no global `CLAUDE.md` is touched.

Then, in any Next.js + Postgres + session-auth project:

```
/feedback-widget
```

The skill audits the project (finds the `sql` import, the auth helper, the
layout/shell), proposes the wiring, and on your OK copies the module + writes
the API route + mounts the button + applies the dev DDL. Production DDL is
always confirmed in chat before running.

**Manual (no Claude Code):** copy `templates/feedback/` to `<target>/src/feedback/`
and follow the three steps in [templates/feedback/README.md](templates/feedback/README.md).

**Just want the files dropped in?**

```powershell
./install.ps1 -Target "C:\path\to\repo"
```

```bash
./install.sh --target /path/to/repo
```

Copies `templates/feedback/` to `<repo>/src/feedback/`. Doesn't wire the route
or layout — run `/feedback-widget` afterwards for that, or do it by hand.

## What the widget actually does

1. **Floating pill** bottom-right of every authed page (Radix Dialog,
   Tailwind-styled, hides itself on `/auth/*`).
2. **Modal form**: severity radios (nice / bug / blocker), textarea, collapsible
   preview of the page path + any page-registered context.
3. **POST** to `/api/feedback` → one row in the `feedback` table with submitter
   email, project name, path, query string, page_context JSON, comment, severity.
4. **Triage** via SQL or a (not-shipped) `/admin/feedback` dashboard.

## Page-context registration (optional but recommended)

Any client component can register a structured object that rides along with
every feedback submission from that page:

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

Any JSON-serializable shape works. Skip it where the page doesn't have
meaningful state — path + query are always captured automatically.

## What touches what (safety)

- The kit is **self-contained**; nothing here writes into other repos unless
  you point `-Target` at one.
- `install.* --global` adds **only** new files under `~/.claude/skills/`.
  Inert until invoked — no auto-firing.
- `install.* -Target <repo>` only **adds** the module files (never overwrites
  without `-Force`).
- The skill **does not** run production DDL without explicit chat confirmation.

## Origins / staying current

Distilled from a real back-test tool's need to capture structured feedback
from non-engineering operators (PMs, analysts, ops folk) without dragging
them into GitHub Issues or a separate tool. The module here is the canonical
source — when a consuming project wants updates, re-copy `templates/feedback/`
(the skill can do this safely, since the module is self-contained). Schema
migrations belong in `templates/feedback/schema.sql` with `CREATE ... IF NOT
EXISTS` so re-runs are idempotent.

If the widget grows features the module README describes as "not shipped"
(screenshot capture, GitHub Issue mirror, `/admin/feedback` dashboard), they
should live in this repo and propagate to consumers via re-install — *not*
as forks in each consumer.
