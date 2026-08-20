import { env } from "cloudflare:workers";
import {
  CREATE_PET_CALLS_INDEX_SQL,
  CREATE_PET_CALLS_TABLE_SQL,
  CREATE_PET_EVENTS_INDEX_SQL,
  CREATE_PET_EVENTS_TABLE_SQL,
  CREATE_PETS_TABLE_SQL,
} from "./schemaSql";
import type { RuntimeBindings } from "@/lib/types";

let schemaInitialization: Promise<void> | undefined;

export function getDatabase(): D1Database {
  const database = (env as unknown as RuntimeBindings).DB;
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let the hosting platform inject the binding before using the database.",
    );
  }

  return database;
}

export async function ensureDatabaseSchema(): Promise<D1Database> {
  const database = getDatabase();

  schemaInitialization ??= database
    .batch([
      database.prepare(CREATE_PETS_TABLE_SQL),
      database.prepare(CREATE_PET_EVENTS_TABLE_SQL),
      database.prepare(CREATE_PET_CALLS_TABLE_SQL),
      database.prepare(CREATE_PET_EVENTS_INDEX_SQL),
      database.prepare(CREATE_PET_CALLS_INDEX_SQL),
    ])
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaInitialization = undefined;
      throw error;
    });

  await schemaInitialization;
  return database;
}
