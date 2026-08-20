import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pets = sqliteTable("pets", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("VapiGotchi"),
  isPersonalized: integer("is_personalized", { mode: "boolean" })
    .notNull()
    .default(false),
  health: integer("health").notNull().default(35),
  mealsEaten: integer("meals_eaten").notNull().default(0),
  version: integer("version").notNull().default(1),
  healthUpdatedAt: text("health_updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const petEvents = sqliteTable(
  "pet_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    food: text("food"),
    healthGain: integer("health_gain"),
    healthAfter: integer("health_after"),
    callId: text("call_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("pet_events_pet_id_id_idx").on(table.petId, table.id)],
);

export const petCalls = sqliteTable(
  "pet_calls",
  {
    callId: text("call_id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    speaker: text("speaker"),
    startedAt: text("started_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("pet_calls_pet_id_status_idx").on(table.petId, table.status)],
);
