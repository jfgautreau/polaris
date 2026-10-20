// Lectures du bilan « Recyclages à prévoir » (règles dans `recyclages.ts`).
//
// ⚠️ RLS : appelé avec getServerClient() (bilan en lecture) → scopé au site
// courant automatiquement. `personne_competence` et `contrat_periode` dépassent
// 1000 lignes : fetchAll obligatoire.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { deriverArriveeDepart, type Periode } from "@/lib/personne-statut";
import {
  construireRecyclages,
  formationsSansEcheance,
  type Detention,
  type Formation,
  type Horizon,
  type LigneRecyclage,
  type PersonneR,
  type TypeFormation,
} from "@/lib/recyclages";

type PersonneRow = Omit<PersonneR, "depart">;
type Contrat = Periode & { personne_id: string };

export type DonneesRecyclages = {
  lignes: LigneRecyclage[];
  // Formations à recycler du site (pour le menu de choix), après filtre de type.
  formations: Formation[];
  sansEcheance: Formation[];
  existeNonClassees: boolean;
};

export async function chargerRecyclages(
  supabase: SupabaseClient,
  opts: { type: TypeFormation | ""; horizon: Horizon; formation: string; atelier: string; equipe: string },
): Promise<DonneesRecyclages> {
  const [{ data: fD }, det, { data: pD }, contrats] = await Promise.all([
    supabase
      .from("competence")
      .select("id, nom, categorie, duree_validite_mois, ordre")
      .eq("a_recycler", true)
      .eq("actif", true)
      .order("ordre")
      .order("nom")
      .returns<Formation[]>(),
    fetchAll<Detention>(() =>
      supabase
        .from("personne_competence")
        .select("personne_id, competence_id, date_obtention, date_expiration")
        .order("id")
        .returns<Detention[]>(),
    ),
    supabase
      .from("personne")
      .select("id, nom, prenom, type_contrat, atelier_id, equipe_id")
      .eq("statut", "ACTIF")
      .returns<PersonneRow[]>(),
    fetchAll<Contrat>(() =>
      supabase.from("contrat_periode").select("personne_id, date_debut, date_fin").order("id").returns<Contrat[]>(),
    ),
  ]);

  const toutes = fD ?? [];
  const parPersonne = new Map<string, Periode[]>();
  for (const c of contrats) {
    const l = parPersonne.get(c.personne_id);
    if (l) l.push(c);
    else parPersonne.set(c.personne_id, [c]);
  }
  const personnes: PersonneR[] = (pD ?? [])
    .filter((p) => (!opts.atelier || p.atelier_id === opts.atelier) && (!opts.equipe || p.equipe_id === opts.equipe))
    .map((p) => ({ ...p, depart: deriverArriveeDepart(parPersonne.get(p.id) ?? []).date_depart_prevu }));

  const formations = toutes.filter((f) => {
    if (!opts.type) return true;
    const c = f.categorie === "reglementaire" || f.categorie === "interne" ? f.categorie : "aucune";
    return c === opts.type;
  });
  return {
    lignes: construireRecyclages(toutes, det, personnes, { type: opts.type, horizon: opts.horizon, formation: opts.formation }),
    formations,
    sansEcheance: formationsSansEcheance(formations, det),
    existeNonClassees: toutes.some((f) => f.categorie !== "reglementaire" && f.categorie !== "interne"),
  };
}
