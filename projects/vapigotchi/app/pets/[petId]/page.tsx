import { PetExperience } from "@/components/PetExperience";

export default async function PetPage({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  const { petId } = await params;
  const featured = petId === "main" || petId === "chorizo";
  const language = petId === "chorizo" ? "es" : "en";

  return (
    <PetExperience featured={featured} language={language} petId={petId} />
  );
}
