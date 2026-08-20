import type { CarePetInput } from "@/lib/types";

import { CARE_ACTIONS } from "@/lib/constants";
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

  let payload: Partial<CarePetInput>;
  try {
    payload = (await request.json()) as Partial<CarePetInput>;
  } catch {
    return Response.json(
      { error: "A JSON request body is required." },
      { status: 400 },
    );
  }

  if (!petState.isCareAction(payload.action)) {
    return Response.json(
      { error: `action must be one of: ${CARE_ACTIONS.join(", ")}.` },
      { status: 400 },
    );
  }

  const result = await petRepository.care(petId, {
    action: payload.action,
    assistantName: payload.assistantName,
    callId: payload.callId,
  });

  return Response.json(result, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
