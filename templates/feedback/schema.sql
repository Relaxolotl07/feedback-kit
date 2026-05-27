-- Feedback widget — schema.
--
-- One row per submission. Free-text comment is the only required body field;
-- everything else is structured context the widget captures automatically.
--
-- Apply once per project DB (idempotent):
--   psql "$DATABASE_URL" -f src/feedback/schema.sql
-- or pipe it through the project's preferred SQL runner.

CREATE TABLE IF NOT EXISTS feedback (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Submitter (from app session)
  submitter_email text NOT NULL,
  submitter_sub   text,                                  -- e.g. Google `sub`

  -- Where they were
  project         text NOT NULL,                         -- e.g. 'my-app' | 'admin' | ...
  page_path       text NOT NULL,                         -- e.g. '/backtest'
  page_query      text,                                  -- raw `?from=...&to=...`
  page_context    jsonb NOT NULL DEFAULT '{}'::jsonb,    -- whatever the page registered

  -- What they said
  comment         text NOT NULL CHECK (length(comment) BETWEEN 1 AND 4000),
  severity        text NOT NULL DEFAULT 'nice'
                    CHECK (severity IN ('nice', 'bug', 'blocker')),

  -- Passive focus context — element under cursor at submit time, recent clicks,
  -- text selection, visible regions, recent client errors, viewport metrics.
  -- Schema is open-ended on purpose (see focus.ts for the current shape).
  focus           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Explicit pointers — elements the user clicked "Point at it" on, in order.
  -- Each element is the same ElementSummary shape used inside `focus`.
  pointers        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Triage
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'triaged', 'fixed', 'wontfix')),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);

-- Bring older deployments forward to the current shape.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS focus    jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS pointers jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS feedback_open_idx ON feedback (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS feedback_project_idx ON feedback (project, created_at DESC);
