import { petState } from "@/lib/petState";
import { vapiWebhookApply } from "@/lib/vapiWebhookApply";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ petId: string }> },
) {
  const { petId } = await params;
  if (!petState.isValidPetId(petId)) {
    return Response.json({ error: "Invalid pet ID." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  const result = await vapiWebhookApply(petId, payload);
  return Response.json({ received: true, ...result });
}
