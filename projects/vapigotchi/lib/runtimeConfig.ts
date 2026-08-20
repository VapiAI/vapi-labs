import { env } from "cloudflare:workers";
import type { RuntimeBindings } from "./types";

function bindings(): RuntimeBindings {
  return env as unknown as RuntimeBindings;
}

function adminApiKey(): string | undefined {
  return bindings().ADMIN_API_KEY;
}

export const runtimeConfig = { adminApiKey };
