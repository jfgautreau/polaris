"use server";

import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";
import { getCurrentProfile } from "@/lib/current-user";
import { canRead, getPermissions } from "@/lib/permissions";

// Version renvoyée hors session (ou sans le droit) : différente de toute version
// réelle, elle fait recharger l'écran, qui part alors sur la page de connexion
// au lieu de rester figé sur des données périmées.
const HORS_SESSION = "hors-session";

// Version des données d'un site, pour la mise à jour ÉCONOME de l'écran TV
// (2026-10-14) : l'écran ne se recharge que si quelque chose a changé depuis son
// dernier affichage. La version = identifiant de la dernière ligne du journal
// d'audit du site (toute écriture applicative y laisse une ligne). Une seule
// petite lecture, au lieu d'une vingtaine pour un rechargement complet.
//
// Server action : même garde que la page (droit « affichage », compte requis
// depuis le 2026-11-03) ; elle ne renvoie qu'un nombre, aucune donnée. Le site est
// celui du compte (getCurrentSite), comme pour la page elle-même.
export async function versionDonnees(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile || !canRead(await getPermissions(profile.role), "affichage")) return HORS_SESSION;
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
