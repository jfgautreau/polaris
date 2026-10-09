import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { ligneSortDUneNuit, veille, type DonneesNuit } from "@/lib/nuit-avant";

// Lecture des données de la règle « nuit avant » (0087) pour une liste de
// jours. Chaque lecture est bornée par site_id : le module sert aussi bien le
// client RLS que le client service_role (TV publique).
//
// Rend deux fonctions : par poste (horaires, via la ligne du poste) et par
// ligne. Site sans quart de nuit : une seule petite lecture, puis toujours
// « non ».
export type NuitsAvant = {
  parPoste: (posteId: string, iso: string) => boolean;
  parLigne: (ligneId: string, iso: string) => boolean;
};

const AUCUNE: NuitsAvant = { parPoste: () => false, parLigne: () => false };

export async function chargerNuitsAvant(supabase: SupabaseClient, siteId: string, isos: string[]): Promise<NuitsAvant> {
  if (!isos.length) return AUCUNE;
  const { data: qn } = await supabase
    .from("quart")
    .select("code")
    .eq("site_id", siteId)
    .eq("nuit", true)
    .returns<{ code: string }[]>();
  const quartsNuit = (qn ?? []).map((q) => q.code);
  if (!quartsNuit.length) return AUCUNE;

  const veilles = [...new Set(isos.map(veille))];
  const [jq, fermees, postes, pq] = await Promise.all([
    supabase
      .from("jour_quart")
      .select("quart_code, jour, actif")
      .eq("site_id", siteId)
      .in("quart_code", quartsNuit)
      .in("jour", veilles)
      .returns<{ quart_code: string; jour: string; actif: boolean }[]>(),
    fetchAll<{ ligne_id: string; quart_code: string; jour: string }>(() =>
      supabase
        .from("ouverture_quart")
        .select("ligne_id, quart_code, jour")
        .eq("site_id", siteId)
        .eq("ouverte", false)
        .in("quart_code", quartsNuit)
        .in("jour", veilles)
        .order("jour")
        .order("ligne_id")
        .order("quart_code")
        .returns<{ ligne_id: string; quart_code: string; jour: string }[]>(),
    ),
    supabase
      .from("poste")
      .select("id, ligne_id")
      .eq("site_id", siteId)
      .eq("actif", true)
      .returns<{ id: string; ligne_id: string | null }[]>(),
    fetchAll<{ poste_id: string; quart_code: string; actif: boolean }>(() =>
      supabase
        .from("poste_quart")
        .select("poste_id, quart_code, actif")
        .eq("site_id", siteId)
        .in("quart_code", quartsNuit)
        .order("poste_id")
        .order("quart_code")
        .returns<{ poste_id: string; quart_code: string; actif: boolean }[]>(),
    ),
  ]);

  // Un poste tourne sur un quart sauf « – » explicite (aucune ligne poste_quart
  // = tourne, même règle que src/lib/poste-quart.ts).
  const etat = new Map(pq.map((r) => [`${r.poste_id}:${r.quart_code}`, r.actif]));
  const posteLigne = new Map<string, string>();
  const lignesQuiTournent = new Set<string>();
  for (const p of postes.data ?? []) {
    if (!p.ligne_id) continue;
    posteLigne.set(p.id, p.ligne_id);
    for (const q of quartsNuit) if (etat.get(`${p.id}:${q}`) !== false) lignesQuiTournent.add(`${q}:${p.ligne_id}`);
  }
  const d: DonneesNuit = {
    quartsNuit,
    quartsActifs: new Set((jq.data ?? []).filter((r) => r.actif).map((r) => `${r.quart_code}:${r.jour}`)),
    lignesFermees: new Set(fermees.map((r) => `${r.quart_code}:${r.ligne_id}:${r.jour}`)),
    lignesQuiTournent,
  };
  return {
    parLigne: (ligneId, iso) => ligneSortDUneNuit(d, ligneId, iso),
    parPoste: (posteId, iso) => {
      const l = posteLigne.get(posteId);
      return !!l && ligneSortDUneNuit(d, l, iso);
    },
  };
}
