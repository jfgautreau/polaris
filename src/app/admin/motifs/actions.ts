"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleWrite } from "@/lib/permissions";
import { getCurrentSite } from "@/lib/current-site";
import { messageErreur, urlAvecErreur, type ErreurPg } from "@/lib/erreurs";

const PATH = "/admin/motifs";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// Fin d'action. `err` non nul -> le message repart dans l'URL et la page
// l'affiche (BandeauErreur) : sans cela, un code court en double se solde par un
// rechargement silencieux ou rien n'a change.
function done(err: ErreurPg = null): never {
  const msg = messageErreur(err);
  revalidatePath(PATH);
  redirect(urlAvecErreur(PATH, msg));
}

// MULTI-SITE (0053) : motif_absence, agence_interim, type_contrat sont
// site-scopés (site_id NOT NULL). Le service_role bypass la RLS, on pose
// donc site_id explicitement pour ne pas atterrir dans un autre site
// (le trigger set_site_id_from_context retomberait sur lebignon).

export async function createMotif(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const site = await getCurrentSite();
  const libelle = s(fd, "libelle");
  const code_court = s(fd, "code_court");
  if (!libelle || !code_court) done();
  const { error } = await supabase.from("motif_absence").insert({
    libelle,
    code_court,
    couleur: s(fd, "couleur") || "#e5e7eb",
    site_id: site.id,
  });
  done(error);
}

export async function updateMotif(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const { error } = await supabase
    .from("motif_absence")
    .update({
      libelle: s(fd, "libelle"),
      code_court: s(fd, "code_court"),
      couleur: s(fd, "couleur") || "#e5e7eb",
    })
    .eq("id", s(fd, "id"));
  done(error);
}

export async function toggleMotif(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const { error } = await supabase
    .from("motif_absence")
    .update({ actif: fd.get("actif") === "true" })
    .eq("id", s(fd, "id"));
  done(error);
}

// Classification planifié / non planifié (colonne non_planifie, migration 0060).
// Le champ posté par ActifCheckbox s'appelle `actif` mais porte ici le NOUVEL
// état de non_planifie (coché = absence non planifiée : maladie, AT, injustifié).
export async function toggleNonPlanifie(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const { error } = await supabase
    .from("motif_absence")
    .update({ non_planifie: fd.get("actif") === "true" })
    .eq("id", s(fd, "id"));
  done(error);
}

// ----- Agences d'interim -----
// Liste fermee alimentant le menu deroulant « Agence » des periodes de contrat
// (cf. src/app/personnel/PeriodesEditor.tsx). Desactiver plutot que supprimer :
// les periodes passees referencent l'agence par son NOM, en texte libre.

export async function createAgence(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const site = await getCurrentSite();
  const nom = s(fd, "nom");
  if (!nom) done();
  const { error } = await supabase.from("agence_interim").insert({ nom, site_id: site.id });
  done(error);
}

export async function updateAgence(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const nom = s(fd, "nom");
  if (!nom) done();
  const { error } = await supabase.from("agence_interim").update({ nom }).eq("id", s(fd, "id"));
  done(error);
}

export async function toggleAgence(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const { error } = await supabase
    .from("agence_interim")
    .update({ actif: fd.get("actif") === "true" })
    .eq("id", s(fd, "id"));
  done(error);
}

// ----- Types de contrat (migration 0040) -----
// Alimente le menu Contrat dans Personnel et dans les periodes de contrat. Le
// `code` est le texte stocke dans `personne.type_contrat` : ajouter un code ici,
// c'est aussitot le voir dans le menu ; retirer un code n'efface pas l'historique.

export async function createTypeContrat(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const site = await getCurrentSite();
  const code = s(fd, "code").toUpperCase();
  const libelle = s(fd, "libelle");
  const ordre = Number(s(fd, "ordre") || "0");
  if (!code || !libelle) done();
  const { error } = await supabase.from("type_contrat").insert({ code, libelle, ordre, site_id: site.id });
  done(error);
}

// La PK depuis 0053 est (code, site_id) : on ajoute le filtre site.
export async function updateTypeContrat(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const site = await getCurrentSite();
  const { error } = await supabase
    .from("type_contrat")
    .update({ libelle: s(fd, "libelle"), ordre: Number(s(fd, "ordre") || "0") })
    .eq("code", s(fd, "code"))
    .eq("site_id", site.id);
  done(error);
}

export async function toggleTypeContrat(fd: FormData) {
  const supabase = await requireModuleWrite("motifs");
  const site = await getCurrentSite();
  const { error } = await supabase
    .from("type_contrat")
    .update({ actif: fd.get("actif") === "true" })
    .eq("code", s(fd, "code"))
    .eq("site_id", site.id);
  done(error);
}

// ----- Fenetre d'affichage du planning (migration 0040, PK site_id depuis 0051) -----
// Un enregistrement par site. Le client admin bypass la RLS : on passe site_id
// explicitement pour ne pas ecrire dans la ligne d'un autre site.

export async function updateFenetreAffichage(fd: FormData) {
  const { getCurrentSite } = await import("@/lib/current-site");
  const site = await getCurrentSite();
  const supabase = await requireModuleWrite("motifs");
  const avant = Math.max(0, Math.min(14, Number(s(fd, "jours_avant") || "1")));
  const apres = Math.max(0, Math.min(30, Number(s(fd, "jours_apres") || "4")));
  const { error } = await supabase
    .from("parametre_affichage")
    .upsert(
      { site_id: site.id, jours_avant: avant, jours_apres: apres, updated_at: new Date().toISOString() },
      { onConflict: "site_id" },
    );
  done(error);
}
