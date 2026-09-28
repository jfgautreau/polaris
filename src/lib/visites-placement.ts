// Avertissement du Placement et du Planning — « à vérifier avec les RH ».
//
// Le module Visites médicales est réservé aux RH : personne d'autre ne voit une
// date de visite, un avis ou une raison. Cette porte est la SEULE chose qui en
// sorte, et elle ne dit jamais pourquoi : un chef d'équipe apprend qu'il y a un
// point à vérifier, pas ce qu'il est.
//
// Chaque cas s'active séparément dans « Param. Visites → Alertes », et TOUS
// partent éteints : sur un module encore vide, chaque personne serait signalée
// et l'avertissement ne voudrait plus rien dire. Le premier à allumer sera
// la contrainte d'affectation — la seule qui soit une consigne d'organisation
// plutôt que la conséquence lisible d'un dossier médical.
//
// COÛT. Les contrôles activés partent ensemble, et chacun se limite à UNE
// personne. Quand aucun cas n'est coché — le réglage d'origine hors contrainte —
// la fonction ne lit rien de plus que les réglages.

import type { getServerClient } from "@/lib/supabase-server";
import { grouperAbsences } from "@/lib/absences-periodes";
import {
  REGIMES_DEFAUT,
  ajouterMoisIso,
  contrainteApplicable,
  lireParametres,
  plusTot,
  repriseDepuisPeriodes,
  type Contrainte,
} from "@/lib/visites";

type SupabaseClient = Awaited<ReturnType<typeof getServerClient>>;

const MSG_GENERIQUE = "Point à vérifier avec les RH avant de placer cette personne.";

/**
 * Motifs d'avertissement pour une affectation, sans aucun détail médical.
 * Tableau vide = rien à signaler.
 */
export async function alertesVisite(
  supabase: SupabaseClient,
  opts: { personne_id: string; poste_id: string; quart: string | null; jour: string; siteId: string },
): Promise<string[]> {
  const { personne_id, poste_id, quart, jour, siteId } = opts;

  const { data: reglages } = await supabase
    .from("visite_parametre")
    .select("cle, valeur")
    .eq("site_id", siteId)
    .returns<{ cle: string; valeur: string }[]>();
  const params = lireParametres(reglages);
  if (
    !params.alertePlacementContrainte &&
    !params.alertePlacementAnci &&
    !params.alertePlacementSir &&
    !params.alertePlacementReprise
  ) {
    return [];
  }

  const besoinPoste = params.alertePlacementAnci || params.alertePlacementSir;
  const besoinVisites = params.alertePlacementAnci || params.alertePlacementSir || params.alertePlacementReprise;

  const [contraintesRes, posteRes, visitesRes] = await Promise.all([
    params.alertePlacementContrainte
      ? supabase
          .from("contrainte_affectation")
          .select("quart_code, poste_id, date_debut, date_fin")
          .eq("site_id", siteId)
          .eq("personne_id", personne_id)
          .returns<Contrainte[]>()
      : null,
    besoinPoste
      ? supabase
          .from("poste")
          .select("suivi_renforce, anci_usage")
          .eq("id", poste_id)
          .eq("site_id", siteId)
          .maybeSingle<{ suivi_renforce: boolean; anci_usage: string | null }>()
      : null,
    besoinVisites
      ? supabase
          .from("visite")
          .select("date_visite, prochaine_date, type:type_id(categorie), anci:visite_anci(usage_code)")
          .eq("site_id", siteId)
          .eq("personne_id", personne_id)
          .not("date_visite", "is", null)
          .returns<VisiteJointe[]>()
      : null,
  ]);

  const out: string[] = [];

  if (params.alertePlacementContrainte) {
    for (const c of contraintesRes?.data ?? []) {
      if (!contrainteApplicable(c, jour, quart, poste_id)) continue;
      out.push(
        c.quart_code && c.quart_code === quart
          ? "Contrainte d'affectation sur ce quart (voir RH)."
          : "Contrainte d'affectation sur ce poste (voir RH).",
      );
      break;
    }
  }

  const poste = posteRes?.data ?? null;
  const visites = visitesRes?.data ?? [];

  // Attestation de non contre-indication exigée par le poste.
  //
  // La validité se mesure ici avec le plafond le PLUS LONG du site (suivi
  // simple) : au Placement on préfère se taire qu'alarmer à tort, et l'écran RH
  // reste la référence, lui qui connaît le régime réel de la personne.
  if (params.alertePlacementAnci && poste?.anci_usage) {
    const plafond = Math.max(...REGIMES_DEFAUT.map((r) => r.mois));
    const valide = visites.some((v) => {
      if (!v.date_visite || !(v.anci ?? []).some((a) => a.usage_code === poste.anci_usage)) return false;
      const terme = plusTot(ajouterMoisIso(v.date_visite, plafond), v.prochaine_date);
      return !!terme && terme >= jour;
    });
    if (!valide) out.push(MSG_GENERIQUE);
  }

  // Poste à suivi renforcé : un examen d'aptitude doit être en cours de validité.
  if (params.alertePlacementSir && poste?.suivi_renforce && !out.includes(MSG_GENERIQUE)) {
    const plafond = REGIMES_DEFAUT.find((r) => r.code === "renforce")!.mois;
    const apte = visites.some((v) => {
      const cat = v.type?.categorie;
      if (!v.date_visite || (cat !== "initiale" && cat !== "periodique")) return false;
      const terme = plusTot(ajouterMoisIso(v.date_visite, plafond), v.prochaine_date);
      return !!terme && terme >= jour;
    });
    if (!apte) out.push(MSG_GENERIQUE);
  }

  // Retour d'absence longue sans visite de reprise enregistrée.
  if (params.alertePlacementReprise && !out.includes(MSG_GENERIQUE)) {
    const { data: motifs } = await supabase
      .from("motif_absence")
      .select("id, libelle")
      .eq("site_id", siteId)
      .eq("visite_reprise", true)
      .returns<{ id: string; libelle: string }[]>();
    const comptes = new Map((motifs ?? []).map((m) => [m.id, m.libelle] as const));
    if (comptes.size) {
      const depuis = isoMoins(jour, 550);
      const { data: jours } = await supabase
        .from("placement")
        .select("jour, motif_absence_id")
        .eq("site_id", siteId)
        .eq("personne_id", personne_id)
        .gte("jour", depuis)
        .in("motif_absence_id", [...comptes.keys()])
        .returns<{ jour: string; motif_absence_id: string | null }[]>();
      const reprise = repriseDepuisPeriodes(grouperAbsences(jours ?? []), comptes, params.repriseJours);
      const faite =
        reprise &&
        visites.some((v) => v.type?.categorie === "reprise" && v.date_visite && v.date_visite >= reprise.fin);
      if (reprise && !faite) out.push(MSG_GENERIQUE);
    }
  }

  return out;
}

type VisiteJointe = {
  date_visite: string | null;
  prochaine_date: string | null;
  type: { categorie: string } | null;
  anci: { usage_code: string }[] | null;
};

function isoMoins(iso: string, jours: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - jours);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
