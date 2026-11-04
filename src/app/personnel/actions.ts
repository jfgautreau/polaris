"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleWrite } from "@/lib/permissions";
import { messageErreur, urlAvecErreur, type ErreurPg } from "@/lib/erreurs";
import { getCurrentProfile } from "@/lib/current-user";

// RGPD (0086) : efface du journal d'audit les traces d'identité de la personne.
// Anonymisation : les lignes de sa fiche (nom, prénom, commentaire…) ; les
// placements restent, ils ne portent que son identifiant, désormais anonyme.
// Suppression : tout ce qui la référence. Best-effort : l'opération RGPD est
// faite, un échec ici ne la défait pas (le message d'erreur reste muet).
async function purgerJournal(supabase: Awaited<ReturnType<typeof requireModuleWrite>>, id: string, tout: boolean) {
  const profile = await getCurrentProfile();
  if (!profile) return;
  await supabase.rpc("journal_purger_personne", { p_site: profile.siteId, p_personne: id, p_tout: tout });
}

const PATH = "/personnel";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

// `err` non nul -> message remonte a l'ecran via l'URL (cf. BandeauErreur).
// Un matricule en double, par exemple, se soldait par un retour silencieux a la
// liste, la personne n'ayant pas ete enregistree.
function done(err: ErreurPg = null): never {
  const msg = messageErreur(err);
  revalidatePath(PATH);
  redirect(urlAvecErreur(PATH, msg));
}

// ⚠️ `createPersonne`, `updatePersonne` et `toggleStatut` ont ete SUPPRIMES :
// aucun ecran ne les appelait. La creation, la modification et le changement de
// statut passent tous par la route `/api/personnel`, qui normalise le nom et le
// prenom et cree la periode de contrat initiale — ce que ces actions ne
// faisaient pas. Les garder revenait a maintenir un second chemin d'ecriture,
// divergent et mort. Ne restent ici que les deux actions RGPD, seules appelees
// (depuis PersonnelEditor).

// RGPD : anonymisation (conserve l'historique de placement, retire l'identite).
// Droit « rgpd: write » — distinct de l'edition du personnel : anonymiser est une
// operation sensible, elle a son propre droit dans la matrice.
export async function anonymiserPersonne(fd: FormData) {
  const supabase = await requireModuleWrite("rgpd");
  const profile = await getCurrentProfile();
  const id = s(fd, "id");
  if (!id || !profile) done();
  // Bornee au site de l'appelant : le client service_role ignore la RLS, un
  // identifiant d'un autre site ne doit rien toucher.
  const { data: p } = await supabase
    .from("personne")
    .select("matricule")
    .eq("id", id)
    .eq("site_id", profile.siteId)
    .maybeSingle<{ matricule: string | null }>();
  if (!p) done({ message: "Personne introuvable sur ce site." });
  const { error } = await supabase
    .from("personne")
    .update({
      nom: "Ex-collaborateur",
      prenom: p?.matricule ? `(${p.matricule})` : "",
      commentaire: null,
      agence_interim: null,
      statut: "PARTI",
      anonymise: true,
      anonymise_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("site_id", profile.siteId);
  if (!error) await purgerJournal(supabase, id, false);
  done(error);
}

// RGPD : droit a l'oubli (suppression definitive + cascade). Droit « rgpd: write ».
export async function supprimerPersonne(fd: FormData) {
  const supabase = await requireModuleWrite("rgpd");
  const profile = await getCurrentProfile();
  const id = s(fd, "id");
  if (!id || !profile) done();
  // Bornee au site de l'appelant (client service_role, cf. anonymiserPersonne).
  const { data, error } = await supabase.from("personne").delete().eq("id", id).eq("site_id", profile.siteId).select("id");
  if (error) done(error);
  if (!data?.length) done({ message: "Personne introuvable sur ce site." });
  await purgerJournal(supabase, id, true);
  done();
}
