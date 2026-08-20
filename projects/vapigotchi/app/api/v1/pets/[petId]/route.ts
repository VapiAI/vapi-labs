import { petRepository } from "@/lib/petRepository";
import { petState } from "@/lib/petState";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ petId: string }> },
) {
  const { petId } = await params;
  if (!petState.isValidPetId(petId)) {
    return Response.json({ error: "Invalid pet ID." }, { status: 400 });
  }

  const assistantName = new URL(request.url).searchParams.get("assistantName");
  const pet = await petRepository.getOrCreate(
    petId,
    assistantName ?? undefined,
  );

  return Response.json({ pet }, {
    headers: { "Cache-Control": "no-store" },
  });
}
