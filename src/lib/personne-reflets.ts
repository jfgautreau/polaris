import type { SupabaseClient } from "@supabase/supabase-js";

// Reflets dénormalisés d'une fiche `personne`, recalculés depuis ses périodes.
// Partagés par /api/personnel (après chaque saisie de contrat ou de temps
// partiel) et /api/personnel/merge (après une fusion, qui apporte les contrats
// et périodes du doublon) : sans ce recalcul, la fiche gardée affichait encore
// le contrat de son ancienne vie (intérim) alors que le cycle de vie montrait
// le CDI arrivé du doublon (bug du 2026-11-04).

type PeriodeRow = {
  type_contrat: string;
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  created_at: string;
};

// Recalcule le reflet denormalise de personne a partir de la periode la plus
// recente (date_debut desc, nulls en dernier, puis created_at desc), et
// renvoie AUSSI les dates derivees pour rafraichir l'ecran :
//   • contrat_debut       : plus ancien date_debut (alerte 18 mois).
//   • date_arrivee_calc   : idem — l'arrivee = 1er contrat.
//   • date_depart_prevu_calc : MAX(date_fin) si tous les contrats sont fermes,
//     sinon null (au moins un CDI ouvert). Miroir de la fonction SQL 0050
//     personne_arrivee_depart. Le statut de personne est reactualise cote DB
//     par le trigger sync_statut_from_contrats.
export async function syncPersonneFromPeriodes(
  supabase: SupabaseClient,
  personne_id: string,
  siteId: string,
): Promise<{
  type_contrat: string;
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  contrat_debut: string | null;
  date_arrivee: string | null;
  date_depart_prevu: string | null;
} | null> {
  try {
    const { data } = await supabase
      .from("contrat_periode")
      .select("type_contrat, agence_interim, date_debut, date_fin, created_at")
      .eq("personne_id", personne_id)
      .eq("site_id", siteId)
      .returns<PeriodeRow[]>();
    const periods = data ?? [];
    if (periods.length === 0) return null;
    periods.sort((a, b) => {
      const da = a.date_debut ?? "";
      const db = b.date_debut ?? "";
      if (da !== db) return db.localeCompare(da); // dates reelles d'abord, null en dernier
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
    const latest = periods[0];
    const reflet = {
      type_contrat: latest.type_contrat,
      agence_interim: latest.agence_interim,
      date_debut: latest.date_debut,
      date_fin: latest.date_fin,
    };
    const { error: refletErr } = await supabase.from("personne").update(reflet).eq("id", personne_id).eq("site_id", siteId);
    if (refletErr) throw refletErr;
    // Debut du contrat le PLUS ANCIEN = date d'arrivee.
    const debuts = periods.map((p) => p.date_debut).filter((d): d is string => !!d).sort();
    const arrivee = debuts[0] ?? null;
    // Depart = MAX(date_fin) UNIQUEMENT si aucun contrat ouvert.
    const auMoinsUnOuvert = periods.some((p) => p.date_debut && p.date_fin === null);
    const fins = periods.map((p) => p.date_fin).filter((d): d is string => !!d).sort();
    const depart = auMoinsUnOuvert ? null : fins[fins.length - 1] ?? null;
    return {
      ...reflet,
      contrat_debut: arrivee,
      date_arrivee: arrivee,
      date_depart_prevu: depart,
    };
  } catch {
    // table absente (migration 0017 non encore appliquee) -> on ignore
    return null;
  }
}

// Synchronise personne.temps_partiel + tp_config avec la période TP active
// (courante ou prochaine future). Appelé après chaque CRUD sur tp_periode.
export async function syncPersonneTP(supabase: SupabaseClient, personne_id: string, siteId: string) {
  const today = new Date().toISOString().slice(0, 10);
  // Période courante : date_debut ≤ today AND (date_fin IS NULL OR date_fin ≥ today).
  const { data: courant } = await supabase
    .from("tp_periode")
    .select("tp_config")
    .eq("personne_id", personne_id)
    .eq("site_id", siteId)
    .lte("date_debut", today)
    .or(`date_fin.is.null,date_fin.gte.${today}`)
    .order("date_debut", { ascending: false })
    .limit(1)
    .single();
  if (courant) {
    const { error } = await supabase.from("personne").update({ temps_partiel: true, tp_config: courant.tp_config }).eq("id", personne_id).eq("site_id", siteId);
    if (error) throw error;
  } else {
    // Pas de période courante : vérifier s'il y a une période future.
    const { data: future } = await supabase
      .from("tp_periode")
      .select("id")
      .eq("personne_id", personne_id)
      .eq("site_id", siteId)
      .gt("date_debut", today)
      .limit(1);
    if (!future?.length) {
      // Aucune période courante ni future → temps plein.
      const { error } = await supabase.from("personne").update({ temps_partiel: false, tp_config: null }).eq("id", personne_id).eq("site_id", siteId);
      if (error) throw error;
    }
    // Si période future seulement, on laisse le flag actuel (la personne est
    // à temps plein maintenant, le flag passera à true quand la période débutera).
  }
}
