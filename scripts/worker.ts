import { setTimeout as sleep } from "node:timers/promises";
import { generateArchitecture } from "../lib/architecture";
import { HttpError, privateGenerationAllowed, repoConfig, workspaceKey } from "../lib/config";
import { architectureFiles, contextHash } from "../lib/context-files";
import { matches, unseal } from "../lib/crypto";
import { claimJob, completeJob, database, failJob, getSession, type StoredJob } from "../lib/db";
import { githubAccess } from "../lib/github";

let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopped = true; });

async function runJob(job: StoredJob) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new HttpError(503, "DeepSeek не настроен");
    const session = await getSession(job.session_id);
    if (!session) throw new HttpError(401, "Сессия истекла; войдите снова");
    const token = unseal(session.token, session.id);
    const config = repoConfig();
    const access = await githubAccess(token, config);
    if (!access.canWrite || access.private !== job.private || (access.private && !privateGenerationAllowed())) {
      throw new HttpError(403, "Доступ или разрешение на передачу файлов изменились");
    }
    const files = await architectureFiles(token, config, job.sha, job.paths);
    if (!matches(contextHash(files), job.context_hash)) throw new HttpError(409, "Содержимое не совпало с подтверждённым");
    const [active, latestAccess] = await Promise.all([getSession(job.session_id), githubAccess(token, config)]);
    if (!active || !latestAccess.canWrite || latestAccess.private !== job.private ||
      (latestAccess.private && !privateGenerationAllowed())) {
      throw new HttpError(403, "Доступ или разрешение на передачу файлов изменились");
    }
    const graph = await generateArchitecture(files, { apiKey, model: process.env.DEEPSEEK_MODEL || "" });
    await completeJob(job, graph);
  } catch (error) {
    await failJob(job.id, error instanceof HttpError ? error.message : "Не удалось построить схему. Предыдущая версия сохранена.");
  }
}

async function run() {
  const workspace = workspaceKey(repoConfig());
  console.log("HackSpace architecture worker is ready.");
  try {
    while (!stopped) {
      try {
        const job = await claimJob(workspace);
        if (job) await runJob(job);
        else await sleep(1500);
      } catch {
        console.error("Worker could not process the queue; retrying.");
        await sleep(3500);
      }
    }
  } finally {
    await database().end();
  }
}

run().catch(() => {
  console.error("Could not start the architecture worker. Check configuration and migrations.");
  process.exitCode = 1;
});
