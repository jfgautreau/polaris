import { cache } from "react";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { SITE_LEBIGNON_ID } from "@/lib/current-site";

export type CurrentProfile = {
  authId: string;
  email: string;
  name: string;
  role: string;
  siteId: string;
  estSuperAdmin: boolean;
};

// Profil applicatif de l'utilisateur connecte (ou null).
// - `getClaims()` verifie le JWT LOCALEMENT (cles asymetriques) sans appel reseau
//   au serveur Auth ; il retombe automatiquement sur getUser() si le projet est
//   encore en HS256 (aucune regression, gain effectif des l'activation des cles).
// - `cache()` deduplique l'appel sur toute la requete (requireModule + page).
//
// MULTI-SITE (cf. tasks/multi-site.md) : le profil porte `siteId` et
// `estSuperAdmin`. Les colonnes sont ajoutées à app_user par la migration
// 0043. En V1a, siteId vaut toujours l'UUID du site historique lebignon.
//
// FALLBACK PRÉ-MIGRATION : tant que 0043 n'est pas appliquée, les colonnes
// `site_id` et `est_super_admin` n'existent pas. On retente alors la
// requête sans ces colonnes pour ne pas casser le déploiement pendant la
// fenêtre code-poussé/migration-non-encore-jouée. Ce bloc de fallback
// pourra être retiré une fois la 0043 en prod.
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await getServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return null;

  // ⚠️ Lecture du profil via getAdminClient (service_role), PAS getServerClient.
  // C'est la ligne de l'appelant (clé user_id) : aucune escalade possible, et
  // surtout ça DÉCOUPLE la résolution du profil de la RLS site-scopée.
  // Sinon, pendant une impersonation, getServerClient propage x-impersonate-site,
  // current_site_id() renvoie le site cible, et la policy app_user (0055, sans
  // passe-droit is_super_admin) masque la propre ligne du super_admin (rattaché
  // à un autre site) → getCurrentProfile = null → boucle /login ↔ / (prod HS
  // le 2026-08-23). getCurrentProfile doit toujours voir SA ligne, quel que soit
  // le site consulté. current-user.ts est whitelisté (admin-client / isolation).
  const admin = getAdminClient();

  const modernSel = "email, name, role, is_active, site_id, est_super_admin";
  const legacySel = "email, name, role, is_active";

  type Row = {
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    site_id?: string | null;
    est_super_admin?: boolean | null;
  };
  let row: Row | null = null;

  {
    const { data, error } = await admin
      .from("app_user")
      .select(modernSel)
      .eq("user_id", userId)
      .single();
    if (error) {
      // Colonnes site_id / est_super_admin absentes (pré-0043) : on
      // retente avec l'ancien SELECT et on comble par les défauts V1a.
      const legacy = await admin
        .from("app_user")
        .select(legacySel)
        .eq("user_id", userId)
        .single<{ email: string; name: string; role: string; is_active: boolean }>();
      row = legacy.data ?? null;
    } else {
      row = (data as unknown as Row) ?? null;
    }
  }

  // `is_active` etait lu par la RLS (is_admin / has_role) mais JAMAIS par
  // l'application : un compte desactive directement en base gardait toute sa
  // navigation. La desactivation via /admin/users bannit aussi le compte cote
  // Auth, ce qui masquait le trou. On ferme ici, a la source du profil : plus de
  // profil, donc redirection vers /login par requireModule.
  if (!row || !row.is_active) return null;

  let siteId = row.site_id ?? SITE_LEBIGNON_ID;
  const estSuperAdmin = row.est_super_admin ?? false;

  // IMPERSONATION : un super_admin « entré » dans un site agit DANS ce site.
  // `siteId` doit alors être le site cible, pas son site d'origine — sinon
  // toutes les écritures `site_id: profile.siteId` (~20 routes) atterrissent
  // sur le mauvais site (bug vécu : compte + atelier créés sur Le Bignon
  // depuis LVC, 2026-08-23). Source = le COOKIE signé et NON le header
  // x-impersonate-site : le middleware ne s'exécute pas sur les routes /api/
  // (exclues du matcher), donc le header y est absent — le cookie, lui, est
  // présent partout. Borné au super_admin (le cookie est en plus HMAC-signé
  // et n'est délivré qu'aux super_admin par /platform).
  if (estSuperAdmin) {
    const { getImpersonatedSiteId } = await import("@/lib/impersonation");
    const imp = await getImpersonatedSiteId();
    if (imp) siteId = imp;
  }

  // MULTI-TENANT — refus de session si le site est suspendu ou archivé.
  // Le super_admin conserve l'accès (il est au-dessus du cycle de vie des
  // sites, cf. tasks/multi-site.md §7). Requête faite via getAdminClient
  // pour contourner la RLS de `site` (qui n'expose qu'un site à la fois
  // depuis la session utilisateur). Erreur silencieuse (statut inconnu) →
  // on laisse passer pour ne pas casser en fenêtre pré-0043.
  if (!estSuperAdmin) {
    try {
      const { data: siteRow } = await admin
        .from("site")
        .select("statut")
        .eq("id", siteId)
        .single<{ statut: string }>();
      if (siteRow && siteRow.statut !== "actif") return null;
    } catch {
      // Table `site` absente (pré-0043) : on ne bloque pas.
    }
  }

  return {
    authId: userId,
    email: row.email,
    name: row.name,
    role: row.role,
    siteId,
    estSuperAdmin,
  };
});

