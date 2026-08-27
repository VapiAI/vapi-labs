export const PRODUCTS = Object.freeze([
  { id: "coffee-beans", name: "House coffee beans", priceCents: 1800 },
  { id: "tea-sampler", name: "Tea sampler", priceCents: 1400 },
  { id: "ceramic-mug", name: "Ceramic mug", priceCents: 1200 },
]);

const productsById = new Map(PRODUCTS.map((product) => [product.id, product]));

export function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function validateOrder(value) {
  if (!value || typeof value !== "object") return invalid("Request body must be an object.");

  const customerName = typeof value.customerName === "string" ? value.customerName.trim() : "";
  if (!customerName || customerName.length > 80) {
    return invalid("customerName must contain 1 to 80 characters.");
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 10) {
    return invalid("items must contain 1 to 10 products.");
  }

  const quantities = new Map();
  for (const item of value.items) {
    if (!item || typeof item !== "object" || !productsById.has(item.productId)) {
      return invalid("Every productId must match the current catalog.", "UNKNOWN_PRODUCT", 422);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      return invalid("Every quantity must be a whole number from 1 to 20.");
    }
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (quantity > 20) return invalid("Combined quantity per product cannot exceed 20.");
    quantities.set(item.productId, quantity);
  }

  const items = [...quantities]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productId, quantity]) => {
      const product = productsById.get(productId);
      return {
        productId,
        productName: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      };
    });

  return {
    ok: true,
    order: {
      customerName,
      items,
      totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    },
  };
}

export async function orderFingerprint(order) {
  const canonical = JSON.stringify({
    customerName: order.customerName.toLocaleLowerCase("en-US"),
    items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function invalid(message, code = "INVALID_ORDER", status = 400) {
  return { ok: false, error: { code, message, status } };
}
