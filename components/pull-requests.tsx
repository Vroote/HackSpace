"use client";

import { useEffect, useState } from "react";
import type { Issue, PullRequest, PullRequestPage } from "@/lib/types";
import { Avatar, EmptyState, Icon, Notice, formatDate, pullStates } from "./ui";

const reviewLabels: Record<NonNullable<PullRequest["reviewDecision"]>, string> = {
  APPROVED: "Одобрено",
  CHANGES_REQUESTED: "Запрошены правки",
  REVIEW_REQUIRED: "Требуется ревью",
};

function PullRow({ pull, issues, mine }: { pull: PullRequest; issues: Issue[]; mine: boolean }) {
  const { label, tone, icon } = pullStates[pull.state];
  return (
    <tr>
      <th scope="row">
        <a className="pull-title" href={pull.url} target="_blank" rel="noreferrer">{pull.title}</a>
        <span className="muted">#{pull.number}</span>
        {issues.filter(issue => issue.pulls.some(link => link.url === pull.url)).map(issue =>
          <a key={issue.id} className="pull-title" href={issue.url} target="_blank" rel="noreferrer">Задача #{issue.number} · {issue.title}</a>
        )}
      </th>
      <td>{pull.author ? <a className="inline" href={pull.author.url} target="_blank" rel="noreferrer">
        <Avatar person={pull.author} />{pull.author.login}
      </a> : <span className="muted">Неизвестен</span>}</td>
      <td><span className={`pill tone-${tone}`}><Icon name={icon} size={14} />{label}</span></td>
      <td>{pull.reviewDecision ? reviewLabels[pull.reviewDecision] : <span className="muted">—</span>}</td>
      {mine && <td>{pull.reviewRequestedAt ? <time dateTime={pull.reviewRequestedAt} title={formatDate(pull.reviewRequestedAt)}>
        {Math.max(0, Math.floor((Date.now() - Date.parse(pull.reviewRequestedAt)) / 60_000))} мин
      </time> : "—"}</td>}
      <td><span className="pull-branches" title={`${pull.headRefName} → ${pull.baseRefName}`}>
        <code>{pull.headRefName}</code> <span className="muted">→</span> <code>{pull.baseRefName}</code>
      </span></td>
      <td><time dateTime={pull.updatedAt}>{formatDate(pull.updatedAt)}</time></td>
    </tr>
  );
}

export function PullRequestsView({ loadPage, issues }: {
  issues: Issue[];
  loadPage: (cursor: string | null, signal: AbortSignal, mine: boolean) => Promise<PullRequestPage>;
}) {
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState<PullRequestPage | null>(null);
  const [pending, setPending] = useState<{ cursor: string | null } | null>({ cursor: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();

    loadPage(pending.cursor, controller.signal, mine).then((next) => {
      if (controller.signal.aborted) return;
      setPage((previous) => {
        if (pending.cursor === null || !previous) return next;
        const pulls = new Map(previous.pulls.map((pull) => [pull.number, pull]));
        for (const pull of next.pulls) pulls.set(pull.number, pull);
        return { ...next, pulls: [...pulls.values()] };
      });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить Pull Requests.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setPending(null);
    });

    return () => controller.abort();
  }, [loadPage, pending, mine]);

  function load(cursor: string | null) {
    setError(null);
    setPending({ cursor });
  }

  return (
    <>
      {error && <Notice role="alert" tone="red">{error}</Notice>}
      <section className="panel" aria-label="Список Pull Requests" aria-busy={Boolean(pending)}>
        <div className="panel-heading pull-list-heading">
          <span className="section-icon"><Icon name="pull" size={17} /></span>
          <h2>{mine ? "Моё ревью" : "Все Pull Requests"}</h2>
          {page && <span className="column-count">{page.totalCount}</span>}
          <label><input type="checkbox" checked={mine} onChange={(event) => {
            setMine(event.target.checked);
            setPage(null);
            load(null);
          }} /> Запрошено моё ревью</label>
          <button className="button" type="button" onClick={() => load(null)} disabled={Boolean(pending)}>
            <Icon name="refresh" size={16} />Обновить
          </button>
        </div>
        {!page && pending && <p className="pull-list-message muted" role="status">Загружаем Pull Requests…</p>}
        {page && (page.pulls.length ? (
          <>
            <div className="history-scroll">
              <table className="pull-table">
                <thead><tr>
                  <th scope="col">Pull Request</th><th scope="col">Автор</th><th scope="col">Статус</th>
                  <th scope="col">Ревью</th>{mine && <th scope="col">Ожидание</th>}<th scope="col">Ветки</th><th scope="col">Обновлён</th>
                </tr></thead>
                <tbody>{page.pulls.map((pull) => <PullRow key={pull.number} pull={pull} issues={issues} mine={mine} />)}</tbody>
              </table>
            </div>
            {page.nextCursor !== null && <div className="pull-list-footer">
              <button className="button" type="button" onClick={() => load(page.nextCursor)} disabled={Boolean(pending)}>
                {pending?.cursor ? "Загружаем…" : "Загрузить ещё"}
              </button>
            </div>}
          </>
        ) : <EmptyState icon="pull" title={mine ? "Сейчас у вас нет запросов на ревью" : "В репозитории пока нет Pull Requests"} />)}
      </section>
    </>
  );
}
