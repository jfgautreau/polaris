import type { SupabaseClient } from "@supabase/supabase-js";
import { peutActualiserFamille } from "@/lib/permissions";
import { LIBELLE_SANS_FAMILLE } from "@/lib/habilitations-familles";

// Contrôle du sous-droit « famille » avant toute écriture d'une habilitation
// (routes /api/habilitations, /autorisation, /commentaire). Rend le message de
// refus, ou null si l'écriture est permise. La formation est désignée par son id,
// ou par l'id de la ligne personne_competence. Lecture bornée au site.
export async function refusFamille(
  supabase: SupabaseClient,
  siteId: string,
  role: string,
  cible: { competenceId: string } | { habilitationId: string },
): Promise<string | null> {
  let groupe: string | null = null;
  if ("competenceId" in cible) {
    const { data, error } = await supabase
      .from("competence")
      .select("groupe")
      .eq("id", cible.competenceId)
      .eq("site_id", siteId)
      .maybeSingle<{ groupe: string | null }>();
    if (error) return error.message;
    if (!data) return "Formation inconnue ou hors de votre site.";
    groupe = data.groupe;
  } else {
    const { data, error } = await supabase
      .from("personne_competence")
      .select("competence:competence_id(groupe)")
      .eq("id", cible.habilitationId)
      .eq("site_id", siteId)
      .maybeSingle<{ competence: { groupe: string | null } | null }>();
    if (error) return error.message;
    if (!data) return "Habilitation introuvable ou hors de votre périmètre.";
    groupe = data.competence?.groupe ?? null;
  }
  if (await peutActualiserFamille(role, groupe)) return null;
  return `Votre rôle ne peut pas actualiser les habilitations de la famille « ${(groupe ?? "").trim() || LIBELLE_SANS_FAMILLE} ».`;
}
