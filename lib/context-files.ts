import { vetFiles } from "./architecture";
import { sha256 } from "./crypto";
import { GitHubError, readText, type RepoConfig } from "./github";

export async function architectureFiles(token: string, config: RepoConfig, sha: string, paths: string[]) {
  const files: { path: string; text: string }[] = [];
  for (let offset = 0; offset < paths.length; offset += 6) {
    const batch = await Promise.all(paths.slice(offset, offset + 6).map(async (path) => {
      try {
        return { path, text: await readText(token, config, sha, path) };
      } catch (error) {
        if (error instanceof GitHubError && error.status === 415) return null;
        throw error;
      }
    }));
    for (const file of batch) if (file) files.push(file);
  }
  return vetFiles(files);
}

export function contextHash(files: { path: string; text: string }[]) {
  return sha256(JSON.stringify(files.map(({ path, text }) => [path, sha256(text)])));
}
