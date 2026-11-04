import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";

// GET /api/personnel/[id]/impact
// Ce que la suppression RGPD (droit à l'oubli) effacerait avec la personne :
// jours placés sur un poste (passés / à venir), jours d'absence, habilitations,
// contrats. Sert l'avertissement du bouton « Supprimer » (SupprimerPersonne) :
// avant le 2026-11-04, la confirmation ne disait pas si la personne était au
// planning. Même droit que la suppression elle-même (« rgpd: write »).
// Comptages seuls (`head: true`) : aucune ligne n'est renvoyée.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!(await canWriteModule(profile.role, "rgpd"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  const supabase = await getServerClient();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const compter = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("site_id", profile.siteId).eq("personne_id", id);

  const [passes, aVenir, absences, habilitations, contrats] = await Promise.all([
    compter("placement").not("poste_id", "is", null).lt("jour", aujourdhui),
    compter("placement").not("poste_id", "is", null).gte("jour", aujourdhui),
    compter("placement").not("motif_absence_id", "is", null),
    compter("personne_competence"),
    compter("contrat_periode"),
  ]);
  const erreur = [passes, aVenir, absences, habilitations, contrats].find((r) => r.error)?.error;
  if (erreur) return NextResponse.json({ error: erreur.message }, { status: 500 });

  return NextResponse.json({
    postesPasses: passes.count ?? 0,
    postesAVenir: aVenir.count ?? 0,
    absences: absences.count ?? 0,
    habilitations: habilitations.count ?? 0,
    contrats: contrats.count ?? 0,
  });
}
