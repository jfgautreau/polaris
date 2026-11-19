// Lectures du bilan « Campagne de formation » (règles dans `campagne-formation.ts`).
//
// ⚠️ RLS : appelé avec getServerClient() (bilan en lecture) → scopé au site courant.
// `contrat_periode` dépasse 1000 lignes : fetchAll. Les autres lectures sont bornées
// à UNE formation ou à UN jour.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { deriverArriveeDepart, type Periode } from "@/lib/personne-statut";
import {
  construireCampagne,
  type Campagne,
  type DetentionC,
  type FormationC,
  type PersonneC,
  type SuppressionC,
} from "@/lib/campagne-formation";

type Contrat = Periode & { personne_id: string };
export type FormationListe = FormationC & { groupe: string | null };

export async function chargerFormations(supabase: SupabaseClient): Promise<FormationListe[]> {
  const { data, error } = await supabase
    .from("competence")
    .select("id, nom, duree_validite_mois, groupe")
    .eq("actif", true)
    .order("groupe", { nullsFirst: false })
    .order("ordre")
    .order("nom")
    .returns<FormationListe[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function chargerCampagne(
  supabase: SupabaseClient,
  formation: FormationC,
  opts: {
    session: string;
    atelier: string;
    equipe: string;
    avecInterim: boolean;
    typesAgence: Set<string>;
    motifs: Map<string, string>; // motif_absence.id → libellé
    cleService: (p: PersonneC) => string;
  },
): Promise<Campagne> {
  const [det, suppr, pers, contrats, jour] = await Promise.all([
    supabase
      .from("personne_competence")
      .select("personne_id, date_obtention, date_expiration")
      .eq("competence_id", formation.id)
      .returns<DetentionC[]>(),
    supabase
      .from("personne_competence_historique")
      .select("personne_id, date_obtention, created_at")
      .eq("competence_id", formation.id)
      .eq("action", "suppression")
      .returns<SuppressionC[]>(),
    supabase
      .from("personne")
      .select("id, nom, prenom, type_contrat, atelier_id, equipe_id, poste_fixe_id")
      .eq("statut", "ACTIF")
      .returns<Omit<PersonneC, "depart">[]>(),
    fetchAll<Contrat>(() =>
      supabase.from("contrat_periode").select("personne_id, date_debut, date_fin").order("id").returns<Contrat[]>(),
    ),
    supabase
      .from("placement")
      .select("personne_id, motif_absence_id, tp")
      .eq("jour", opts.session)
      .or("motif_absence_id.not.is.null,tp.eq.true")
      .returns<{ personne_id: string; motif_absence_id: string | null; tp: boolean | null }[]>(),
  ]);
  for (const r of [det, suppr, pers, jour]) if (r.error) throw new Error(r.error.message);

  const parPersonne = new Map<string, Periode[]>();
  for (const c of contrats) {
    const l = parPersonne.get(c.personne_id);
    if (l) l.push(c);
    else parPersonne.set(c.personne_id, [c]);
  }
  const personnes: PersonneC[] = (pers.data ?? [])
    .filter(
      (p) =>
        (!opts.atelier || p.atelier_id === opts.atelier) &&
        (!opts.equipe || p.equipe_id === opts.equipe) &&
        (opts.avecInterim || !opts.typesAgence.has(p.type_contrat)),
    )
    .map((p) => ({ ...p, depart: deriverArriveeDepart(parPersonne.get(p.id) ?? []).date_depart_prevu }));

  const absences = new Map<string, string>();
  const tp = new Set<string>();
  for (const r of jour.data ?? []) {
    if (r.motif_absence_id) absences.set(r.personne_id, opts.motifs.get(r.motif_absence_id) ?? "absence");
    else if (r.tp) tp.add(r.personne_id);
  }

  return construireCampagne(formation, det.data ?? [], suppr.data ?? [], personnes, {
    session: opts.session,
    absences,
    tp,
    cleService: opts.cleService,
  });
}
