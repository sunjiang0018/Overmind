import { test, type TestContext } from "vite-plus/test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const { upload } = require("../../scripts/upload.cjs");

function fixture(t: TestContext, config: Record<string, string | number | undefined> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-upload-test-"));
  t.onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, "main.js");
  const configFile = path.join(directory, "screeps.json");
  fs.writeFileSync(outputFile, "exports.loop = () => 24;");
  fs.writeFileSync(path.join(directory, "fixture.wasm"), Buffer.from([0, 97, 115, 109]));
  fs.writeFileSync(path.join(directory, "ignored.txt"), "do not upload");
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      test: {
        token: "fake-token",
        protocol: "https",
        hostname: "example.invalid",
        port: 443,
        path: "/",
        branch: "main",
        ...config,
      },
    }),
  );
  return { destination: "test", outputFile, configFile };
}

interface ApiResponse {
  data?: unknown;
  status?: number;
  headers?: RequestInit["headers"];
}

function api(responses: (ApiResponse | Error)[]) {
  const calls: {
    url: string;
    method?: string;
    headers: Record<string, string>;
    body: any;
  }[] = [];
  return {
    calls,
    fetch: async (url: string | URL | Request, options: RequestInit = {}) => {
      calls.push({
        url: String(url),
        ...options,
        headers: options.headers as Record<string, string>,
        body: options.body && JSON.parse(String(options.body)),
      });
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      const next = responses.shift();
      assert.ok(next, "unexpected API request");
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next.data ?? { ok: 1 }), {
        status: next.status || 200,
        headers: next.headers,
      });
    },
  };
}

test("uploads emitted JavaScript and Wasm using token auth and the configured path", async (t) => {
  const options = fixture(t, { path: "/season/" });
  const mock = api([{ data: { ok: 1, list: [{ branch: "main" }] } }, {}]);
  const result = await upload(options, mock);
  assert.deepEqual(result, { branch: "main", moduleCount: 2 });
  assert.equal(mock.calls[0].url, "https://example.invalid/season/api/user/branches");
  assert.equal(mock.calls[0].headers["X-Token"], "fake-token");
  assert.equal(mock.calls[1].url, "https://example.invalid/season/api/user/code");
  assert.equal(mock.calls[1].method, "POST");
  assert.deepEqual(mock.calls[1].body, {
    branch: "main",
    modules: {
      main: fs.readFileSync(options.outputFile, "utf8"),
      "fixture.wasm": { binary: "AGFzbQ==" },
    },
  });
});

test("authenticates a private server and follows token rotation before creating a branch", async (t) => {
  const options = fixture(t, {
    token: undefined,
    email: "fake-user",
    password: "fake-password",
    protocol: "http",
    hostname: "private.invalid",
    port: 21025,
    branch: "new-branch",
  });
  const mock = api([
    { data: { ok: 1, token: "login-token" } },
    { data: { ok: 1, list: [] }, headers: { "x-token": "rotated-token" } },
    {},
  ]);
  await upload(options, mock);
  assert.equal(mock.calls[0].url, "http://private.invalid:21025/api/auth/signin");
  assert.deepEqual(mock.calls[0].body, { email: "fake-user", password: "fake-password" });
  assert.equal(mock.calls[0].headers["X-Token"], undefined);
  assert.equal(mock.calls[1].headers["X-Token"], "login-token");
  assert.equal(mock.calls[2].headers["X-Token"], "rotated-token");
  assert.equal(mock.calls[2].headers["X-Username"], "rotated-token");
  assert.equal(mock.calls[2].url, "http://private.invalid:21025/api/user/clone-branch");
  assert.equal(mock.calls[2].body.branch, "");
  assert.equal(mock.calls[2].body.newName, "new-branch");
  assert.ok(mock.calls[2].body.defaultModules.main);
  assert.equal(mock.calls.length, 3);
});

test("rejects missing or unknown destinations before making requests", async (t) => {
  const options = fixture(t);
  const mock = api([]);
  await assert.rejects(
    upload({ ...options, destination: undefined }, mock),
    /explicit --destination/,
  );
  await assert.rejects(
    upload({ ...options, destination: "missing" }, mock),
    /Unknown Screeps destination/,
  );
  assert.equal(mock.calls.length, 0);
});

test("rejects a missing entry file before authenticating", async (t) => {
  const options = fixture(t, { token: undefined, email: "user", password: "password" });
  fs.unlinkSync(options.outputFile);
  const mock = api([]);
  await assert.rejects(upload(options, mock), /ENOENT/);
  assert.equal(mock.calls.length, 0);
});

test("upload failures are awaited, reported without credentials, and never retried", async (t) => {
  for (const response of [
    { status: 401, data: { error: "fake-token" } },
    { data: { ok: 0, error: "fake-token" } },
    new Error("transport failure with fake-token"),
  ]) {
    const options = fixture(t);
    const mock = api([{ data: { ok: 1, list: [{ branch: "main" }] } }, response]);
    await assert.rejects(upload(options, mock), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Screeps POST user\/code:/);
      assert.equal(error.message.includes("fake-token"), false);
      return true;
    });
    assert.equal(mock.calls.length, 2);
  }
});

test("authentication rejection or missing token never proceeds to upload", async (t) => {
  for (const response of [{ status: 403 }, { data: { ok: 1 } }]) {
    const options = fixture(t, { token: undefined, email: "user", password: "password" });
    const mock = api([response]);
    await assert.rejects(upload(options, mock));
    assert.equal(mock.calls.length, 1);
  }
});

test("rejects invalid JSON and invalid branch lists without uploading", async (t) => {
  const options = fixture(t);
  await assert.rejects(
    upload(options, {
      fetch: async () => new Response("invalid json", { status: 200 }),
    }),
    /invalid JSON/,
  );
  const mock = api([{ data: { ok: 1, list: null } }]);
  await assert.rejects(upload(options, mock), /invalid branch list/);
  assert.equal(mock.calls.length, 1);
});

test("upload CLI fails for an unknown destination without exposing config or making a request", (t) => {
  const options = fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/upload.cjs",
      "--destination",
      "missing",
      "--config",
      options.configFile,
      "--output",
      options.outputFile,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown Screeps destination/);
  assert.equal(result.stderr.includes("fake-token"), false);
});
