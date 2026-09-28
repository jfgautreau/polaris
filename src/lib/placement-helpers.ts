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
  // Perf (2026-09-28) : les deux lectures partent ENSEMBLE. On lit toutes les
  // habilitations de la personne (quelques dizaines de lignes au plus) plutot que
  // d'attendre la liste des exigences pour filtrer : un aller-retour de moins par
  // saisie. Le filtrage se fait ci-dessous, sur les seules exigences du poste.
  const [{ data: reqs }, { data: det }] = await Promise.all([
    supabase
      .from("poste_competence_requise")
      .select("competence_id, competence:competence_id(nom, duree_validite_mois)")
      .eq("poste_id", poste_id)
      .eq("site_id", siteId)
      .returns<{ competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null }[]>(),
    supabase
      .from("personne_competence")
      .select("competence_id, date_obtention, date_expiration")
      .eq("personne_id", personne_id)
      .eq("site_id", siteId)
      .returns<{ competence_id: string; date_obtention: string | null; date_expiration: string | null }[]>(),
  ]);
  if (!reqs?.length) return [];

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
  // Perf (2026-09-28) : numeros du poste et places occupees lus ENSEMBLE.
  const [{ data: poste }, { data: occ }] = await Promise.all([
    supabase
      .from("poste")
      .select("numero_rotation")
      .eq("id", poste_id)
      .eq("site_id", siteId)
      .maybeSingle<{ numero_rotation: string | null }>(),
    supabase
      .from("placement")
      .select("personne_id, numero_rotation, quart_code")
      .eq("jour", jour)
      .eq("poste_id", poste_id)
      .eq("site_id", siteId)
      .returns<{ personne_id: string; numero_rotation: string | null; quart_code: string | null }[]>(),
  ]);
  const numeros = parseNumeros(poste?.numero_rotation);
  if (!numeros.length) return null;

  const q = quartOuDefaut(quart_code, quarts);
  const pris = new Set(
    (occ ?? [])
      .filter((r) => r.personne_id !== personne_id && memeQuart(r.quart_code, q, quarts) && r.numero_rotation)
      .map((r) => r.numero_rotation as string),
  );
  return numeros.find((n) => !pris.has(n)) ?? null;
}

// Cycle du poste (2026-09-28) : vrai si le poste est marqué « – » (ne tourne
// pas) sur ce quart au Référentiel. Aucune ligne poste_quart = le poste tourne
// (repli historique, cf. src/lib/poste-quart.ts). Partagé par les routes
// d'écriture de placement (cell, move) — la copie filtre en lot.
export async function posteNeTournePas(
  supabase: SupabaseClient,
  poste_id: string,
  quart: string,
  siteId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("poste_quart")
    .select("actif")
    .eq("poste_id", poste_id)
    .eq("quart_code", quart)
    .eq("site_id", siteId)
    .maybeSingle<{ actif: boolean }>();
  return data?.actif === false;
}
export const MSG_HORS_CYCLE =
  "Ce poste ne tourne pas sur ce quart (Référentiel) : affectation refusée. Choisissez le quart où le poste tourne, ou modifiez son cycle au Référentiel.";
