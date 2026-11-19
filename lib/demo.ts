import type { Blocker, Board, Issue, Person, Workspace } from "./types";

const repoUrl = "https://github.com/hackspace-demo/relay";
const commits = Array.from({ length: 8 }, (_, index) =>
  [ "a8ce2d1", "40ac168", "bb913ea", "877af27", "d11aa36", "214d2bc", "8f1c2a0", "c5bc042" ][index] + (index + 1).toString(16).repeat(33));
const head = commits[7];
const people: Person[] = [
  { login: "mira", avatarUrl: "" },
  { login: "alex", avatarUrl: "" },
  { login: "nikita", avatarUrl: "" },
  { login: "dasha", avatarUrl: "" },
];

function issue(number: number, title: string, statusId: string, assignees: Person[], blockers: Blocker[] = [], pr?: number): Issue {
  return {
    id: `issue-${number}`, itemId: `item-${number}`, number, title, url: `${repoUrl}/issues/${number}`,
    state: statusId === "done" ? "CLOSED" : "OPEN", statusId, assignees, blockers, blockersUnknown: false,
    pulls: pr ? [{ number: pr, url: `${repoUrl}/pull/${pr}`, state: statusId === "done" ? "MERGED" : "OPEN" }] : [],
  };
}

function blocker(task: Issue): Blocker {
  return { id: task.id, number: task.number, title: task.title, url: task.url, state: task.state, completed: task.state === "CLOSED" };
}

function seed(): Workspace {
  const setup = issue(6, "Подготовить окружение проекта", "done", [people[1]], [], 18);
  const api = issue(12, "Реализовать контракт API", "progress", [people[0]], [blocker(setup)], 26);
  const dataset = issue(13, "Подготовить датасет", "todo", [people[1]]);
  const design = issue(14, "Собрать макет интерфейса", "progress", [people[3]], [], 28);
  const storage = issue(16, "Подключить хранилище результатов", "todo", [people[2]], [blocker(api)]);
  const evaluation = issue(17, "Настроить оценку модели", "todo", [people[0], people[1]], [blocker(dataset), blocker(api)]);
  const ui = issue(19, "Собрать интерфейс результатов", "todo", [people[3]], [blocker(design)]);
  const release = issue(21, "Протестировать сборку целиком", "todo", [], [blocker(storage), blocker(evaluation), blocker(ui)]);
  const brief = issue(22, "Обновить инструкцию для команды", "todo", []);
  const board: Board = {
    statuses: [{ id: "todo", name: "Todo" }, { id: "progress", name: "In progress" }, { id: "done", name: "Done" }],
    issues: [setup, api, dataset, design, storage, evaluation, ui, release, brief],
    projectUrl: "https://github.com/orgs/hackspace-demo/projects/1", repoUrl, repoName: "hackspace-demo/relay",
    refreshedAt: new Date().toISOString(), stale: false,
  };
  const now = Date.now();
  return {
    demo: true, user: people[0], canWrite: true, canGenerate: true, board, defaultSha: head, job: null,
    architecture: {
      sha: head, createdAt: new Date(now - 3_600_000).toISOString(),
      graph: {
        nodes: [
          { id: "ui", label: "Веб-интерфейс", description: "Доска задач, план и результаты оценки", paths: ["README.md", "app/page.tsx"] },
          { id: "api", label: "API", description: "Обрабатывает задачи и замеры", paths: ["app/api/results/route.ts"] },
          { id: "db", label: "PostgreSQL", description: "Хранит историю тестов и общие схемы", paths: ["db/schema.sql"] },
          { id: "worker", label: "Фоновая генерация", description: "Перестраивает общую схему", paths: ["scripts/worker.ts"] },
        ],
        edges: [
          { source: "ui", target: "api", label: "JSON" }, { source: "api", target: "db", label: "Чтение и запись" },
          { source: "api", target: "worker", label: "Задание" }, { source: "worker", target: "db", label: "Схема" },
        ],
      },
    },
    results: [36, 51, 47, 64, 70, 65, 81, 86].map((score, index) => ({
      id: String(index + 1), sha: commits[index], url: `${repoUrl}/commit/${commits[index]}`, score,
      testedAt: new Date(now - (7 - index) * 14_400_000).toISOString(), author: people[index % people.length].login,
    })),
  };
}

const memory = globalThis as typeof globalThis & { hackspaceDemo?: Workspace };

export function demoWorkspace() {
  return memory.hackspaceDemo ??= seed();
}

export function demoCommit(sha: string) {
  const resolved = commits.find((commit) => commit.startsWith(sha));
  return resolved ? { sha: resolved, url: `${repoUrl}/commit/${resolved}` } : null;
}
