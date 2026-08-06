#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const configPath = path.resolve(
  process.argv[2] || path.join(__dirname, "assistants", "flux.json"),
);

if (!process.env.VAPI_API_KEY) {
  console.error("VAPI_API_KEY is required.");
  process.exit(1);
}

async function main() {
  const assistant = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const response = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistant),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
