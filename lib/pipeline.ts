import type { Board } from "./types";

export function analyzePipeline(board: Board) {
  const open = board.issues.filter((issue) => issue.state === "OPEN")
    .sort((left, right) => left.number - right.number);
  const allIds = new Set(board.issues.map((issue) => issue.id));
  const ids = new Set(open.map((issue) => issue.id));
  const reasons: Record<string, string[]> = Object.create(null);
  const edges: { source: string; target: string }[] = [];
  const outgoing = new Map(open.map((issue) => [issue.id, [] as string[]]));
  const indegree = new Map(open.map((issue) => [issue.id, 0]));
  const todo = board.statuses.find((status) => status.name.trim().toLowerCase() === "todo");
  const readyIds: string[] = [];
  for (const issue of open) {
    const messages: string[] = [];
    reasons[issue.id] = messages;
    const seen = new Set<string>();
    if (board.stale) messages.push("Данные устарели");
    if (issue.blockersUnknown) messages.push("Не удалось проверить все зависимости");
    for (const blocker of issue.blockers) {
      if (seen.has(blocker.id) || blocker.completed) continue;
      seen.add(blocker.id);
      const outside = !allIds.has(blocker.id) ? " · вне плана" : "";
      messages.push(blocker.state === "OPEN"
        ? `Ждёт #${blocker.number}${outside}`
        : `Блокер #${blocker.number} закрыт не как выполненный${outside}`);
      if (blocker.state !== "OPEN" || !ids.has(blocker.id)) continue;
      edges.push({ source: blocker.id, target: issue.id });
      outgoing.get(blocker.id)!.push(issue.id);
      indegree.set(issue.id, indegree.get(issue.id)! + 1);
    }
    if (todo && issue.statusId === todo.id && !messages.length) readyIds.push(issue.id);
  }
  const columns: string[][] = [];
  const ordered = new Set<string>();
  let frontier = open.filter((issue) => indegree.get(issue.id) === 0).map((issue) => issue.id);
  while (frontier.length) {
    columns.push(frontier);
    const next: string[] = [];
    for (const source of frontier) {
      ordered.add(source);
      for (const target of outgoing.get(source)!) {
        const remaining = indegree.get(target)! - 1;
        indegree.set(target, remaining);
        if (!remaining) next.push(target);
      }
    }
    frontier = next;
  }
  const unresolvedIds = open.filter((issue) => !ordered.has(issue.id)).map((issue) => issue.id);
  for (const id of unresolvedIds) reasons[id].push("Есть цикл зависимостей в цепочке");
  return { readyIds, columns, edges, unresolvedIds, reasons };
}
