import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

export const setupVariableNames = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "VAPI_API_KEY",
  "ORDERS_API_TOKEN",
  "WORKER_BASE_URL",
];

const wranglerPassThroughNames = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

/** Load setup-only credentials without exposing arbitrary file entries to the process. */
export async function loadSetupEnvironment(
  env = process.env,
  fileUrl = new URL("../.setup.env", import.meta.url),
  read = readFile,
) {
  let parsed = {};
  try {
    parsed = parseDotEnv(await read(fileUrl, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  for (const name of setupVariableNames) {
    if (!env[name] && parsed[name]) env[name] = parsed[name];
  }
  return env;
}

export async function assertSetupFilePermissions(
  fileUrl = new URL("../.setup.env", import.meta.url),
  inspect = stat,
) {
  if (process.platform === "win32") return;
  try {
    const info = await inspect(fileUrl);
    if ((info.mode & 0o077) !== 0) {
      throw new Error(".setup.env must not be accessible by group or other users; run chmod 600 .setup.env.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function parseDotEnv(contents) {
  const values = {};
  for (const originalLine of contents.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error("Invalid entry in .setup.env; expected NAME=value.");

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

/** Build the smallest practical Wrangler environment and explicitly disable .env fallback. */
export function wranglerEnvironment(env = process.env) {
  const childEnv = childProcessEnvironment(env);
  childEnv.CI = "true";
  childEnv.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  childEnv.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN;
  childEnv.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
  return childEnv;
}

export function childProcessEnvironment(env = process.env, extra = {}) {
  const childEnv = {};
  for (const name of wranglerPassThroughNames) {
    if (env[name] !== undefined) childEnv[name] = env[name];
  }
  return { ...childEnv, ...extra };
}

export function redact(value, secrets = []) {
  let safe = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

export function assertLocalDevArgs(args) {
  if (args.some((arg) => arg === "--remote" || arg.startsWith("--remote="))) {
    throw new Error("Remote preview is disabled for this project; use local npm run dev and the canonical deploy/smoke workflow.");
  }
}

/** Build Path A's account-specific config without Path B's pre-deploy secret gate. */
export function manualWranglerConfig(config, database) {
  const { secrets: _deployButtonSecretRequirements, ...manualConfig } = config;
  return {
    ...manualConfig,
    d1_databases: [{
      binding: "DB",
      database_name: database.name,
      database_id: database.uuid,
      migrations_dir: "migrations",
    }],
  };
}

/** Prove that the resources Vapi persisted use only the smoke-tested canonical backend. */
export function assertCanonicalVapiResources({ workerUrl, expectedTools, tools, assistant }) {
  const canonical = workerUrl.replace(/\/$/, "");
  const expectedById = new Map(expectedTools.map((tool) => [tool.id, tool]));
  if (expectedById.size !== expectedTools.length) throw new Error("Vapi verification failed: duplicate tool IDs.");

  const returnedIds = new Set(tools.map((tool) => tool.id));
  if (tools.length !== expectedTools.length || returnedIds.size !== expectedTools.length) {
    throw new Error("Vapi verification failed: tool read-back was incomplete or duplicated.");
  }

  for (const tool of tools) {
    const expected = expectedById.get(tool.id);
    if (!expected) throw new Error(`Vapi verification failed: unexpected tool ${tool.id}.`);
    if (tool.url !== expected.url || !tool.url.startsWith(`${canonical}/`)) {
      throw new Error(`Vapi verification failed: ${tool.name ?? tool.id} does not use the smoke-tested Worker URL.`);
    }
    for (const field of [
      "type",
      "name",
      "description",
      "method",
      "credentialId",
      "timeoutSeconds",
      "backoffPlan",
      "headers",
      "body",
      "parameters",
    ]) {
      if (!isDeepStrictEqual(tool[field], expected[field])) {
        throw new Error(`Vapi verification failed: ${tool.name ?? tool.id} persisted an unexpected ${field}.`);
      }
    }
  }

  const assistantToolIds = assistant?.model?.toolIds;
  if (!Array.isArray(assistantToolIds)) {
    throw new Error("Vapi verification failed: assistant tool IDs were not returned.");
  }
  const actualIds = [...assistantToolIds].sort();
  const expectedIds = [...expectedById.keys()].sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error("Vapi verification failed: assistant is not attached to exactly the verified tools.");
  }
}
