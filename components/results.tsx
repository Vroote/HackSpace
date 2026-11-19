"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Result } from "@/lib/types";
import { EmptyState, Icon, formatDate } from "./ui";

export type ResultInput = { sha: string; testedAt: string; score: number };

function CommitLink({ sha, url }: { sha: string; url: string }) {
  return <a className="commit-link inline" href={url} target="_blank" rel="noreferrer" title={sha} aria-label={`Коммит ${sha}`}>
    <Icon name="commit" size={15} /><code>{sha.slice(0, 8)}</code><Icon name="external" size={12} />
  </a>;
}

function ResultsChart({ results }: { results: Result[] }) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gradientId = useId();
  const selected = results.find((result) => result.id === selectedId) ?? results[results.length - 1];

  useEffect(() => {
    if (!plot.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, []);

  const height = 272;
  const left = 38;
  const right = width - 23;
  const top = 19;
  const bottom = 225;
  const first = new Date(results[0].testedAt).getTime();
  const last = new Date(results[results.length - 1].testedAt).getTime();
  const range = last - first;
  const x = (time: number) => range > 0 ? left + 7 + ((time - first) / range) * (right - left - 14) : (left + right) / 2;
  const y = (score: number) => bottom - (score / 100) * (bottom - top);
  const dateFormat = new Intl.DateTimeFormat("ru-RU", range >= 2 * 86400000
    ? { day: "numeric", month: "short" }
    : range >= 86400000 ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" });
  const tickCount = width >= 660 ? 5 : width >= 400 ? 4 : 3;
  const ticks = range > 0 ? Array.from({ length: tickCount }, (_, index) => first + range * index / (tickCount - 1)) : [first];
  const points = results.map((result) => ({ result, x: x(new Date(result.testedAt).getTime()), y: y(result.score) }));
  const coordinates = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${points[0].x},${bottom} ${coordinates} ${points[points.length - 1].x},${bottom}`;

  function selectPoint(point: (typeof points)[number]) {
    const coinciding = points.filter((other) => point.x === other.x && point.y === other.y);
    const active = coinciding.findIndex((other) => other.result.id === selected.id);
    setSelectedId(coinciding[(active + 1) % coinciding.length].result.id);
  }

  return (
    <>
      <div className="chart-plot" ref={plot}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="График баллов по времени теста">
          <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#388bfd" stopOpacity=".25" />
            <stop offset="100%" stopColor="#388bfd" stopOpacity=".02" />
          </linearGradient></defs>
          {[100, 75, 50, 25, 0].map((score) => (
            <g key={score} className="chart-tick">
              <text x={left - 10} y={y(score) + 4} textAnchor="end">{score}</text>
              <line x1={left} x2={right} y1={y(score)} y2={y(score)} />
            </g>
          ))}
          {ticks.map((time, index) => (
            <g key={time} className="chart-tick">
              <line x1={x(time)} x2={x(time)} y1={top} y2={bottom} />
              <text x={x(time)} y={bottom + 23} textAnchor={ticks.length === 1 ? "middle" : index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}>
                {dateFormat.format(time)}
              </text>
            </g>
          ))}
          {points.length > 1 && <><polygon points={area} fill={`url(#${gradientId})`} />
            <polyline points={coordinates} className="chart-line" /></>}
          {points.map((point) => (
            <g key={point.result.id} tabIndex={0} role="button" className="chart-point"
              aria-label={`${point.result.score} из 100, ${formatDate(point.result.testedAt)}, коммит ${point.result.sha}`}
              aria-pressed={selected.id === point.result.id}
              onFocus={() => setSelectedId(point.result.id)}
              onClick={() => selectPoint(point)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(point.result.id);
                }
              }}>
              <circle cx={point.x} cy={point.y} r="13" fill="transparent" />
              {selected.id === point.result.id && <circle cx={point.x} cy={point.y} r="10" className="chart-point-halo" />}
              <circle cx={point.x} cy={point.y} r={selected.id === point.result.id ? 5 : 4} className="chart-point-dot" />
            </g>
          ))}
        </svg>
      </div>
      <div className="chart-selection" aria-live="polite">
        <span className="score-chip">{selected.score}<span>/100</span></span>
        <time dateTime={selected.testedAt}>{formatDate(selected.testedAt)}</time>
        <CommitLink sha={selected.sha} url={selected.url} />
        <span className="muted chart-author"><Icon name="person" size={15} />{selected.author}</span>
      </div>
    </>
  );
}

function localDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function ResultForm({ busy, defaultSha, onSubmit }: {
  busy: boolean; defaultSha: string | null; onSubmit: (value: ResultInput) => Promise<boolean>;
}) {
  const [sha, setSha] = useState("");
  const [testedAt, setTestedAt] = useState(() => localDateTime(new Date()));
  const [score, setScore] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new Date(testedAt);
    if (!Number.isFinite(date.getTime()) || !sha.trim() || score === "") return;
    if (await onSubmit({ sha: sha.trim(), testedAt: date.toISOString(), score: Number(score) })) {
      setSha("");
      setScore("");
      setTestedAt(localDateTime(new Date()));
    }
  }

  return (
    <form className="result-form panel" onSubmit={submit}>
      <div className="panel-heading"><span className="section-icon"><Icon name="plus" size={17} /></span><h2>Добавить замер</h2></div>
      <label htmlFor="result-sha">SHA коммита</label>
      <input id="result-sha" className="input-mono" value={sha} onChange={(event) => setSha(event.target.value)}
        placeholder="Например, a1b2c3d" autoCapitalize="none" spellCheck={false} required disabled={busy} />
      {defaultSha && <button className="text-button sha-helper" type="button" disabled={busy} onClick={() => setSha(defaultSha)}>
        Использовать SHA основной ветки
      </button>}
      <label htmlFor="result-date">Дата и время теста</label>
      <input id="result-date" type="datetime-local" value={testedAt} onChange={(event) => setTestedAt(event.target.value)}
        required disabled={busy} aria-describedby="time-zone-hint" />
      <small className="muted" id="time-zone-hint">Местное время</small>
      <label htmlFor="result-score">Балл</label>
      <div className="score-input">
        <input id="result-score" type="number" min="0" max="100" step="any" inputMode="decimal" placeholder="0–100"
          value={score} onChange={(event) => setScore(event.target.value)} required disabled={busy} />
        <span aria-hidden="true">/ 100</span>
      </div>
      <button className="button button-primary" type="submit" disabled={busy}><Icon name="plus" size={17} />Сохранить замер</button>
    </form>
  );
}

export function ResultsView({ results, canWrite, busy, defaultSha, onSubmit }: {
  results: Result[]; canWrite: boolean; busy: boolean; defaultSha: string | null;
  onSubmit: (value: ResultInput) => Promise<boolean>;
}) {
  const chronological = useMemo(() => [...results].sort((a, b) => new Date(a.testedAt).getTime() - new Date(b.testedAt).getTime()), [results]);
  const latest = chronological[chronological.length - 1];

  return (
    <>
      <div className={`results-grid${canWrite ? " with-form" : ""}`}>
        <section className="panel chart-panel" aria-labelledby="chart-title">
          <div className="panel-heading">
            <span className="section-icon"><Icon name="chart" size={17} /></span>
            <div><h2 id="chart-title">Динамика баллов</h2><span className="muted">Внешние тесты · шкала 0–100</span></div>
            {latest && <div className="latest-score"><strong>{latest.score}</strong><span>Последний балл</span></div>}
          </div>
          {chronological.length ? <ResultsChart results={chronological} />
            : <EmptyState icon="chart" title="Пока нет замеров">График появится после добавления результатов внешнего теста.</EmptyState>}
        </section>
        {canWrite && <ResultForm busy={busy} defaultSha={defaultSha} onSubmit={onSubmit} />}
      </div>
      <section className="panel history-panel" aria-labelledby="history-title">
        <div className="panel-heading"><span className="section-icon"><Icon name="clock" size={17} /></span>
          <h2 id="history-title">История замеров</h2><span className="column-count">{results.length}</span>
        </div>
        {chronological.length ? <div className="history-scroll">
          <table>
            <thead><tr><th scope="col">Время теста</th><th scope="col">Коммит</th><th scope="col">Балл</th><th scope="col">Автор</th></tr></thead>
            <tbody>{[...chronological].reverse().map((result) => (
              <tr key={result.id}>
                <td><time dateTime={result.testedAt}>{formatDate(result.testedAt)}</time></td>
                <td><CommitLink sha={result.sha} url={result.url} /></td>
                <td><span className="score-chip">{result.score}<span>/100</span></span></td>
                <td className="muted">{result.author}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : <div className="history-empty muted">Сохранённые замеры появятся здесь.</div>}
      </section>
    </>
  );
}
