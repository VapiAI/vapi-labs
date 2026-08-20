export const CREATE_PETS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT 'VapiGotchi',
    is_personalized INTEGER NOT NULL DEFAULT 0,
    health INTEGER NOT NULL DEFAULT 35,
    meals_eaten INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    health_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export const CREATE_PET_EVENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pet_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id TEXT NOT NULL,
    type TEXT NOT NULL,
    food TEXT,
    health_gain INTEGER,
    health_after INTEGER,
    call_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
  )
`;

export const CREATE_PET_CALLS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pet_calls (
    call_id TEXT PRIMARY KEY NOT NULL,
    pet_id TEXT NOT NULL,
    status TEXT NOT NULL,
    speaker TEXT,
    started_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
  )
`;

export const CREATE_PET_EVENTS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS pet_events_pet_id_id_idx
  ON pet_events (pet_id, id)
`;

export const CREATE_PET_CALLS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS pet_calls_pet_id_status_idx
  ON pet_calls (pet_id, status)
`;
