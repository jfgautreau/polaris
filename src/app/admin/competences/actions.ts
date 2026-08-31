"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleWrite } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/current-user";
import { NIVEAUX_TAG, NB_NIVEAUX_TAG } from "@/lib/refdata";
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

  // Libellés d'abord (partie historiquement fonctionnelle) : ainsi, même tant
  // que la migration 0061 n'est pas appliquée, l'échelle continue de s'enregistrer.
  for (let n = 0; n <= nb; n++) {
    const libelle = s(fd, `niveau_${n}`);
    if (libelle) {
      const { error } = await supabase
        .from("competence_niveau_libelle")
        .upsert(
          { niveau: n, libelle, site_id: profile!.siteId },
          { onConflict: "site_id,niveau" }
        );
      // On s'arrete au premier echec : poursuivre laisserait une echelle
      // partiellement enregistree sans que personne ne le sache.
      if (error) done(error);
    }
  }

  // Puis le nombre de niveaux (site.nb_niveaux, migration 0061). Tolérant à
  // l'absence de colonne (code 42703) : avant l'application de 0061 en prod, on
  // ignore silencieusement ce réglage plutôt que de casser l'enregistrement de
  // l'échelle. Toute autre erreur est bien remontée.
  {
    const { error } = await supabase
      .from("site")
      .update({ nb_niveaux: nb })
      .eq("id", profile!.siteId);
    if (error && error.code !== "42703") done(error);
  }

  updateTag(NIVEAUX_TAG);
  updateTag(NB_NIVEAUX_TAG);
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
