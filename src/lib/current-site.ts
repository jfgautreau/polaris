import { cache } from "react";
import { headers } from "next/headers";
import { getAdminClient } from "@/lib/supabase-server";

// Contexte multi-site (SaaS multi-tenant). Une seule base Supabase, un
// `site_id` sur chaque table métier locale, RLS pour l'isolation
// (cf. supabase/migrations/0043_multi_site.sql et tasks/multi-site.md).
//
// L'UUID du site historique « lebignon » est fixé en dur : il est écrit
// dans la migration 0043 comme DEFAULT temporaire des colonnes site_id
// (retiré ensuite), et sert de fallback tant que les sous-domaines ne sont
// pas en place. À terme, `getCurrentSite()` lit exclusivement le header
// `x-site-id` posé par le middleware après résolution du sous-domaine.
export const SITE_LEBIGNON_ID = "00000000-0000-4000-8000-00000000c0de";

export type CurrentSite = {
  id: string;
  slug: string;
  nom: string;
  statut: "actif" | "suspendu" | "archive";
  fuseau: string;
};

// Fallback statique réservé au SEUL cas « schéma pré-0043 » : la table
// `site` n'existe pas encore (code Postgres 42P01). Dans tous les autres
// cas (erreur réseau/transitoire, site introuvable), on NE retombe PLUS
// en silence sur Lebignon : en multi-site, cela afficherait ses données
// à l'utilisateur d'un autre site. On lève alors une erreur franche —
// une page en erreur est préférable à des données du mauvais site.
const FALLBACK_LEBIGNON: CurrentSite = {
  id: SITE_LEBIGNON_ID,
  slug: "lebignon",
  nom: "Lebignon",
  statut: "actif",
  fuseau: "Europe/Paris",
};

// STABLE tant que la V1a (single-site) : le site est lu une fois par
// requête. `cache()` de React déduplique l'appel entre AppHeader, les
// pages et les server actions.
export const getCurrentSite = cache(async function getCurrentSite(): Promise<CurrentSite> {
  // 1) IMPERSONATION prioritaire : si un super_admin est en mode support,
  //    le middleware pose `x-impersonate-site`. On lit ce header pour que
  //    tout l'écran (AppHeader, pages, PDF) affiche bien le site cible.
  //    La validation « seul un super_admin peut poser ce header » est
  //    faite plus haut par le middleware ET par la fonction SQL
  //    current_site_id() qui verifie est_super_admin avant d'honorer.
  let siteId: string | null = null;
  try {
    const h = await headers();
    siteId = h.get("x-impersonate-site")
      ?? h.get("x-site-id");
  } catch {
    siteId = null;
  }

  // 2) V1a : fallback vers le site historique tant qu'un seul sous-domaine
  //    est configuré. Retiré en PR suivante quand /platform et le multi-
  //    domaine seront actifs.
  const id = siteId ?? SITE_LEBIGNON_ID;

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("site")
    .select("id, slug, nom, statut, fuseau")
    .eq("id", id)
    .single<CurrentSite>();

  if (error) {
    // Schéma pré-0043 : la table `site` n'existe pas encore (undefined_table).
    // Seul cas où le fallback historique reste toléré.
    if (error.code === "42P01") return FALLBACK_LEBIGNON;
    // Toute autre erreur (réseau, transitoire, permission) : on refuse de
    // retomber en silence sur Lebignon. En multi-site, cela montrerait ses
    // données à l'utilisateur d'un autre site. Erreur franche => la page
    // échoue plutôt que d'afficher le mauvais site.
    throw new Error(
      `getCurrentSite: lecture du site ${id} impossible (${error.code ?? "?"}: ${error.message})`
    );
  }
  if (!data) {
    throw new Error(`getCurrentSite: site ${id} introuvable`);
  }
  return data;
});
