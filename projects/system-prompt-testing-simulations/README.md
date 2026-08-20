# System prompt testing with Vapi Simulations

> 🧪 **This is a showcase demo, not an officially supported Vapi product.**
> Built by Amanda Martin for a talk about how system-prompt design changes voice
> agent behavior. It is intended for learning and controlled comparison, not as
> a production reservation system.

A minimal, standalone comparison of three Vapi assistants whose only intended
behavioral difference is the system prompt:

- `personality-first`: warm and expressive, with underspecified mechanics.
- `rigid-sop`: exhaustive fixed-order procedure.
- `voice-native`: stateful, concise, correction-aware behavior.

All three use the same model, voice, transcriber, timing, shared Code Tools,
greeting, and three-minute limit. One introductory simulation suite runs the
talk's controlled caller scenario against all three assistants. It uses eight
focused Boolean evaluations and one iteration per assistant by default.

## Requirements

- Node.js 20 or newer (no npm dependencies)
- A Vapi account with Code Tools and Simulations access
- `VAPI_API_KEY` exported in the shell or stored in a local `.env`

Never commit `.env` or `state/`.

## Run the complete workflow

```bash
cp .env.example .env
# Add VAPI_API_KEY to .env.

npm run validate
npm run push
npm run simulation:create
npm run simulation:run
```

`push` creates the two shared [Code Tools](https://docs.vapi.ai/tools/code-tool) and the three assistants when they do
not exist. If local state is missing, it first reuses a single exact-name match
instead of creating a duplicate. Later runs update the same Vapi resources
using IDs in `state/vapi-resources.json`. `simulation:create` creates or updates
the AI tester personality, scenario, simulation, and reusable suite.

The runner is intentionally small but does more than start calls: it prints the
suite, transport, iteration count, and live-tool side-effect review; waits for
each native Vapi run to end; fetches every run item; prints Vapi's native
evaluation values; and exits nonzero when a target fails. It does not save
duplicate result artifacts or add a separate scoring layer.

Chat transport is the default because it is faster and isolates prompt/tool
behavior. For audio, transcription, endpointing, interruptions, and timing:

```bash
SIM_TRANSPORT=vapi.websocket npm run simulation:run
```

Voice mode consumes more concurrent call capacity and costs more. The AI tester
has an explicit voice and transcriber so voice reruns are reproducible.
When an agent is operating this workflow for a developer, it asks which mode to
use before starting the run unless the developer already specified one. The
script itself remains non-interactive and defaults to chat for direct and CI
use.

## Known limitations

- This is a simple introduction matching the August 2026 conference talk and is intended to be introductory, not a comprehensive
  regression program.
- The reservation tools are deterministic local fixtures and persist nothing.
- The scenario intentionally preserves the talk's dated “next Friday” fixture.
  Before reusing it in another period, update the opening, approved date, and
  date-specific evaluations together.
- Chat simulations test prompt and tool behavior but do not validate voice
  behavior. Use voice transport for STT, TTS, latency, interruption, silence,
  and audio testing.
- Production coverage should use separate smoke, regression, failure, and edge
  simulations rather than expanding this introductory scenario indefinitely.

## Project map

- `assistants/`: exactly three assistant source configurations and prompts.
- `simulations/config.json`: tester, scenario, rubric, and run settings.
- `tools/`: shared Vapi Code Tool payloads with no external side effects.
- `scripts/`: validate, deploy, create simulations, run, and collect results.
- `AGENTS.md`: maintenance instructions and canonical skill links for agents.
- `docs/`: business rules and tool contracts.

## Current Vapi references

- [Vapi Simulations skill](https://github.com/VapiAI/skills/tree/main/simulations)
- [Vapi Create Assistant skill](https://github.com/VapiAI/skills/tree/main/create-assistant)
- [Vapi Prompt Builder skill](https://github.com/VapiAI/skills/tree/main/vapi-prompt-builder)
- [Create Assistant](https://docs.vapi.ai/api-reference/assistants/create)
- [Update Assistant](https://docs.vapi.ai/api-reference/assistants/update)
- [Create Tool](https://docs.vapi.ai/api-reference/tools/create)
- [Update Tool](https://docs.vapi.ai/api-reference/tools/update)
- [Simulations quickstart](https://docs.vapi.ai/observability/simulations-quickstart)
- [Advanced simulations](https://docs.vapi.ai/observability/simulations-advanced)
- [Manage simulations](https://docs.vapi.ai/observability/simulations-manage)

## Built by

[Amanda Martin](https://www.linkedin.com/in/amandamartin-dev)
