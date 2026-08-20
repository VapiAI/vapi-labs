import { petRepository } from "@/lib/petRepository";
import { petState } from "@/lib/petState";
import { runtimeConfig } from "@/lib/runtimeConfig";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ petId: string }> },
) {
  const expectedKey = runtimeConfig.adminApiKey();
  if (!expectedKey) {
    return Response.json(
      { error: "The admin reset endpoint is not configured." },
      { status: 503 },
    );
  }

  if (request.headers.get("Authorization") !== `Bearer ${expectedKey}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { petId } = await params;
  if (!petState.isValidPetId(petId)) {
    return Response.json({ error: "Invalid pet ID." }, { status: 400 });
  }

  const pet = await petRepository.reset(petId);
  return Response.json({ pet }, {
    headers: { "Cache-Control": "no-store" },
  });
}
