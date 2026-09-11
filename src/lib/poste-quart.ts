// Effectif requis par (poste × quart) — les TROIS états d'une case de quart au
// Référentiel :
//   • aucune ligne poste_quart  → repli : le poste tourne au défaut du poste
//     (`poste.effectif_requis`). C'est le comportement HISTORIQUE d'avant la
//     migration 0070 (défaut actif, la table ne stockait que les désactivations)
//     et celui d'un poste tout juste créé, sans détail par quart ;
//   • ligne `actif = false`      → « – » : le poste NE TOURNE PAS sur ce quart ;
//   • ligne `actif = true`       → le poste tourne, effectif = `effectif_requis`
//     de la ligne (0 = « tourne mais 0 requis », N = N personnes). Repli sur le
//     défaut du poste si la colonne n'est pas encore renseignée.
//
// ⚠️ « – » (ne tourne pas) et « 0 » (tourne à 0) sont deux états DISTINCTS :
// un poste actif à 0 existait déjà avant 0070 et reste visible dans le planning.
//
// La table est site-scopée : appelée via getServerClient(), elle ne rend que le
// site courant. Le chargement TOLÈRE l'absence de la colonne `effectif_requis`
// (avant exécution de la migration 0070 dans Supabase) → repli sur le défaut poste,
// donc le comportement reste identique à aujourd'hui tant que la migration n'est
// pas passée.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";

export type PqEtat = { actif: boolean; effectif: number | null };
export type PqMap = Map<string, PqEtat>;

const cle = (posteId: string, quart: string) => `${posteId}:${quart}`;

// Charge toutes les lignes poste_quart du site courant dans une Map indexée
// `${poste_id}:${quart_code}`. fetchAll + ordre déterministe (la table peut
// dépasser 1000 lignes une fois l'effectif matérialisé par quart, cf. règle 7).
export async function chargerPosteQuart(supabase: SupabaseClient): Promise<PqMap> {
  const m: PqMap = new Map();
  // Sonde : la colonne effectif_requis existe-t-elle ? (migration 0070)
  const probe = await supabase.from("poste_quart").select("effectif_requis").limit(1);
  const cols = probe.error ? "poste_id, quart_code, actif" : "poste_id, quart_code, actif, effectif_requis";
  const rows = await fetchAll<{ poste_id: string; quart_code: string; actif: boolean; effectif_requis?: number | null }>(() =>
    supabase.from("poste_quart").select(cols).order("poste_id").order("quart_code").returns<{ poste_id: string; quart_code: string; actif: boolean; effectif_requis?: number | null }[]>()
  );
  for (const r of rows) m.set(cle(r.poste_id, r.quart_code), { actif: r.actif, effectif: r.effectif_requis ?? null });
  return m;
}

// Les trois états résolus pour un (poste, quart). `posteEff` = poste.effectif_requis,
// utilisé comme repli quand aucune ligne n'existe ou que l'effectif n'est pas renseigné.
export function etatQuart(pq: PqMap, posteId: string, quart: string, posteEff: number): { tourne: boolean; effectif: number } {
  const r = pq.get(cle(posteId, quart));
  if (r === undefined) return { tourne: true, effectif: posteEff }; // repli : aucune ligne = tourne au défaut
  if (!r.actif) return { tourne: false, effectif: 0 }; // « – » : ne tourne pas
  return { tourne: true, effectif: r.effectif ?? posteEff }; // tourne : 0 ou N (repli si null)
}

// Le poste tourne-t-il sur ce quart ? (« – » = false, « 0 » et « N » = true)
export const tourneSurQuart = (pq: PqMap, posteId: string, quart: string, posteEff = 0): boolean =>
  etatQuart(pq, posteId, quart, posteEff).tourne;

// Effectif requis sur ce quart (0 si le poste n'y tourne pas).
export const effectifSurQuart = (pq: PqMap, posteId: string, quart: string, posteEff = 0): number => {
  const e = etatQuart(pq, posteId, quart, posteEff);
  return e.tourne ? e.effectif : 0;
};
