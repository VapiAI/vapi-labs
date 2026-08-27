const productIds = ["coffee-beans", "tea-sampler", "ceramic-mug"];

const failureMessage = (action) => ({
  type: "request-failed",
  role: "system",
  content: `The ${action} failed. Say it did not complete and offer at most one retry.`,
});

const retryPlan = {
  type: "exponential",
  maxRetries: 2,
  baseDelaySeconds: 1,
  excludedStatusCodes: [400, 401, 403, 404, 413, 415, 422],
};

export function credentialPayload(token) {
  return {
    provider: "custom-credential",
    name: "Acme Orders Worker Auth",
    authenticationPlan: {
      type: "bearer",
      token,
      headerName: "Authorization",
      bearerPrefixEnabled: true,
    },
  };
}

export function toolPayloads(baseUrl, credentialId) {
  const common = { type: "apiRequest", credentialId, timeoutSeconds: 8, backoffPlan: retryPlan };

  return [
    {
      ...common,
      name: "acme_list_products",
      description: "Get the current Acme Market catalog and authoritative prices. Use before discussing products or prices. Do not use to create or check an order.",
      method: "GET",
      url: `${baseUrl}/products`,
      messages: [
        { type: "request-start", content: "Let me check what's available." },
        { type: "request-response-delayed", content: "The catalog is taking a little longer.", timingMilliseconds: 1500 },
        failureMessage("catalog lookup"),
      ],
    },
    {
      ...common,
      name: "acme_create_order",
      description: "Create one simulated order only after the caller explicitly confirms their first name, catalog items, and quantities. Do not use for quotes, unconfirmed carts, unsupported products, or order lookup.",
      method: "POST",
      url: `${baseUrl}/orders`,
      // Vapi injects X-Call-Id for API Request tools. Keep one harmless custom
      // header because Vapi rejects an empty header schema; updating this field
      // clears older tools that also templated x-call-id and created a duplicate.
      headers: {
        type: "object",
        properties: {
          Accept: { type: "string", value: "application/json" },
        },
      },
      parameters: [{ key: "callId", value: "{{ call.id }}" }],
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "The caller's confirmed first name.",
          },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            description: "The caller's confirmed cart using exact catalog product IDs.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                productId: { type: "string", enum: productIds },
                quantity: { type: "integer", minimum: 1, maximum: 20 },
              },
              required: ["productId", "quantity"],
            },
          },
        },
        required: ["customerName", "items"],
      },
      messages: [
        { type: "request-start", content: "I'll place that order now." },
        { type: "request-response-delayed", content: "The order is taking a little longer.", timingMilliseconds: 1500 },
        failureMessage("order request"),
      ],
    },
    {
      ...common,
      name: "acme_get_order",
      description: "Get the status and total for an order created during the current call. Use only with an order code returned by the backend during this call. Do not use to create or change an order.",
      method: "GET",
      url: `${baseUrl}/orders/{{orderCode}}`,
      headers: {
        type: "object",
        properties: {
          Accept: { type: "string", value: "application/json" },
        },
      },
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          orderCode: {
            type: "string",
            pattern: "^ORD-[A-Fa-f0-9]{12}$",
            description: "The order code returned earlier in this call, such as ORD-A1B2C3D4E5F6.",
          },
        },
        required: ["orderCode"],
      },
      messages: [
        { type: "request-start", content: "Let me check that order." },
        { type: "request-response-delayed", content: "The order lookup is taking a little longer.", timingMilliseconds: 1500 },
        failureMessage("order lookup"),
      ],
    },
  ];
}

export function assistantPayload(toolIds, prompt) {
  return {
    name: "Acme Market Orders",
    firstMessage: "Hi, this is River from Acme Market. I can help you explore our catalog or place a simulated order. What would you like to do?",
    firstMessageInterruptionsEnabled: true,
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.2,
      messages: [{ role: "system", content: prompt }],
      toolIds,
    },
    voice: {
      provider: "vapi",
      voiceId: "Elliot",
      version: 2,
    },
    transcriber: {
      provider: "deepgram",
      model: "flux-general-en",
      language: "en",
    },
    endCallPhrases: ["Thanks for calling Acme Market. Goodbye."],
    maxDurationSeconds: 600,
    metadata: {
      example: "vapi-orders-agent",
      version: "1.0.0",
    },
  };
}
