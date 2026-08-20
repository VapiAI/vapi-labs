import type {
  CallStatus,
  CallSummaryRow,
  CarePetInput,
  FeedPetInput,
  LatestEventRow,
  LiveCallSummary,
  LivePetPayload,
  PetCareEvent,
  PetEvent,
  PetEventBase,
  PetEventRow,
  PetRow,
  PetState,
  SpeakerRole,
} from "./types";

import { ensureDatabaseSchema } from "@/db";
import {
  CARE_ACTION_EVENT_TYPE,
  CARE_ACTION_HEALTH_GAIN,
  HEALTH_DECAY_INTERVAL_SECONDS,
  HEALTH_GAIN_PER_MEAL,
  INITIAL_HEALTH,
  MAX_HEALTH,
  STALE_CALL_INTERVAL_SECONDS,
} from "./constants";
import { petState } from "./petState";

const PET_SELECT_SQL = `
  SELECT id, name, health, meals_eaten, version, health_updated_at, updated_at
  FROM pets
  WHERE id = ?
`;

function petRowToState(row: PetRow, now: Date): PetState {
  const health = petState.calculateEffectiveHealth(
    row.health,
    row.health_updated_at,
    now,
  );
  return {
    id: row.id,
    name: row.name,
    health,
    mood: petState.getPetMood(health),
    mealsEaten: row.meals_eaten,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function eventRowToEvent(row: PetEventRow): PetEvent | undefined {
  if (row.health_gain === null || row.health_after === null) {
    return undefined;
  }

  const eventBase: PetEventBase = {
    id: row.id,
    healthGain: row.health_gain,
    healthAfter: row.health_after,
    callId: row.call_id,
    createdAt: row.created_at,
  };

  if (row.type === "pet.fed" && petState.isFoodType(row.food)) {
    return { ...eventBase, type: "pet.fed", food: row.food };
  }

  if (row.type === "pet.danced") {
    return { ...eventBase, type: "pet.danced", action: "dance-salsa" };
  }

  if (row.type === "pet.showered") {
    return { ...eventBase, type: "pet.showered", action: "shower" };
  }

  if (row.type === "pet.napped") {
    return { ...eventBase, type: "pet.napped", action: "nap" };
  }

  return undefined;
}

async function getOrCreate(
  petId: string,
  assistantName?: string,
  now: Date = new Date(),
): Promise<PetState> {
  const database = await ensureDatabaseSchema();
  const timestamp = now.toISOString();

  await database
    .prepare(
      `
        INSERT INTO pets (
          id, name, is_personalized, health, meals_eaten, version,
          health_updated_at, created_at, updated_at
        )
        VALUES (?, 'VapiGotchi', 0, ?, 0, 1, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `,
    )
    .bind(petId, INITIAL_HEALTH, timestamp, timestamp, timestamp)
    .run();

  const normalizedName = petState.normalizeAssistantName(assistantName);
  if (normalizedName) {
    await database
      .prepare(
        `
          UPDATE pets
          SET name = ?, is_personalized = 1, updated_at = ?, version = version + 1
          WHERE id = ? AND is_personalized = 0
        `,
      )
      .bind(normalizedName, timestamp, petId)
      .run();
  }

  const row = await database.prepare(PET_SELECT_SQL).bind(petId).first<PetRow>();
  if (!row) {
    throw new Error("The pet could not be created.");
  }

  return petRowToState(row, now);
}

async function feed(
  petId: string,
  input: FeedPetInput,
  now: Date = new Date(),
): Promise<{ pet: PetState; event: PetEvent }> {
  await getOrCreate(petId, input.assistantName, now);
  const database = await ensureDatabaseSchema();
  const timestamp = now.toISOString();

  const [updateResult, eventResult] = await database.batch([
    database
      .prepare(
        `
          UPDATE pets
          SET
            health = MIN(
              ?,
              MAX(
                0,
                health - CAST(
                  MAX(0, unixepoch(?) - unixepoch(health_updated_at)) / ?
                  AS INTEGER
                )
              ) + ?
            ),
            meals_eaten = meals_eaten + 1,
            version = version + 1,
            health_updated_at = ?,
            updated_at = ?
          WHERE id = ?
          RETURNING health
        `,
      )
      .bind(
        MAX_HEALTH,
        timestamp,
        HEALTH_DECAY_INTERVAL_SECONDS,
        HEALTH_GAIN_PER_MEAL,
        timestamp,
        timestamp,
        petId,
      ),
    database
      .prepare(
        `
          INSERT INTO pet_events (
            pet_id, type, food, health_gain, health_after, call_id, created_at
          )
          SELECT ?, 'pet.fed', ?, ?, health, ?, ?
          FROM pets
          WHERE id = ?
          RETURNING id, type, food, health_gain, health_after, call_id, created_at
        `,
      )
      .bind(
        petId,
        input.food,
        HEALTH_GAIN_PER_MEAL,
        input.callId ?? null,
        timestamp,
        petId,
      ),
  ]);

  if (!updateResult.success) {
    throw new Error("The pet health update failed.");
  }

  const eventRow = eventResult.results[0] as PetEventRow | undefined;
  const event = eventRow ? eventRowToEvent(eventRow) : undefined;
  if (!event) {
    throw new Error("The feeding event could not be recorded.");
  }

  const pet = await getOrCreate(petId, undefined, now);
  return { pet, event };
}

async function care(
  petId: string,
  input: CarePetInput,
  now: Date = new Date(),
): Promise<{ pet: PetState; event: PetCareEvent }> {
  await getOrCreate(petId, input.assistantName, now);
  const database = await ensureDatabaseSchema();
  const timestamp = now.toISOString();
  const healthGain = CARE_ACTION_HEALTH_GAIN[input.action];
  const eventType = CARE_ACTION_EVENT_TYPE[input.action];

  const [updateResult, eventResult] = await database.batch([
    database
      .prepare(
        `
          UPDATE pets
          SET
            health = MIN(
              ?,
              MAX(
                0,
                health - CAST(
                  MAX(0, unixepoch(?) - unixepoch(health_updated_at)) / ?
                  AS INTEGER
                )
              ) + ?
            ),
            version = version + 1,
            health_updated_at = ?,
            updated_at = ?
          WHERE id = ?
          RETURNING health
        `,
      )
      .bind(
        MAX_HEALTH,
        timestamp,
        HEALTH_DECAY_INTERVAL_SECONDS,
        healthGain,
        timestamp,
        timestamp,
        petId,
      ),
    database
      .prepare(
        `
          INSERT INTO pet_events (
            pet_id, type, food, health_gain, health_after, call_id, created_at
          )
          SELECT ?, ?, NULL, ?, health, ?, ?
          FROM pets
          WHERE id = ?
          RETURNING id, type, food, health_gain, health_after, call_id, created_at
        `,
      )
      .bind(
        petId,
        eventType,
        healthGain,
        input.callId ?? null,
        timestamp,
        petId,
      ),
  ]);

  if (!updateResult.success) {
    throw new Error("The pet care update failed.");
  }

  const eventRow = eventResult.results[0] as PetEventRow | undefined;
  const event = eventRow ? eventRowToEvent(eventRow) : undefined;
  if (!event || event.type === "pet.fed") {
    throw new Error("The pet care event could not be recorded.");
  }

  const pet = await getOrCreate(petId, undefined, now);
  return { pet, event };
}

async function liveGet(
  petId: string,
  afterEventId?: number,
  assistantName?: string,
  now: Date = new Date(),
): Promise<LivePetPayload> {
  const pet = await getOrCreate(petId, assistantName, now);
  const database = await ensureDatabaseSchema();
  const staleBefore = new Date(
    now.getTime() - STALE_CALL_INTERVAL_SECONDS * 1_000,
  ).toISOString();

  await database
    .prepare(
      `
        UPDATE pet_calls
        SET status = 'ended', speaker = NULL, updated_at = ?
        WHERE pet_id = ? AND status != 'ended' AND updated_at < ?
      `,
    )
    .bind(now.toISOString(), petId, staleBefore)
    .run();

  const callRow = await database
    .prepare(
      `
        SELECT
          COALESCE(SUM(CASE WHEN status = 'ringing' THEN 1 ELSE 0 END), 0) AS ringing,
          COALESCE(SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END), 0) AS active,
          COALESCE(SUM(CASE WHEN status = 'in-progress' AND speaker = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_speaking,
          COALESCE(SUM(CASE WHEN status = 'in-progress' AND speaker = 'user' THEN 1 ELSE 0 END), 0) AS user_speaking
        FROM pet_calls
        WHERE pet_id = ? AND status != 'ended'
      `,
    )
    .bind(petId)
    .first<CallSummaryRow>();

  const calls: LiveCallSummary = {
    ringing: Number(callRow?.ringing ?? 0),
    active: Number(callRow?.active ?? 0),
    total: Number(callRow?.ringing ?? 0) + Number(callRow?.active ?? 0),
    assistantSpeaking: Number(callRow?.assistant_speaking ?? 0),
    userSpeaking: Number(callRow?.user_speaking ?? 0),
  };

  const latestEventRow = await database
    .prepare(
      `
        SELECT COALESCE(MAX(id), 0) AS latest_event_id
        FROM pet_events
        WHERE pet_id = ?
      `,
    )
    .bind(petId)
    .first<LatestEventRow>();
  const latestEventId = Number(latestEventRow?.latest_event_id ?? 0);

  let events: PetEvent[] = [];
  if (afterEventId !== undefined) {
    const result = await database
      .prepare(
        `
          SELECT id, type, food, health_gain, health_after, call_id, created_at
          FROM pet_events
          WHERE pet_id = ? AND id > ?
          ORDER BY id ASC
          LIMIT 30
        `,
      )
      .bind(petId, afterEventId)
      .all<PetEventRow>();

    events = (result.results as PetEventRow[])
      .map(eventRowToEvent)
      .filter((event): event is PetEvent => event !== undefined);
  }

  return { pet, calls, events, latestEventId };
}

async function callStatusSet(
  petId: string,
  callId: string,
  status: CallStatus,
  startedAt?: string,
  assistantName?: string,
  now: Date = new Date(),
): Promise<void> {
  await getOrCreate(petId, assistantName, now);
  const database = await ensureDatabaseSchema();
  const timestamp = now.toISOString();

  await database
    .prepare(
      `
        INSERT INTO pet_calls (call_id, pet_id, status, speaker, started_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?)
        ON CONFLICT(call_id) DO UPDATE SET
          pet_id = excluded.pet_id,
          status = excluded.status,
          speaker = CASE WHEN excluded.status = 'ended' THEN NULL ELSE pet_calls.speaker END,
          started_at = COALESCE(pet_calls.started_at, excluded.started_at),
          updated_at = excluded.updated_at
      `,
    )
    .bind(callId, petId, status, startedAt ?? null, timestamp)
    .run();
}

async function callSpeakerSet(
  petId: string,
  callId: string,
  role: SpeakerRole,
  isSpeaking: boolean,
  assistantName?: string,
  now: Date = new Date(),
): Promise<void> {
  await getOrCreate(petId, assistantName, now);
  const database = await ensureDatabaseSchema();
  const timestamp = now.toISOString();

  await database
    .prepare(
      `
        INSERT INTO pet_calls (call_id, pet_id, status, speaker, started_at, updated_at)
        VALUES (?, ?, 'in-progress', ?, ?, ?)
        ON CONFLICT(call_id) DO UPDATE SET
          pet_id = excluded.pet_id,
          status = CASE WHEN pet_calls.status = 'ended' THEN pet_calls.status ELSE 'in-progress' END,
          speaker = CASE
            WHEN pet_calls.status = 'ended' THEN NULL
            WHEN ? = 1 THEN ?
            WHEN pet_calls.speaker = ? THEN NULL
            ELSE pet_calls.speaker
          END,
          started_at = COALESCE(pet_calls.started_at, excluded.started_at),
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      callId,
      petId,
      isSpeaking ? role : null,
      timestamp,
      timestamp,
      isSpeaking ? 1 : 0,
      role,
      role,
    )
    .run();
}

async function reset(petId: string, now: Date = new Date()): Promise<PetState> {
  await getOrCreate(petId, undefined, now);
  const database = await ensureDatabaseSchema();
  const timestamp = now.toISOString();

  await database.batch([
    database
      .prepare(
        `
          UPDATE pets
          SET health = ?, meals_eaten = 0, version = version + 1,
              health_updated_at = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(INITIAL_HEALTH, timestamp, timestamp, petId),
    database.prepare("DELETE FROM pet_events WHERE pet_id = ?").bind(petId),
    database.prepare("DELETE FROM pet_calls WHERE pet_id = ?").bind(petId),
  ]);

  return getOrCreate(petId, undefined, now);
}

export const petRepository = {
  getOrCreate,
  feed,
  care,
  liveGet,
  callStatusSet,
  callSpeakerSet,
  reset,
};
