import { unstable_cache } from "next/cache";
import { parRequete } from "@/lib/par-requete";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";

// Éléments masquables par site qui NE sont PAS des modules/menus de MODULES
// (donc pas de route ni d'entrée de nav) mais pilotés via la même table
// site_module. Ex. `guide` = affichage du lien « Guide utilisateur » dans le
// menu utilisateur. Défaut = visible ; une ligne site_module(guide) = masqué.
export const MASQUABLES_EXTRA = [
  { key: "guide", label: "Guide utilisateur" },
] as const;
export const CLES_MASQUABLES_EXTRA: string[] = MASQUABLES_EXTRA.map((m) => m.key);

// Modules (menus) MASQUÉS pour un site — pilotés depuis /platform par le
// super_admin (cf. migration 0056). Présence d'une ligne site_module =
// module masqué ; défaut = visible.
//
// Lecture MISE EN CACHE entre les requêtes depuis le 2026-10-14 (elle partait à
// chaque page et à chaque appel d'API). Un changement de menu reste visible tout
// de suite : /platform invalide MODULES_MASQUES_TAG à chaque bascule ;
// `revalidate` n'est qu'un filet pour une modification hors appli. Une erreur
// LÈVE dans le cache (rien n'est mémorisé) et l'appelant retombe sur « rien de
// masqué », comme avant. `parRequete` déduplique DANS une même requête.
export const MODULES_MASQUES_TAG = "socle-modules-masques";
const lireMasques = unstable_cache(
  async (site: string): Promise<string[]> => {
    const { data, error } = await getAdminClient()
      .from("site_module")
      .select("module_key")
      .eq("site_id", site);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.module_key as string);
  },
  ["socle-modules-masques"],
  { revalidate: 300, tags: [MODULES_MASQUES_TAG] }
);

const getMasquesBySite = parRequete(async function getMasquesBySite(site: string): Promise<Set<string>> {
  try {
    return new Set(await lireMasques(site));
  } catch {
    return new Set();
  }
});

// Ensemble des clés de modules masqués pour un site donné.
export async function getModulesMasques(siteId: string): Promise<Set<string>> {
  return getMasquesBySite(siteId);
}

// Idem pour le site courant (impersonation-aware via getCurrentSite).
export async function getModulesMasquesC(): Promise<Set<string>> {
  return getMasquesBySite((await getCurrentSite()).id);
}
