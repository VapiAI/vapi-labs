# Meridian: a 5-assistant Vapi concierge squad

> 🧪 **This is a showcase demo, not an officially supported Vapi product.** Built by Justin Crowe (GTM at Vapi) to explore how far a multi-assistant squad can go using only native Vapi primitives: code tools, query tools, transfers, evals, and structured-data analysis. No third-party integrations, no self-hosted webhook required. It is meant to inspire, not to be production ready.

## What it does

Meridian is a fictional membership travel brand (think closed-loop hotel + airline concierge). Call one number and a squad of five assistants handles the whole journey:

| Assistant | Voice | Role |
|---|---|---|
| Concierge "Aria" | asteria | Front door. Greets, identifies the member, routes to hotel or flight. |
| Hotel Concierge "Jack" | orion | Reservation lookup, service requests, hotel knowledge base. |
| Flight Triage "Maya" | luna | Flight status. Escalates cancellations and 2h+ delays to Rebooking. |
| Rebooking "Marcus" | arcas | Finds alternative flights, confirms the rebook. |
| Upsell & Recovery "Sophie" | stella | Room upgrades (priced, pending on folio) and travel-credit requests. |

A sixth, standalone assistant ("Outbound Disruption") proactively calls members when their flight is cancelled or badly delayed, rebooks them in one call, and files a travel-credit request.

## How it works

- **Every business tool is a Vapi code tool** that calls the Supabase REST API directly, so the tools run on Vapi's infrastructure. There is no webhook, tunnel, or server to host, yet data persists: a new caller gets a randomly invented reservation that is written to Supabase and returned consistently on every later call.
- **Routing lives in the squad**, not in prompts: members declare `transferCall` tools with `assistantName` destinations, and the squad wires `assistantDestinations` with silent, rolling-history transfers so context carries across handoffs.
- **Distinct persona voices** per member (Deepgram), with `membersOverrides` used only for uniform settings (transcriber, barge-in). Pinning a voice in `membersOverrides` would silently collapse every member to one voice.
- **Barge-in is tuned for PSTN**: a shared `stopSpeakingPlan` (`numWords: 10`, the API maximum, plus `acknowledgementPhrases` / `interruptionPhrases`) so background noise and backchannels never interrupt, but "stop" or "wait" always does.
- **TTS hygiene everywhere**: every string a tool returns for speech is spoken words only. Flight numbers, times, dates, and reference codes are spelled out so the voice never reads raw codes or ISO timestamps.
- **Evals**: 15 `chat.mockConversation` simulations cover routing, tool behavior, and guardrails (for example: Sophie must treat an upgrade ask as an upgrade, never lead with credits, and never quote a credit dollar amount).
- An optional Express webhook server (`src/server.ts`) adds end-of-call analytics (call logs to Supabase, events to PostHog). The voice demo works fully without it.

## Setup

### Prerequisites

- Node 20+
- A Vapi account and API key (use a test key)
- A free [Supabase](https://supabase.com) project (gives the code tools a hosted place to persist reservations)

### Steps

1. `cp .env.example .env` and fill in `VAPI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_URL`
2. `npm install`
3. `npm run migrate`: applies `src/db/schema.sql` (5 tables) to your Supabase project
4. Optional: `npm run kb:upload`: uploads `assets/hotel-knowledge-base.txt` to your Vapi org; put the printed id in `.env` as `HOTEL_KB_FILE_ID` so Jack gets the knowledge-base tool
5. Create the five assistants (order does not matter; names are the routing contract, so leave them as-is):
   ```
   npm run assistant:concierge
   npm run assistant:hotel
   npm run assistant:triage
   npm run assistant:rebooking
   npm run assistant:upsell
   ```
6. `npm run squad`: wires them into the Meridian Concierge Squad
7. In the Vapi dashboard, point a phone number at the squad, then call it

Re-running an assistant script creates a new assistant. To update one in place, pass its id: `ASSISTANT_ID=<id> npm run assistant:hotel`. Keep assistant names unique in your org or the squad script will refuse to wire (by design).

### Outbound disruption campaign (optional)

```
npm run assistant:outbound
npm run seed                                            # adds a demo member
TEST_PHONE=+1XXXXXXXXXX FLIGHT_NUMBER=UA482 npm run campaign
```

`TEST_PHONE` overrides the member's phone so the call goes to you. You also need a Vapi phone number to place the call from.

## Verify and test

| Command | What it checks | Needs |
|---|---|---|
| `npm run typecheck` | TypeScript across the project | nothing |
| `npm run check` | env vars + Supabase/Vapi connectivity | .env |
| `npm run test:synth` | executes the exact shipped lookup code against your Supabase | .env |
| `npm run test:flight` | flight status/rebook/compensation code tools | .env |
| `npm run test:audit` | all 8 code-tool bodies across a 40+ case matrix, plus a TTS-hygiene scan of every spoken message | .env |
| `npm run test:verify` | live squad config: membership, distinct voices, barge-in, transferCall wiring (read-only) | assistants + squad created |
| `npm run simulations` | upserts the 15 evals (`RUN=1` to also execute them) | assistants created |

## Known limitations

- Flight status is **synthesized** (weighted toward disruptions so the demo is interesting). No real flight-data provider is wired in.
- Free-tier Supabase projects pause after about a week of inactivity; unpause in the Supabase dashboard if lookups start failing with DNS errors.
- Eval runs (`RUN=1 npm run simulations`) have been observed to sit in `queued` on some orgs; the audit suite (`npm run test:audit`) covers the same tool behavior offline.
- Voices are Deepgram-specific; swapping providers means re-tuning the barge-in plan.
- Built and tested on macOS with Node 20/24.

## Built by

Justin Crowe ([justincrowe-hub](https://github.com/justincrowe-hub)), GTM at Vapi.
