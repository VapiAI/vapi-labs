import { money, orderFingerprint, PRODUCTS, validateOrder } from "./domain.js";

const MAX_BODY_BYTES = 16_384;
const ORDER_CODE = /^ORD-[A-F0-9]{12}$/;

export default {
  async fetch(request, env) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const startedAt = Date.now();
    let response;

    try {
      response = await route(request, env, requestId);
    } catch (error) {
      console.error(JSON.stringify({ event: "request.error", requestId, error: error?.message ?? "Unknown error" }));
      response = problem(500, "INTERNAL_ERROR", "The service could not complete the request.", requestId);
    }

    console.log(JSON.stringify({
      event: "request.complete",
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }));
    return response;
  },
};

async function route(request, env, requestId) {
  const rawPath = new URL(request.url).pathname;
  const path = rawPath.replace(/\/+$/, "") || "/";

  if (path === "/health") {
    if (request.method !== "GET") return methodNotAllowed("GET", requestId);
    await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: true, service: "vapi-orders-agent" }, 200, requestId);
  }

  const auth = await authenticate(request, env.ORDERS_API_TOKEN);
  if (!auth.ok) return problem(auth.status, auth.code, auth.message, requestId);

  if (path === "/products") {
    if (request.method !== "GET") return methodNotAllowed("GET", requestId);
    const products = PRODUCTS.map(({ id, name, priceCents }) => ({ id, name, priceCents, priceDisplay: money(priceCents) }));
    return json({ products, message: products.map((p) => `${p.name} is ${p.priceDisplay}`).join("; ") + "." }, 200, requestId);
  }

  if (path === "/orders") {
    if (request.method !== "POST") return methodNotAllowed("POST", requestId);
    return createOrder(request, env.DB, requestId);
  }

  const orderCode = path.match(/^\/orders\/(.+)$/)?.[1]?.toUpperCase();
  if (orderCode) {
    if (request.method !== "GET") return methodNotAllowed("GET", requestId);
    if (!ORDER_CODE.test(orderCode)) return problem(400, "INVALID_ORDER_CODE", "Use an order code like ORD-A1B2C3D4E5F6.", requestId);
    return getOrder(env.DB, orderCode, request.headers.get("x-call-id"), requestId);
  }

  return problem(404, "NOT_FOUND", "Route not found.", requestId);
}

async function createOrder(request, db, requestId) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return problem(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", requestId);
  }

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_BODY_BYTES) return problem(413, "BODY_TOO_LARGE", "Request body is too large.", requestId);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return problem(413, "BODY_TOO_LARGE", "Request body is too large.", requestId);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return problem(400, "INVALID_JSON", "Request body must be valid JSON.", requestId);
  }

  // Vapi injects X-Call-Id from server-side call state, while the saved tool's
  // top-level static parameter injects the same value into the body. Requiring
  // both prevents model-generated data from choosing the call context.
  const callId = request.headers.get("x-call-id");
  if (!callId || typeof body.callId !== "string" || body.callId !== callId) {
    return problem(400, "INVALID_CALL_CONTEXT", "A trusted Vapi call context is required.", requestId);
  }

  const validation = validateOrder(body);
  if (!validation.ok) {
    return problem(validation.error.status, validation.error.code, validation.error.message, requestId);
  }

  const id = crypto.randomUUID();
  const orderCode = `ORD-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const requestHash = await orderFingerprint(validation.order);
  const createdAt = new Date().toISOString();

  await db.prepare(`
    INSERT INTO orders (
      id, order_code, call_id, request_hash, customer_name,
      items_json, total_cents, currency, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', 'confirmed', ?)
    ON CONFLICT(call_id, request_hash) DO NOTHING
  `).bind(
    id,
    orderCode,
    callId,
    requestHash,
    validation.order.customerName,
    JSON.stringify(validation.order.items),
    validation.order.totalCents,
    createdAt,
  ).run();

  const row = await db.prepare("SELECT * FROM orders WHERE call_id = ? AND request_hash = ?")
    .bind(callId, requestHash)
    .first();
  const replayed = row.id !== id;

  console.log(JSON.stringify({ event: "order.persisted", requestId, callId, orderCode: row.order_code, replayed }));
  return orderResponse(row, replayed ? 200 : 201, requestId, replayed);
}

async function getOrder(db, orderCode, callId, requestId) {
  if (!callId) return problem(400, "INVALID_CALL_CONTEXT", "A trusted Vapi call context is required.", requestId);
  const row = await db.prepare("SELECT * FROM orders WHERE order_code = ? AND call_id = ?")
    .bind(orderCode, callId)
    .first();
  if (!row) return problem(404, "ORDER_NOT_FOUND", "No order with that code exists in this call.", requestId);
  return orderResponse(row, 200, requestId, false);
}

function orderResponse(row, status, requestId, replayed) {
  const items = JSON.parse(row.items_json).map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPriceDisplay: money(item.unitPriceCents),
    lineTotalDisplay: money(item.lineTotalCents),
  }));
  const totalDisplay = money(row.total_cents);
  const message = `Order ${row.order_code} is confirmed for ${totalDisplay}.`;
  return json({
    success: true,
    replayed,
    order: {
      code: row.order_code,
      customerName: row.customer_name,
      items,
      totalCents: row.total_cents,
      totalDisplay,
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
    },
    message,
  }, status, requestId, { Location: `/orders/${row.order_code}` });
}

async function authenticate(request, token) {
  if (!token) return { ok: false, status: 503, code: "SERVER_MISCONFIGURED", message: "Authentication is not configured." };
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return await equalSecrets(supplied, token)
    ? { ok: true }
    : { ok: false, status: 401, code: "UNAUTHORIZED", message: "Bearer token is missing or invalid." };
}

async function equalSecrets(a, b) {
  const encode = (value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [left, right] = await Promise.all([encode(a), encode(b)]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

function methodNotAllowed(allow, requestId) {
  return problem(405, "METHOD_NOT_ALLOWED", `Use ${allow} for this route.`, requestId, { Allow: allow });
}

function problem(status, code, message, requestId, headers) {
  return json({ error: { code, message, requestId } }, status, requestId, headers);
}

function json(body, status, requestId, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      ...headers,
    },
  });
}
