import type { Blocker, Board, Issue, Person, Status } from "@/lib/types";

export type RepoConfig = { owner: string; project: number; repo: string };

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GitHubError";
  }
}

const API_URL = "https://api.github.com";
const REST_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 60_000;
const MAX_TEXT_BYTES = 256 * 1024;
const FULL_SHA = /^[a-f0-9]{40}$/i;
const PAGE_INFO = "pageInfo { hasNextPage endCursor }";
const PERSON_FIELDS = "login avatarUrl";
const PULL_FIELDS = "number url state isDraft";
const REST_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": REST_VERSION };

type GraphError = {
  message: string;
  type?: string;
  path?: (string | number)[];
  extensions?: { type?: string; code?: string };
};

function graphErrorStatus(errors: GraphError[], headers: Headers): number {
  const codes = errors.flatMap(({ type, extensions }) => [type, extensions?.type, extensions?.code]);
  if (codes.includes("RATE_LIMITED") || errors.some(({ message }) => /rate limit/i.test(message))) {
    return headers.get("x-ratelimit-remaining") === "0" ? 403 : 429;
  }
  if (codes.includes("UNAUTHORIZED") || codes.includes("UNAUTHENTICATED")) return 401;
  if (codes.includes("FORBIDDEN") || codes.includes("INSUFFICIENT_SCOPES")) return 403;
  if (codes.includes("NOT_FOUND")) return 404;
  if (codes.includes("UNPROCESSABLE") || codes.includes("VALIDATION_FAILED")) return 422;
  return 502;
}

async function httpError(response: Response): Promise<GitHubError> {
  const fallback = `GitHub returned HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { message?: unknown } | null;
    return new GitHubError(typeof body?.message === "string" ? body.message : fallback, response.status);
  } catch {
    return new GitHubError(fallback, response.status);
  }
}

class GitHubClient {
  private readonly deadline = Date.now() + OPERATION_TIMEOUT_MS;

  constructor(private readonly token: string) {
    if (!token.trim()) throw new GitHubError("A GitHub token is required", 401);
  }

  private async request<T>(
    path: string,
    init: RequestInit & { headers: Record<string, string> },
    parse: (response: Response) => Promise<T>,
  ): Promise<T> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new GitHubError("GitHub operation timed out", 504);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, REQUEST_TIMEOUT_MS));
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
        cache: "no-store",
        redirect: "manual",
      });
      if (!response.ok) throw await httpError(response);
      return await parse(response);
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      if (controller.signal.aborted) throw new GitHubError("GitHub request timed out", 504);
      throw new GitHubError("GitHub request failed or returned an invalid response", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    acceptErrors?: (errors: GraphError[]) => boolean,
  ): Promise<T> {
    return this.request("/graphql", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    }, async (response) => {
      const { data, errors } = (await response.json()) as { data?: T; errors?: GraphError[] };
      if (errors?.length && (!data || !acceptErrors?.(errors))) {
        throw new GitHubError(errors.map(({ message }) => message).join("; "), graphErrorStatus(errors, response.headers));
      }
      if (!data) throw new GitHubError("GitHub GraphQL response did not include data", 502);
      return data;
    });
  }

  rest<T>(path: string): Promise<T> {
    return this.request(path, { headers: REST_HEADERS }, (response) => response.json() as Promise<T>);
  }

  async *installationPages<T>(path: string, key: "installations" | "repositories"): AsyncGenerator<T> {
    for (let page = 1; ; page++) {
      const { entries, hasNext } = await this.request(`${path}?per_page=100&page=${page}`, {
        headers: REST_HEADERS,
      }, async (response) => {
        const body = (await response.json()) as Record<string, T[]>;
        const entries = body[key];
        if (!Array.isArray(entries)) throw new GitHubError("Invalid GitHub installation response", 502);
        return { entries, hasNext: /;\s*rel="next"/.test(response.headers.get("link") ?? "") };
      });
      yield* entries;
      if (!hasNext) return;
    }
  }

  textBlob(path: string, size: number): Promise<string> {
    return this.request(path, {
      headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": REST_VERSION },
    }, async (response) => {
      const bytes = new Uint8Array(size);
      const reader = response.body?.getReader();
      let offset = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (offset + value.length > size) {
              await reader.cancel();
              throw new GitHubError("GitHub blob exceeded its declared size", 502);
            }
            bytes.set(value, offset);
            offset += value.length;
          }
        } finally {
          reader.releaseLock();
        }
      }
      if (offset !== size) throw new GitHubError("GitHub blob did not match its declared size", 502);
      if (bytes.includes(0)) throw new GitHubError("GitHub blob is not UTF-8 text", 415);
      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new GitHubError("GitHub blob is not UTF-8 text", 415);
      }
    });
  }
}

function repoPath({ owner, repo }: RepoConfig): string {
  if (!/^[a-z0-9-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo) || repo === "." || repo === "..") {
    throw new GitHubError("Invalid GitHub repository configuration", 400);
  }
  return `/repos/${owner}/${repo}`;
}

type Scope = {
  repository: {
    id: string;
    nameWithOwner: string;
    visibility: string | null;
    url: string;
    defaultBranchRef?: { target: { oid: string } | null } | null;
  };
  project: {
    id: string;
    number: number;
    url: string;
    viewerCanUpdate: boolean;
    field?: { __typename: string; id: string; options: Status[] } | null;
  };
};

async function readScope(client: GitHubClient, config: RepoConfig, statusField: boolean): Promise<Scope> {
  repoPath(config);
  const { owner, repo, project: number } = config;
  if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647) {
    throw new GitHubError("Invalid GitHub project number", 400);
  }

  const { repository, organization } = await client.graphql<{
    repository: Scope["repository"] | null;
    organization: { login: string; projectV2: Scope["project"] | null } | null;
  }>(`query GitHubScope($owner: String!, $repo: String!, $number: Int!, $statusField: Boolean!) {
    repository(owner: $owner, name: $repo) {
      id nameWithOwner visibility url
      defaultBranchRef @skip(if: $statusField) { target { ... on Commit { oid } } }
    }
    organization(login: $owner) {
      login
      projectV2(number: $number) {
        id number url viewerCanUpdate
        field(name: "Status") @include(if: $statusField) {
          __typename
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  }`, { owner, repo, number, statusField });

  if (repository?.nameWithOwner.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) {
    throw new GitHubError("Configured GitHub repository is unavailable", 404);
  }
  const project = organization?.projectV2;
  if (organization?.login.toLowerCase() !== owner.toLowerCase() || project?.number !== number) {
    throw new GitHubError("Configured GitHub project is unavailable", 404);
  }
  return { repository, project };
}

export async function githubViewer(token: string): Promise<Person> {
  const { viewer } = await new GitHubClient(token).graphql<{ viewer: Person }>(
    `query GitHubViewer { viewer { ${PERSON_FIELDS} } }`,
  );
  return viewer;
}

type Installation = {
  id: number;
  account: { login: string } | null;
  target_type: string;
  suspended_at: string | null;
};

async function assertInstallationAccess(client: GitHubClient, { owner, repo }: RepoConfig): Promise<void> {
  const ownerLogin = owner.toLowerCase();
  const fullName = `${ownerLogin}/${repo.toLowerCase()}`;
  for await (const installation of client.installationPages<Installation>("/user/installations", "installations")) {
    if (installation.target_type !== "Organization" || installation.account?.login.toLowerCase() !== ownerLogin ||
        installation.suspended_at || !Number.isSafeInteger(installation.id) || installation.id < 1) continue;
    const path = `/user/installations/${installation.id}/repositories`;
    for await (const repository of client.installationPages<{ full_name: string }>(path, "repositories")) {
      if (repository.full_name.toLowerCase() === fullName) return;
    }
  }
  throw new GitHubError("The GitHub viewer lacks explicit access to the configured repository through the app", 403);
}

export async function githubAccess(token: string, config: RepoConfig): Promise<{
  canWrite: boolean; private: boolean; defaultSha: string; repoUrl: string;
}> {
  const client = new GitHubClient(token);
  const { project, repository } = await readScope(client, config, false);
  await assertInstallationAccess(client, config);
  const defaultSha = repository.defaultBranchRef?.target?.oid;
  if (!defaultSha || !FULL_SHA.test(defaultSha)) {
    throw new GitHubError("The GitHub repository has no default branch commit", 409);
  }
  return { canWrite: project.viewerCanUpdate, private: repository.visibility !== "PUBLIC", defaultSha, repoUrl: repository.url };
}

type Connection<T> = {
  nodes: (T | null)[] | null;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

async function* pages<Page extends Connection<unknown>>(
  load: (after: string | null) => Promise<Page | null>,
  first?: Page | null,
  onInvalidCursor?: () => void,
): AsyncGenerator<Page> {
  const seenCursors = new Set<string>();
  let page = first === undefined ? await load(null) : first;
  while (page) {
    yield page;
    const { hasNextPage, endCursor } = page.pageInfo;
    if (!hasNextPage) return;
    if (!endCursor || seenCursors.has(endCursor)) {
      if (!onInvalidCursor) throw new GitHubError("GitHub returned an invalid pagination cursor", 502);
      onInvalidCursor();
      return;
    }
    seenCursors.add(endCursor);
    page = await load(endCursor);
  }
}

type IssueFields = Pick<Issue, "id" | "number" | "title" | "url" | "state">;
type IssueContent = { __typename: "Issue"; repository: { id: string } };
type Item<Content = IssueContent> = {
  id: string;
  isArchived: boolean;
  content: Content | { __typename: "DraftIssue" | "PullRequest" } | null;
};
type Pull = Omit<Issue["pulls"][number], "state"> & { state: "OPEN" | "MERGED" | "CLOSED"; isDraft: boolean };
type BoardIssue = IssueContent & IssueFields & { assignees: Connection<Person>; pulls: Connection<Pull> | null };
type BoardItem = Item<BoardIssue> & {
  status: { optionId?: string | null } | null;
};

const ASSIGNEES_PAGE = `assignees(first: 25, after: $issueAfter) { nodes { ${PERSON_FIELDS} } ${PAGE_INFO} }`;
const PULLS_PAGE = `pulls: closedByPullRequestsReferences(first: 25, after: $issueAfter, includeClosedPrs: true, excludeUserLinked: false) {
  nodes { ${PULL_FIELDS} } ${PAGE_INFO}
}`;

async function readIssueConnection<T>(
  client: GitHubClient,
  issue: BoardIssue,
  field: "assignees" | "pulls",
  first: Connection<T> | null,
): Promise<T[]> {
  const selection = field === "assignees" ? ASSIGNEES_PAGE : PULLS_PAGE;
  const result: T[] = [];
  for await (const page of pages(async (after) => {
    const { node } = await client.graphql<{
      node: ({ repository: { id: string } } & Record<typeof field, Connection<T> | null>) | null;
    }>(`query BoardIssueConnection($id: ID!, $issueAfter: String) {
      node(id: $id) { ... on Issue { repository { id } ${selection} } }
    }`, { id: issue.id, issueAfter: after });
    if (node?.repository?.id !== issue.repository.id || !node[field]) {
      throw new GitHubError("A GitHub issue changed during pagination", 409);
    }
    return node[field];
  }, first)) {
    for (const item of page.nodes ?? []) if (item) result.push(item);
  }
  return result;
}

type BlockerNode = IssueFields & { stateReason: string | null };
type BlockerPage = Connection<BlockerNode> & { totalCount: number };
type BlockerIssue = {
  id: string;
  repository: { id: string };
  blockedBy: BlockerPage;
  issueDependenciesSummary: { totalBlockedBy: number };
};
type BlockerResult = { node: BlockerIssue | null; incomplete: boolean };

async function blockerPages(client: GitHubClient, ids: string[], after: string | null = null): Promise<BlockerResult[]> {
  const incomplete = new Set<number>();
  const { nodes } = await client.graphql<{ nodes: (BlockerIssue | null)[] }>(`
    query BoardBlockers($ids: [ID!]!, $after: String) {
      nodes(ids: $ids) {
        ... on Issue {
          id repository { id }
          issueDependenciesSummary { totalBlockedBy }
          blockedBy(first: 25, after: $after) {
            totalCount
            nodes { id number title url state stateReason }
            ${PAGE_INFO}
          }
        }
      }
    }
  `, { ids, after }, (errors) => errors.every(({ path, type, extensions }) => {
    const [root, index, field] = path ?? [];
    if (root !== "nodes" || typeof index !== "number" || index < 0 || index >= ids.length) return false;
    const code = type ?? extensions?.type ?? extensions?.code;
    const isDependencyError = field === "blockedBy" || field === "issueDependenciesSummary";
    const isInaccessibleNode = field === undefined && (code === "NOT_FOUND" || code === "FORBIDDEN");
    if (!isDependencyError && !isInaccessibleNode) return false;
    incomplete.add(index);
    return true;
  }));
  return ids.map((id, index) => ({
    node: nodes[index]?.id === id ? nodes[index] : null,
    incomplete: incomplete.has(index),
  }));
}

async function readBlockers(
  client: GitHubClient,
  issue: BoardIssue,
  first: BlockerResult,
): Promise<Pick<Issue, "blockers" | "blockersUnknown">> {
  const blockers = new Map<string, Blocker>();
  const totals = new Set<number>();
  let blockersUnknown = false;

  function getPage({ node, incomplete }: BlockerResult): BlockerPage | null {
    if (incomplete) blockersUnknown = true;
    if (node?.repository?.id !== issue.repository.id || !node.blockedBy) {
      blockersUnknown = true;
      return null;
    }
    const summaryTotal = node.issueDependenciesSummary?.totalBlockedBy;
    if (typeof summaryTotal === "number") totals.add(summaryTotal);
    else blockersUnknown = true;
    return node.blockedBy;
  }

  for await (const page of pages(async (after) => {
    const [next] = await blockerPages(client, [issue.id], after);
    return getPage(next);
  }, getPage(first), () => { blockersUnknown = true; })) {
    totals.add(page.totalCount);
    if (!page.nodes) blockersUnknown = true;
    for (const blocker of page.nodes ?? []) {
      if (!blocker || blockers.has(blocker.id)) {
        blockersUnknown = true;
        continue;
      }
      const { stateReason, ...fields } = blocker;
      blockers.set(blocker.id, { ...fields, completed: fields.state === "CLOSED" && stateReason === "COMPLETED" });
    }
  }

  // GitHub does not document whether both counts can omit permission-filtered dependencies.
  return {
    blockers: [...blockers.values()],
    blockersUnknown: blockersUnknown || totals.size !== 1 || !totals.has(blockers.size),
  };
}

function getStatusField(project: Scope["project"]) {
  if (project.field?.__typename !== "ProjectV2SingleSelectField") {
    throw new GitHubError("The GitHub project has no single-select Status field", 422);
  }
  return project.field;
}

export async function readBoard(token: string, config: RepoConfig): Promise<Board> {
  const client = new GitHubClient(token);
  const { project, repository } = await readScope(client, config, true);
  const statuses = getStatusField(project).options;
  const issues: Issue[] = [];
  const seenIssues = new Set<string>();

  for await (const page of pages(async (after) => {
    const { node } = await client.graphql<{ node: { items: Connection<BoardItem> } | null }>(`
      query BoardItems($id: ID!, $filter: String!, $after: String, $issueAfter: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: 20, after: $after, query: $filter) {
              ${PAGE_INFO}
              nodes {
                id isArchived
                status: fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue { optionId }
                }
                content {
                  __typename
                  ... on Issue {
                    id number title url state repository { id }
                    ${ASSIGNEES_PAGE}
                    ${PULLS_PAGE}
                  }
                }
              }
            }
          }
        }
      }
    `, { id: project.id, filter: `repo:${repository.nameWithOwner} is:issue`, after });
    if (!node?.items) throw new GitHubError("Configured GitHub project is unavailable", 404);
    return node.items;
  })) {
    const selected = (page.nodes ?? []).flatMap((item) => {
      const issue = item?.content;
      if (!item || item.isArchived || issue?.__typename !== "Issue" ||
          issue.repository.id !== repository.id || seenIssues.has(issue.id)) return [];
      seenIssues.add(issue.id);
      return [{ item, issue }];
    });
    if (!selected.length) continue;
    const dependencies = await blockerPages(client, selected.map(({ issue }) => issue.id));

    for (const [index, { item, issue }] of selected.entries()) {
      const assignees = await readIssueConnection(client, issue, "assignees", issue.assignees);
      const pulls = await readIssueConnection(client, issue, "pulls", issue.pulls);
      issues.push({
        id: issue.id,
        itemId: item.id,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        statusId: item.status?.optionId ?? null,
        assignees,
        ...await readBlockers(client, issue, dependencies[index]),
        pulls: pulls.map(({ number, url, state, isDraft }) => ({
          number, url, state: state === "OPEN" && isDraft ? "DRAFT" : state,
        })),
      });
    }
  }

  return {
    statuses, issues, projectUrl: project.url, repoUrl: repository.url, repoName: repository.nameWithOwner,
    refreshedAt: new Date().toISOString(), stale: false,
  };
}

export async function changeStatus(token: string, config: RepoConfig, itemId: string, statusId: string | null): Promise<void> {
  const client = new GitHubClient(token);
  const { repository, project } = await readScope(client, config, true);
  if (!project.viewerCanUpdate) throw new GitHubError("The GitHub project is read-only for this viewer", 403);
  const field = getStatusField(project);
  if (statusId !== null && !field.options.some(({ id }) => id === statusId)) {
    throw new GitHubError("Unknown option for the GitHub project Status field", 422);
  }

  const { node } = await client.graphql<{ node: (Item & { project: { id: string } }) | null }>(`
    query ScopedProjectItem($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          id isArchived project { id }
          content { __typename ... on Issue { repository { id } } }
        }
      }
    }
  `, { itemId });
  if (node?.id !== itemId || node.isArchived || node.project.id !== project.id ||
      node.content?.__typename !== "Issue" || node.content.repository.id !== repository.id) {
    throw new GitHubError("GitHub issue item is outside the configured board or unavailable", 404);
  }

  const input = { itemId, projectId: project.id, fieldId: field.id };
  const { result } = statusId === null
    ? await client.graphql<StatusMutation>(`mutation ClearBoardStatus($input: ClearProjectV2ItemFieldValueInput!) {
        result: clearProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }
      }`, { input })
    : await client.graphql<StatusMutation>(`mutation UpdateBoardStatus($input: UpdateProjectV2ItemFieldValueInput!) {
        result: updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }
      }`, { input: { ...input, value: { singleSelectOptionId: statusId } } });
  if (result?.projectV2Item?.id !== itemId) throw new GitHubError("GitHub did not confirm the status change", 502);
}

type StatusMutation = { result: { projectV2Item: { id: string } | null } | null };

export async function verifyCommit(token: string, config: RepoConfig, sha: string): Promise<{ sha: string; url: string }> {
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) throw new GitHubError("Invalid Git commit SHA", 400);
  const { sha: fullSha, html_url: url } = await new GitHubClient(token).rest<{ sha: string; html_url: string }>(
    `${repoPath(config)}/commits/${sha.toLowerCase()}`,
  );
  if (!FULL_SHA.test(fullSha) || !fullSha.toLowerCase().startsWith(sha.toLowerCase()) || !url) {
    throw new GitHubError("GitHub did not resolve the requested commit SHA", 404);
  }
  return { sha: fullSha, url };
}

type TreeEntry = { path: string; mode: string; type: string; sha: string; size?: number };
type GitTree = { truncated: boolean; tree: TreeEntry[] };

async function rootTreeSha(client: GitHubClient, repo: string, sha: string): Promise<string> {
  if (!FULL_SHA.test(sha)) throw new GitHubError("A full Git commit SHA is required", 400);
  const commit = await client.rest<{ sha: string; tree: { sha: string } }>(`${repo}/git/commits/${sha.toLowerCase()}`);
  if (commit.sha?.toLowerCase() !== sha.toLowerCase() || !FULL_SHA.test(commit.tree?.sha)) {
    throw new GitHubError("GitHub returned an invalid commit tree", 502);
  }
  return commit.tree.sha;
}

function regularFile(entry: TreeEntry): entry is TreeEntry & { size: number } {
  return entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755") &&
    typeof entry.size === "number" && Number.isSafeInteger(entry.size) && entry.size >= 0;
}

async function readGitTree(client: GitHubClient, repo: string, sha: string): Promise<TreeEntry[]> {
  if (!FULL_SHA.test(sha)) throw new GitHubError("GitHub returned an invalid tree SHA", 502);
  const { tree, truncated } = await client.rest<GitTree>(`${repo}/git/trees/${sha}`);
  if (truncated) throw new GitHubError("GitHub truncated a non-recursive tree", 502);
  return tree;
}

export async function getTree(token: string, config: RepoConfig, sha: string): Promise<{ path: string; size: number }[]> {
  const client = new GitHubClient(token);
  const repo = repoPath(config);
  const root = await rootTreeSha(client, repo, sha);
  const { tree, truncated } = await client.rest<GitTree>(`${repo}/git/trees/${root}?recursive=1`);
  if (!truncated) return tree.filter(regularFile).map(({ path, size }) => ({ path, size }));

  const files: { path: string; size: number }[] = [];
  const pending = [{ sha: root, prefix: "" }];
  while (pending.length) {
    const next = pending.pop()!;
    for (const entry of await readGitTree(client, repo, next.sha)) {
      const path = `${next.prefix}${entry.path}`;
      if (entry.type === "tree") pending.push({ sha: entry.sha, prefix: `${path}/` });
      else if (regularFile(entry)) files.push({ path, size: entry.size });
    }
  }
  return files;
}

export async function readText(token: string, config: RepoConfig, sha: string, path: string): Promise<string> {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new GitHubError("Invalid repository file path", 400);
  }
  const client = new GitHubClient(token);
  const repo = repoPath(config);
  let treeSha = await rootTreeSha(client, repo, sha);
  for (const [index, part] of parts.entries()) {
    const entry = (await readGitTree(client, repo, treeSha)).find((item) => item.path === part);
    if (!entry) throw new GitHubError("File does not exist at the requested Git commit", 404);
    if (index < parts.length - 1) {
      if (entry.type !== "tree") throw new GitHubError("Repository path does not identify a file", 404);
      treeSha = entry.sha;
      continue;
    }
    if (!regularFile(entry)) throw new GitHubError("Repository path does not identify a regular file", 415);
    if (entry.size > MAX_TEXT_BYTES) throw new GitHubError("Repository text file exceeds 256 KiB", 413);
    if (!FULL_SHA.test(entry.sha)) throw new GitHubError("GitHub returned an invalid blob SHA", 502);
    return client.textBlob(`${repo}/git/blobs/${entry.sha}`, entry.size);
  }
  throw new GitHubError("Invalid repository file path", 400);
}
