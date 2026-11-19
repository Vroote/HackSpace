import assert from "node:assert/strict";
import test from "node:test";
import { generateArchitecture, selectPaths, vetFiles } from "../lib/architecture";

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
  const graph = { nodes: [{ id: "app", label: "App", description: "Reads tasks", paths: ["README.md"] }], edges: [] };
  let responseGraph = graph;
  const mocked = testContext.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).host, "api.deepseek.com");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(JSON.parse(body.messages.at(-1).content), files);
    assert.equal(body.tool_choice.function.name, "render_architecture");
    return Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant",
      tool_calls: [{ type: "function", function: { name: "render_architecture", arguments: JSON.stringify(responseGraph) } }],
    } }] });
  });
  assert.deepEqual(await generateArchitecture(files, options), graph);
  responseGraph = { ...graph, nodes: [{ ...graph.nodes[0], paths: [".env"] }] };
  await assert.rejects(generateArchitecture(files, options), /invalid architecture graph/);
  await assert.rejects(generateArchitecture([{ path: ".env", text: "secret" }], options), /failed validation/);
  assert.equal(mocked.mock.callCount(), 2);
});
