import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertCanonicalVapiResources,
  assertLocalDevArgs,
  assertSetupFilePermissions,
  childProcessEnvironment,
  loadSetupEnvironment,
  parseDotEnv,
  redact,
  wranglerEnvironment,
} from "../scripts/setup-helpers.mjs";

test("setup environment parser supports exports and shell-style quoting", () => {
  assert.deepEqual(parseDotEnv('export CLOUDFLARE_ACCOUNT_ID="account-id"\nVAPI_API_KEY=key # note\n'), {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    VAPI_API_KEY: "key",
  });
});

test("setup credential file rejects group or world-readable permissions", async () => {
  if (process.platform === "win32") return;
  await assert.rejects(
    assertSetupFilePermissions(new URL("file:///unused"), async () => ({ mode: 0o100644 })),
    /chmod 600/,
  );
  await assert.doesNotReject(
    assertSetupFilePermissions(new URL("file:///unused"), async () => ({ mode: 0o100600 })),
  );
});

test("explicit environment wins over the setup credential file", async () => {
  const env = { VAPI_API_KEY: "exported" };
  const read = async () => "VAPI_API_KEY=file\nCLOUDFLARE_ACCOUNT_ID=account";
  await loadSetupEnvironment(env, new URL("file:///unused"), read);
  assert.equal(env.VAPI_API_KEY, "exported");
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "account");
});

test("generic child processes receive no administrative credentials", () => {
  const env = childProcessEnvironment({
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "cloudflare-secret",
    VAPI_API_KEY: "vapi-secret",
  }, { WORKER_BASE_URL: "https://orders.example.com", ORDERS_API_TOKEN: "worker-secret" });
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(env.VAPI_API_KEY, undefined);
  assert.equal(env.ORDERS_API_TOKEN, "worker-secret");
});

test("Wrangler receives Cloudflare auth but not Vapi, Worker, or unrelated secrets", () => {
  const env = wranglerEnvironment({
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "cloudflare-secret",
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    VAPI_API_KEY: "vapi-secret",
    ORDERS_API_TOKEN: "worker-secret",
    DATABASE_URL: "unrelated-secret",
  });
  assert.equal(env.CLOUDFLARE_API_TOKEN, "cloudflare-secret");
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "account-id");
  assert.equal(env.VAPI_API_KEY, undefined);
  assert.equal(env.ORDERS_API_TOKEN, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
});

test("child output redaction covers all known secrets", () => {
  assert.equal(redact("cf-secret vapi-secret worker-secret", ["cf-secret", "vapi-secret", "worker-secret"]), "[redacted] [redacted] [redacted]");
});

test("the supported development command refuses remote previews", () => {
  assert.doesNotThrow(() => assertLocalDevArgs(["--port", "8787"]));
  assert.throws(() => assertLocalDevArgs(["--remote"]), /Remote preview is disabled/);
  assert.throws(() => assertLocalDevArgs(["--remote=true"]), /Remote preview is disabled/);
});

test("Vapi read-back accepts only the canonical smoke-tested tool URLs and exact assistant tools", () => {
  const workerUrl = "https://orders.example.com";
  const expectedTools = [
    { id: "one", type: "apiRequest", name: "list", method: "GET", url: `${workerUrl}/products` },
    {
      id: "two",
      type: "apiRequest",
      name: "create",
      method: "POST",
      url: `${workerUrl}/orders`,
      parameters: [{ key: "callId", value: "{{ call.id }}" }],
    },
  ];
  const tools = expectedTools.map((tool) => ({ ...tool }));
  const assistant = { model: { toolIds: ["two", "one"] } };
  assert.doesNotThrow(() => assertCanonicalVapiResources({ workerUrl, expectedTools, tools, assistant }));
  assert.throws(
    () => assertCanonicalVapiResources({
      workerUrl,
      expectedTools,
      tools: [{ id: "one", url: "https://preview.example.com/products" }, tools[1]],
      assistant,
    }),
    /smoke-tested Worker URL/,
  );
  assert.throws(
    () => assertCanonicalVapiResources({
      workerUrl,
      expectedTools,
      tools: [tools[0], { ...tools[1], parameters: undefined }],
      assistant,
    }),
    /unexpected parameters/,
  );
});

test("provisioning cannot bypass canonical smoke before the first Vapi mutation", async () => {
  const source = await readFile(new URL("../scripts/provision.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("SMOKE_BASE_URL"), false);
  assert.ok(source.indexOf("await runSmoke(workerUrl, token)") > -1);
  assert.ok(source.indexOf("await runSmoke(workerUrl, token)") < source.indexOf("await upsert("));
});
