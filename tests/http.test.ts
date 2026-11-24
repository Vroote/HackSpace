import assert from "node:assert/strict";
import test from "node:test";
import { demoBuildInput, measurement, requestBody, statusChange } from "../lib/http";

const sample = { sha: " abCdef0 ", testedAt: "2025-07-02T21:00:00Z", score: 0 };

test("measurement validates SHA, precise timestamps, and the full score range", () => {
  assert.deepEqual(measurement(sample), { sha: "abcdef0", testedAt: "2025-07-02T21:00:00.000Z", score: 0 });
  assert.equal(measurement({ ...sample, score: 100 }).score, 100);
  for (const invalid of [
    { sha: "main" }, { testedAt: "2025-02-30T21:00:00Z" }, { score: -1 }, { score: 100.1 }, { score: "100" },
  ]) assert.throws(() => measurement({ ...sample, ...invalid }), { status: 422 });
});

test("status updates must specify a column or explicit null", () => {
  assert.equal(statusChange({ itemId: "PVTI_123", statusId: null }).statusId, null);
  assert.equal(statusChange({ itemId: "PVTI_123", statusId: "abcd" }).itemId, "PVTI_123");
  assert.throws(() => statusChange({ itemId: "PVTI_123" }), { status: 422 });
});

test("request parsing rejects unsupported types, invalid JSON, and oversized bodies", async () => {
  function request(body: string, type = "application/json") {
    return new Request("https://localhost/", { method: "POST", body, headers: { "content-type": type } });
  }
  await assert.rejects(requestBody(request("{}", "text/plain")), { status: 415 });
  await assert.rejects(requestBody(request("[")), { status: 400 });
  await assert.rejects(requestBody(request(JSON.stringify("a".repeat(32_769)))), { status: 413 });
});

test("measurements keep suite and version together and demo links accept HTTP(S)", () => {
  assert.equal(measurement({ ...sample, suite: " validation ", version: "v2" }).suite, "validation");
  assert.throws(() => measurement({ ...sample, suite: "validation" }), { status: 422 });
  assert.throws(() => demoBuildInput({ resultId: "1", standUrl: "javascript:alert(1)" }), { status: 422 });
  assert.deepEqual(demoBuildInput({ resultId: "1", standUrl: "https://demo.example" }), {
    resultId: "1", reason: "", standUrl: "https://demo.example",
  });
});
