BEGIN;

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  token text NOT NULL,
  person jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS board_cache (
  workspace text NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  board jsonb NOT NULL,
  PRIMARY KEY (workspace, session_id)
);

CREATE TABLE IF NOT EXISTS architecture_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace text NOT NULL,
  session_id text,
  approval_id text NOT NULL UNIQUE,
  sha text NOT NULL,
  paths text[] NOT NULL,
  context_hash text NOT NULL,
  private boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_architecture_job
  ON architecture_jobs (workspace) WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS architecture_snapshots (
  workspace text PRIMARY KEY,
  sha text NOT NULL,
  graph jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS measurements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace text NOT NULL,
  sha text NOT NULL,
  url text NOT NULL,
  tested_at timestamptz NOT NULL,
  score double precision NOT NULL CHECK (score >= 0 AND score <= 100),
  author text NOT NULL
);

CREATE INDEX IF NOT EXISTS measurements_by_time ON measurements (workspace, tested_at, id);

COMMIT;
