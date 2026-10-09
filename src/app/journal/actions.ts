"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleWrite } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/current-user";
import { messageErreur, urlAvecErreur } from "@/lib/erreurs";

// Durée de conservation du journal du site (0086), en mois. Droit « journal »
// en écriture : la matrice décide, aucun rôle en dur.
export async function reglerConservation(fd: FormData) {
  const supabase = await requireModuleWrite("journal");
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Non authentifié.");
  const mois = Math.floor(Number(fd.get("mois")));
  if (!Number.isFinite(mois) || mois < 1 || mois > 120) {
    redirect(urlAvecErreur("/journal", "Durée de conservation : entre 1 et 120 mois."));
  }
  const { error } = await supabase.from("site").update({ journal_conservation_mois: mois }).eq("id", profile.siteId);
  revalidatePath("/journal");
  redirect(urlAvecErreur("/journal", messageErreur(error)));
}
