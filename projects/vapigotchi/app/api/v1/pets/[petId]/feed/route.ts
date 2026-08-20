import type { FeedPetInput } from "@/lib/types";

import { FOOD_TYPES } from "@/lib/constants";
import { petRepository } from "@/lib/petRepository";
import { petState } from "@/lib/petState";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ petId: string }> },
) {
  const { petId } = await params;
  if (!petState.isValidPetId(petId)) {
    return Response.json({ error: "Invalid pet ID." }, { status: 400 });
  }

  let payload: Partial<FeedPetInput>;
  try {
    payload = (await request.json()) as Partial<FeedPetInput>;
  } catch {
    return Response.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  if (!petState.isFoodType(payload.food)) {
    return Response.json(
      {
        error: `food must be one of: ${FOOD_TYPES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const result = await petRepository.feed(petId, {
    food: payload.food,
    assistantName: payload.assistantName,
    callId: payload.callId,
  });

  return Response.json(result, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
