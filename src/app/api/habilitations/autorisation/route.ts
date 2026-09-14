import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { messageRefusPerimetre } from "@/lib/erreurs";

// POST /api/habilitations/autorisation { id, remise: boolean }
// Toggle « autorisation remise » sur un enregistrement personne_competence
// (edition inline, apres coup). L'UI n'expose plus qu'une case a cocher : cochee
// on inscrit la date d'obtention dans date_autorisation_conduite, decochee on
// remet a null. Perimetre : admin -> client admin ; chef d'equipe -> client RLS
// (can_edit_personne).
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: string; remise?: boolean } | null;
  const id = String(body?.id ?? "");
  const remise = body?.remise === true;
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  const supabase = (await canWriteModule(profile.role, "habilitations")) ? getAdminClient() : await getServerClient();

  // MULTI-SITE : borne par site_id (défense en profondeur — l'id UUID
  // est unique global, mais avec service_role la RLS ne filtre pas).
  const site_id = profile.siteId;

  // Lire la date d'obtention pour l'utiliser comme date d'autorisation.
  // Sans date d'obtention (cas theorique : ligne existant mais vide), on refuse :
  // la « date d'autorisation » n'aurait rien a pointer.
  const { data: rec, error: readErr } = await supabase
    .from("personne_competence")
    .select("date_obtention")
    .eq("id", id)
    .eq("site_id", site_id)
    .single<{ date_obtention: string | null }>();
  if (readErr) return NextResponse.json({ error: messageRefusPerimetre({ code: readErr.code, message: readErr.message, details: null }) }, { status: 403 });
  if (remise && !rec?.date_obtention) {
    return NextResponse.json({ error: "Date d'obtention manquante." }, { status: 400 });
  }

  const { error } = await supabase
    .from("personne_competence")
    .update({ date_autorisation_conduite: remise ? rec!.date_obtention : null })
    .eq("id", id)
    .eq("site_id", site_id);
  if (error) return NextResponse.json({ error: messageRefusPerimetre({ code: error.code, message: error.message, details: null }) }, { status: 403 });
  return NextResponse.json({ ok: true });
}
