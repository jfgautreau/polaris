import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { addMonthsIso } from "@/lib/habilitations";
import { avecLotJournal } from "@/lib/journal-contexte";

// Recalcul des échéances d'une formation après un changement de sa durée de
// validité (Param. Habilitation, Compétences). L'échéance est STOCKÉE à la
// saisie (date de passage + durée) : sans ce recalcul, passer l'EPI de 24 à 36
// mois laissait toutes les habilitations déjà saisies sur 24 mois (113 fiches
// au Bignon, 2026-11-04), et une durée ajoutée après coup laissait les
// échéances vides. Durée retirée = la formation n'expire plus (échéance vide).
//
// `supabase` : client service_role (l'appelant a vérifié le droit du module).
// Une seule requête d'écriture par tranche de 500, une seule ligne au Journal.
export async function recalculerEcheances(
  supabase: SupabaseClient,
  competenceId: string,
  siteId: string,
  duree: number | null,
  libelle: string,
): Promise<number> {
  type Ligne = {
    id: string;
    personne_id: string;
    competence_id: string;
    date_obtention: string | null;
    date_expiration: string | null;
  };
  const lignes = await fetchAll<Ligne>(() =>
    supabase
      .from("personne_competence")
      .select("id, personne_id, competence_id, date_obtention, date_expiration")
      .eq("competence_id", competenceId)
      .eq("site_id", siteId)
      .order("id")
      .returns<Ligne[]>(),
  );
  const aEcrire = lignes
    .map((l) => ({ ...l, cible: addMonthsIso(l.date_obtention, duree) }))
    .filter((l) => l.cible !== l.date_expiration)
    .map((l) => ({
      personne_id: l.personne_id,
      competence_id: l.competence_id,
      date_obtention: l.date_obtention,
      date_expiration: l.cible,
      site_id: siteId,
    }));
  if (aEcrire.length === 0) return 0;

  await avecLotJournal(siteId, `Échéances recalculées : ${libelle} (${aEcrire.length})`, async () => {
    for (let i = 0; i < aEcrire.length; i += 500) {
      const { error } = await supabase
        .from("personne_competence")
        .upsert(aEcrire.slice(i, i + 500), { onConflict: "personne_id,competence_id" });
      if (error) throw error;
    }
  });
  return aEcrire.length;
}
