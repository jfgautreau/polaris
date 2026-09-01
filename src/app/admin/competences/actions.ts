"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleWrite } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/current-user";
import { NIVEAUX_TAG, NB_NIVEAUX_TAG, SEUIL_COMPETENT_TAG } from "@/lib/refdata";
import { HEX_NIVEAUX_AUTORISES } from "@/lib/couleurs-niveau";
import { messageErreur, urlAvecErreur, type ErreurPg } from "@/lib/erreurs";

const PATH = "/admin/competences";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => fd.get(k) === "true" || fd.get(k) === "on";
const intOrNull = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v === "" ? null : Number(v);
};

// `err` non nul -> message remonte a l'ecran via l'URL (cf. BandeauErreur).
function done(err: ErreurPg = null): never {
  const msg = messageErreur(err);
  revalidatePath(PATH);
  redirect(urlAvecErreur(PATH, msg));
}

// Echelle de niveaux + nombre de niveaux activés pour le site.
// MULTI-SITE (0053) : competence_niveau_libelle.PK est (site_id, niveau).
// L'upsert cible ce couple, et pose site_id explicitement.
// nb_niveaux (0061) vit sur `site` : borné à 2..4, on écrit la ligne du site
// courant (.eq("id", siteId)). On n'enregistre que les libellés 0..N.
export async function saveEchelle(fd: FormData) {
  const supabase = await requireModuleWrite("competences");
  const profile = await getCurrentProfile();

  // Nombre de niveaux activés : borné à [2,4] (repli 4 si absent/invalide).
  const nbBrut = Number(s(fd, "nb_niveaux"));
  const nb = Number.isFinite(nbBrut) ? Math.max(2, Math.min(4, Math.trunc(nbBrut))) : 4;
  // Seuil « compétent » : borné à [1, nb] (repli 2, puis ramené sous nb).
  const seuilBrut = Number(s(fd, "seuil_competent"));
  const seuil = Math.max(1, Math.min(nb, Number.isFinite(seuilBrut) ? Math.trunc(seuilBrut) : 2));

  // Libellés d'abord (partie historiquement fonctionnelle) : ainsi, même tant
  // que la migration 0061 n'est pas appliquée, l'échelle continue de s'enregistrer.
  for (let n = 0; n <= nb; n++) {
    const libelle = s(fd, `niveau_${n}`);
    if (!libelle) continue;
    // Couleur : niveaux POSITIFS seulement, restreinte à la palette autorisée
    // (le niveau 0 reste blanc/contour, jamais de couleur).
    const couleurBrute = s(fd, `couleur_${n}`);
    const couleur = n >= 1 && HEX_NIVEAUX_AUTORISES.has(couleurBrute) ? couleurBrute : null;
    const row = { niveau: n, libelle, site_id: profile!.siteId, ...(couleur ? { couleur } : {}) };
    let { error } = await supabase
      .from("competence_niveau_libelle")
      .upsert(row, { onConflict: "site_id,niveau" });
    // Colonne `couleur` absente (0063/0065 non appliquée) : Postgres renvoie
    // 42703, mais PostgREST renvoie PGRST204 (« column ... in the schema cache »)
    // quand il ne connaît pas la colonne. On couvre les DEUX et on réessaie sans
    // la couleur pour que le libellé s'enregistre quand même.
    if ((error?.code === "42703" || error?.code === "PGRST204") && couleur) {
      ({ error } = await supabase
        .from("competence_niveau_libelle")
        .upsert({ niveau: n, libelle, site_id: profile!.siteId }, { onConflict: "site_id,niveau" }));
    }
    // On s'arrete au premier echec : poursuivre laisserait une echelle
    // partiellement enregistree sans que personne ne le sache.
    if (error) done(error);
  }

  // Puis les réglages portés par `site` (migrations 0061/0062). Chaque update est
  // TOLÉRANT à l'absence de sa colonne (code 42703) et fait SÉPARÉMENT : ainsi,
  // tant qu'une migration n'est pas appliquée en prod, on ignore silencieusement
  // ce réglage-là sans casser l'enregistrement de l'échelle ni de l'autre réglage.
  // Toute autre erreur est bien remontée.
  {
    const { error } = await supabase
      .from("site")
      .update({ nb_niveaux: nb })
      .eq("id", profile!.siteId);
    if (error && error.code !== "42703") done(error);
  }
  {
    const { error } = await supabase
      .from("site")
      .update({ seuil_competent: seuil })
      .eq("id", profile!.siteId);
    if (error && error.code !== "42703") done(error);
  }

  updateTag(NIVEAUX_TAG);
  updateTag(NB_NIVEAUX_TAG);
  updateTag(SEUIL_COMPETENT_TAG);
  done();
}

// Competences transverses / habilitations
export async function createCompetence(fd: FormData) {
  const supabase = await requireModuleWrite("competences");
  // MULTI-SITE : getCurrentProfile est cache() — pas de requete supplementaire.
  const profile = await getCurrentProfile();
  const nom = s(fd, "nom");
  if (!nom) done();
  const a_recycler = bool(fd, "a_recycler");
  const { error } = await supabase.from("competence").insert({
    nom,
    type: s(fd, "type") === "ACQUIS" ? "ACQUIS" : "NIVEAU",
    a_recycler,
    duree_validite_mois: a_recycler ? intOrNull(fd, "duree_validite_mois") : null,
    site_id: profile!.siteId,
  });
  done(error);
}

export async function updateCompetence(fd: FormData) {
  const supabase = await requireModuleWrite("competences");
  const a_recycler = bool(fd, "a_recycler");
  const { error } = await supabase
    .from("competence")
    .update({
      nom: s(fd, "nom"),
      type: s(fd, "type") === "ACQUIS" ? "ACQUIS" : "NIVEAU",
      a_recycler,
      duree_validite_mois: a_recycler ? intOrNull(fd, "duree_validite_mois") : null,
    })
    .eq("id", s(fd, "id"));
  done(error);
}

export async function toggleCompetence(fd: FormData) {
  const supabase = await requireModuleWrite("competences");
  const { error } = await supabase
    .from("competence")
    .update({ actif: bool(fd, "actif") })
    .eq("id", s(fd, "id"));
  done(error);
}
