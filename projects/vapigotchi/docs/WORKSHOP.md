# VapiGotchi Workshop

## Outcome

By the end of the workshop, every team has a voice assistant that can inspect
and feed its own live creature through HTTP API tools. The creature visibly
reacts to ringing, connected calls, user speech, assistant speech, and tool
execution.

The workshop is designed for builders who can navigate a web dashboard and
edit a prompt. Coding is optional during the core hour; teams can fork the repo
afterward to remix the product.

## 60-minute agenda

| Time | Segment | Builder outcome |
| --- | --- | --- |
| 0:00–0:05 | Cold open: call VapiGotchi | See voice, events, and an API action working end to end |
| 0:05–0:12 | What is Vapi? | Understand the voice orchestration layer and where product code begins |
| 0:12–0:18 | Five core concepts | Assistant, model, voice, transcriber, tools/server events |
| 0:18–0:24 | Trace one bite | Follow speech → model decision → API request → state → UI |
| 0:24–0:32 | Create an assistant | Choose a voice, write the identity prompt, and run a first call |
| 0:32–0:46 | Connect a creature | Paste the Assistant ID, add the Server URL, and enable status/speech messages |
| 0:46–0:54 | Add API tools | Add state and feed tools, then teach the prompt when to use them |
| 0:54–0:58 | Test and debug | Call, ask about health, feed the pet, and inspect one failure path |
| 0:58–1:00 | Hackathon launchpad | Pick one remix and share the live URL |

For a 45-minute slot, provide assistants in advance and begin at “Connect a
creature.” For a 90-minute slot, add a 25-minute remix sprint and 5-minute
showcase.

## The five concepts

1. **Assistant** — the configuration that defines identity and behavior.
2. **Model** — decides what to say and when to use a tool.
3. **Voice** — turns the assistant's text into speech.
4. **Transcriber** — turns the caller's audio into text for the model.
5. **Tools and server events** — tools let the assistant take actions; server
   events let the rest of the product react to the call.

Keep the explanation anchored to the demo. Builders only need enough theory to
predict what will happen during the next call.

## Facilitator setup

Complete this before the room arrives:

- deploy VapiGotchi to a public HTTPS URL;
- configure the canonical assistant and test a dashboard web call;
- open `/stage` on the presentation display;
- reset the canonical pet to 35 health;
- keep one known-good Assistant ID ready as a fallback; and
- verify microphone and browser permissions on the presentation machine.

Do not distribute a private Vapi API key. Participants need their own Vapi
accounts or pre-created assistants.

## Live build script

### 1. Create the assistant

Start with a short system prompt:

```text
You are a tiny digital creature with a big personality. Be playful and concise.
Check your VapiGotchi state when the caller asks how you feel. If the caller asks
you to eat—or names a food after you ask what to eat—use feed_vapigotchi with
that food or choose one yourself. Celebrate only after the tool succeeds.
```

Add a first message that immediately invites the caller into the demo:

```text
Hi! I'm your VapiGotchi. I just woke up, and I'm a little hungry. Will you help
me choose something delicious to eat?
```

Both blocks have copy buttons on `/setup` and switch to Spanish with the setup
language toggle.

Test one conversational turn before adding any integration. This isolates voice
configuration from tool configuration.

The primary path uses the dashboard Test button. As an optional SDK bonus,
builders can expand the call panel on their pet page, paste their public key,
and start the same assistant from the browser. The key is kept only in that tab.

### 2. Connect the pet

Open the deployed `/setup` page and choose a pet target. For an isolated pet,
paste the Assistant ID and explain that the assistant namespace is the pet
namespace. A shared featured pet does not require an Assistant ID: English uses
`main` for Byte, while Spanish uses `chorizo`. Set the generated Server URL on
the assistant. Vapi's default server message selection already includes the
two events VapiGotchi uses:

- `status-update`
- `speech-update`

Builders do not need to disable the other defaults. The endpoint acknowledges
them successfully and ignores them without touching pet state.

The setup language toggle also changes the starter system prompt and the tool
descriptions copied into Vapi. Builders can therefore configure an English- or
Spanish-speaking assistant without translating JSON by hand.

Use **My isolated pet** during team testing. Use the shared demo option for a
room demo in which every assistant updates the featured language pet and
contributes to its live call counter. English targets `/pets/main`; Spanish
targets `/pets/chorizo`. Shared-pet calls start from each assistant's Vapi
dashboard; the optional Web SDK launcher remains available only on isolated
pet pages, where the page URL identifies one Assistant ID.

Start another call. The creature should receive the assistant's name and show
the call state. If it does not, check that the generated URL was copied exactly.
If the assistant's server message selection was customized, also verify that
both required message types remain enabled.

### 3. Add the tools

Copy the generated Composer prompt from `/setup`, paste it into Composer for the
same assistant, and ask Composer to create both tools. Keep the generated JSON
cards as a manual fallback or a way to inspect the exact configuration:

- `check_vapigotchi`, a GET request with no body; and
- `feed_vapigotchi`, a POST request with a required `food` enum.

### 4. Test the complete loop

Open the generated live pet page and keep it visible. Start a call with the Test
button in Vapi, ask the assistant how it feels, then ask it to eat. The room
should see the call, conversation, and API action become visible animations.

### Optional bonus: add care actions

Keep this out of the required path. After both core tools work, open the
collapsed bonus section on `/setup`. It provides a separate Composer prompt,
exact JSON, and system prompt addendum for `care_for_vapigotchi`.

The optional tool accepts one action: `dance-salsa`, `shower`, or `nap`. Ask
the assistant to perform each action and watch the page switch to the matching
animation. This is a useful five-minute extension or a starting point for teams
that finish early.

## Debug ladder

Debug one layer at a time:

1. **Can the assistant talk?** If not, fix the assistant/voice configuration.
2. **Does the pet show a call?** If not, check Server URL and server messages.
3. **Can the GET tool return health?** If not, inspect the tool URL and method.
4. **Can the POST tool feed?** If not, validate the JSON body and food enum.
5. **Does the UI animate?** If state changes but animation does not, reload the
   pet page and retry a new feed event.

## Remix prompts for the hackathon

- Make health unlock different conversation personalities.
- Add exercise, play, or a day/night room.
- Let several assistants care for one team creature.
- Turn customer support outcomes into creature upgrades.
- Add a boss battle driven by simultaneous calls.
- Replace food with actions in the team's actual hackathon product.

The transferable idea is not the pet. It is the loop: a realtime conversation
can call ordinary product APIs, and ordinary product state can shape the next
conversation.
