"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import type { Board, Issue, Status } from "@/lib/types";
import { Assignees, EmptyState, Icon, statusDisplay } from "./ui";

type Props = {
  board: Board;
  readyIds: Set<string>;
  canWrite: boolean;
  busy: boolean;
  onMove: (issue: Issue, statusId: string | null) => void;
};

const noStatus = "";

function IssueCard({ issue, statuses, ready, canWrite, busy, dragging, onMove, onDragStart, onDragEnd }: {
  issue: Issue;
  statuses: Status[];
  ready: boolean;
  canWrite: boolean;
  busy: boolean;
  dragging: boolean;
  onMove: Props["onMove"];
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const blocked = issue.state === "OPEN" && (issue.blockersUnknown || issue.blockers.some((blocker) => !blocker.completed));
  const value = statuses.some((status) => status.id === issue.statusId) ? issue.statusId! : noStatus;

  return (
    <article className={`issue-card${canWrite && !busy ? " is-movable" : ""}${dragging ? " is-dragging" : ""}`}
      draggable={canWrite && !busy} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="issue-card-meta">
        <a className={`issue-number tone-${issue.state === "OPEN" ? "green" : "purple"}`}
          href={issue.url} target="_blank" rel="noreferrer" draggable={false} aria-label={`Issue #${issue.number} на GitHub`}>
          <Icon name={issue.state === "OPEN" ? "issue" : "check"} size={15} /> <span>#{issue.number}</span>
        </a>
        {canWrite && <Icon name="grip" size={16} />}
      </div>
      <a className="issue-title" href={issue.url} target="_blank" rel="noreferrer" draggable={false}>{issue.title}</a>
      {ready && <span className="card-flag tone-green"><Icon name="ready" size={13} />Можно брать</span>}
      {blocked && !ready && <span className="card-flag tone-amber"><Icon name="lock" size={13} />
        {issue.blockersUnknown ? "Не все зависимости известны" : "Есть блокеры"}
      </span>}
      <div className="issue-card-footer">
        <Assignees people={issue.assignees} showNames />
        <div className="issue-actions">
          {issue.pulls.length > 0 && <span className="muted inline" aria-label={`Связанных PR: ${issue.pulls.length}`}>
            <Icon name="pull" size={14} />{issue.pulls.length}
          </span>}
          {canWrite && (
            <label className="move-select" title="Переместить задачу">
              <Icon name="move" size={15} />
              <select aria-label={`Статус задачи #${issue.number}`} disabled={busy} value={value}
                onChange={(event) => onMove(issue, event.target.value || null)}>
                <option value={noStatus}>Без статуса</option>
                {statuses.map((status) => <option key={status.id} value={status.id}>{statusDisplay(status).label}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    </article>
  );
}

export function Kanban({ board, readyIds, canWrite, busy, onMove }: Props) {
  const [readyOnly, setReadyOnly] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const groups = new Map(board.statuses.map((status) => [status.id, [] as Issue[]]));
  const unassigned: Issue[] = [];
  let openCount = 0;

  for (const issue of board.issues) {
    if (issue.state === "OPEN") openCount++;
    if (readyOnly && !readyIds.has(issue.id)) continue;
    const group = issue.statusId === null ? undefined : groups.get(issue.statusId);
    (group ?? unassigned).push(issue);
  }

  const columns = board.statuses.map((status) => ({ id: status.id, ...statusDisplay(status), issues: groups.get(status.id)! }));
  if (unassigned.length || (!readyOnly && (canWrite || !columns.length))) {
    columns.push({ id: noStatus, ...statusDisplay(), issues: unassigned });
  }

  function endDrag() {
    setDraggedId(null);
    setTargetId(null);
  }

  function drop(event: DragEvent<HTMLElement>, statusId: string) {
    if (!draggedId || !canWrite || busy) return;
    event.preventDefault();
    const issue = board.issues.find((item) => item.id === draggedId);
    endDrag();
    if (issue && issue.statusId !== (statusId || null)) onMove(issue, statusId || null);
  }

  return (
    <>
      <div className="board-toolbar">
        <div className="filters" role="group" aria-label="Фильтр задач">
          <button type="button" aria-pressed={!readyOnly} onClick={() => setReadyOnly(false)}>
            <Icon name="layers" size={15} /> Все задачи <span>{board.issues.length}</span>
          </button>
          <button type="button" aria-pressed={readyOnly} onClick={() => setReadyOnly(true)}>
            <Icon name="ready" size={15} /> Можно брать <span>{readyIds.size}</span>
          </button>
        </div>
        <div className="board-summary muted">
          <span><i className="status-dot tone-green" />Открыто <strong>{openCount}</strong></span>
          <span><i className="status-dot tone-purple" />Закрыто <strong>{board.issues.length - openCount}</strong></span>
        </div>
      </div>
      {readyOnly && <p className="filter-note muted">Открытые задачи к выполнению, у которых все блокеры закрыты как выполненные.</p>}
      {!board.issues.length ? <EmptyState icon="board" title="В проекте пока нет задач" />
        : readyOnly && !readyIds.size ? <EmptyState icon="ready" title="Пока нет задач, которые можно брать" />
        : (
          <div className="kanban-scroll">
            <div className="kanban" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(240px, 1fr))` }}>
              {columns.map((column, index) => (
                <section key={column.id} aria-labelledby={`column-${index}`}
                  className={`kanban-column tone-${column.tone}${targetId === column.id ? " is-drop-target" : ""}`}
                  onDragOver={(event) => {
                    if (!draggedId || !canWrite || busy) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setTargetId(column.id);
                  }}
                  onDragLeave={(event) => {
                    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                      setTargetId((current) => current === column.id ? null : current);
                    }
                  }}
                  onDrop={(event) => drop(event, column.id)}>
                  <header className="column-header">
                    <span className="column-icon"><Icon name={column.tone === "green" ? "check" : column.tone === "amber" ? "clock" : column.tone === "purple" ? "pull" : "circle"} size={15} /></span>
                    <h2 id={`column-${index}`}>{column.label}</h2>
                    <span className="column-count">{column.issues.length}</span>
                  </header>
                  <div className="column-cards">
                    {column.issues.map((issue) => (
                      <IssueCard key={issue.id} issue={issue} statuses={board.statuses} ready={readyIds.has(issue.id)}
                        busy={busy} canWrite={canWrite} dragging={draggedId === issue.id} onMove={onMove}
                        onDragStart={(event) => {
                          if (!canWrite || busy) { event.preventDefault(); return; }
                          event.dataTransfer.setData("text/plain", issue.itemId);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggedId(issue.id);
                        }}
                        onDragEnd={endDrag} />
                    ))}
                    {!column.issues.length && <div className="column-empty">{draggedId ? "Перетащите задачу сюда" : "Нет задач"}</div>}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
    </>
  );
}
