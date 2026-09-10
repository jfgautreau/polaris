import type { SupabaseClient } from "@supabase/supabase-js";

// Verifie qu'un UUID de rattachement (equipe_id, atelier_id, poste_id, ...)
// appartient bien AU SITE de l'appelant, AVANT de l'ecrire sur une ligne
// site-scopee. Les cles etrangeres du schema Polaris ne portent PAS site_id ;
// via le service_role, une valeur d'un autre site passerait sans erreur SQL
// et polluerait silencieusement les grilles (equipe inconnue -> pastille grise).
//
// Cf. audit S2 (2026-09-10) : /api/personnel op=update, /api/matrice/cell,
// /api/placement/cell, etc. — a appeler partout ou un patch client peut
// injecter un UUID de rattachement.
//
// Renvoie null si valide, sinon un message d'erreur pret a repondre en 400.
export async function verifierIdSite(
  supabase: SupabaseClient,
  table: string,
  id: string | null | undefined,
  siteId: string,
  libelle: string,
): Promise<string | null> {
  if (!id) return null; // valeur nulle autorisee, rien a verifier
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) return `Verification impossible (${libelle}) : ${error.message}`;
  if (!data) return `${libelle} inconnu(e) ou hors de votre site.`;
  return null;
}

// Variante en lot pour un patch qui peut porter plusieurs FKs a la fois.
// Verifie SEULEMENT les cles PRESENTES dans le patch (undefined = ignore).
export async function verifierFksSite(
  supabase: SupabaseClient,
  patch: Record<string, unknown>,
  siteId: string,
  correspondances: { champ: string; table: string; libelle: string }[],
): Promise<string | null> {
  for (const c of correspondances) {
    if (!(c.champ in patch)) continue;
    const v = patch[c.champ];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v !== "string") continue;
    const err = await verifierIdSite(supabase, c.table, v, siteId, c.libelle);
    if (err) return err;
  }
  return null;
}
