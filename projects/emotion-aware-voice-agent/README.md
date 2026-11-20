# Emotion-Aware Voice Agent

> 🧪 **This is a showcase demo, not an officially supported Vapi product.** Built by Noah Raynor at Vapi for the VapiCon 2026 workshop "Beyond the Transcript", presented with Dhruva Reddy. This is meant to inspire, not production ready.

## What it does

A Vapi voice agent that hears how the caller sounds, not just what they say, and answers in a tone your brand has approved.

The same words can mean two different things. "Six tonight. Great, that's just great." is good news from a relieved caller and a complaint from a frustrated one. The transcript is identical. The voice is not. This project listens to the caller's voice, picks the agent's tone in code, and hands a frustrated caller to a person before the call goes wrong.

## How it works

Vapi runs the call. This server is the assistant's custom LLM, so it sees every turn before the agent speaks.

1. **Hear the caller.** The server listens to the call's live audio. Before each reply, it sends the last 1 to 2.5 seconds of the caller's voice to [Hume](https://www.hume.ai/)'s Audio Decisions API and asks how the caller sounds: angry, frustrated, sad, worried, happy or neutral.
2. **Pick the tone in code.** A fixed palette maps the caller's mood to an approved delivery. The agent never mirrors anger.

   | Caller sounds | Agent delivery (ElevenLabs v4 tag) |
   |---|---|
   | angry, frustrated | `[slightly calm, reassuring]` |
   | worried | `[slightly gentle, steady and reassuring]` |
   | sad | `[slightly gentle, warm and empathetic]` |
   | happy | `[slightly upbeat, bright and friendly]` |
   | neutral | `[slightly warm, friendly]` |

   Angry or frustrated switches to calm right away. Other moods switch only when Hume's top answer is clear. Otherwise the last tone holds.
3. **Write the words.** OpenAI writes the reply, guided by a short note about the chosen delivery. The server removes any brackets the model writes and puts the approved tag in front of the reply, so ElevenLabs v4 performs it.
4. **Check the agent.** After each agent turn, Hume scores the agent's own audio. The dashboard flags a turn that sounded curt or flat.
5. **Escalate.** On the second caller turn that sounds angry or frustrated, the agent says a handoff line and the server sends a warm transfer through Vapi's live call control. The specialist hears a one-line briefing before the caller joins.

The rules live in code, not in the prompt, so they are easy to read, test and change.

| Path | What it is |
|---|---|
| `server.mjs` | The whole server. Plain Node 22, no dependencies. |
| `assistant/system-prompt.md` | The agent's prompt (a support agent for a fictional internet provider during an outage) |
| `assistant/assistant.json` | The Vapi assistant config, with placeholders for your server URL and secret |
| `scripts/create-assistant.sh` | Creates the assistant in your Vapi org |
| `public/index.html` | Live dashboard (press `1`) and the workshop slides (press `2`) |

## Setup

### Prerequisites

- Node 22 or later, and `jq`
- Accounts and API keys for [Vapi](https://vapi.ai), [OpenAI](https://platform.openai.com) and [Hume](https://www.hume.ai/)
- A host for the server (see [Deploying](#deploying))

### Steps

1. `cp .env.example .env` and fill in your own values. `OPENAI_API_KEY`, `HUME_API_KEY` and `DEMO_SECRET` are required. Set the same values on your host.
2. Deploy the server. There are no dependencies to install. It starts with `npm start`.
3. Check it is up. `curl https://<your-server>/health` should return `{"ok":true,...}`.
4. Create the assistant.

   ```bash
   VAPI_PRIVATE_KEY=<your Vapi private key> \
   SERVER_URL=https://<your-server> \
   DEMO_SECRET=<same secret as the server> \
     ./scripts/create-assistant.sh
   ```

5. Attach the assistant to a phone number in the Vapi dashboard and call it. Open `https://<your-server>/` to watch the call.

To try it from the browser instead, set `VAPI_ORG_ID`, `VAPI_PRIVATE_KEY`, `ASSISTANT_ID` and `PUBLIC_ORIGIN` on the server and use the "Talk to the agent" button. The server mints a short-lived token that only works for this assistant on this page, so your private key never reaches the browser.

### Deploying

The server needs three things from a host:

- **One long-running Node 22 process.** It keeps each call's state in memory and holds the call's audio stream open for the whole call. Serverless functions (Vercel, Lambda, Val Town) won't work.
- **A public HTTPS URL**, so Vapi can reach it.
- **Streaming responses**, so the dashboard updates live.

It reads `PORT` from the environment. A few options:

- **Railway.** We ran the workshop demo on it. Create a project from your fork of this repo with this folder as the root directory, add the variables, and generate a domain under Settings > Networking.
- **Render.** Create a Web Service from your fork with this folder as the root directory and the start command `npm start`, and add the variables. Should work, not tested by us.
- **Fly.io.** Run `fly launch` in this folder and set the variables with `fly secrets set`. Should work, not tested by us.
- **Your own machine.** Run `node --env-file=.env server.mjs`, then expose port 7788 with a tunnel such as ngrok. Good for a quick try. Some quick tunnels buffer streaming responses, so the dashboard may not update even though calls work.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `SPECIALIST_NUMBER` | none | Phone number for the warm transfer. Leave it empty to turn escalation off. |
| `ESCALATE_TURNS` | 2 | Upset caller turns before the handoff. The turns don't have to be in a row. |
| `MOOD_MIN`, `MOOD_MARGIN` | 0.25, 0.05 | When a non-upset mood switches the tone. Real voices score 0.30 to 0.45 for the top mood, so keep these low. |
| `CLIP_MAX_MS` | 2500 | Longest caller clip sent to Hume. Longer clips take longer to score. |
| `HUME_WAIT_MS` | 1200 | Longest a reply waits for Hume before it keeps the last tone |
| `LLM_MODEL` | gpt-4.1 | OpenAI model that writes the replies |
| `TRACE_DIR` | off | Save every call's events and the exact clips sent to Hume, for tuning the rules |

## What we learned

- **Subtle beats dramatic.** Tags like `[calm]` made the voice overact. Adding "slightly" and tagging only the start of each reply sounded far more natural. ElevenLabs v4 carries the tone forward on its own. A voice stability of 0.5 helped too.
- **Wording matters more than the tag.** A calm tag can't save an impatient sentence, so the model also gets a note about the delivery and writes words to match it.
- **Two upset turns, not one.** One misread, such as a cough or a sarcastic joke, shouldn't send a caller to a person. The dashboard shows what Hume heard on every turn, so you can tune the threshold.
- **Split replies only at sentence ends.** The assistant sets `voice.inputPunctuationBoundaries` to `. ! ?`. When replies were split at commas, only the first piece got the tag.
- **Short clips are enough.** Hume documents a 5 second minimum, but 1 to 2.5 seconds from the end of the turn worked well in testing and keeps the wait short.

## Known limitations

- Waiting for Hume adds about 0.3 to 1.2 seconds before each reply.
- On the agent's own voice, Hume separates calm, warm and gentle only loosely. The check catches curt or flat delivery, not an exact match.
- Web calls can't be transferred. On a web call, the dashboard plays the handoff steps and then ends the call. A real warm transfer needs a phone call.
- The dashboard has no login. Anyone with the server URL can watch live transcripts and the specialist briefing, so don't point real customer traffic at a public deployment without adding auth. The specialist's number is masked to its last 4 digits.
- The "Talk to the agent" button is off unless you set its four variables. While it is on, anyone who can open the page can start calls that spend your Vapi, OpenAI and Hume credits. Turn it off when you are done demoing.
- Emotion recognition is regulated in some places, for example in workplaces and schools under the EU AI Act. Use the signal to help the caller, never to score or profile them.

## Built by

[Noah Raynor](https://github.com/noahraynor-vapi), Forward Deployed Engineering at Vapi
