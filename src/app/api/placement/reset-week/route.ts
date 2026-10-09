import { NextResponse, type NextRequest } from "next/server";
import { avecLotJournal } from "@/lib/journal-contexte";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";

// POST /api/placement/reset-week { personne_ids: string[], jours: string[] }
// Vide UNIQUEMENT les affectations sur lignes (placements avec poste_id) des
// personnes pour ces jours. Les absences (motif, materialisees depuis la table
// absence) et le temps partiel ne sont PAS touches -> coherence avec l'ecran
// "Absences specifiques". La RLS (can_edit_personne) limite aux personnes
// autorisees (admin / chef).
async function traiterPOST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifie" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    personne_ids?: string[];
    jours?: string[];
  } | null;
  const ids = body?.personne_ids ?? [];
  const jours = body?.jours ?? [];
  if (!ids.length || !jours.length) {
    return NextResponse.json({ error: "Parametres manquants" }, { status: 400 });
  }

  const supabase = (await canWritePlacementData(profile.role)) ? getAdminClient() : await getServerClient();
  // MULTI-SITE : borne par site_id (service_role bypass la RLS).
  const { error } = await supabase
    .from("placement")
    .delete()
    .eq("site_id", profile.siteId)
    .in("personne_id", ids)
    .in("jour", jours)
    .not("poste_id", "is", null); // ne supprime que les affectations sur poste
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}

// Journal (0086) : l'opération entière forme UN lot — une ligne de synthèse au
// Journal au lieu de centaines. La garde d'accès reste dans traiterPOST.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return traiterPOST(req);
  const b = (await req.clone().json().catch(() => null)) as { personne_ids?: string[]; jours?: string[] } | null;
  const fr = (iso?: string) => (iso && /^d{4}-d{2}-d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso ?? "");
  return avecLotJournal(profile.siteId, `Réinitialisation — ${b?.personne_ids?.length ?? 0} personne(s), ${b?.jours?.length ?? 0} jour(s)${b?.jours?.length ? ` à partir du ${fr([...b.jours].sort()[0])}` : ""}`, () => traiterPOST(req));
}
