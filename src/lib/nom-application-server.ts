import { unstable_cache } from "next/cache";
import { parRequete } from "@/lib/par-requete";
import { getAdminClient } from "@/lib/supabase-server";
import { nomApplication, NOM_APPLICATION_DEFAUT } from "@/lib/nom-application";

// Nom de l'application du site courant (0095). Lu en cache par site : la
// Plateforme invalide NOM_APPLICATION_TAG à chaque enregistrement ; `revalidate`
// n'est qu'un filet. Une erreur LÈVE dans le cache (rien n'est mémorisé) et
// l'appelant retombe sur le nom par défaut : un nom illisible ne doit jamais
// casser une page. Sans session (/login…) : nom par défaut, aucun site connu.
export const NOM_APPLICATION_TAG = "socle-nom-application";
const lireNom = unstable_cache(
  async (site: string): Promise<string | null> => {
    const { data, error } = await getAdminClient()
      .from("site")
      .select("nom_application")
      .eq("id", site)
      .maybeSingle<{ nom_application: string | null }>();
    if (error) throw new Error(error.message);
    return data?.nom_application ?? null;
  },
  ["nom-application"],
  { revalidate: 300, tags: [NOM_APPLICATION_TAG] }
);

export const getNomApplication = parRequete(async function getNomApplication(): Promise<string> {
  try {
    // Import dynamique : même précaution que current-site (cycle de chargement).
    const { getCurrentProfile } = await import("@/lib/current-user");
    const profile = await getCurrentProfile();
    if (!profile?.siteId) return NOM_APPLICATION_DEFAUT;
    return nomApplication(await lireNom(profile.siteId));
  } catch {
    return NOM_APPLICATION_DEFAUT;
  }
});
