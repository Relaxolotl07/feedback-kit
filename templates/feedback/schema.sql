-- Militia feedback widget — schema.
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
  project         text NOT NULL,                         -- 'militiahub' | 'militia-capital-hub' | ...
  page_path       text NOT NULL,                         -- e.g. '/backtest'
  page_query      text,                                  -- raw `?from=...&to=...`
  page_context    jsonb NOT NULL DEFAULT '{}'::jsonb,    -- whatever the page registered

  -- What they said
  comment         text NOT NULL CHECK (length(comment) BETWEEN 1 AND 4000),
  severity        text NOT NULL DEFAULT 'nice'
                    CHECK (severity IN ('nice', 'bug', 'blocker')),

  -- Triage
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'triaged', 'fixed', 'wontfix')),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);

CREATE INDEX IF NOT EXISTS feedback_open_idx ON feedback (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS feedback_project_idx ON feedback (project, created_at DESC);
