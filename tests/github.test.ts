import assert from "node:assert/strict";
import test from "node:test";
import { changeStatus, githubAccess, readBoard, readPullRequests } from "../lib/github";

const config = { owner: "example", repo: "hackathon", project: 4 };
const token = "ghu_test";
const sha = "a".repeat(40);
const scope = {
  repository: { id: "repo", nameWithOwner: "example/hackathon", visibility: "INTERNAL",
    url: "https://github.com/example/hackathon", defaultBranchRef: { target: { oid: sha } } },
  organization: { login: "example", projectV2: { id: "project", number: 4, url: "https://github.com/orgs/example/projects/4",
    viewerCanUpdate: true, field: { __typename: "ProjectV2SingleSelectField", id: "field", options: [{ name: "Todo", id: "todo" }] } } },
};
const repo = { id: "repo" };
const issue = { __typename: "Issue", id: "issue", number: 17, title: "Implement board",
  url: "https://github.com/example/hackathon/issues/17", state: "OPEN", repository: repo };
const pageInfo = { hasNextPage: false, endCursor: null };

test("GitHub access requires explicit repository installation access and marks internal code non-public", async (context) => {
  let repositories = [{ full_name: "example/hackathon" }];
  context.mock.method(globalThis, "fetch", async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/graphql") return Response.json({ data: scope });
    if (path === "/user/installations") return Response.json({ installations: [
      { id: 11, target_type: "Organization", account: { login: "example" }, suspended_at: null },
    ] });
    assert.equal(path, "/user/installations/11/repositories");
    return Response.json({ repositories });
  });
  const access = await githubAccess(token, config);
  assert.equal(access.private, true);
  assert.equal(access.defaultSha, sha);
  repositories = [];
  await assert.rejects(githubAccess(token, config), { status: 403 });
});

test("GitHub board excludes pull-request items, tracks linked PR states, and marks incomplete blockers", async (context) => {
  const linkedPulls = [
    { state: "OPEN", isDraft: true, mergeStateStatus: "CLEAN" },
    { state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN" },
    { state: "OPEN", isDraft: false, mergeStateStatus: "BLOCKED" },
    { state: "OPEN", isDraft: false, mergeStateStatus: "UNKNOWN" },
    { state: "MERGED", isDraft: false, mergeStateStatus: "UNKNOWN" },
    { state: "CLOSED", isDraft: false, mergeStateStatus: "UNKNOWN" },
  ].map((pull, index) => ({ ...pull, number: 23 + index, url: `https://github.com/example/hackathon/pull/${23 + index}` }));
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    if (query.includes("GitHubScope")) return Response.json({ data: scope });
    if (query.includes("BoardItems")) return Response.json({ data: { node: { items: { pageInfo, nodes: [
      { id: "item", isArchived: false, status: { optionId: "todo" }, content: { ...issue,
        assignees: { nodes: [{ login: "person", avatarUrl: "" }], pageInfo },
        pulls: { nodes: linkedPulls, pageInfo },
      } },
      { id: "pr-item", isArchived: false, content: { __typename: "PullRequest" } },
    ] } } } });
    assert.match(query, /BoardBlockers/);
    return Response.json({ data: { nodes: [{ repository: repo, issueDependenciesSummary: { totalBlockedBy: 1 },
      blockedBy: { pageInfo, nodes: [null], totalCount: 1 } }] } });
  });
  const board = await readBoard(token, config);
  assert.equal(board.issues.length, 1);
  assert.equal(board.issues[0].assignees[0].login, "person");
  assert.deepEqual(board.issues[0].pulls.map(({ state }) => state), ["DRAFT", "READY", "OPEN", "OPEN", "MERGED", "CLOSED"]);
  assert.equal(board.issues[0].blockersUnknown, true);
});

test("status mutation rejects a foreign item or a viewer with read-only project access", async (context) => {
  let canWrite = true;
  const mock = context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    if (query.includes("GitHubScope")) return Response.json({ data: {
      ...scope, organization: { ...scope.organization, projectV2: { ...scope.organization.projectV2, viewerCanUpdate: canWrite } },
    } });
    assert.match(query, /ScopedProjectItem/);
    return Response.json({ data: { node: { id: "item", isArchived: false, project: { id: "other" }, content: issue } } });
  });
  await assert.rejects(changeStatus(token, config, "item", "todo"), { status: 404 });
  canWrite = false;
  await assert.rejects(changeStatus(token, config, "item", "todo"), { status: 403 });
  assert.equal(mock.mock.callCount(), 3);
});

test("repository PR pages include unlinked PRs, authors, and every status", async (context) => {
  const newer = {
    number: 30, title: "PR without an issue", url: "https://github.com/example/hackathon/pull/30",
    state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: "APPROVED",
    headRefName: "feature", baseRefName: "main", updatedAt: "2026-11-19T10:00:00Z",
    author: { login: "person", avatarUrl: "", url: "https://github.com/person" },
  };
  const older = { ...newer, number: 29, state: "CLOSED", author: null, reviewDecision: null };
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    assert.match(query, /states: \[OPEN, CLOSED, MERGED\]/);
    assert.equal(variables.owner, "example");
    assert.equal(variables.repo, "hackathon");
    return Response.json({ data: { repository: { nameWithOwner: "example/hackathon", pullRequests: {
      nodes: variables.after === null ? [newer] : [older],
      totalCount: 2,
      pageInfo: { hasNextPage: variables.after === null, endCursor: "next-page" },
    } } } });
  });

  const first = await readPullRequests(token, config, null);
  assert.equal(first.totalCount, 2);
  assert.equal(first.nextCursor, "next-page");
  assert.equal(first.pulls[0].state, "READY");
  assert.deepEqual(first.pulls[0].author, newer.author);
  assert.equal(first.pulls[0].headRefName, "feature");
  assert.equal(first.pulls[0].reviewDecision, "APPROVED");
  const next = await readPullRequests(token, config, first.nextCursor);
  assert.equal(next.nextCursor, null);
  assert.equal(next.pulls[0].state, "CLOSED");
  assert.equal(next.pulls[0].author, null);
});

test("personal review search scopes the cursor and request time to the viewer", async (context) => {
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body));
    assert.match(variables.query, /repo:example\/hackathon is:pr is:open user-review-requested:@me/);
    assert.equal(variables.after, "page2");
    return Response.json({ data: { viewer: { login: "me" }, search: {
      totalCount: 1, pageInfo, nodes: [{ number: 7, state: "OPEN", timelineItems: { nodes: [
        { requestedReviewer: { login: "me" }, createdAt: "2026-11-22T12:00:00Z" },
        { requestedReviewer: { login: "other" }, createdAt: "2026-11-22T13:00:00Z" },
      ] } }],
    } } });
  });
  const page = await readPullRequests(token, config, "page2", true);
  assert.equal(page.pulls[0].reviewRequestedAt, "2026-11-22T12:00:00Z");
});
