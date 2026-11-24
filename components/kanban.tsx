"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import type { Board, Issue, Status } from "@/lib/types";
import { Assignees, EmptyState, Icon, PullLinks, statusDisplay } from "./ui";

type Props = {
  board: Board;
  canWrite: boolean;
  busy: boolean;
  onMove: (issue: Issue, statusId: string | null) => void;
};

const noStatus = "";

function IssueCard({ issue, statuses, canWrite, busy, dragging, onMove, onDragStart, onDragEnd }: {
  issue: Issue;
  statuses: Status[];
  canWrite: boolean;
  busy: boolean;
  dragging: boolean;
  onMove: Props["onMove"];
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const blocked = issue.state === "OPEN" && (issue.blockersUnknown || issue.blockers.some((blocker) => !blocker.completed));
  const value = statuses.some((status) => status.id === issue.statusId) ? issue.statusId! : noStatus;
  const movable = canWrite && !busy;

  return (
    <article className={`issue-card${movable ? " is-movable" : ""}${dragging ? " is-dragging" : ""}`}
      draggable={movable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="issue-card-meta">
        <a className={`issue-number tone-${issue.state === "OPEN" ? "green" : "purple"}`}
          href={issue.url} target="_blank" rel="noreferrer" draggable={false} aria-label={`Issue #${issue.number} на GitHub`}>
          <Icon name={issue.state === "OPEN" ? "issue" : "check"} size={15} /> <span>#{issue.number}</span>
        </a>
        {movable && <Icon name="grip" size={16} />}
      </div>
      <a className="issue-title" href={issue.url} target="_blank" rel="noreferrer" draggable={false}>{issue.title}</a>
      {blocked && <span className="card-flag tone-amber"><Icon name="lock" size={13} />
        {issue.blockersUnknown ? "Не все зависимости известны" : "Есть блокеры"}
      </span>}
      <PullLinks pulls={issue.pulls} />
      <div className="issue-card-footer">
        <Assignees people={issue.assignees} showNames />
        <div className="issue-actions">
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

export function Kanban({ board, canWrite, busy, onMove }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const groups = new Map(board.statuses.map((status) => [status.id, [] as Issue[]]));
  const unassigned: Issue[] = [];
  let openCount = 0;

  for (const issue of board.issues) {
    if (issue.state === "OPEN") openCount++;
    const group = issue.statusId === null ? undefined : groups.get(issue.statusId);
    (group ?? unassigned).push(issue);
  }

  const columns = board.statuses.map((status) => ({ id: status.id, ...statusDisplay(status), issues: groups.get(status.id)! }));
  if (unassigned.length || canWrite || !columns.length) {
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
        <div className="board-summary muted">
          <span><i className="status-dot tone-green" />Открыто <strong>{openCount}</strong></span>
          <span><i className="status-dot tone-purple" />Закрыто <strong>{board.issues.length - openCount}</strong></span>
        </div>
      </div>
      {!board.issues.length ? <EmptyState icon="board" title="В проекте пока нет задач" />
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
                      <IssueCard key={issue.id} issue={issue} statuses={board.statuses}
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
