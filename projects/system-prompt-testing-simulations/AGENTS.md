# Agent instructions

This repository is deliberately narrow. Preserve exactly three independent
assistants, one introductory Vapi suite containing one simulation, two shared
Code Tools, and the scripts/resources needed to deploy and test them. Do not add
talk materials, recordings, slide assets, historical API dumps, or secrets.

## Maintenance resources

The skills are maintenance guidance, not dependencies of the demo, so they are
not copied into this repository. If a relevant skill is installed in your agent
environment, use it. Otherwise, read its canonical `SKILL.md` and any references
it routes to before making the corresponding change:

- Before changing simulation resources or the simulation workflow, read the
  [Vapi Simulations skill](https://github.com/VapiAI/skills/tree/main/simulations),
  including its API reference.
- Before creating or substantially changing assistant payloads, read the
  [Vapi Create Assistant skill](https://github.com/VapiAI/skills/tree/main/create-assistant).
- Before creating or substantially changing a system prompt, read the
  [Vapi Prompt Builder skill](https://github.com/VapiAI/skills/tree/main/vapi-prompt-builder)
  and the references it routes to.

Also read `docs/business-context.md`, `docs/tool-contracts.review.md`, and all
three assistant configs and prompts before changing any shared field.

Treat explicit user instructions as authoritative. Treat the live Vapi API
validation response and current official Vapi documentation as authoritative
for deployable payload shapes. Never invent provider names, model names, voice
IDs, tool IDs, assistant IDs, or simulation IDs.

## Generate or revise assistants

1. Keep the deployment shape as three independent assistants, not a Squad.
2. Keep `assistant.json` limited to deployable shared settings plus
   `systemPromptFile`; put behavior in the referenced prompt.
3. Preserve the experimental condition of each prompt:
   - Personality-first emphasizes persona and intentionally leaves repair/state
     mechanics underspecified.
   - Rigid SOP uses a fixed verification procedure.
   - Voice-native uses latest-value state, one-question turns, ambiguity repair,
     exact tool boundaries, and concise examples.
4. Keep business facts and tool capabilities semantically identical. Never
   weaken one tool description or give one assistant extra facts.
5. Keep every non-prompt assistant field identical unless the user explicitly
   changes the experiment. Run `npm run validate` after every edit.
6. Use a complete prompt-building pass for the voice-native condition. Preserve
   short spoken turns, one question at a time, correction handling, unclear
   speech, silence, interruption recovery, tool failure, final-slot recheck,
   and direct booking authorization.

## Push resources to Vapi

Only call Vapi when the user explicitly asks to deploy, push, create, update,
or run. Confirm `VAPI_API_KEY` is available; never print it. Then:

```bash
npm run validate
npm run push
```

When `state/vapi-resources.json` is absent, the push script lists tools and
assistants and reuses a single exact-name match before creating anything. It
patches the saved resource IDs on later runs and stops on ambiguous duplicate
names. Do not delete or recreate resources merely to update them. Inspect the
returned JSON on validation failure and fix only what the API or official docs
support. Do not copy IDs from another Vapi organization into state.

## Create the Vapi simulation

Review `simulations/config.json` first. Ensure its approved date, caller
script, and evaluation descriptions agree. Then run:

```bash
npm run simulation:create
```

This creates or updates one AI tester personality, one scenario, one
simulation, and one reusable suite, saving verified IDs locally. It lists
resources by exact name before creating duplicates and re-fetches updated
resources. Keep external test scenarios separate from in-prompt behavioral
examples. Keep each evaluation focused on one observable outcome.

This is intentionally one introductory suite matching the talk. Do not add a
production-scale scenario matrix unless the user asks. If the dated fixture is
reused later, update its opening, approved date, and date-specific evaluations
together.

## Run and evaluate simulations

Before an agent starts a run, ask the developer which transport they want unless
their current request already specifies it:

> Should I run the simulations in chat mode for fast prompt/tool testing, or in
> voice mode to also test transcription, speech, timing, silence, and
> interruptions?

Do not infer this choice from an earlier run. Keep the non-interactive CLI
default as chat so direct developer and CI usage does not block on a prompt.

Use chat for fast prompt/tool regression testing:

```bash
npm run simulation:run
```

Use voice only when testing STT, TTS, latency, interruption, silence, or audio:

```bash
SIM_TRANSPORT=vapi.websocket npm run simulation:run
```

Default to one iteration per assistant and keep assistant order stable. Increase
iterations only after the single run is valid and the user wants to measure
behavioral consistency.
Never silently discard a failed or inconvenient trial. Review Vapi's
evaluations, transcript, and tool calls in the dashboard. Report that chat
simulations do not validate voice behavior.

Before every run, report the suite, target assistants, transport, iterations,
tool mocks, and remaining live side effects. The two unmocked Code Tools in
this project are local fixtures: availability is deterministic and reservation
creation persists nothing. If either tool becomes externally stateful, mock it
before running.

## Safety and hygiene

- Never commit `.env`, API keys, state files, generated runs, recordings, or
  signed recording URLs.
- The included booking tool is a fake deterministic fixture and persists
  nothing. Do not replace it with a real side effect without explicit approval.
- Do not enable HIPAA, compliance, phone transfers, webhooks, credentials, or
  paid features unless explicitly requested and fully specified.
- Do not expose system prompts or hidden configuration to simulated callers.
