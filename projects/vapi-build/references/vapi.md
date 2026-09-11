# What `compile`, `apply`, `test`, and `simulate` do in Vapi

`compile` writes `vapi/build.json` (every payload), `vapi/knowledge/` (the files, each with its digest), and `vapi/summary.md`. `apply --yes` first checks that the build matches the currently approved plan and the current evidence (a stale build is refused with "run `compile` again"), resolves every token it will need from `~/.config/vapi-build/env`, and only then talks to `https://api.vapi.ai` with the private key from `VAPI_API_KEY` in the environment or that same file. Order, with `vapi/receipts.json` written after every step so a rerun resumes instead of duplicating:

1. **Files**: `POST /file` (multipart, `purpose=knowledge-base-v2`) for every knowledge file. A receipted file whose content changed is refused: run `teardown --yes` then `apply --yes`.
2. **Knowledge base**: `POST /v2/knowledge-base`, then `POST /v2/knowledge-base/{id}/file` per file, then poll `GET /v2/knowledge-base/{id}` until every file is `ready` and the base reports its search `toolId`. Organizations without Knowledge Bases V2 get one `query` tool over the same files instead.
3. **Tools**: `POST /tool` with `type: apiRequest`, the method, a URL built from the server URL and the operation path with `{param}` rewritten to `{{param}}` (query parameters appended the same way), a `body` schema projected from the OpenAPI parameters and request body (with `staticParameters` as fixed `value`s), optional `messages`, `variableExtractionPlan`, `credentialId`, and `headers` whose properties carry a fixed `value`. `HEADER_ENV` tokens are injected into those header values here and nowhere else.
4. **Structured outputs**: `POST /structured-output` per plan output (`name`, `description`, `type: ai`, `schema`).
5. **Assistants**: `POST /assistant` with the compiled system prompt, `model.toolIds` = the knowledge search tool plus the API tools, handoff tools when the plan has several assistants (each destination carrying a `contextEngineeringPlan` and, from `carry`, a `variableExtractionPlan`), `artifactPlan.structuredOutputIds` for the outputs attached to that assistant, voice and transcriber from the plan runtime, and metadata naming the project and digests.
6. **Squad**: `POST /squad` when there is more than one assistant; the entry assistant is first.
7. **Simulations**: `POST /eval/simulation/personality` (an AI-tester assistant configuration using the plan's model), `POST /eval/simulation/scenario` (instructions, evaluations with `structuredOutputId` or an inline `structuredOutput`, `toolMocks`, `targetOverrides`), `POST /eval/simulation` per scenario, then `POST /eval/simulation/suite` with every simulation and a `targetAssignments` entry for the squad or assistant.
8. **Verify**: `GET` every created resource and check the ID matches.

`teardown --yes` deletes in reverse (suite, simulations, scenarios, personalities, squad, assistants, structured outputs, tools, knowledge base, files). Anything Vapi refuses to delete (for example a pinned assistant) stays in the receipts and is reported; delete it in the dashboard and run teardown again.

## Testing the agent

`test` sends each plan test to the applied assistant (or squad) through `POST /chat`, chaining `followUps` with `previousChatId`, and saves `vapi/test-results.json`. Judge the transcripts against `expect` and `mustNot` yourself and report per scenario. Chat exercises the model, prompt, knowledge base, and tools, but not voice.

`simulate --yes` sends `POST /eval/simulation/run` for the suite against the applied target over the plan's transport (`vapi.webchat` unless the plan says `vapi.websocket`), polls `GET /eval/simulation/run/{id}` until the run has ended, reads `GET /eval/simulation/run/{id}/item`, and saves `vapi/simulation-results.json`. Vapi judges each evaluation; report its name, expected and actual values, and any extraction error, and separate execution failures (`failureReason`) from failed evaluations. A run uses credits and concurrency, and every unmocked tool is live, which is why the plan check refuses unmocked writes. After both, run `render` so the Build tab shows resource IDs, transcripts, and evaluations.

Structured outputs only run on real calls (phone or web), not on chat: point the user at `call.artifact.structuredOutputs` on their first calls, or preview one with the `create-structured-output` skill's run endpoint.

## Things to verify on a first live build

- URL variables (`{{bookingId}}`) resolve from the body properties the model fills; check the tool response in the call log if a path comes through unrendered.
- `{{customer.number}}` is empty on web calls and chats; the front door's prompt must ask for the number in that case.
- Optional query parameters render as empty strings when the model omits them; if the API rejects `?q=`, remove the optional parameter from the plan's tool or ask for it as required.
- Vapi indexes Markdown, text, PDF, and DOCX files. A file stuck in `indexing` past ten minutes stops `apply`; rerun to keep waiting, or remove that file from the plan.
- 401 from the tool means the auth mode is wrong for that API: switch to `HEADER_ENV` or `VAPI_CREDENTIAL`, or model the login flow with `extract` and a Liquid `headers` value.
- Assistant names must be unique in the Vapi organization when handoffs address them by name.
- A simulation evaluation that reads `null` usually means the structured output had no evidence in that conversation; simplify the schema or sharpen the description before changing the assistant.
