import { spawnSync } from "node:child_process";
import { assertLocalDevArgs, childProcessEnvironment } from "./setup-helpers.mjs";

const args = process.argv.slice(2);
assertLocalDevArgs(args);

const result = spawnSync("npx", ["wrangler", "dev", ...args], {
  cwd: new URL("../", import.meta.url),
  env: childProcessEnvironment(process.env, {
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  }),
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
