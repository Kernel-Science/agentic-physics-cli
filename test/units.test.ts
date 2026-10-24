import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { consoleUrl, readCredentials, resolveAuth, saveCredentials } from "../src/config.js";
import { hasSorry, splitStatement, theoremName } from "../src/lean.js";
import { runReport, settle } from "../src/runs.js";
import { Api } from "../src/api.js";
import type { RunFrame } from "../src/types.js";
import { fakeConsole, tempDir } from "./helpers.js";

describe("splitStatement", () => {
  it("takes the import lines out and keeps the theorem whole", () => {
    const source = "import Mathlib\nimport Physlib\r\n\nopen Real\n\ntheorem t (x : ℝ) : x = x := by sorry\n";
    assert.deepEqual(splitStatement(source), {
      theorem: "open Real\n\ntheorem t (x : ℝ) : x = x := by sorry",
      imports: ["import Physlib"],
    });
  });

  it("splits a line naming several modules, and names each once", () => {
    assert.deepEqual(splitStatement("import A B\nimport A\ntheorem t : True := by sorry").imports, ["import A", "import B"]);
  });

  it("finds the theorem's name, and whether its body is sorry", () => {
    assert.equal(theoremName("theorem energy_nonneg (m v : ℝ) : 0 ≤ m := by sorry"), "energy_nonneg");
    assert.equal(theoremName("lemma foo.bar : True := by sorry"), "foo.bar");
    assert.equal(hasSorry("theorem t : True := by sorry"), true);
    assert.equal(hasSorry("theorem t : True := by trivial -- sorryless"), false);
  });
});

describe("consoleUrl", () => {
  it("defaults to agentic-physics.com and keeps only the origin", () => {
    assert.equal(consoleUrl({}), "https://agentic-physics.com");
    assert.equal(consoleUrl({ AGENTIC_PHYSICS_URL: "https://example.org/some/path/" }), "https://example.org");
  });

  it("sends a token over plain http only to this machine", () => {
    assert.equal(consoleUrl({ AGENTIC_PHYSICS_URL: "http://127.0.0.1:3300" }), "http://127.0.0.1:3300");
    assert.equal(consoleUrl({ AGENTIC_PHYSICS_URL: "http://localhost:3000" }), "http://localhost:3000");
    assert.throws(() => consoleUrl({ AGENTIC_PHYSICS_URL: "http://example.org" }), /https/);
    assert.throws(() => consoleUrl({ AGENTIC_PHYSICS_URL: "https://user:pw@example.org" }), /password/);
  });
});

describe("credentials", () => {
  it("are written readable by their owner only", { skip: process.platform === "win32" }, () => {
    const env = { AGENTIC_PHYSICS_CONFIG_DIR: join(tempDir(), "nested") };
    const path = saveCredentials(
      { url: "https://agentic-physics.com", token: "tok", account: { id: "u", email: "e", name: "n" }, savedAt: "now" },
      env,
    );
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readCredentials(env)?.token, "tok");
  });

  it("are never sent to a console other than the one that issued them", () => {
    const env: NodeJS.ProcessEnv = { AGENTIC_PHYSICS_CONFIG_DIR: tempDir() };
    saveCredentials({ url: "https://agentic-physics.com", token: "tok", account: { id: "u", email: "e", name: "n" }, savedAt: "now" }, env);
    assert.equal(resolveAuth(env).token, "tok");
    const elsewhere = resolveAuth({ ...env, AGENTIC_PHYSICS_URL: "https://evil.example" });
    assert.equal(elsewhere.token, null);
    assert.equal(elsewhere.storedFor, "https://agentic-physics.com");
  });

  it("give way to AGENTIC_PHYSICS_TOKEN", () => {
    const env: NodeJS.ProcessEnv = { AGENTIC_PHYSICS_CONFIG_DIR: tempDir(), AGENTIC_PHYSICS_TOKEN: " envtok " };
    saveCredentials({ url: "https://agentic-physics.com", token: "tok", account: { id: "u", email: "e", name: "n" }, savedAt: "now" }, env);
    assert.deepEqual([resolveAuth(env).token, resolveAuth(env).source], ["envtok", "env"]);
  });
});

const frame = (over: Partial<RunFrame>): RunFrame => ({ status: "running", steps: [], elapsedMs: 75_000, ...over });

describe("a run's verdict", () => {
  it("is proved only when the record says the kernel verified it", async () => {
    let verified = true;
    const server = await fakeConsole(() => ({ json: { run_id: "run_0000abcd", status: "solved", verified, proof: "theorem t : True := trivial" } }));
    try {
      const api = new Api({ url: server.url, token: "t", source: "file" });
      const solved = frame({ status: "solved", proof: "theorem t : True := trivial" });
      assert.equal((await settle(api, "run_0000abcd", solved)).outcome, "proved");
      verified = false;
      assert.equal((await settle(api, "run_0000abcd", solved)).outcome, "not_proved");
      assert.equal((await settle(api, "run_0000abcd", frame({ status: "awaiting_decision" }))).outcome, "question");
      assert.equal((await settle(api, "run_0000abcd", frame({ status: "running" }))).outcome, "running");
    } finally {
      await server.close();
    }
  });

  it("says FALSE, with the negation, when the kernel proved the negation", () => {
    const report = runReport(
      "run_0000abcd",
      frame({ status: "failed", refutation: { theorem: "theorem not_t : ¬ (1 = 2)", proof: "by decide" } }),
      "not_proved",
      undefined,
      "https://agentic-physics.com",
    ).join("\n");
    assert.match(report, /not proved after 1m 15s/);
    assert.match(report, /The statement is FALSE/);
    assert.match(report, /theorem not_t/);
  });

  it("puts the question and the three answers in front of the reader", () => {
    const report = runReport(
      "run_0000abcd",
      frame({
        status: "awaiting_decision",
        decision: {
          reason: "needs_intermediate",
          question: "Prove `0 ≤ v ^ 2` first?",
          options: [
            { id: "accept", label: "Prove it first" },
            { id: "steer", label: "Say how" },
            { id: "stop", label: "Stop" },
          ],
          question_id: "q1",
        },
      }),
      "question",
      undefined,
      "https://agentic-physics.com",
    ).join("\n");
    assert.match(report, /Prove `0 ≤ v \^ 2` first\?/);
    assert.match(report, /agentic-physics answer run_0000abcd accept/);
    assert.match(report, /agentic-physics answer run_0000abcd steer/);
  });
});
