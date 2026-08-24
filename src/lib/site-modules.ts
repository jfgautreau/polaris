import { cache } from "react";
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
// Lecture NON mise en cache inter-requête (contrairement à refdata) : un
// changement de menu doit se refléter tout de suite à la navigation suivante,
// sans attendre l'expiration d'un cache. `cache()` de React déduplique quand
// même l'appel DANS une même requête (requireModule + AppHeader). La table est
// minuscule et indexée par site_id : le coût est négligeable.

const getMasquesBySite = cache(async function getMasquesBySite(site: string): Promise<Set<string>> {
  const { data } = await getAdminClient()
    .from("site_module")
    .select("module_key")
    .eq("site_id", site);
  return new Set((data ?? []).map((r) => r.module_key as string));
});

// Ensemble des clés de modules masqués pour un site donné.
export async function getModulesMasques(siteId: string): Promise<Set<string>> {
  return getMasquesBySite(siteId);
}

// Idem pour le site courant (impersonation-aware via getCurrentSite).
export async function getModulesMasquesC(): Promise<Set<string>> {
  return getMasquesBySite((await getCurrentSite()).id);
}
