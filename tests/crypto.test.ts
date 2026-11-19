import assert from "node:assert/strict";
import test from "node:test";
import { randomToken, seal, sign, unseal, verify } from "../lib/crypto";

process.env.SESSION_SECRET = randomToken();

test("approval rejects modifications and malformed signatures", () => {
  const approval = { sha: "abcdef", paths: ["README.md"], session: "one" };
  const payload = sign(approval);
  assert.deepEqual(verify(payload), approval);
  assert.equal(verify(payload + "a"), null);
  assert.equal(verify(payload + ".ignored"), null);
});

test("stored GitHub tokens are authenticated and bound to a session", () => {
  const token = "ghu_example";
  const encrypted = seal(token, "session");
  assert.notEqual(encrypted, token);
  assert.equal(unseal(encrypted, "session"), token);
  assert.throws(() => unseal(encrypted, "other-session"));
});
