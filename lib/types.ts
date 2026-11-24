export type Status = { id: string; name: string };
export type Person = { login: string; avatarUrl: string };
export type PullLink = { number: number; url: string; state: "DRAFT" | "OPEN" | "READY" | "MERGED" | "CLOSED" };
export type PullRequest = PullLink & {
  title: string;
  author: (Person & { url: string }) | null;
  headRefName: string;
  baseRefName: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviewRequestedAt?: string;
  updatedAt: string;
};
export type PullRequestPage = { pulls: PullRequest[]; totalCount: number; nextCursor: string | null };
export type Blocker = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  completed: boolean;
};
export type Issue = {
  id: string;
  itemId: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  statusId: string | null;
  assignees: Person[];
  blockers: Blocker[];
  blockersUnknown: boolean;
  pulls: PullLink[];
};
export type Board = {
  statuses: Status[];
  issues: Issue[];
  projectUrl: string;
  repoUrl: string;
  repoName: string;
  refreshedAt: string;
  stale: boolean;
};
export type ArchitectureGraph = {
  nodes: { id: string; label: string; description: string; paths: string[] }[];
  edges: { source: string; target: string; label: string }[];
};
export const ARCHITECTURE_COMMENT_LIMIT = 1000;
export type ArchitectureSnapshot = { sha: string; graph: ArchitectureGraph; createdAt: string };
export type Job = { status: "pending" | "running" | "complete" | "failed"; error: string | null };
export type DemoBuild = { resultId: string; standUrl: string; reason: string };
export type Result = { suite?: string | null; version?: string | null; id: string; sha: string; url: string; testedAt: string; score: number; author: string };
export type Workspace = {
  demo: boolean;
  user: Person;
  canWrite: boolean;
  canGenerate: boolean;
  board: Board;
  defaultSha: string | null;
  architecture: ArchitectureSnapshot | null;
  job: Job | null;
  demoBuild: DemoBuild | null;
  results: Result[];
};
