import type { ReactNode } from "react";
import type { Issue, Person, Status } from "@/lib/types";

const icons = {
  logo: <><path d="M12 2.5 21 7.7v8.6l-9 5.2-9-5.2V7.7z"/><path d="m3.4 7.9 8.6 5 8.6-5M12 13v8.2M7.5 5.1l9 5.2"/></>,
  board: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/></>,
  plan: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v6a3 3 0 0 0 3 3h6m-3-3 3 3-3 3"/></>,
  architecture: <><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4m-6 4v-4h12v4"/></>,
  chart: <><path d="M4 4v16h16M8 15l4-5 4 2 4-6"/><path d="M17 6h3v3"/></>,
  github: <path fill="currentColor" stroke="none" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0 1 12 6.84c.85 0 1.7.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.73c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/>,
  external: <><path d="M13 5h6v6m0-6-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 8a7.5 7.5 0 0 1 12.4-2L20 12M4 12l2.1 6a7.5 7.5 0 0 0 12.4-2"/></>,
  ready: <><path d="m13 2-8 12h6l-1 8 9-12h-6z"/></>,
  circle: <circle cx="12" cy="12" r="7"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  issue: <><circle cx="12" cy="12" r="8"/><path d="M12 9v6"/></>,
  pull: <><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10m9-9-3-3 3-3m-3 3h2a4 4 0 0 1 4 4v8"/></>,
  person: <><circle cx="12" cy="8" r="3"/><path d="M5 19a7 7 0 0 1 14 0"/></>,
  grip: <><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="3"/></>,
  move: <><path d="M4 12h16m-4-4 4 4-4 4M8 8l-4 4 4 4"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  fit: <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>,
  alert: <><path d="M10.5 4.7 3 18a1 1 0 0 0 .9 1.5h16.2A1 1 0 0 0 21 18L13.5 4.7a1.7 1.7 0 0 0-3 0Z"/><path d="M12 9v4m0 3h.01"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  file: <><path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z"/><path d="M13 3v6h6"/></>,
  commit: <><circle cx="12" cy="12" r="4"/><path d="M3 12h5m8 0h5"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
} satisfies Record<string, ReactNode>;

export function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
}

const knownStatuses: Record<string, { label: string; tone: string }> = {
  todo: { label: "К выполнению", tone: "blue" },
  backlog: { label: "Бэклог", tone: "neutral" },
  "in progress": { label: "В работе", tone: "amber" },
  "in review": { label: "На проверке", tone: "purple" },
  review: { label: "На проверке", tone: "purple" },
  done: { label: "Готово", tone: "green" },
};

export function statusDisplay(status?: Status) {
  if (!status) return { label: "Без статуса", tone: "neutral" };
  return knownStatuses[status.name.trim().toLowerCase()] ?? { label: status.name, tone: "neutral" };
}

export function Avatar({ person }: { person: Person }) {
  return (
    <span className="avatar" title={person.login}>
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt={person.login} width={24} height={24}
          onError={(event) => { event.currentTarget.hidden = true; }} />
      ) : null}
      <span aria-hidden={Boolean(person.avatarUrl)}>{person.login.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

export function Assignees({ people, showNames = false }: { people: Person[]; showNames?: boolean }) {
  if (!people.length) return <span className="muted inline"><Icon name="person" size={14} />Без исполнителя</span>;
  return (
    <span className="assignees">
      <span className="avatars">{people.map((person) => <Avatar key={person.login} person={person} />)}</span>
      {showNames && people.length === 1 && <span className="assignee-name">{people[0].login}</span>}
    </span>
  );
}

export function PullLinks({ pulls }: { pulls: Issue["pulls"] }) {
  const states = {
    DRAFT: { label: "Черновик", tone: "neutral" },
    OPEN: { label: "Открыт", tone: "green" },
    MERGED: { label: "Слит", tone: "purple" },
    CLOSED: { label: "Закрыт", tone: "red" },
  };
  if (!pulls.length) return null;
  return (
    <div className="pull-list">
      {pulls.map((pull) => (
        <a className={`pull-link nodrag tone-${states[pull.state].tone}`} key={pull.url}
          href={pull.url} target="_blank" rel="noreferrer" aria-label={`PR #${pull.number}, ${states[pull.state].label}`}>
          <Icon name="pull" size={13} /> #{pull.number} <span>{states[pull.state].label}</span>
        </a>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: keyof typeof icons; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Notice({ children, tone = "amber", role = "status" }: {
  children: ReactNode; tone?: "amber" | "red" | "blue" | "green"; role?: "status" | "alert";
}) {
  return <div className={`notice tone-${tone}`} role={role}><Icon name={tone === "green" ? "check" : tone === "blue" ? "clock" : "alert"} size={17} /><div>{children}</div></div>;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
