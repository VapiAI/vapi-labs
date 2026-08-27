import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { manualWranglerConfig } from "../scripts/setup-helpers.mjs";

const root = new URL("../", import.meta.url);
const administrativeCredentials = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "VAPI_API_KEY",
];

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Workers Builds deploy is Cloudflare-only and migrates D1 by binding before deploy", async () => {
  const pkg = JSON.parse(await text("package.json"));

  assert.equal(pkg.scripts["db:migrate:remote"], "wrangler d1 migrations apply DB --remote");
  assert.equal(pkg.scripts.deploy, "npm run db:migrate:remote && wrangler deploy");
  assert.equal(pkg.scripts.deploy.includes("setup"), false);
  assert.equal(pkg.scripts.deploy.includes("provision"), false);
  assert.equal(pkg.scripts.setup, "node scripts/provision.mjs");
  assert.deepEqual(Object.keys(pkg.cloudflare.bindings).sort(), ["DB", "ORDERS_API_TOKEN"]);
  for (const credential of administrativeCredentials) {
    assert.equal(pkg.scripts.deploy.includes(credential), false);
    assert.equal(Object.hasOwn(pkg.cloudflare.bindings, credential), false);
  }
});

test("tracked Wrangler config is an auto-provisionable D1 draft with one runtime secret", async () => {
  const config = JSON.parse(await text("wrangler.json"));

  assert.deepEqual(config.secrets, { required: ["ORDERS_API_TOKEN"] });
  assert.equal(config.vars, undefined);
  assert.deepEqual(config.d1_databases, [{
    binding: "DB",
    database_name: "vapi-orders-agent-db",
    migrations_dir: "migrations",
  }]);
  assert.equal(config.d1_databases[0].database_id, undefined);

  const serialized = JSON.stringify(config);
  for (const credential of administrativeCredentials) {
    assert.equal(serialized.includes(credential), false);
  }
});

test("manual setup config removes the Path B required-secret gate before initial deploy", async () => {
  const tracked = JSON.parse(await text("wrangler.json"));
  const remote = manualWranglerConfig(tracked, {
    name: "account-orders-db",
    uuid: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(remote.secrets, undefined);
  assert.deepEqual(remote.d1_databases, [{
    binding: "DB",
    database_name: "account-orders-db",
    database_id: "00000000-0000-4000-8000-000000000001",
    migrations_dir: "migrations",
  }]);
  assert.deepEqual(tracked.secrets, { required: ["ORDERS_API_TOKEN"] });
  assert.equal(tracked.d1_databases[0].database_id, undefined);
});

test("Deploy to Cloudflare secret declaration exposes only the Worker bearer secret", async () => {
  const example = await text(".dev.vars.example");
  const deprecatedEnvExample = await text(".env.example");
  const declared = example
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=", 1)[0]);

  assert.deepEqual(declared, ["ORDERS_API_TOKEN"]);
  assert.doesNotMatch(deprecatedEnvExample, /^[A-Za-z_][A-Za-z0-9_]*=/m);
  for (const credential of administrativeCredentials) {
    assert.equal(declared.includes(credential), false);
  }
});

test("operator docs route agents and users through exactly one workflow", async () => {
  const readme = await text("README.md");
  const agents = await text("AGENTS.md");

  assert.match(readme, /Choose one installation workflow/);
  assert.match(readme, /Deploy to Cloudflare \(secondary, backend only\)/);
  assert.match(readme, /does \*\*not\*\* create a Vapi custom credential/);
  assert.match(readme, /removes the tracked `secrets.required` gate/);
  assert.match(readme, /\[!\[Deploy to Cloudflare\].*https:\/\/github\.com\/VapiAI\/vapi-labs\/tree\/main\/projects\/vapi-orders-agent/);
  assert.doesNotMatch(readme, /OWNER\/REPOSITORY/);
  assert.match(agents, /Workflow routing: choose exactly one/);
  assert.match(agents, /Never run `npm run setup` inside Workers Builds/);
  assert.match(agents, /It is not voice-assistant readiness/);
  assert.match(agents, /omit the tracked `secrets.required` gate/);
});

test("manual full setup remains credential-driven and separate", async () => {
  const setup = await text("scripts/provision.mjs");
  const setupExample = await text(".setup.env.example");

  for (const credential of administrativeCredentials) {
    assert.match(setup, new RegExp(credential));
    assert.match(setupExample, new RegExp(`^${credential}=`, "m"));
  }
  assert.match(setup, /await runSmoke\(workerUrl, token\)/);
  assert.match(setup, /await upsert\(/);
});

test("local development remains behind the wrapper that rejects remote preview", async () => {
  const pkg = JSON.parse(await text("package.json"));
  const dev = await text("scripts/dev.mjs");

  assert.equal(pkg.scripts.dev, "node scripts/dev.mjs");
  assert.match(dev, /assertLocalDevArgs\(args\)/);
  assert.doesNotMatch(pkg.scripts.dev, /wrangler\s+dev/);
});
