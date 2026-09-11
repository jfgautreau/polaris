// Validité datée d'une ligne ou d'un poste (migration 0071). Même esprit que le
// cycle de vie du personnel (src/lib/personne-statut.ts) : `actif` reste le
// coupe-circuit manuel immédiat, et deux dates PRÉVISIONNELLES nullables ouvrent
// / ferment l'élément à une date donnée.
//
// Visibilité effective à une date J (ISO « YYYY-MM-DD ») :
//   actif ET (date_ouverture ∅ OU J >= date_ouverture)
//         ET (date_fermeture ∅ OU J <= date_fermeture).
//
// Les écrans passent la DATE DU JOUR : quand la fermeture est atteinte, la ligne
// / le poste disparaît de lui-même — aucun geste manuel le jour J.
//
// Le chargement des dates (chargerValidites) est TOLÉRANT à l'absence des
// colonnes (avant exécution de la migration 0071) : il renvoie alors une map
// vide → actifLe retombe sur le seul `actif`, comportement identique à avant.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Validite = { date_ouverture: string | null; date_fermeture: string | null };
export type ValiditeMap = Map<string, Validite>;

// Vrai si l'élément est visible à la date `iso`. `actif=false` coupe toujours.
export function actifLe(
  e: { actif?: boolean | null; date_ouverture?: string | null; date_fermeture?: string | null } | undefined,
  iso: string
): boolean {
  if (!e) return true; // pas d'info de validité → on ne masque pas
  if (e.actif === false) return false;
  if (e.date_ouverture && iso < e.date_ouverture) return false;
  if (e.date_fermeture && iso > e.date_fermeture) return false;
  return true;
}

// Charge les dates d'ouverture/fermeture d'une table (`ligne` ou `poste`) dans
// une Map indexée par id. Tolère l'absence des colonnes (migration 0071 non
// passée) → Map vide.
export async function chargerValidites(supabase: SupabaseClient, table: "ligne" | "poste"): Promise<ValiditeMap> {
  const m: ValiditeMap = new Map();
  const { data, error } = await supabase
    .from(table)
    .select("id, date_ouverture, date_fermeture")
    .returns<{ id: string; date_ouverture: string | null; date_fermeture: string | null }[]>();
  if (error) return m; // colonnes absentes → repli sur `actif` seul
  for (const r of data ?? []) m.set(r.id, { date_ouverture: r.date_ouverture, date_fermeture: r.date_fermeture });
  return m;
}
