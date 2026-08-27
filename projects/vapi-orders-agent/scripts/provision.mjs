import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { assistantPayload, credentialPayload, toolPayloads } from "../vapi/config.mjs";
import {
  assertCanonicalVapiResources,
  assertSetupFilePermissions,
  childProcessEnvironment,
  loadSetupEnvironment,
  manualWranglerConfig,
  redact,
  wranglerEnvironment,
} from "./setup-helpers.mjs";

await loadSetupEnvironment();
await assertSetupFilePermissions();

const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "VAPI_API_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

const root = new URL("../", import.meta.url);
const stateDir = new URL("../.state/", import.meta.url);
// Generated with the account-specific D1 binding; the tracked wrangler.json stays unmodified.
const remoteConfig = "wrangler.remote.json";
await mkdir(stateDir, { recursive: true });

const token = await ordersToken();
if (token.length < 32) throw new Error("ORDERS_API_TOKEN must contain at least 32 characters.");

console.log("Discovering or creating the Cloudflare D1 database...");
const database = await ensureD1();
await configureD1(database);
runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", remoteConfig]);

console.log("Deploying the Cloudflare Worker...");
const deployOutput = runWrangler(["deploy", "--config", remoteConfig]);
runWrangler(["secret", "put", "ORDERS_API_TOKEN", "--config", remoteConfig], token + "\n");

const workerUrl = await resolveWorkerUrl(deployOutput);
await runSmoke(workerUrl, token);

console.log("Creating or updating Vapi resources...");
const previous = await readJson(new URL("resources.json", stateDir), {});
const credential = await upsert(
  "credential",
  previous.credentialId,
  credentialPayload(token),
  (item) => item.provider === "custom-credential" && item.name === "Acme Orders Worker Auth",
);

const toolIds = {};
const expectedTools = [];
for (const payload of toolPayloads(workerUrl, credential.id)) {
  const tool = await upsert(
    "tool",
    previous.toolIds?.[payload.name],
    payload,
    (item) => item.type === "apiRequest" && item.name === payload.name,
  );
  toolIds[payload.name] = tool.id;
  expectedTools.push({ ...payload, id: tool.id });
}

const prompt = await readFile(new URL("../vapi/assistant-prompt.md", import.meta.url), "utf8");
const assistant = await upsert(
  "assistant",
  previous.assistantId,
  assistantPayload(Object.values(toolIds), prompt),
  (item) => item.name === "Acme Market Orders",
);

console.log("Verifying persisted Vapi tool URLs and assistant attachments...");
const [verifiedTools, verifiedAssistant] = await Promise.all([
  Promise.all(expectedTools.map((tool) => vapi(`/tool/${tool.id}`, "GET"))),
  vapi(`/assistant/${assistant.id}`, "GET"),
]);
assertCanonicalVapiResources({
  workerUrl,
  expectedTools,
  tools: verifiedTools,
  assistant: verifiedAssistant,
});

const assistantUrl = `https://dashboard.vapi.ai/assistants/${assistant.id}`;
const state = { workerUrl, credentialId: credential.id, toolIds, assistantId: assistant.id, assistantUrl };
await writeFile(new URL("resources.json", stateDir), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });

console.log("Production verification complete. Voice assistant is ready.");
console.log(`Worker:           ${workerUrl}`);
console.log(`Assistant ID:     ${assistant.id}`);
console.log(`Voice test:       ${assistantUrl}`);
console.log("Open the voice test link and select Talk to Assistant.");

async function ordersToken() {
  if (process.env.ORDERS_API_TOKEN) {
    await saveToken(process.env.ORDERS_API_TOKEN);
    return process.env.ORDERS_API_TOKEN;
  }
  try {
    return (await readFile(new URL("orders-api-token", stateDir), "utf8")).trim();
  } catch {
    const generated = randomBytes(32).toString("base64url");
    await saveToken(generated);
    return generated;
  }
}

async function saveToken(value) {
  await writeFile(new URL("orders-api-token", stateDir), value + "\n", { mode: 0o600 });
}

function runWrangler(args, input) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: root,
    env: wranglerEnvironment(),
    input,
    encoding: "utf8",
    // Node 20.12+ refuses to spawn .cmd files without a shell.
    shell: process.platform === "win32",
  });
  const safeStdout = redactKnownSecrets(result.stdout);
  const safeStderr = redactKnownSecrets(result.stderr);
  if (safeStdout) process.stdout.write(safeStdout);
  if (safeStderr) process.stderr.write(safeStderr);
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed.`);
  return `${safeStdout}\n${safeStderr}`;
}

async function resolveWorkerUrl(output) {
  if (process.env.WORKER_BASE_URL) return process.env.WORKER_BASE_URL.replace(/\/$/, "");
  const deployed = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (deployed) return deployed.replace(/\/$/, "");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } },
  );
  const body = await response.json();
  if (!response.ok || !body.result?.subdomain) {
    throw new Error("Could not determine the workers.dev URL. Set WORKER_BASE_URL and rerun setup.");
  }
  return `https://vapi-orders-agent.${body.result.subdomain}.workers.dev`;
}

async function ensureD1() {
  const databaseName = "vapi-orders-agent-db";
  const listed = await cloudflare(`/d1/database?name=${encodeURIComponent(databaseName)}`);
  const existing = listed.result?.find((database) => database.name === databaseName);
  if (existing?.uuid) return { name: databaseName, uuid: existing.uuid };

  const created = await cloudflare("/d1/database", "POST", { name: databaseName });
  if (!created.result?.uuid) throw new Error("Cloudflare created D1 without returning its UUID.");
  return { name: databaseName, uuid: created.result.uuid };
}

async function configureD1(database) {
  const config = JSON.parse(await readFile(new URL("../wrangler.json", import.meta.url), "utf8"));
  const remote = manualWranglerConfig(config, database);
  await writeFile(new URL(`../${remoteConfig}`, import.meta.url), JSON.stringify(remote, null, 2) + "\n");
}

async function cloudflare(path, method = "GET", body) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const parsed = await response.json();
  if (!response.ok || parsed.success === false) {
    throw new Error(`Cloudflare ${method} ${path} returned ${response.status}.`);
  }
  return parsed;
}

async function runSmoke(workerUrl, secret) {
  const command = process.execPath;
  const result = spawnSync(command, ["scripts/smoke.mjs"], {
    cwd: root,
    env: childProcessEnvironment(process.env, { WORKER_BASE_URL: workerUrl, ORDERS_API_TOKEN: secret }),
    encoding: "utf8",
  });
  const safeStdout = redactKnownSecrets(result.stdout);
  const safeStderr = redactKnownSecrets(result.stderr);
  if (safeStdout) process.stdout.write(safeStdout);
  if (safeStderr) process.stderr.write(safeStderr);
  if (result.status !== 0) throw new Error("Worker smoke test failed; Vapi resources were not changed.");
}

async function upsert(kind, knownId, payload, matches) {
  let id = knownId;
  if (id) {
    const existing = await vapi(`/${kind}/${id}`, "GET").catch((error) => {
      if (error.status === 404) return null;
      throw error;
    });
    if (!existing) id = undefined;
  }
  if (!id) {
    const items = await vapi(`/${kind}`, "GET");
    id = items.find(matches)?.id;
  }
  return id ? vapi(`/${kind}/${id}`, "PATCH", payload) : vapi(`/${kind}`, "POST", payload);
}

async function vapi(path, method, body) {
  const response = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    if (response.ok) throw new Error(`Vapi ${method} ${path} returned invalid JSON.`);
  }
  if (!response.ok) {
    const safe = redactKnownSecrets(text);
    const error = new Error(`Vapi ${method} ${path} returned ${response.status}: ${safe}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

function redactKnownSecrets(value) {
  return redact(value, [process.env.CLOUDFLARE_API_TOKEN, process.env.VAPI_API_KEY, token]);
}

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
}
