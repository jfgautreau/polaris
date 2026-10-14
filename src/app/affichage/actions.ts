"use server";

import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";

// Version des données d'un site, pour la mise à jour ÉCONOME de l'écran TV
// (2026-10-14) : l'écran ne se recharge que si quelque chose a changé depuis son
// dernier affichage. La version = identifiant de la dernière ligne du journal
// d'audit du site (toute écriture applicative y laisse une ligne). Une seule
// petite lecture, au lieu d'une vingtaine pour un rechargement complet.
//
// Server action et non route API : l'affichage TV est public (pas de session) ;
// cette action ne renvoie qu'un nombre, aucune donnée. Le site est celui de la
// requête (getCurrentSite), comme pour la page elle-même.
export async function versionDonnees(): Promise<string> {
  const site = await getCurrentSite();
  const { data, error } = await getAdminClient()
    .from("audit_log")
    .select("id")
    .eq("site_id", site.id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: number }>();
  if (error) return "";
  return String(data?.id ?? 0);
}
