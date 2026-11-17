import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { requireModule } from "@/lib/permissions";
import { nomsDeComptes } from "@/lib/noms-comptes";
import { evenementsFormation, type EvenementFormation, type LigneAudit, type LotAudit } from "@/lib/historique-formation";

// GET /api/habilitations-param/historique?id=<competence>
// Historique d'une formation : création, changements de réglage (durée,
// nom, groupe, actif…) et nombre d'échéances recalculées. Lu dans le journal
// d'audit en service_role borné au site : la matrice de droits décide (lecture
// de Param. Habilitation), pas la RLS d'audit_log à rôles en dur.
export type EvenementFormationAffiche = Omit<EvenementFormation, "auteurId"> & { auteur: string | null };

export async function GET(req: NextRequest) {
  const { profile } = await requireModule("habilitations_param", "read");
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Formation inconnue." }, { status: 400 });

  const sb = getAdminClient();
  const { data: lignes, error } = await sb
    .from("audit_log")
    .select("id, created_at, action, app_user_id, old_values, new_values")
    .eq("site_id", profile.siteId)
    .eq("table_name", "competence")
    .eq("record_id", id)
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<LigneAudit[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recalculs d'échéances (lignes de synthèse LOT) sur la même période.
  const plusAncien = (lignes ?? []).reduce<string | null>((m, l) => (!m || l.created_at < m ? l.created_at : m), null);
  let lots: LotAudit[] = [];
  if (plusAncien) {
    const { data, error: errLots } = await sb
      .from("audit_log")
      .select("id, created_at, lot_libelle, new_values")
      .eq("site_id", profile.siteId)
      .eq("action", "LOT")
      .like("lot_libelle", "Échéances recalculées : %")
      .gte("created_at", plusAncien)
      .order("created_at")
      .limit(1000)
      .returns<LotAudit[]>();
    if (errLots) return NextResponse.json({ error: errLots.message }, { status: 500 });
    lots = data ?? [];
  }

  const evts = evenementsFormation(lignes ?? [], lots);
  const noms = await nomsDeComptes(evts.map((e) => e.auteurId ?? ""), profile.siteId);
  const evenements: EvenementFormationAffiche[] = evts.map(({ auteurId, ...e }) => ({
    ...e,
    auteur: auteurId ? noms.get(auteurId) || null : null,
  }));
  return NextResponse.json({ evenements });
}
