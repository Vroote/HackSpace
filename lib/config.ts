import type { RepoConfig } from "./github";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function appOrigin() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_URL must be an HTTPS origin or a loopback HTTP origin");
  }
  return url.origin;
}

export function demoMode() {
  const enabled = process.env.HACKSPACE_DEMO === "1";
  if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(appOrigin()).hostname)) {
    throw new Error("Demo must be configured with a loopback origin");
  }
  return enabled;
}

export function repoConfig(): RepoConfig {
  const owner = process.env.GITHUB_OWNER || "";
  const repo = process.env.GITHUB_REPO || "";
  const project = Number(process.env.GITHUB_PROJECT_NUMBER);
  if (!/^[\w-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || repo === "." || repo === ".." || !Number.isSafeInteger(project) || project < 1) {
    throw new Error("GitHub workspace is not configured");
  }
  return { owner, repo, project };
}

export function workspaceKey(config: RepoConfig) {
  return `${config.owner.toLowerCase()}/${config.repo.toLowerCase()}:${config.project}`;
}

export function privateGenerationAllowed() {
  return process.env.ALLOW_PRIVATE_DEEPSEEK === "1";
}

export function oauthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub App OAuth is not configured");
  return { clientId, clientSecret, redirectUri: `${appOrigin()}/api/auth/callback` };
}
