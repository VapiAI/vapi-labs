# Writing `plan/plan.json`

The plan says what the agent does, with which knowledge and tools, how it is split into assistants, what every call must yield, and how it is tested. It references the checked ontology by ID and the OpenAPI operations by `operationId`. Schema: `../scripts/vapi_build/schemas/plan.schema.json` (relative to this guide). `check plan` enforces it plus the rules below, then `render` shows ontology and plan on one page for the user's yes.

## Contents

- [Shape](#shape)
- [Topology: one assistant or a squad](#topology-one-assistant-or-a-squad)
- [Jobs, tools, auth, knowledge](#jobs-tools-auth-knowledge)
- [Structured outputs](#structured-outputs)
- [Simulations](#simulations)
- [Chat tests](#chat-tests)

## Shape

```json
{
  "agent": {"name": "Standard Charter Assistant", "purpose": "…", "audience": "customers", "language": "en",
            "topology": {"choice": "squad", "why": "Front door verifies callers by ANI and PIN; banking actions need the verified id and a service token; product questions need neither."}},
  "runtime": {"serverUrl": "https://standardcharter.co",
              "model": {"provider": "openai", "model": "gpt-4.1", "temperature": 0.2},
              "voice": {"provider": "vapi", "voiceId": "Elliot"},
              "transcriber": {"provider": "deepgram", "model": "nova-3", "language": "en"}},
  "jobs": [{"id": "job:verify-caller", "label": "Verify the caller", "goals": ["goal:secure-access"], "handling": "TOOL_ACTION", "tools": ["lookupCustomerByPhone", "verifyPin"],
            "steps": ["Look the caller up by the number they are calling from.", "Ask for their PIN; never read a PIN back.", "After two failures, offer a callback instead."],
            "safeguards": ["Disclose nothing about the account until the PIN is verified."]},
           {"id": "job:compare-products", "label": "Compare savings products", "goals": ["goal:compare-products"], "handling": "ANSWER",
            "knowledge": ["claim:mma-minimum", "rule:disclose-fees"], "tools": ["listOfferings"],
            "slots": [{"name": "product", "description": "Which product the caller means", "required": false}],
            "safeguards": ["Never quote a rate not returned by the tool or knowledge base."],
            "escalation": "Offer a callback from a banker when the caller wants advice."}],
  "tools": [{"operationId": "lookupCustomerByPhone", "description": "Find the customer record for the calling number.", "auth": {"mode": "HEADER_ENV", "env": "SC_SERVICE_TOKEN"},
             "staticParameters": {"phone": "{{customer.number}}"}, "extract": {"customerId": "{{id}}"}},
            {"operationId": "verifyPin", "description": "Check the caller's PIN.", "auth": {"mode": "HEADER_ENV", "env": "SC_SERVICE_TOKEN"},
             "skipConfirmationReason": "Verification call; nothing to read back and a PIN must never be repeated aloud."},
            {"operationId": "listOfferings", "description": "Search public products by keyword.", "auth": {"mode": "NONE"}, "startMessage": "One moment while I look that up."},
            {"operationId": "prepareAction", "description": "Prepare a transfer for confirmation.", "auth": {"mode": "HEADER_ENV", "env": "SC_SERVICE_TOKEN"}, "confirmBeforeCall": true,
             "extract": {"proposalId": "{{proposalId}}"}}],
  "knowledge": {"includeSourceDocuments": true, "includeWebsitePages": true, "includeDomainGuide": true, "excludeLocators": []},
  "assistants": [{"id": "front-door", "name": "Standard Charter Front Door", "systemPrompt": "You answer the phone for Standard Charter Bank. Greet the caller, identify them from the number they are calling from, ask for their PIN, and hand off once verified. If the number is unknown, ask for it. Never discuss accounts before verification.",
                  "firstMessage": "Thanks for calling Standard Charter. One moment while I find your details.", "jobs": ["job:verify-caller"], "tools": ["lookupCustomerByPhone", "verifyPin"], "knowledge": false,
                  "handoffTo": [{"assistant": "banker", "when": "the caller is verified", "carry": {"customerId": "the verified customer's record id"}}]},
                 {"id": "banker", "name": "Standard Charter Banker", "systemPrompt": "You help verified Standard Charter customers compare products, answer policy questions from the knowledge base, and prepare transfers only after a read-back and an explicit yes.",
                  "jobs": ["job:compare-products"], "tools": ["listOfferings", "prepareAction"], "knowledge": true}],
  "squad": {"entry": "front-door"},
  "structuredOutputs": [{"id": "output:call-outcome", "name": "Call outcome", "description": "What the caller wanted and whether it was resolved.",
                         "schema": {"type": "object", "properties": {"intent": {"type": "string", "enum": ["compare", "transfer", "policy", "other"]}, "verified": {"type": "boolean"},
                                                                    "resolved": {"type": "boolean"}, "summary": {"type": "string", "description": "One sentence."}}, "required": ["intent", "verified", "resolved"]},
                         "jobs": ["job:verify-caller", "job:compare-products"]}],
  "simulations": {"personalities": [{"id": "personality:brisk", "name": "Brisk regular", "prompt": "You are a long-time customer in a hurry. You answer questions directly, give your PIN when asked, and get impatient with repetition. Use only the facts in the scenario."}],
                  "scenarios": [{"id": "scenario:compare-after-verify", "name": "Verified caller compares products", "personality": "personality:brisk", "jobs": ["job:verify-caller", "job:compare-products"],
                                 "instructions": "You are calling from your registered number. Your PIN is 4321. Once verified, ask what the difference is between the two savings accounts and end the call after an answer.",
                                 "evaluations": [{"name": "verified", "output": "output:call-outcome", "path": "verified", "value": true},
                                                 {"name": "compared", "description": "True if the assistant named two products and a difference.", "schema": {"type": "boolean"}, "value": true}],
                                 "toolMocks": [{"tool": "lookupCustomerByPhone", "result": "{\"id\":\"cus_sim_1\",\"name\":\"Sim Customer\"}"}, {"tool": "verifyPin", "result": "{\"verified\":true}"}]}]},
  "tests": [{"id": "test:compare", "scenario": "Product comparison", "callerOpening": "What savings accounts do you offer?", "expect": ["calls listOfferings", "names products from the result"], "mustNot": ["quotes a rate not in the result"]}],
  "exclusions": [{"what": "Investment advice", "why": "No authoritative source and out of policy."}]
}
```

## Topology: one assistant or a squad

Assess this explicitly and record it in `agent.topology` (`choice` and `why`); the check refuses a choice that contradicts the assistant count and warns when the decision is missing on anything but the smallest plan.

Prefer **one assistant** when one focused prompt and one compatible tool set handle every job reliably. Use a **squad** for genuine boundaries, and only those:

- distinct domains or personas (billing versus technical support; sales versus service);
- different tool or credential access (public catalogue calls versus calls that need a service token or a verified customer id);
- deliberate context isolation (what the verifier heard should not leak into the sales conversation, or the reverse);
- specialists that will be maintained separately.

Do not create one member per conversational step; keep related steps in one member and make each handoff earn its latency. The check warns when a single assistant carries more than five jobs, more than six tools, or several authentication modes, and when a squad member owns at most one job and no tools.

**Front door.** When callers reach the agent by phone and the API can identify them, a front-door member is usually the first boundary. It answers, looks the caller up by ANI using `{{customer.number}}` (the caller's number, available in every prompt and tool template on phone calls), asks for their PIN or other secret, and hands off to the specialist with the verified id. Put the number into the lookup tool with `staticParameters` so the model never fills it, `extract` the customer id from the response, and pass it through the handoff with `carry`; the compiler turns `carry` into the destination's variable extraction plan and tells the front door what to carry along. Give the front door `knowledge: false` and no business tools. Write the prompt so an unknown or missing number (web chat has none) falls back to asking for it. Never read a PIN back; verification calls take `skipConfirmationReason` instead of `confirmBeforeCall`. The check hints at this pattern when the API has lookup or verify operations and the plan calls authenticated ones.

## Jobs, tools, auth, knowledge

- **Jobs** come from goals with enough support. `handling`: `ANSWER` (knowledge only), `GUIDED_PROCESS` (a procedure without tools), `TOOL_ACTION` (calls an operation), `HANDOFF` (another assistant or a human), `DECLINE` (say it is out of scope and why). Everything on a job is compiled into the system prompt of each assistant that owns it: a "Jobs you handle" section with steps, slots, safeguards, escalation, up to two examples, and the text of every `knowledge` record it lists. The domain guide in the knowledge base carries the whole approved ontology regardless.
- **Tools** are the operations the agent may call. Include only what a job needs. The check fails on operations classified PRIVILEGED (admin, reset, internal) unless `agent.allowPrivileged` is true and the user asked for it. Every non-GET operation must carry `confirmBeforeCall: true`; the compiled prompt then requires a read-back and an explicit yes. The only way out is `skipConfirmationReason` (a login or verification call with nothing to read back), which the check prints as "NO read-back" so the user sees it at the gate. `staticParameters` fixes body fields the model never fills, as literals or Liquid such as `{{customer.number}}`.
- **Auth** per tool: `NONE`; `VAPI_CREDENTIAL` with the `credentialId` of a credential the user already created in Vapi; or `HEADER_ENV` with `env`, the name of a variable saved in `~/.config/vapi-build/env` (the same file as the Vapi key). At apply time its value is sent as a fixed header, `Authorization: Bearer <token>` by default; set `headerName` and `prefix` for APIs that want `X-API-Key: <token>`. Never name a platform secret (`VAPI_*`, `AWS_*`, anything with `SECRET`); the check refuses those. For a session token that a login operation returns, give the login tool an `extract` map (Liquid over its response) and put `"headers": {"Authorization": "Bearer {{sessionToken}}"}` on the tools that need it; `headers` values are fixed or Liquid, never model-generated.
- **Knowledge base**: source documents (including PDFs), website pages as Markdown, and the generated domain guide. Exclude internal or employee-only documents with `excludeLocators` when the audience is customers. Transcripts are never included.
- **Assistants**: names are at most 40 characters and unique. Each `handoffTo` entry becomes a handoff tool and a squad destination; `carry` names the variables extracted for the destination. Prompts should name the jobs, the tone, what to verify before disclosing anything, and when to hand off. The compiler appends knowledge, tool, handoff, and exclusion sections automatically.

## Structured outputs

Structured outputs are what Vapi extracts from every call after it ends, so every call yields reviewable data. Propose the smallest set the business would actually read, derived from the jobs:

- always a **call outcome** record: `intent` as an enum of the job ids or their short names, `resolved` and, where relevant, `verified` booleans, an `escalated` flag, a one-sentence `summary`;
- one output per **confirmed write**: `booking made`, `payment taken`, `appointment start`, as a boolean or a small object with the reference the API returned;
- the **fields callers gave** that the business wants downstream (a callback number, a product of interest), only when a slot collects them;
- a **compliance** signal when the plan has exclusions or safeguards: did the caller ask for something out of scope, did the agent disclose before verification.

Each entry has an `id` (`output:…`), a `name` (at most 40 characters, unique), a `description`, a JSON `schema`, and optionally `jobs` and `assistants` (default: every assistant). Use `enum` for closed categories, mark a field required only when every valid call produces it, and prefer a primitive schema for a single value. The check validates the schema and rejects object schemas with no properties. `apply` creates each output and attaches it to its assistants through `artifactPlan.structuredOutputIds`; results appear under `call.artifact.structuredOutputs` in the dashboard and API.

## Simulations

Simulations are Vapi's dynamic tests: an AI caller with a **personality** follows a **scenario**'s instructions against the applied assistant or squad, and Vapi judges each **evaluation** by extracting a structured output and comparing it with the expected value. Design them from the transcripts and the jobs:

- one **smoke scenario per job**, written as the caller's intent and facts, never as a script of the agent's answers; add edge cases for ambiguity, a wrong PIN, an unavailable dependency, an out-of-scope request, a handoff. Speech IVR logs are the richest source: the utterances an existing IVR marked no-match or no-input are exactly the phrasings the new agent must handle, so turn the frequent ones into scenarios and their wording into personalities;
- **personalities** drawn from how callers actually talk in the transcripts (hurried, confused, elderly, angry), one paragraph of stable temperament and speaking style; situation-specific facts go in the scenario;
- **evaluations** that measure one observable outcome each: reuse a plan structured output with `output` (add `path` to pick a primitive leaf of an object output) or define an inline primitive `schema`; `comparator` defaults to `=`, and booleans and strings allow only `=` and `!=`; `required` defaults to true;
- **toolMocks** for every write tool a scenario's jobs can reach, by `operationId`, with a string `result`. The check refuses a scenario that could hit a live write unmocked. Read tools may stay live.
- `variables` for `{{placeholders}}` in the prompts, and `transport` (`vapi.webchat` by default; `vapi.websocket` for voice) at the top level.

`apply` creates the personalities, scenarios, one simulation per scenario, and a suite aimed at the squad or assistant. `simulate --yes` runs the suite once, waits for it to end, and reports every evaluation's actual and expected values; it uses credits, so it needs the user's yes.

## Chat tests

`tests` are cheap deterministic checks: a caller opening, optional `followUps` (later caller turns in the same chat), observable `expect` and `mustNot` lines. `test` runs them through Vapi chat after `apply`; you judge the transcripts. Prefer scenarios drawn from the transcripts without copying a caller's personal details. Keep them alongside simulations: chat tests catch prompt and tool wiring in seconds, simulations exercise real conversations.

`check plan` resolves everything, fills runtime defaults, and prints the exact operations the agent will be able to call. Read that list to the user before `approve plan`.
