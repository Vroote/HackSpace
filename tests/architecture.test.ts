import assert from "node:assert/strict";
import test from "node:test";
import { generateArchitecture, normalizeArchitectureComment, selectPaths, vetFiles } from "../lib/architecture";
import { ARCHITECTURE_COMMENT_LIMIT } from "../lib/types";

test("architecture comments are optional, bounded, and checked for secrets", () => {
  assert.equal(normalizeArchitectureComment(undefined), "");
  assert.equal(normalizeArchitectureComment("  Покажи поток данных\nи воркер  "), "Покажи поток данных\nи воркер");
  assert.throws(() => normalizeArchitectureComment(".".repeat(ARCHITECTURE_COMMENT_LIMIT + 1)), /не длиннее/);
  assert.throws(() => normalizeArchitectureComment(42), /не длиннее/);
  assert.throws(() => normalizeArchitectureComment('apiKey = "example-value"'), /секреты/);
  assert.throws(() => normalizeArchitectureComment("before\u0000after"), /недопустимые/);
});

test("context selection excludes sensitive, large, and duplicated files", () => {
  const paths = selectPaths([
    { path: "src/server.ts", size: 200 }, { path: "README.md", size: 200 }, { path: "package.json", size: 200 },
    { path: ".env", size: 40 }, { path: "src/credentials.ts", size: 200 }, { path: "src/main.ts", size: 1_000_000 },
    { path: "README.md", size: 200 },
  ]);
  assert.deepEqual(paths, ["package.json", "src/server.ts"]);
  assert.deepEqual(vetFiles([
    { path: "README.md", text: "This is public architecture documentation." },
    { path: "src/index.ts", text: 'const apiKey = "nonempty-test-value";' },
    { path: "package.json", text: "\u0000binary" },
  ]), [{ path: "README.md", text: "This is public architecture documentation." }]);
});

test("generation accepts only one valid tool call citing approved source paths", async (testContext) => {
  const files = [{ path: "README.md", text: "This app reads tasks." }];
  const options = { apiKey: "dummy", model: "" };
  const comment = "Покажи компоненты обработки задач";
  const graph = { nodes: [{ id: "app", label: "App", description: "Reads tasks", paths: ["README.md"] }], edges: [] };
  let responseGraph = graph;
  let expectsComment = false;
  const mocked = testContext.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).host, "api.deepseek.com");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(JSON.parse(body.messages.at(-1).content), files);
    assert.equal(body.messages.length, expectsComment ? 3 : 2);
    if (expectsComment) assert.deepEqual(JSON.parse(body.messages[1].content), { architectureComment: comment });
    assert.equal(body.tool_choice.function.name, "render_architecture");
    return Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant",
      tool_calls: [{ type: "function", function: { name: "render_architecture", arguments: JSON.stringify(responseGraph) } }],
    } }] });
  });
  assert.deepEqual(await generateArchitecture(files, options), graph);
  expectsComment = true;
  const withComment = { ...options, comment: `  ${comment}  ` };
  assert.deepEqual(await generateArchitecture(files, withComment), graph);
  responseGraph = { ...graph, nodes: [{ ...graph.nodes[0], paths: [".env"] }] };
  await assert.rejects(generateArchitecture(files, withComment), /invalid architecture graph/);
  await assert.rejects(generateArchitecture([{ path: ".env", text: "secret" }], options), /failed validation/);
  await assert.rejects(generateArchitecture(files, { ...options, comment: 'apiKey = "example-value"' }), /секреты/);
  assert.equal(mocked.mock.callCount(), 3);
});
