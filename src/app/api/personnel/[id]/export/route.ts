import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { messageErreur } from "@/lib/erreurs";

type Ligne = Record<string, unknown>;

// GET /api/personnel/[id]/export
// Export RGPD des donnees d'une personne (JSON). Droit « rgpd: write » — meme
// droit que l'anonymisation et la suppression, distinct de l'edition du personnel.
//
// Chaque table passe par fetchAll : les placements d'une personne depassent 1000
// lignes en moins de trois ans, et PostgREST tronque sans erreur (export
// incomplet, cf. audit du 2026-11-03). Les visites medicales n'y figurent pas :
// elles relevent du droit `visites` (RH), pas du droit RGPD.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
  // La matrice decide : admin ou droit « rgpd: write ».
  if (!(await canWriteModule(profile.role, "rgpd"))) {
    return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await getServerClient();

  // Ordre deterministe par la cle d'unicite de chaque table (personne fixee).
  const parPersonne = (table: string, ordre: string) =>
    fetchAll<Ligne>(() => supabase.from(table).select("*").eq("personne_id", id).order(ordre).returns<Ligne[]>());

  try {
    const [personne, matrice, competences, placements, contrats, absences, tempsPartiel, horaires] = await Promise.all([
      supabase.from("personne").select("*").eq("id", id).maybeSingle<Ligne>(),
      parPersonne("matrice", "poste_id"),
      parPersonne("personne_competence", "competence_id"),
      parPersonne("placement", "jour"),
      parPersonne("contrat_periode", "id"),
      parPersonne("absence", "id"),
      parPersonne("tp_periode", "id"),
      parPersonne("horaire_exception", "jour"),
    ]);
    if (personne.error) throw personne.error;
    if (!personne.data) return NextResponse.json({ error: "Personne introuvable" }, { status: 404 });

    const payload = {
      export_le: new Date().toISOString(),
      personne: personne.data,
      contrats,
      matrice,
      competences,
      placements,
      absences,
      temps_partiel: tempsPartiel,
      horaires_specifiques: horaires,
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="personne-${id}.json"`,
      },
    });
  } catch (e) {
    const pg = e as { code?: string; message?: string; details?: string | null };
    return NextResponse.json({ error: messageErreur({ code: pg?.code, message: pg?.message ?? "Erreur", details: pg?.details ?? null }) }, { status: 500 });
  }
}
