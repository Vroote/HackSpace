import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { claimJob, completeJob, database, enqueue, failJob, sharedWorkspace, type Approval } from "../lib/db";

test("PostgreSQL deduplicates active jobs and preserves a successful snapshot after failure", {
  skip: !process.env.HACKSPACE_TEST_DATABASE_URL,
}, async () => {
  process.env.DATABASE_URL = process.env.HACKSPACE_TEST_DATABASE_URL;
  const pool = database();
  const workspace = `test:${randomUUID()}`;
  const approval: Approval = { id: randomUUID(), workspace, session: "test", sha: "before",
    paths: ["README.md"], hash: "hash", private: false, expires: Date.now() + 60_000 };
  const graph = { nodes: [{ id: "node", label: "Node", description: "Description", paths: ["README.md"] }], edges: [] };
  try {
    await Promise.all([enqueue(approval), enqueue({ ...approval, id: randomUUID() })]);
    const job = await claimJob(workspace);
    assert.ok(job);
    assert.equal(await claimJob(workspace), null);
    await completeJob(job, graph);
    assert.deepEqual((await sharedWorkspace(workspace)).architecture?.graph, graph);
    const used = await pool.query<{ approval_id: string }>(
      "SELECT approval_id FROM architecture_jobs WHERE id = $1", [job.id]);
    await enqueue({ ...approval, id: used.rows[0].approval_id });
    assert.equal(await claimJob(workspace), null);
    await enqueue({ ...approval, id: randomUUID(), sha: "after" });
    const next = await claimJob(workspace);
    assert.ok(next);
    await failJob(next.id, "test failure");
    const state = await sharedWorkspace(workspace);
    assert.equal(state.architecture?.sha, "before");
    assert.equal(state.job?.status, "failed");
  } finally {
    await pool.query("DELETE FROM architecture_jobs WHERE workspace = $1", [workspace]);
    await pool.query("DELETE FROM architecture_snapshots WHERE workspace = $1", [workspace]);
    await pool.end();
  }
});
