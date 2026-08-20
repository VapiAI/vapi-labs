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

  const searchParams = new URL(request.url).searchParams;
  const rawEventId = searchParams.get("afterEventId");
  const parsedEventId = rawEventId === null ? undefined : Number(rawEventId);
  if (
    parsedEventId !== undefined &&
    (!Number.isSafeInteger(parsedEventId) || parsedEventId < 0)
  ) {
    return Response.json({ error: "Invalid event cursor." }, { status: 400 });
  }

  const payload = await petRepository.liveGet(petId, parsedEventId);
  return Response.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
