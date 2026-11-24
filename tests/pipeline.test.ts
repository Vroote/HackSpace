import assert from "node:assert/strict";
import test from "node:test";
import { analyzePipeline, observeUnlocks, resolveProjectBlockers, type UnlockHistory } from "../lib/pipeline";
import type { Blocker, Board, Issue } from "../lib/types";

function blocker(id: string, state: Blocker["state"] = "OPEN", completed = false): Blocker {
  return { id, title: id, number: Number(id), url: "", state, completed };
}

function task(id: string, blockers: Blocker[] = [], overrides: Partial<Issue> = {}): Issue {
  return { ...blocker(id), itemId: `item-${id}`, statusId: "todo", assignees: [], blockers, blockersUnknown: false, pulls: [], ...overrides };
}

function board(issues: Issue[], stale = false): Board {
  return { statuses: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }], issues, stale,
    projectUrl: "", repoUrl: "", repoName: "demo", refreshedAt: "" };
}

test("parallel tasks share a column; joins are ordered by their deepest blocker", () => {
  const result = analyzePipeline(board([
    task("1"), task("2"), task("3", [blocker("1"), blocker("2")]), task("4", [blocker("1"), blocker("3")]),
  ]));
  assert.deepEqual(result.columns, [["1", "2"], ["3"], ["4"]]);
  assert.deepEqual(result.readyIds, ["1", "2"]);
  assert.deepEqual(result.edges, [
    { source: "1", target: "3" }, { source: "2", target: "3" }, { source: "1", target: "4" }, { source: "3", target: "4" },
  ]);
});

test("a cycle and its descendants are unresolved, independent work survives", () => {
  const result = analyzePipeline(board([
    task("1", [blocker("2")]), task("2", [blocker("1")]), task("3", [blocker("2")]), task("4"),
  ]));
  assert.deepEqual(result.columns, [["4"]]);
  assert.deepEqual(result.unresolvedIds, ["1", "2", "3"]);
  assert.deepEqual(result.readyIds, ["4"]);
});

test("only completed dependencies are resolved, even across projects", () => {
  const result = analyzePipeline(board([
    task("1", [blocker("20")]), task("2", [blocker("21", "CLOSED")]), task("3", [], { blockersUnknown: true }),
    task("4", [blocker("22", "CLOSED", true)]), task("5", [], { statusId: "done" }), task("6", [blocker("5")]),
  ]));
  assert.deepEqual(result.readyIds, ["4"]);
  assert.match(result.reasons["1"][0], /вне плана/);
  assert.match(result.reasons["2"][0], /не как выполненный/);
  assert.match(result.reasons["3"][0], /проверить/);
  assert.deepEqual(analyzePipeline(board([task("4")], true)).readyIds, []);
});

test("only the last confirmed blocker unlocks an assigned task", () => {
  const snapshot = board([task("1"), task("2"), task("3", [blocker("1"), blocker("2")], {
    assignees: [{ login: "Me", avatarUrl: "" }],
  })]);
  const observe = (history: UnlockHistory) => observeUnlocks(resolveProjectBlockers(snapshot), "me", history);
  const initial = observe({ blocked: [], unread: [] });
  assert.deepEqual(initial.blocked, ["3"]);
  snapshot.issues[0].statusId = "done";
  assert.deepEqual(observe(initial), initial);
  snapshot.issues[1].statusId = "done";
  snapshot.stale = true;
  assert.deepEqual(observe(initial), initial);
  snapshot.stale = false;
  const ready = observe(initial);
  assert.deepEqual(ready, { blocked: [], unread: ["3"] });
  assert.deepEqual(observe({ blocked: [], unread: [] }).unread, []);
});
