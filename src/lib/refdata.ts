import { unstable_cache } from "next/cache";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";

// Donnees de reference (rarement modifiees, identiques pour tous les users) mises
// en cache pour ne pas etre rechargees a chaque clic de filtre / navigation.
// Lecture via le client service (hors cookies) -> cacheable. Invalidation par
// expiration courte (les edits de reference se refletent en <= 30 s).
//
// ⚠️ MULTI-SITE : le cache est SEGMENTÉ PAR SITE. Le siteId passe en argument
// des fonctions cachées ; Next.js l'inclut dans la clé de cache, donc deux sites
// n'écrasent JAMAIS le cache l'un de l'autre. Ne jamais retirer cet argument :
// sans lui, on servirait les ateliers du site A à un utilisateur du site B.
//
// ⚠️ MIGRATION 0053 : plus AUCUNE ligne partagée (site_id NULL). Chaque
// nouveau site part d'un référentiel copié depuis un site source (voir
// /platform). L'ancien fallback `siteFilteredOrLegacy` et la clause
// `.or(site_id.is.null,…)` ont donc été retirés.
const OPTS = { revalidate: 30 };

async function siteId(): Promise<string> {
  return (await getCurrentSite()).id;
}

// -------- Ateliers -------------------------------------------------

const getAteliersBySite = unstable_cache(
  async (site: string) => {
    const { data } = await getAdminClient()
      .from("atelier")
      .select("id, nom")
      .eq("actif", true)
      .eq("site_id", site)
      .order("nom");
    return (data ?? []) as { id: string; nom: string }[];
  },
  ["refdata-ateliers"],
  OPTS
);
export async function getAteliersC() {
  return getAteliersBySite(await siteId());
}

// -------- Equipes --------------------------------------------------

type EquipeRow = {
  id: string;
  nom: string;
  couleur: string | null;
  quart_fixe: string | null;
};

const getEquipesBySite = unstable_cache(
  async (site: string) => {
    const { data } = await getAdminClient()
      .from("equipe")
      .select("id, nom, couleur, quart_fixe")
      .eq("actif", true)
      .eq("site_id", site)
      .order("nom");
    return (data ?? []) as EquipeRow[];
  },
  ["refdata-equipes"],
  OPTS
);
export async function getEquipesC() {
  return getEquipesBySite(await siteId());
}

// -------- Quarts ---------------------------------------------------
// Depuis la migration 0053, `quart` est site-scopé (PK composite
// (code, site_id)). Chaque site a son propre jeu de quarts, seedé à la
// création (copie depuis le site source).

const getQuartsBySite = unstable_cache(
  async (site: string) => {
    const { data } = await getAdminClient()
      .from("quart")
      .select("code, libelle, ordre")
      .eq("site_id", site)
      .order("ordre");
    return (data ?? []) as { code: string; libelle: string; ordre: number }[];
  },
  ["refdata-quarts"],
  OPTS
);
export async function getQuartsC() {
  return getQuartsBySite(await siteId());
}

// -------- Motifs d'absence -----------------------------------------
// Depuis la 0053, `motif_absence.site_id` est NOT NULL : chaque site a ses
// motifs. Plus de branche « ligne groupe (NULL) » à agréger.

type MotifRow = {
  id: string;
  code_court: string;
  libelle: string;
  couleur: string;
};

const getMotifsBySite = unstable_cache(
  async (site: string) => {
    const { data } = await getAdminClient()
      .from("motif_absence")
      .select("id, code_court, libelle, couleur")
      .eq("actif", true)
      .eq("site_id", site)
      .order("libelle");
    return (data ?? []) as MotifRow[];
  },
  ["refdata-motifs"],
  OPTS
);
export async function getMotifsC() {
  return getMotifsBySite(await siteId());
}

// -------- Echelle des niveaux (0..4) -------------------------------
// Depuis la 0053, `competence_niveau_libelle` est site-scopée. La PK est
// (site_id, niveau). Tag dédié pour invalidation immédiate depuis l'écran
// des libellés.
export const NIVEAUX_TAG = "refdata-niveaux";

const getNiveauxBySite = unstable_cache(
  async (site: string) => {
    const { data } = await getAdminClient()
      .from("competence_niveau_libelle")
      .select("niveau, libelle")
      .eq("site_id", site)
      .order("niveau");
    return (data ?? []) as { niveau: number; libelle: string }[];
  },
  ["refdata-niveaux"],
  { ...OPTS, tags: [NIVEAUX_TAG] }
);
export async function getNiveauxC() {
  return getNiveauxBySite(await siteId());
}

// -------- Nombre de niveaux activés (par site) ---------------------
// Réglé dans /admin/competences (colonne site.nb_niveaux, migration 0061).
// Nombre de niveaux POSITIFS de l'échelle (1..N), N ∈ [2,4] ; le 0 et la
// restriction restent toujours présents. Repli 4 = échelle complète (comportement
// historique), utilisé aussi tant que la migration 0061 n'est pas appliquée
// (colonne absente → erreur avalée, on rend 4).
export const NB_NIVEAUX_TAG = "refdata-nb-niveaux";
export const NB_NIVEAUX_DEFAUT = 4;

const getNbNiveauxBySite = unstable_cache(
  async (site: string) => {
    try {
      const { data, error } = await getAdminClient()
        .from("site")
        .select("nb_niveaux")
        .eq("id", site)
        .single<{ nb_niveaux: number }>();
      if (error || !data?.nb_niveaux) return NB_NIVEAUX_DEFAUT;
      return data.nb_niveaux;
    } catch {
      return NB_NIVEAUX_DEFAUT;
    }
  },
  ["refdata-nb-niveaux"],
  { ...OPTS, tags: [NB_NIVEAUX_TAG] }
);
export async function getNbNiveauxC() {
  return getNbNiveauxBySite(await siteId());
}

// -------- Références de rotation -----------------------------------
// Site-scopées : la rotation des équipes d'un site n'est pas celle d'un
// autre. Tag dédié invalide à chaque enregistrement.
export const ROTATION_TAG = "refdata-rotation";

type RotationRefRow = {
  semaine: string;
  equipe_id: string;
  quart_code: string;
};

const getRotationRefsBySite = unstable_cache(
  async (site: string) => {
    const { data } = await getAdminClient()
      .from("rotation_reference")
      .select("semaine, equipe_id, quart_code")
      .eq("site_id", site)
      .order("semaine");
    return (data ?? []) as RotationRefRow[];
  },
  ["refdata-rotation"],
  { ...OPTS, tags: [ROTATION_TAG] }
);
export async function getRotationRefsC() {
  return getRotationRefsBySite(await siteId());
}
