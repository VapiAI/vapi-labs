import { readFile } from "node:fs/promises";

const API_URL = "https://api.vapi.ai/assistant";
const CONFIG_URL = new URL("../assistant.json", import.meta.url);

function argumentValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex !== -1) return process.argv[exactIndex + 1];

  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function validate(config) {
  const required = [
    ["name", config.name],
    ["firstMessage", config.firstMessage],
    ["model.provider", config.model?.provider],
    ["model.model", config.model?.model],
    ["voice.provider", config.voice?.provider],
    ["voice.voiceId", config.voice?.voiceId],
    ["transcriber.provider", config.transcriber?.provider],
    ["transcriber.model", config.transcriber?.model]
  ];

  const missing = required.filter(([, value]) => !value).map(([field]) => field);
  if (missing.length) {
    throw new Error(`assistant.json is missing: ${missing.join(", ")}`);
  }
}

const config = JSON.parse(await readFile(CONFIG_URL, "utf8"));
validate(config);

if (process.argv.includes("--check")) {
  console.log("assistant.json is valid.");
  process.exit(0);
}

const apiKey = process.env.VAPI_API_KEY || argumentValue("--api-key");
if (!apiKey) {
  console.error(
    "Missing a Vapi API key. Set VAPI_API_KEY or pass --api-key <key>."
  );
  process.exit(1);
}

const response = await fetch(API_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(config)
});

const body = await response.text();
let result;

try {
  result = JSON.parse(body);
} catch {
  result = body;
}

if (!response.ok) {
  console.error(`Vapi returned ${response.status} ${response.statusText}.`);
  console.error(
    typeof result === "string" ? result : JSON.stringify(result, null, 2)
  );
  process.exit(1);
}

console.log(`Created assistant ${result.name ?? config.name} (${result.id}).`);
