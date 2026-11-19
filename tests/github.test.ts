import assert from "node:assert/strict";
import test from "node:test";
import { changeStatus, githubAccess, readBoard } from "../lib/github";

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

test("GitHub board excludes pull-request items and marks incomplete blocker data", async (context) => {
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    if (query.includes("GitHubScope")) return Response.json({ data: scope });
    if (query.includes("BoardItems")) return Response.json({ data: { node: { items: { pageInfo, nodes: [
      { id: "item", isArchived: false, status: { optionId: "todo" }, content: { ...issue,
        assignees: { nodes: [{ login: "person", avatarUrl: "" }], pageInfo },
        pulls: { nodes: [{ number: 23, url: "https://github.com/example/hackathon/pull/23", state: "OPEN", isDraft: true }], pageInfo },
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
  assert.equal(board.issues[0].pulls[0].state, "DRAFT");
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
