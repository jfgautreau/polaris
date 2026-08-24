import { cache } from "react";
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
  // Le site courant = le site du compte connecté (getCurrentProfile.siteId),
  // qui est DÉJÀ conscient de l'impersonation : site cible quand un super_admin
  // est « entré » dans un site, sinon son site de rattachement. C'est l'exact
  // pendant applicatif de current_site_id() en SQL. On ne lit plus de header
  // x-impersonate-site / x-site-id : le premier est absent sur les routes /api/
  // (middleware exclu), le second n'était qu'un fallback hardcodé.
  //   - Import dynamique : évite un cycle de chargement current-site <-> current-user.
  //   - Repli lebignon quand il n'y a pas de session (routes publiques :
  //     /login, /affichage) — un seul site en prod aujourd'hui.
  const { getCurrentProfile } = await import("@/lib/current-user");
  const profile = await getCurrentProfile();
  const id = profile?.siteId ?? SITE_LEBIGNON_ID;

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
