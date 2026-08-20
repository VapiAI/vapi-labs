export async function GET() {
  return Response.json(
    { status: "ok", service: "vapigotchi" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
