import test from "node:test";
import assert from "node:assert/strict";
import { orderFingerprint, PRODUCTS, validateOrder } from "../src/domain.js";

test("catalog remains the recognizable three-product example", () => {
  assert.deepEqual(PRODUCTS.map((product) => product.id), ["coffee-beans", "tea-sampler", "ceramic-mug"]);
});

test("order validation normalizes duplicate products and calculates authoritative totals", () => {
  const result = validateOrder({
    customerName: "  Alex  ",
    items: [
      { productId: "ceramic-mug", quantity: 1 },
      { productId: "ceramic-mug", quantity: 2 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.order.customerName, "Alex");
  assert.equal(result.order.items[0].quantity, 3);
  assert.equal(result.order.totalCents, 3600);
});

test("order validation rejects unsupported products and invalid quantities", () => {
  assert.equal(validateOrder({ customerName: "Alex", items: [{ productId: "cake", quantity: 1 }] }).error.code, "UNKNOWN_PRODUCT");
  assert.equal(validateOrder({ customerName: "Alex", items: [{ productId: "tea-sampler", quantity: 0 }] }).error.code, "INVALID_ORDER");
});

test("idempotency fingerprint is stable across item order and name casing", async () => {
  const first = validateOrder({
    customerName: "Alex",
    items: [
      { productId: "tea-sampler", quantity: 1 },
      { productId: "coffee-beans", quantity: 2 },
    ],
  }).order;
  const second = validateOrder({
    customerName: "ALEX",
    items: [
      { productId: "coffee-beans", quantity: 2 },
      { productId: "tea-sampler", quantity: 1 },
    ],
  }).order;
  assert.equal(await orderFingerprint(first), await orderFingerprint(second));
});
