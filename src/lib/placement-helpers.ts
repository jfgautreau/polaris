// Helpers partagés par les routes d'écriture de placement (/api/placement/cell
// et /api/placement/move) : contrôle d'habilitation et attribution du premier
// numéro de rotation libre. Extraits pour ne pas diverger entre les deux écrans.
import type { getServerClient } from "@/lib/supabase-server";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { parseNumeros } from "@/lib/numeros-rotation";
import { quartOuDefaut, memeQuart, type QuartRef } from "@/lib/quarts";

type SupabaseClient = Awaited<ReturnType<typeof getServerClient>>;

// Habilitations exigees par le poste que la personne n'a pas (ou plus). Recalcule
// ici plutot que de croire le client : le drapeau de forcage sert de trace d'audit.
export async function habManquantes(
  supabase: SupabaseClient,
  personne_id: string,
  poste_id: string,
  siteId: string,
): Promise<string[]> {
  const { data: reqs } = await supabase
    .from("poste_competence_requise")
    .select("competence_id, competence:competence_id(nom, duree_validite_mois)")
    .eq("poste_id", poste_id)
    .eq("site_id", siteId)
    .returns<{ competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null }[]>();
  if (!reqs?.length) return [];

  const { data: det } = await supabase
    .from("personne_competence")
    .select("competence_id, date_obtention, date_expiration")
    .eq("personne_id", personne_id)
    .eq("site_id", siteId)
    .in("competence_id", reqs.map((r) => r.competence_id))
    .returns<{ competence_id: string; date_obtention: string | null; date_expiration: string | null }[]>();

  const parComp = new Map((det ?? []).map((d) => [d.competence_id, d]));
  return reqs
    .filter((r) => {
      const d = parComp.get(r.competence_id);
      if (!d) return true;
      // date_expiration est stockee a la saisie : repli sur obtention + duree.
      const exp = d.date_expiration ?? addMonthsIso(d.date_obtention, r.competence?.duree_validite_mois);
      return !habValable({ expiration: exp });
    })
    .map((r) => r.competence?.nom ?? "habilitation");
}

// Premier numero de rotation encore libre sur ce poste, ce jour et ce quart.
// `null` si le poste n'est pas numerote, ou si toutes les places numerotees sont
// prises : la personne rejoint alors la zone « sans numero » de la tuile.
export async function premierNumeroLibre(
  supabase: SupabaseClient,
  poste_id: string,
  jour: string,
  quart_code: string | null,
  personne_id: string,
  quarts: QuartRef[],
  siteId: string,
): Promise<string | null> {
  const { data: poste } = await supabase
    .from("poste")
    .select("numero_rotation")
    .eq("id", poste_id)
    .eq("site_id", siteId)
    .maybeSingle<{ numero_rotation: string | null }>();
  const numeros = parseNumeros(poste?.numero_rotation);
  if (!numeros.length) return null;

  const { data: occ } = await supabase
    .from("placement")
    .select("personne_id, numero_rotation, quart_code")
    .eq("jour", jour)
    .eq("poste_id", poste_id)
    .eq("site_id", siteId)
    .returns<{ personne_id: string; numero_rotation: string | null; quart_code: string | null }[]>();

  const q = quartOuDefaut(quart_code, quarts);
  const pris = new Set(
    (occ ?? [])
      .filter((r) => r.personne_id !== personne_id && memeQuart(r.quart_code, q, quarts) && r.numero_rotation)
      .map((r) => r.numero_rotation as string),
  );
  return numeros.find((n) => !pris.has(n)) ?? null;
}
