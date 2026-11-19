import { Pool } from "pg";
import type { Board, ArchitectureSnapshot, Job, Person, Result } from "./types";

let pool: Pool | undefined;

export function database() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000, max: 8 });
    pool.on("error", () => console.error("PostgreSQL idle connection failed"));
  }
  return pool;
}

export type StoredSession = { id: string; token: string; person: Person };
export type Approval = { id: string; workspace: string; session: string; sha: string; paths: string[]; hash: string; private: boolean; expires: number };
export type StoredJob = {
  id: string; session_id: string; workspace: string; sha: string; paths: string[]; context_hash: string; private: boolean;
};

export async function getSession(id: string) {
  const result = await database().query<StoredSession>(
    "SELECT id, token, person FROM sessions WHERE id = $1 AND expires_at > now()", [id]);
  return result.rows[0] ?? null;
}

export async function cachedBoard(workspace: string, id: string) {
  const result = await database().query<{ board: Board }>(
    "SELECT board FROM board_cache WHERE workspace = $1 AND session_id = $2", [workspace, id]);
  return result.rows[0]?.board ?? null;
}

export async function cacheBoard(workspace: string, id: string, board: Board) {
  await database().query(
    `INSERT INTO board_cache (workspace, session_id, board) VALUES ($1, $2, $3)
    ON CONFLICT (workspace, session_id) DO UPDATE SET board = EXCLUDED.board`, [workspace, id, board]);
}

export async function sharedWorkspace(workspace: string) {
  const [architecture, job, results] = await Promise.all([
    database().query<ArchitectureSnapshot>(
      'SELECT sha, graph, created_at AS "createdAt" FROM architecture_snapshots WHERE workspace = $1', [workspace]),
    database().query<Job>(
      "SELECT status, error FROM architecture_jobs WHERE workspace = $1 ORDER BY id DESC LIMIT 1", [workspace]),
    database().query<Result>(
      'SELECT id::text, sha, url, tested_at AS "testedAt", score, author FROM measurements WHERE workspace = $1 ORDER BY tested_at, id', [workspace]),
  ]);
  return { architecture: architecture.rows[0] ?? null, job: job.rows[0] ?? null, results: results.rows };
}

export async function enqueue(approval: Approval) {
  await database().query(
    `INSERT INTO architecture_jobs (workspace, session_id, approval_id, sha, paths, context_hash, private)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [approval.workspace, approval.session, approval.id, approval.sha, approval.paths, approval.hash, approval.private]);
}

export async function claimJob(workspace: string) {
  await database().query(
    `UPDATE architecture_jobs SET status = 'failed', session_id = NULL, error = 'Время ожидания генерации истекло'
    WHERE workspace = $1 AND ((status = 'running' AND started_at < now() - interval '5 minutes')
      OR (status = 'pending' AND created_at < now() - interval '15 minutes'))`, [workspace]);
  const result = await database().query<StoredJob>(
    `UPDATE architecture_jobs SET status = 'running', started_at = now()
    WHERE id = (SELECT id FROM architecture_jobs WHERE workspace = $1 AND status = 'pending'
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, workspace, session_id, sha, paths, context_hash, private`, [workspace]);
  return result.rows[0] ?? null;
}

export async function completeJob(job: StoredJob, graph: ArchitectureSnapshot["graph"]) {
  await database().query(
    `WITH finished AS (
      UPDATE architecture_jobs SET status = 'complete', session_id = NULL
      WHERE id = $1 AND status = 'running' RETURNING workspace, sha
    )
    INSERT INTO architecture_snapshots (workspace, sha, graph)
      SELECT workspace, sha, $2::jsonb FROM finished
    ON CONFLICT (workspace) DO UPDATE SET sha = EXCLUDED.sha, graph = EXCLUDED.graph, created_at = now()`,
    [job.id, graph]);
}

export async function failJob(id: string, error: string) {
  await database().query(
    "UPDATE architecture_jobs SET status = 'failed', error = $2, session_id = NULL WHERE id = $1 AND status = 'running'",
    [id, error]);
}
