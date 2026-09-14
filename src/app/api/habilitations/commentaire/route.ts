import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { messageRefusPerimetre } from "@/lib/erreurs";

// POST /api/habilitations/commentaire { id, commentaire }
// Edition inline du commentaire d'une habilitation depuis la vue liste. Meme
// perimetre que /autorisation : admin -> client admin, chef d'equipe -> RLS.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: string; commentaire?: string | null } | null;
  const id = String(body?.id ?? "");
  const commentaire = (body?.commentaire ?? "").toString().trim() || null;
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  const supabase = (await canWriteModule(profile.role, "habilitations")) ? getAdminClient() : await getServerClient();
  // MULTI-SITE : borne par site_id (défense en profondeur avec service_role).
  const { error } = await supabase
    .from("personne_competence")
    .update({ commentaire })
    .eq("id", id)
    .eq("site_id", profile.siteId);
  if (error) return NextResponse.json({ error: messageRefusPerimetre({ code: error.code, message: error.message, details: null }) }, { status: 403 });
  return NextResponse.json({ ok: true });
}
