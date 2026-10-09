import { getAdminClient } from "@/lib/supabase-server";

// Noms affichables de comptes (auteurs d'une saisie, d'une suppression…).
// La table des comptes n'est pas lisible par tous les rôles : lecture en
// service_role, bornée au site courant — un compte d'un autre site (support)
// reste sans nom, l'écran affiche alors son repli.
export async function nomsDeComptes(ids: string[], siteId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniques = [...new Set(ids.filter(Boolean))];
  if (!uniques.length) return out;
  const { data } = await getAdminClient()
    .from("app_user")
    .select("user_id, name, email")
    .eq("site_id", siteId)
    .in("user_id", uniques)
    .returns<{ user_id: string; name: string | null; email: string | null }[]>();
  for (const u of data ?? []) out.set(u.user_id, u.name || u.email || "");
  return out;
}
