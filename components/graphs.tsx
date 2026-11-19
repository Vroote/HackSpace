"use client";

import { useCallback, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background, BackgroundVariant, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow, useReactFlow,
} from "@xyflow/react";
import type { Edge, Node, NodeProps, OnNodesChange } from "@xyflow/react";
import type { ArchitectureSnapshot, Board, Issue, Status } from "@/lib/types";
import type { analyzePipeline } from "@/lib/pipeline";
import { Assignees, EmptyState, Icon, PullLinks, statusDisplay } from "./ui";

type Pipeline = ReturnType<typeof analyzePipeline>;
type PlanNode = Node<{ issue: Issue; status?: Status; ready: boolean; reasons: string[] }, "issue">;
type LaneNode = Node<{ label: string; unresolved?: boolean }, "lane">;
type ArchitectureNode = Node<{ label: string; description: string; paths: { path: string; url: string }[] }, "component">;
type CanvasNode = PlanNode | LaneNode | ArchitectureNode;
type Heights = Record<string, number>;

const planWidth = 280;
const architectureWidth = 274;
const handles = (
  <>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </>
);

function PlanCard({ data }: NodeProps<PlanNode>) {
  const status = statusDisplay(data.status);
  return (
    <article className={`graph-card plan-card${data.reasons.length ? " has-blockers" : ""}`}>
      {handles}
      <div className="node-meta">
        <a className="issue-number tone-green nodrag nopan" href={data.issue.url} target="_blank" rel="noreferrer">
          <Icon name="issue" size={15} />#{data.issue.number}
        </a>
        <span className={`pill tone-${status.tone}`}><i className="status-dot" />{status.label}</span>
      </div>
      <a className="issue-title nodrag nopan" href={data.issue.url} target="_blank" rel="noreferrer">{data.issue.title}</a>
      <div className="node-people">
        <Assignees people={data.issue.assignees} showNames />
        {data.ready && <span className="card-flag tone-green"><Icon name="ready" size={13} />Можно брать</span>}
      </div>
      <PullLinks pulls={data.issue.pulls} />
      {data.reasons.length > 0 && (
        <div className="node-warning tone-amber">
          <Icon name="lock" size={14} />
          <ul>{data.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        </div>
      )}
    </article>
  );
}

function LaneLabel({ data }: NodeProps<LaneNode>) {
  return <div className={`lane-label${data.unresolved ? " tone-amber" : ""}`}>
    <Icon name={data.unresolved ? "alert" : "layers"} size={15} />{data.label}
  </div>;
}

function ArchitectureCard({ data }: NodeProps<ArchitectureNode>) {
  return (
    <article className="graph-card architecture-card">
      {handles}
      <div className="component-title"><span className="component-icon"><Icon name="layers" size={17} /></span><strong>{data.label}</strong></div>
      {data.description && <p>{data.description}</p>}
      {data.paths.length > 0 && <div className="component-paths">
        {data.paths.map(({ path, url }) => (
          <a key={path} href={url} target="_blank" rel="noreferrer" className="nodrag nopan">
            <Icon name="file" size={14} /><code>{path}</code><Icon name="external" size={13} />
          </a>
        ))}
      </div>}
    </article>
  );
}

const nodeTypes = { issue: PlanCard, lane: LaneLabel, component: ArchitectureCard };

function GraphControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left" className="canvas-control-panel">
      <div className="canvas-controls" role="group" aria-label="Управление холстом">
        <button type="button" onClick={() => void zoomOut({ duration: 160 })} aria-label="Уменьшить" title="Уменьшить"><Icon name="minus" size={17} /></button>
        <button type="button" onClick={() => void zoomIn({ duration: 160 })} aria-label="Увеличить" title="Увеличить"><Icon name="plus" size={17} /></button>
        <button type="button" onClick={() => void fitView({ padding: 0.16, maxZoom: 1, duration: 260 })} aria-label="Показать весь граф" title="Показать весь граф"><Icon name="fit" size={17} /></button>
      </div>
    </Panel>
  );
}

const fitOptions = { padding: 0.16, maxZoom: 1 };

function GraphCanvas({ label, layout, edges }: { label: string; layout: (heights: Heights) => CanvasNode[]; edges: Edge[] }) {
  const [heights, setHeights] = useState<Heights>({});
  const nodes = useMemo(() => layout(heights), [layout, heights]);
  const onNodesChange = useCallback<OnNodesChange<CanvasNode>>((changes) => {
    const dimensions = changes.getByType("dimensions");
    if (!dimensions.length) return;
    setHeights((current) => {
      let next = current;
      for (const change of dimensions) {
        if (!change.dimensions?.height || current[change.id] === change.dimensions.height) continue;
        if (next === current) next = { ...current };
        next[change.id] = change.dimensions.height;
      }
      return next;
    });
  }, []);

  return (
    <div className="graph-canvas">
      <ReactFlow<CanvasNode, Edge> aria-label={label} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} className="dark" fitView fitViewOptions={fitOptions}
        minZoom={0.08} maxZoom={2} nodesDraggable={false} nodesConnectable={false}
        nodesFocusable={false} elementsSelectable={false} edgesFocusable={false}
        deleteKeyCode={null} zoomOnDoubleClick={false} preventScrolling
        ariaLabelConfig={{ "minimap.ariaLabel": "Мини-карта графа" }}>
        <Background variant={BackgroundVariant.Dots} gap={19} size={1.15} color="#303845" />
        <GraphControls />
        {nodes.length > 3 && <MiniMap className="canvas-minimap" pannable zoomable
          nodeColor={(node) => node.type === "lane" ? "#303642" : "#456693"}
          nodeStrokeWidth={2} maskColor="#0d1117b3" />}
      </ReactFlow>
    </div>
  );
}

function graphEdge(id: string, source: string, target: string, label?: string, warning = false): Edge {
  const color = warning ? "#ad824c" : "#637f9f";
  return {
    id, source, target, label: label || undefined, type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17, color },
    style: { stroke: color, strokeWidth: 1.7, strokeDasharray: warning ? "5 4" : undefined },
    labelStyle: { fontSize: 11, fill: "#c9d4e2" },
    labelBgStyle: { fill: "#1b2532", fillOpacity: 1 },
    labelBgPadding: [7, 4],
    labelBgBorderRadius: 5,
  };
}

export function DependencyGraph({ board, analysis, readyIds }: { board: Board; analysis: Pipeline; readyIds: Set<string> }) {
  const layout = useCallback((heights: Heights) => {
    const issues = new Map(board.issues.map((issue) => [issue.id, issue]));
    const statuses = new Map(board.statuses.map((status) => [status.id, status]));
    const inPlan = new Set([...analysis.columns.flat(), ...analysis.unresolvedIds]);
    const nodes: CanvasNode[] = [];

    function place(ids: string[], x: number, label: string, unresolved = false) {
      const laneId = `lane:${label}`;
      let y = 58;
      nodes.push({ id: laneId, type: "lane", data: { label, unresolved }, position: { x, y: 0 }, style: { width: planWidth } });
      for (const id of ids) {
        const issue = issues.get(id);
        if (!issue) continue;
        const reasons = analysis.reasons[id] ?? [];
        const fallback: string[] = [];
        if (!reasons.length) {
          if (issue.blockersUnknown) fallback.push("Часть зависимостей недоступна.");
          for (const blocker of issue.blockers) {
            if (blocker.completed) continue;
            if (blocker.state === "CLOSED") fallback.push(`#${blocker.number} закрыта без выполнения · ${blocker.title}`);
            else if (!inPlan.has(blocker.id)) fallback.push(`Внешний блокер #${blocker.number} · ${blocker.title}`);
          }
          if (unresolved && !fallback.length) fallback.push("Задача входит в цикл зависимостей или зависит от него.");
        }
        nodes.push({
          id, type: "issue", position: { x, y }, style: { width: planWidth },
          data: { issue, ready: readyIds.has(id), status: statuses.get(issue.statusId ?? ""), reasons: reasons.length ? reasons : fallback },
        });
        y += (heights[id] ?? (130 + (issue.pulls.length ? 38 : 0) + (reasons.length || fallback.length ? 62 : 0))) + 26;
      }
    }

    analysis.columns.forEach((column, index) => place(column, index * 390, `Уровень ${index + 1}`));
    if (analysis.unresolvedIds.length) {
      place(analysis.unresolvedIds, analysis.columns.length * 390 + (analysis.columns.length ? 40 : 0), "Порядок не определён", true);
    }
    return nodes;
  }, [analysis, board, readyIds]);

  const edges = useMemo(() => {
    const ordered = new Set(analysis.columns.flat());
    const unresolved = new Set(analysis.unresolvedIds);
    const visible = (id: string) => ordered.has(id) || unresolved.has(id);
    return analysis.edges.filter(({ source, target }) => visible(source) && visible(target)).map(({ source, target }, index) =>
      graphEdge(`dependency-${index}`, source, target, undefined, unresolved.has(source) || unresolved.has(target)));
  }, [analysis]);

  if (!analysis.columns.length && !analysis.unresolvedIds.length) {
    return <EmptyState icon="plan" title="В плане пока нет задач">Здесь появятся открытые задачи репозитория и их зависимости.</EmptyState>;
  }

  return (
    <div className="canvas-panel">
      <div className="canvas-heading">
        <strong><Icon name="plan" size={17} /> Зависимости задач</strong>
        <div className="canvas-legend">
          <span><i className="legend-edge" /> Блокирует</span>
          <span className="tone-green"><Icon name="ready" size={14} /> Можно брать</span>
          <span className="tone-amber"><Icon name="lock" size={14} /> Есть препятствия</span>
        </div>
      </div>
      <GraphCanvas label="Граф зависимостей задач" layout={layout} edges={edges} />
      <div className="canvas-footnote muted">Порядок уровней определяется зависимостями. Стрелка идёт от блокера к зависимой задаче.</div>
    </div>
  );
}

export function ArchitectureGraph({ snapshot, repoUrl }: { snapshot: ArchitectureSnapshot; repoUrl: string }) {
  const { graph, sha } = snapshot;
  const layout = useCallback((heights: Heights) => {
    const diagram = new dagre.graphlib.Graph();
    diagram.setGraph({ rankdir: "LR", ranksep: 116, nodesep: 52, marginx: 30, marginy: 30 });
    diagram.setDefaultEdgeLabel(() => ({}));
    for (const node of graph.nodes) {
      diagram.setNode(node.id, { width: architectureWidth, height: heights[node.id] ?? (106 + node.paths.length * 28) });
    }
    for (const edge of graph.edges) {
      if (diagram.hasNode(edge.source) && diagram.hasNode(edge.target)) diagram.setEdge(edge.source, edge.target);
    }
    dagre.layout(diagram);
    const baseUrl = `${repoUrl.replace(/\/$/, "")}/blob/${encodeURIComponent(sha)}`;
    return graph.nodes.map((node): ArchitectureNode => {
      const { x, y, height } = diagram.node(node.id);
      return {
        id: node.id, type: "component", position: { x: x - architectureWidth / 2, y: y - height / 2 },
        style: { width: architectureWidth },
        data: {
          label: node.label, description: node.description,
          paths: node.paths.map((path) => ({ path, url: `${baseUrl}/${path.split("/").map(encodeURIComponent).join("/")}` })),
        },
      };
    });
  }, [graph, repoUrl, sha]);

  const edges = useMemo(() => {
    const ids = new Set(graph.nodes.map((node) => node.id));
    return graph.edges.filter(({ source, target }) => ids.has(source) && ids.has(target)).map(({ source, target, label }, index) =>
      graphEdge(`component-edge-${index}`, source, target, label));
  }, [graph]);

  if (!graph.nodes.length) return <EmptyState icon="architecture" title="В схеме нет компонентов" />;

  return (
    <div className="canvas-panel">
      <div className="canvas-heading">
        <strong><Icon name="architecture" size={17} /> Компоненты репозитория</strong>
        <span className="muted">{graph.nodes.length} комп. <span aria-hidden="true">·</span> {edges.length} связ.</span>
      </div>
      <GraphCanvas key={sha} label="Граф архитектуры" layout={layout} edges={edges} />
      <div className="canvas-footnote muted">Ссылки в карточках открывают файлы зафиксированного коммита.</div>
    </div>
  );
}
