import { unstable_cache } from "next/cache";
import { parRequete } from "@/lib/par-requete";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { optionsClaims } from "@/lib/jwks";

export type CurrentProfile = {
  authId: string;
  email: string;
  name: string;
  role: string;
  siteId: string;
  estSuperAdmin: boolean;
  // Ligne `site` du site de RATTACHEMENT, lue dans la meme requete que le profil
  // (perf P2, 2026-09-28) : getCurrentSite la reutilise au lieu de relire la
  // table. Absente en impersonation (le site courant est alors un autre site).
  siteRow?: SiteRow;
};
type SiteRow = { id: string; slug: string; nom: string; statut: "actif" | "suspendu" | "archive"; fuseau: string };

type ProfilRow = {
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  site_id: string | null;
  est_super_admin: boolean | null;
  site?: SiteRow | null;
};

// Ligne app_user (+ site de rattachement) MISE EN CACHE entre les requêtes.
// Avant le 2026-10-14, elle était relue à chaque page et à chaque appel d'API :
// ~11 % des journaux Supabase pour une donnée qui ne change presque jamais.
// Invalidation IMMÉDIATE par PROFIL_TAG à chaque écriture d'app_user ou de
// site.statut (routes /api/users/*, /platform) ; `revalidate` ne sert que de
// filet pour une modification faite hors de l'application (SQL Editor).
// Une erreur ou une ligne absente LÈVE : unstable_cache ne met pas en cache un
// échec (un incident passager ne verrouille donc pas le compte 5 minutes).
// Clé = user_id, globale par construction (c'est la ligne qui DIT le site) :
// cf. la liste blanche de refdata-cache.test.ts.
export const PROFIL_TAG = "socle-profil";
const lireProfil = unstable_cache(
  async (userId: string): Promise<ProfilRow> => {
    const admin = getAdminClient();
    // Profil + site de rattachement en UN aller-retour (embed PostgREST via la FK
    // app_user.site_id → site.id). Repli sur la lecture simple si l'embed échoue
    // (ex. relation ambiguë) : le statut du site est alors relu à part, comme avant.
    const COLS = "email, name, role, is_active, site_id, est_super_admin";
    let { data, error } = await admin
      .from("app_user")
      .select(`${COLS}, site:site_id(id, slug, nom, statut, fuseau)`)
      .eq("user_id", userId)
      .single<ProfilRow>();
    if (error && error.code !== "PGRST116") {
      ({ data, error } = await admin.from("app_user").select(COLS).eq("user_id", userId).single<ProfilRow>());
    }
    if (error || !data) throw new Error(error?.message ?? "ligne absente");
    return data;
  },
  ["socle-profil"],
  { revalidate: 300, tags: [PROFIL_TAG] }
);

// Profil applicatif de l'utilisateur connecte (ou null).
// - `getClaims()` verifie le JWT LOCALEMENT (cles asymetriques) sans appel reseau
//   au serveur Auth ; il retombe automatiquement sur getUser() si le projet est
//   encore en HS256 (aucune regression, gain effectif des l'activation des cles).
// - `parRequete` deduplique l'appel sur toute la requete (requireModule + page),
//   y compris dans les routes API ou `cache()` de React ne memorise rien.
//
// MULTI-SITE (cf. tasks/multi-site.md) : le profil porte `siteId` et
// `estSuperAdmin`. Les colonnes sont posees sur app_user par la migration
// 0043, appliquee en prod depuis 2026-08 — le fallback pre-0043 et le repli
// sur SITE_LEBIGNON_ID ont ete retires (audit O2 / S6, 2026-09-10). Une
// ligne app_user sans site_id est desormais un bug : on refuse la session
// avec un log d'erreur plutot que de rattacher silencieusement a Lebignon.
export const getCurrentProfile = parRequete(async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await getServerClient();
  // Clés de signature partagées entre instances (src/lib/jwks.ts, 2026-10-16).
  const { data: claimsData } = await supabase.auth.getClaims(undefined, await optionsClaims());
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

  let row: ProfilRow;
  try {
    row = await lireProfil(userId);
  } catch (e) {
    console.error(`app_user introuvable pour user_id=${userId}: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  // `is_active` etait lu par la RLS (is_admin / has_role) mais JAMAIS par
  // l'application : un compte desactive directement en base gardait toute sa
  // navigation. La desactivation via /admin/users bannit aussi le compte cote
  // Auth, ce qui masquait le trou. On ferme ici, a la source du profil : plus de
  // profil, donc redirection vers /login par requireModule.
  if (!row || !row.is_active) return null;

  // Un app_user sans site_id est un bug : depuis 0043, la colonne est NOT
  // NULL et le trigger handle_new_user la remplit. On REFUSE la session
  // plutot que de retomber silencieusement sur Lebignon (fuite cross-tenant
  // potentielle, cf. audit S6).
  if (!row.site_id) {
    console.error(`app_user.user_id=${userId} sans site_id — session refusee`);
    return null;
  }
  let siteId = row.site_id;
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
  const siteRow = row.site && row.site.id === siteId ? row.site : undefined;
  if (!estSuperAdmin) {
    if (siteRow) {
      if (siteRow.statut !== "actif") return null;
    } else {
      try {
        const { data: s } = await admin
          .from("site")
          .select("statut")
          .eq("id", siteId)
          .single<{ statut: string }>();
        if (s && s.statut !== "actif") return null;
      } catch {
        // Table `site` absente (pré-0043) : on ne bloque pas.
      }
    }
  }

  return {
    authId: userId,
    email: row.email,
    name: row.name,
    role: row.role,
    siteId,
    estSuperAdmin,
    siteRow,
  };
});

