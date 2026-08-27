import { readFile } from "node:fs/promises";

const baseUrl = (process.env.WORKER_BASE_URL ?? "").replace(/\/$/, "");
const token = process.env.ORDERS_API_TOKEN ?? await readStateToken();

if (!baseUrl || !token) {
  throw new Error("Set WORKER_BASE_URL and ORDERS_API_TOKEN, or run npm run setup first.");
}

const callId = "00000000-0000-4000-8000-000000000001";
const headers = { Authorization: `Bearer ${token}`, "X-Call-Id": callId };

const health = await request("/health");
assert(health.ok === true, "health check failed");

const catalog = await request("/products", { headers });
assert(catalog.products?.length === 3, "catalog check failed");

const orderBody = {
  callId,
  customerName: "Setup Test",
  items: [{ productId: "coffee-beans", quantity: 1 }],
};
const first = await request("/orders", {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(orderBody),
}, [201, 200]);
const replay = await request("/orders", {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(orderBody),
}, 200);
assert(first.order.code === replay.order.code && replay.replayed === true, "idempotency check failed");

const found = await request(`/orders/${first.order.code}`, { headers });
assert(found.order.code === first.order.code, "order lookup failed");

console.log(`Smoke test passed (${first.order.code}; retry was idempotent).`);

async function request(path, init, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    throw new Error(`${path} returned ${response.status}: ${body.error?.code ?? "invalid response"}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readStateToken() {
  try {
    return (await readFile(new URL("../.state/orders-api-token", import.meta.url), "utf8")).trim();
  } catch {
    return "";
  }
}
