import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assistantPayload, credentialPayload, toolPayloads } from "../vapi/config.mjs";

const prompt = await readFile(new URL("../vapi/assistant-prompt.md", import.meta.url), "utf8");
const tools = toolPayloads("https://orders.example.com", "00000000-0000-4000-8000-000000000001");

test("credential uses Vapi custom bearer authentication without leaking into tool headers", () => {
  const credential = credentialPayload("a".repeat(32));
  assert.equal(credential.provider, "custom-credential");
  assert.equal(credential.authenticationPlan.type, "bearer");
  assert.equal(credential.authenticationPlan.bearerPrefixEnabled, true);
  assert.equal(tools.some((tool) => tool.headers?.properties?.Authorization), false);
});

test("trusted call ID is static and absent from the model-facing order schema", () => {
  const create = tools.find((tool) => tool.name === "acme_create_order");
  const lookup = tools.find((tool) => tool.name === "acme_get_order");
  assert.deepEqual(create.parameters, [{ key: "callId", value: "{{ call.id }}" }]);
  assert.equal(create.body.properties.callId, undefined);
  assert.deepEqual(create.headers.properties, {
    Accept: { type: "string", value: "application/json" },
  });
  assert.deepEqual(lookup.headers.properties, {
    Accept: { type: "string", value: "application/json" },
  });
  assert.equal(create.backoffPlan.maxRetries, 2);
});

test("assistant uses verified safe defaults and saved API request tools", () => {
  const assistant = assistantPayload(["tool-1", "tool-2", "tool-3"], prompt);
  assert.deepEqual(assistant.model.toolIds, ["tool-1", "tool-2", "tool-3"]);
  assert.equal(assistant.model.model, "gpt-4.1");
  assert.deepEqual(assistant.voice, { provider: "vapi", voiceId: "Elliot", version: 2 });
  assert.deepEqual(assistant.transcriber, { provider: "deepgram", model: "flux-general-en", language: "en" });
  assert.match(assistant.model.messages[0].content, /explicit confirmation/i);
  assert.match(assistant.model.messages[0].content, /## Error recovery/);
});

test("every tool has bounded execution and voice-safe progress messages", () => {
  assert.equal(tools.length, 3);
  for (const tool of tools) {
    assert.equal(tool.timeoutSeconds, 8);
    assert.ok(tool.messages.some((message) => message.type === "request-start"));
    assert.ok(tool.messages.some((message) => message.type === "request-failed" && message.role === "system"));
  }
});
