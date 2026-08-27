import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const token = "test-token-that-is-at-least-32-characters";
const callId = "00000000-0000-4000-8000-000000000002";

test("health is public while business endpoints require bearer authentication", async () => {
  const env = { DB: new FakeD1(), ORDERS_API_TOKEN: token };
  assert.equal((await worker.fetch(request("/health"), env)).status, 200);
  assert.equal((await worker.fetch(request("/products"), env)).status, 401);
  assert.equal((await worker.fetch(request("/products", { headers: authHeaders() }), env)).status, 200);
});

test("order creation is persistent, correlated, idempotent, and retrievable", async () => {
  const env = { DB: new FakeD1(), ORDERS_API_TOKEN: token };
  const body = {
    callId,
    customerName: "Alex",
    items: [{ productId: "coffee-beans", quantity: 2 }],
  };
  const init = {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", "X-Call-Id": callId }),
    body: JSON.stringify(body),
  };

  const first = await worker.fetch(request("/orders", init), env);
  const firstBody = await first.json();
  assert.equal(first.status, 201);
  assert.equal(firstBody.order.totalCents, 3600);

  const retry = await worker.fetch(request("/orders", init), env);
  const retryBody = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryBody.replayed, true);
  assert.equal(retryBody.order.code, firstBody.order.code);

  const found = await worker.fetch(request(`/orders/${firstBody.order.code}`, {
    headers: authHeaders({ "X-Call-Id": callId }),
  }), env);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).order.code, firstBody.order.code);

  const otherCall = await worker.fetch(request(`/orders/${firstBody.order.code}`, {
    headers: authHeaders({ "X-Call-Id": "another-call" }),
  }), env);
  assert.equal(otherCall.status, 404);
});

test("order creation rejects mismatched model and transport call context", async () => {
  const env = { DB: new FakeD1(), ORDERS_API_TOKEN: token };
  const response = await worker.fetch(request("/orders", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", "X-Call-Id": callId }),
    body: JSON.stringify({
      callId: "untrusted-call",
      customerName: "Alex",
      items: [{ productId: "coffee-beans", quantity: 1 }],
    }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_CALL_CONTEXT");
});

test("order creation rejects a missing static body call context", async () => {
  const env = { DB: new FakeD1(), ORDERS_API_TOKEN: token };
  const response = await worker.fetch(request("/orders", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", "X-Call-Id": callId }),
    body: JSON.stringify({
      customerName: "Alex",
      items: [{ productId: "ceramic-mug", quantity: 1 }],
    }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_CALL_CONTEXT");
});

test("order creation still requires Vapi's trusted transport call context", async () => {
  const env = { DB: new FakeD1(), ORDERS_API_TOKEN: token };
  const response = await worker.fetch(request("/orders", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      callId,
      customerName: "Alex",
      items: [{ productId: "ceramic-mug", quantity: 1 }],
    }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_CALL_CONTEXT");
});

function request(path, init) {
  return new Request(`https://orders.example.com${path}`, init);
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

class FakeD1 {
  rows = [];

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    if (!this.sql.startsWith("INSERT INTO orders")) throw new Error(`Unexpected run: ${this.sql}`);
    const [id, order_code, call_id, request_hash, customer_name, items_json, total_cents, created_at] = this.args;
    if (!this.db.rows.some((row) => row.call_id === call_id && row.request_hash === request_hash)) {
      this.db.rows.push({
        id,
        order_code,
        call_id,
        request_hash,
        customer_name,
        items_json,
        total_cents,
        currency: "USD",
        status: "confirmed",
        created_at,
      });
    }
    return { success: true };
  }

  async first() {
    if (this.sql === "SELECT 1 AS ok") return { ok: 1 };
    if (this.sql.includes("WHERE call_id = ? AND request_hash = ?")) {
      return this.db.rows.find((row) => row.call_id === this.args[0] && row.request_hash === this.args[1]) ?? null;
    }
    if (this.sql.includes("WHERE order_code = ? AND call_id = ?")) {
      return this.db.rows.find((row) => row.order_code === this.args[0] && row.call_id === this.args[1]) ?? null;
    }
    throw new Error(`Unexpected first: ${this.sql}`);
  }
}
