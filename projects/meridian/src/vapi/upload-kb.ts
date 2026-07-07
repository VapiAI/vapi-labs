/**
 * Uploads assets/hotel-knowledge-base.txt to YOUR Vapi org and prints the
 * file id. Put that id in .env as HOTEL_KB_FILE_ID, then (re)create the hotel
 * assistant so it gets the knowledge-base query tool.
 *
 *   npm run kb:upload
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config.js";
import { header } from "../utils/print.js";

header("Meridian — upload hotel knowledge base");

const here = path.dirname(fileURLToPath(import.meta.url));
const kbPath = path.resolve(here, "../../assets/hotel-knowledge-base.txt");

const form = new FormData();
form.append("file", new Blob([fs.readFileSync(kbPath)], { type: "text/plain" }), "hotel-knowledge-base.txt");

const res = await fetch("https://api.vapi.ai/file", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.vapiApiKey}` },
  body: form,
});
if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status} — ${await res.text()}`);
const file = (await res.json()) as { id: string; name: string };

console.log(`Uploaded "${file.name}" → file id: ${file.id}`);
console.log(`\nAdd to .env:\n  HOTEL_KB_FILE_ID=${file.id}`);
console.log(`Then re-run:  npm run assistant:hotel  (ASSISTANT_ID=<id> to upsert in place)`);
