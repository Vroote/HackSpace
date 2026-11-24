import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { claimJob, completeJob, database, enqueue, failJob, saveDemoBuild, sharedWorkspace, type Approval } from "../lib/db";

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
    const measurements = await pool.query<{ id: string }>(
      `INSERT INTO measurements (workspace, sha, url, tested_at, score, author)
       VALUES ($1, 'abc', '', now(), 60, 'test'), ($1, 'def', '', now(), 70, 'test') RETURNING id::text`, [workspace]);
    const choices = measurements.rows.map(({ id }) => ({ resultId: id, reason: "stable", standUrl: "" }));
    await Promise.all(choices.map(choice => saveDemoBuild(workspace, choice)));
    const saved = await sharedWorkspace(workspace);
    assert.ok(choices.some(choice => choice.resultId === saved.demoBuild?.resultId));
    assert.equal(saved.results[0].suite, null);
    await assert.rejects(saveDemoBuild(workspace + "-other", choices[0]), { code: "23503" });
    const comment = "Покажи очередь генерации";
    await Promise.all([enqueue(approval, comment), enqueue({ ...approval, id: randomUUID() }, comment)]);
    const job = await claimJob(workspace);
    assert.ok(job);
    assert.equal(job.generation_comment, comment);
    assert.equal(await claimJob(workspace), null);
    await completeJob(job, graph);
    assert.deepEqual((await sharedWorkspace(workspace)).architecture?.graph, graph);
    const used = await pool.query<{ approval_id: string; generation_comment: string | null }>(
      "SELECT approval_id, generation_comment FROM architecture_jobs WHERE id = $1", [job.id]);
    assert.equal(used.rows[0].generation_comment, null);
    await enqueue({ ...approval, id: used.rows[0].approval_id });
    assert.equal(await claimJob(workspace), null);
    await enqueue({ ...approval, id: randomUUID(), sha: "after" }, comment);
    const next = await claimJob(workspace);
    assert.ok(next);
    await failJob(next.id, "test failure");
    const state = await sharedWorkspace(workspace);
    assert.equal(state.architecture?.sha, "before");
    assert.equal(state.job?.status, "failed");
    assert.deepEqual((await pool.query("SELECT generation_comment FROM architecture_jobs WHERE id = $1", [next.id])).rows,
      [{ generation_comment: null }]);
  } finally {
    await pool.query("DELETE FROM architecture_jobs WHERE workspace = $1", [workspace]);
    await pool.query("DELETE FROM architecture_snapshots WHERE workspace = $1", [workspace]);
    await pool.query("DELETE FROM demo_builds WHERE workspace = $1", [workspace]);
    await pool.query("DELETE FROM measurements WHERE workspace = $1", [workspace]);
    await pool.end();
  }
});
