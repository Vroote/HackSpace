import type { NextRequest } from "next/server";
import { checkOrigin, demoRequest, liveSession } from "./auth";
import { demoMode, HttpError, privateGenerationAllowed, workspaceKey } from "./config";
import { cacheBoard, cachedBoard, database, enqueue, sharedWorkspace, type Approval } from "./db";
import { demoCommit, demoWorkspace } from "./demo";
import { changeStatus, GitHubError, getTree, readBoard, verifyCommit } from "./github";
import { measurement, requestBody, statusChange } from "./http";
import { randomToken, sign, verify } from "./crypto";
import { selectPaths } from "./architecture";
import { architectureFiles, contextHash } from "./context-files";
import type { Board, Workspace } from "./types";

type Live = Awaited<ReturnType<typeof liveSession>>;
type Context = Live | null;

async function context(request: NextRequest, write = false): Promise<Context> {
  if (write) checkOrigin(request);
  if (!demoMode()) return liveSession(request);
  demoRequest(request);
  return null;
}

function writeAccess(current: Live) {
  if (!current.access.canWrite) throw new HttpError(403, "Нужно право записи в GitHub Project");
}

function canGenerate(current: Live) {
  return current.access.canWrite && Boolean(process.env.DEEPSEEK_API_KEY) &&
    (!current.access.private || privateGenerationAllowed());
}

async function getBoard(current: Live, refresh: boolean) {
  const key = workspaceKey(current.config);
  const cached = await cachedBoard(key, current.session.id);
  if (cached && !refresh) return { ...cached, stale: cached.stale || Date.now() - Date.parse(cached.refreshedAt) > 300_000 };
  try {
    const board = await readBoard(current.token, current.config);
    await cacheBoard(key, current.session.id, board);
    return board;
  } catch (error) {
    if (!cached || !(error instanceof GitHubError) || ![429, 500, 502, 503, 504].includes(error.status)) throw error;
    const stale: Board = { ...cached, stale: true };
    await cacheBoard(key, current.session.id, stale);
    return stale;
  }
}

async function assemble(current: Context, refresh = false): Promise<Workspace> {
  if (!current) return demoWorkspace();
  const [board, shared] = await Promise.all([
    getBoard(current, refresh), sharedWorkspace(workspaceKey(current.config)),
  ]);
  return {
    demo: false, user: current.session.person, canWrite: current.access.canWrite, canGenerate: canGenerate(current),
    board, defaultSha: current.access.defaultSha, ...shared,
  };
}

export async function workspace(request: NextRequest) {
  return assemble(await context(request));
}

export async function refreshWorkspace(request: NextRequest) {
  const current = await context(request, true);
  if (!current) demoWorkspace().board.refreshedAt = new Date().toISOString();
  return assemble(current, true);
}

export async function moveCard(request: NextRequest) {
  const current = await context(request, true);
  const { itemId, statusId } = statusChange(await requestBody(request));
  if (current) writeAccess(current);
  const state = await assemble(current);
  const { board } = state;
  const issue = board.issues.find((task) => task.itemId === itemId);
  if (!issue || (statusId !== null && !board.statuses.some((status) => status.id === statusId))) {
    throw new HttpError(422, "Карточка или колонка не найдена. Обновите доску.");
  }
  if (current) await changeStatus(current.token, current.config, itemId, statusId);
  issue.statusId = statusId;
  if (!current) board.refreshedAt = new Date().toISOString();
  else {
    await cacheBoard(workspaceKey(current.config), current.session.id, board).catch(() => {
      board.stale = true;
      console.error("Could not cache the confirmed GitHub status change.");
    });
  }
  return state;
}

export async function addMeasurement(request: NextRequest) {
  const current = await context(request, true);
  const input = measurement(await requestBody(request));
  if (current) writeAccess(current);
  const commit = current ? await verifyCommit(current.token, current.config, input.sha) : demoCommit(input.sha);
  if (!commit) throw new HttpError(422, "Коммит не найден в репозитории");
  const state = await assemble(current);
  const author = state.user.login;
  if (!current) {
    state.results.push({ ...input, ...commit, id: randomToken(), author });
  } else {
    const inserted = await database().query<{ id: string }>(
      "INSERT INTO measurements (workspace, sha, url, tested_at, score, author) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text",
      [workspaceKey(current.config), commit.sha, commit.url, input.testedAt, input.score, author]);
    state.results.push({ ...input, ...commit, id: inserted.rows[0].id, author });
  }
  state.results.sort((left, right) => Date.parse(left.testedAt) - Date.parse(right.testedAt));
  return state;
}

export async function previewArchitecture(request: NextRequest) {
  const current = await context(request);
  if (!current) return { sha: demoWorkspace().defaultSha, files: ["README.md", "app/page.tsx", "db/schema.sql"], private: false, approval: "demo" };
  if (!canGenerate(current)) throw new HttpError(403, "Генерация недоступна: проверьте права и разрешение на передачу кода");
  const { token, config, access, session } = current;
  const paths = selectPaths(await getTree(token, config, access.defaultSha));
  const files = await architectureFiles(token, config, access.defaultSha, paths);
  if (!files.length) throw new HttpError(422, "Нет подходящих файлов для генерации");
  const approval: Approval = {
    id: randomToken(), workspace: workspaceKey(config), session: session.id, sha: access.defaultSha,
    paths: files.map(({ path }) => path), hash: contextHash(files), private: access.private, expires: Date.now() + 10 * 60_000,
  };
  return { sha: approval.sha, files: approval.paths, private: approval.private, approval: sign(approval) };
}

export async function startArchitecture(request: NextRequest) {
  const current = await context(request, true);
  const { approval, confirmed } = await requestBody(request);
  if (typeof approval !== "string" || confirmed !== true) throw new HttpError(422, "Подтвердите точный список файлов");
  if (!current) {
    if (approval !== "demo") throw new HttpError(422, "Сначала получите список файлов");
    const state = demoWorkspace();
    state.architecture = { ...state.architecture!, createdAt: new Date().toISOString() };
    state.job = { status: "complete", error: null };
    return state;
  }
  if (!canGenerate(current)) throw new HttpError(403, "Генерация недоступна");
  const valid = verify<Approval>(approval);
  if (!valid || valid.expires <= Date.now() || valid.session !== current.session.id || valid.workspace !== workspaceKey(current.config) ||
    valid.private !== current.access.private) {
    throw new HttpError(422, "Подтверждение недействительно. Получите новый список файлов.");
  }
  const state = await assemble(current);
  await enqueue(valid);
  const saved = await sharedWorkspace(valid.workspace);
  return { ...state, ...saved };
}
