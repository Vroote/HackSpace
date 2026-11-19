"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzePipeline } from "@/lib/pipeline";
import type { Issue, Workspace } from "@/lib/types";
import { ArchitectureGraph, DependencyGraph } from "@/components/graphs";
import { Kanban } from "@/components/kanban";
import { ResultsView } from "@/components/results";
import type { ResultInput } from "@/components/results";
import { Avatar, EmptyState, Icon, Notice, formatDate } from "@/components/ui";

const tabs = [
  { id: "tasks", label: "Задачи", icon: "board", description: "Доска задач команды в GitHub Projects." },
  { id: "plan", label: "План задач", icon: "plan", description: "Открытые задачи репозитория и порядок их выполнения." },
  { id: "architecture", label: "Архитектура", icon: "architecture", description: "Карта компонентов репозитория и связей между ними." },
  { id: "results", label: "Результаты", icon: "chart", description: "Замеры внешних тестов по коммитам." },
] as const;

type Tab = (typeof tabs)[number]["id"];
type Action = "refresh" | "move" | "preview" | "generate" | "result";
type ArchitecturePreview = { sha: string; files: string[]; private: boolean; approval: string };

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new ApiError(
      typeof data?.error === "string" ? data.error : "Сервер вернул неожиданный ответ. Попробуйте ещё раз.",
      response.status,
    );
  }
  return data as T;
}

function jsonRequest(method: "POST" | "PATCH", body: object): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Не удалось связаться с сервером. Попробуйте ещё раз.";
}

function ApprovalDialog({ preview, demo, busy, onCancel, onConfirm }: {
  preview: ArchitecturePreview; demo: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="approval-dialog" aria-labelledby="approval-title" onCancel={(event) => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
      <div className="dialog-heading">
        <span className="section-icon"><Icon name={preview.private ? "lock" : "architecture"} /></span>
        <h2 id="approval-title">Файлы для построения схемы</h2>
        <button className="icon-button" type="button" onClick={onCancel} disabled={busy} aria-label="Закрыть"><Icon name="close" /></button>
      </div>
      <p className="muted">{demo ? "Демо имитирует построение схемы. Список ниже показывает пример для коммита "
        : "DeepSeek получит перечисленные файлы из коммита "}<code title={preview.sha}>{preview.sha.slice(0, 8)}</code>.</p>
      <ul className="approval-files">
        {preview.files.map((file, index) => <li key={index}><Icon name="file" size={15} /><code>{file}</code></li>)}
      </ul>
      {preview.private && !demo && <label className="approval-check">
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
        Разрешаю отправку перечисленных приватных файлов в DeepSeek
      </label>}
      <div className="dialog-actions">
        <button className="button" type="button" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="button button-primary" type="button" onClick={onConfirm} disabled={busy || (preview.private && !demo && !confirmed)}>
          <Icon name="architecture" size={16} />{busy ? "Запускаем…" : demo ? "Запустить симуляцию" : "Подтвердить и запустить"}
        </button>
      </div>
    </dialog>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<Action | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; statusId: string | null } | null>(null);
  const [preview, setPreview] = useState<ArchitecturePreview | null>(null);
  const mutation = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    function syncTab() {
      const hash = window.location.hash.slice(1);
      setTab(tabs.find(({ id }) => id === hash)?.id ?? "tasks");
      setAuthFailed(new URLSearchParams(window.location.search).get("auth") === "failed");
    }
    syncTab();
    window.addEventListener("hashchange", syncTab);
    window.addEventListener("popstate", syncTab);
    return () => {
      window.removeEventListener("hashchange", syncTab);
      window.removeEventListener("popstate", syncTab);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void request<Workspace>("/api/workspace", { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setWorkspace(data);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) setSignedOut(true);
      else setError(errorMessage(cause));
    });
    return () => controller.abort();
  }, [attempt]);

  const jobStatus = workspace?.job?.status;
  const jobActive = jobStatus === "pending" || jobStatus === "running";

  useEffect(() => {
    if (!jobActive) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (!mutation.current) {
        const version = revision.current;
        try {
          const data = await request<Workspace>("/api/workspace", { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (version === revision.current) {
            setWorkspace(data);
            setPollError(null);
          }
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (version === revision.current) {
            if (cause instanceof ApiError && cause.status === 401) {
              setWorkspace(null);
              setPreview(null);
              setSignedOut(true);
              return;
            }
            setPollError(errorMessage(cause));
          }
        }
      }
      timer = setTimeout(poll, 2500);
    }

    timer = setTimeout(poll, 1800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobActive]);

  const originalBoard = workspace?.board;
  const board = useMemo(() => {
    if (!originalBoard || !pendingMove) return originalBoard;
    return { ...originalBoard, issues: originalBoard.issues.map((issue) =>
      issue.id === pendingMove.id ? { ...issue, statusId: pendingMove.statusId } : issue) };
  }, [originalBoard, pendingMove]);
  const analysis = useMemo(() => board ? analyzePipeline(board) : null, [board]);
  const readyIds = useMemo(() => new Set(analysis?.readyIds), [analysis]);
  const current = tabs.find(({ id }) => id === tab) ?? tabs[0];

  async function run(action: Action, task: () => Promise<void>) {
    if (mutation.current) return false;
    mutation.current = true;
    revision.current++;
    setError(null);
    setBusy(action);
    try {
      await task();
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setWorkspace(null);
        setPreview(null);
        setSignedOut(true);
      } else {
        setError(errorMessage(cause));
      }
      return false;
    } finally {
      mutation.current = false;
      setBusy(null);
    }
  }

  function move(issue: Issue, statusId: string | null) {
    if (!workspace?.canWrite || issue.statusId === statusId) return;
    void run("move", async () => {
      setPendingMove({ id: issue.id, statusId });
      try {
        setWorkspace(await request<Workspace>("/api/status", jsonRequest("PATCH", { itemId: issue.itemId, statusId })));
      } finally {
        setPendingMove(null);
      }
    });
  }

  function refresh() {
    void run("refresh", async () => {
      const data = tab === "architecture"
        ? await request<Workspace>("/api/workspace")
        : await request<Workspace>("/api/refresh", { method: "POST" });
      setWorkspace(data);
      setPollError(null);
    });
  }

  function previewArchitecture() {
    void run("preview", async () => {
      setPreview(await request<ArchitecturePreview>("/api/architecture"));
    });
  }

  function generateArchitecture() {
    if (!preview) return;
    void run("generate", async () => {
      try {
        setWorkspace(await request<Workspace>("/api/architecture", jsonRequest("POST", { approval: preview.approval, confirmed: true })));
        setPollError(null);
      } finally {
        setPreview(null);
      }
    });
  }

  function addResult(value: ResultInput) {
    return run("result", async () => setWorkspace(await request<Workspace>("/api/results", jsonRequest("POST", value))));
  }

  const snapshot = workspace?.architecture;
  const architectureStale = Boolean(snapshot && workspace.defaultSha && snapshot.sha !== workspace.defaultSha);

  return (
    <>
      <header className="app-header">
        <div className="topbar frame">
          <a className="brand" href="#tasks" onClick={(event) => {
            event.preventDefault();
            if (tab !== "tasks") window.history.pushState(null, "", "#tasks");
            setTab("tasks");
          }}>
            <span className="brand-mark"><Icon name="logo" size={22} /></span><span>HackSpace</span>
          </a>
          {workspace && board && <>
            <span className="topbar-divider" />
            <a className="repo-link" href={board.repoUrl} target="_blank" rel="noreferrer">
              <Icon name="github" size={17} /><span>{board.repoName}</span><Icon name="external" size={13} />
            </a>
            <div className="topbar-end">
              {workspace.demo && <span className="environment"><i className="status-dot" />Демо</span>}
              {!workspace.canWrite && <span className="readonly-badge"><Icon name="lock" size={13} />Только чтение</span>}
              <span className="profile"><Avatar person={workspace.user} /><span>{workspace.user.login}</span></span>
              {!workspace.demo && <form method="post" action="/api/auth/logout">
                <button className="button" type="submit" disabled={Boolean(busy)}>Выйти</button>
              </form>}
            </div>
          </>}
        </div>
        {workspace && <nav className="tabbar frame" aria-label="Разделы HackSpace">
          {tabs.map((item) => (
            <a key={item.id} href={`#${item.id}`} aria-current={tab === item.id ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (tab !== item.id) window.history.pushState(null, "", `#${item.id}`);
                setTab(item.id);
              }}><Icon name={item.icon} size={17} /><span>{item.label}</span></a>
          ))}
        </nav>}
      </header>

      <main className="main frame">
        {authFailed && <Notice tone="red" role="alert">Не удалось войти через GitHub. Повторите вход и подтвердите доступ в GitHub.</Notice>}
        {signedOut ? (
          <div className="entry-panel">
            <EmptyState icon="github" title="Войдите в HackSpace">Подключите свой аккаунт GitHub, чтобы открыть рабочее пространство команды.</EmptyState>
            <a className="button button-primary" href="/api/auth/login"><Icon name="github" size={18} />Войти через GitHub</a>
          </div>
        ) : !workspace || !board || !analysis ? (
          <div className="entry-panel">
            {error ? <>
              <Notice tone="red" role="alert">{error}</Notice>
              <button className="button" type="button" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>
                <Icon name="refresh" size={17} />Повторить
              </button>
            </> : <div className="loading" role="status"><Icon name="refresh" size={20} />Загружаем рабочее пространство…</div>}
          </div>
        ) : (
          <>
            <div className="page-heading">
              <div><h1>{current.label}</h1><p>{current.description}</p></div>
              <div className="heading-actions">
                {tab === "tasks" && <a className="button" href={board.projectUrl} target="_blank" rel="noreferrer">
                  <Icon name="github" size={17} />Проект на GitHub<Icon name="external" size={14} />
                </a>}
                {tab !== "results" && (
                  <button className="button" type="button" disabled={Boolean(busy)} onClick={refresh}>
                    <span className={busy === "refresh" ? "spinning" : "inline"}><Icon name="refresh" size={17} /></span>
                    {busy === "refresh" ? "Обновляем…" : tab === "plan" ? "Обновить план" : "Обновить"}
                  </button>
                )}
                {tab === "architecture" && <button className="button button-primary" type="button" onClick={previewArchitecture}
                  disabled={!workspace.canGenerate || jobActive || Boolean(busy)}>
                  <Icon name="refresh" size={17} />{busy === "preview" ? "Получаем список…" : "Перестроить схему"}
                </button>}
              </div>
            </div>

            {error && <Notice tone="red" role="alert">{error}</Notice>}
            {(tab === "tasks" || tab === "plan") && board.stale && (
              <Notice>GitHub временно недоступен. Показаны данные последнего успешного обновления.</Notice>
            )}

            {tab === "tasks" && <Kanban board={board} readyIds={readyIds} canWrite={workspace.canWrite} busy={Boolean(busy)} onMove={move} />}
            {tab === "plan" && <DependencyGraph board={board} analysis={analysis} readyIds={readyIds} />}
            {(tab === "tasks" || tab === "plan") && <div className="sync-stamp muted" role="status">
              <Icon name="clock" size={15} /> Последнее обновление <time dateTime={board.refreshedAt}>{formatDate(board.refreshedAt)}</time>
            </div>}

            {tab === "architecture" && <>
              {jobActive && <Notice tone="blue">{jobStatus === "pending" ? "Задание в очереди." : "Схема строится. Страница обновится автоматически."}</Notice>}
              {pollError && jobActive && <Notice>{pollError} Проверка состояния задания продолжится автоматически.</Notice>}
              {jobStatus === "failed" && <Notice tone="red" role="alert">
                {workspace.job?.error || "Не удалось перестроить схему."}{snapshot && " Показана последняя успешная версия."}
              </Notice>}
              {architectureStale && <Notice>В основной ветке появился новый коммит. Перестройте схему, чтобы обновить её.</Notice>}
              {!workspace.canGenerate && <Notice tone="blue">У вашей учётной записи или репозитория нет разрешения на построение схемы.</Notice>}
              {snapshot ? <>
                <div className="snapshot-meta muted">
                  <a className="commit-link inline" href={`${board.repoUrl.replace(/\/$/, "")}/commit/${encodeURIComponent(snapshot.sha)}`}
                    target="_blank" rel="noreferrer" title={snapshot.sha}>
                    <Icon name="commit" size={16} /><code>{snapshot.sha.slice(0, 8)}</code><Icon name="external" size={13} />
                  </a>
                  <span><Icon name="clock" size={15} />Построено <time dateTime={snapshot.createdAt}>{formatDate(snapshot.createdAt)}</time></span>
                  {architectureStale && <span className="pill tone-amber"><i className="status-dot" />Устарела</span>}
                </div>
                <ArchitectureGraph snapshot={snapshot} repoUrl={board.repoUrl} />
              </> : <EmptyState icon="architecture" title="Схема ещё не построена">
                {workspace.canGenerate && "Запустите построение, чтобы увидеть компоненты и связи."}
              </EmptyState>}
            </>}
            {tab === "results" && <ResultsView results={workspace.results} canWrite={workspace.canWrite} busy={Boolean(busy)}
              defaultSha={workspace.defaultSha} onSubmit={addResult} />}
          </>
        )}
      </main>
      {preview && workspace && <ApprovalDialog preview={preview} demo={workspace.demo} busy={busy === "generate"}
        onCancel={() => setPreview(null)} onConfirm={generateArchitecture} />}
    </>
  );
}
