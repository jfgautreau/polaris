import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { requireModule } from "@/lib/permissions";

// GET /api/habilitations/historique?personne_id=…&competence_id=…
// Historique d'une habilitation pour une personne (migration 0084) : ajouts,
// recyclages, modifications et suppressions, du plus récent au plus ancien.
// Lecture sous RLS (bornée au site) ; seuls les noms d'auteurs passent par le
// client admin, la table des comptes n'étant pas lisible par tous les rôles.
export type EvenementHabilitation = {
  id: number;
  action: "ajout" | "modification" | "suppression";
  date_obtention: string | null;
  date_expiration: string | null;
  date_autorisation_conduite: string | null;
  commentaire: string | null;
  auteur: string | null;
  created_at: string;
};

export async function GET(req: NextRequest) {
  const { profile } = await requireModule("habilitations", "read");
  const personne_id = req.nextUrl.searchParams.get("personne_id") ?? "";
  const competence_id = req.nextUrl.searchParams.get("competence_id") ?? "";
  if (!personne_id || !competence_id) {
    return NextResponse.json({ error: "Personne et habilitation sont requises." }, { status: 400 });
  }

  const supabase = await getServerClient();
  const { data, error } = await supabase
    .from("personne_competence_historique")
    .select("id, action, date_obtention, date_expiration, date_autorisation_conduite, commentaire, auteur, created_at")
    .eq("site_id", profile.siteId)
    .eq("personne_id", personne_id)
    .eq("competence_id", competence_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200)
    .returns<(Omit<EvenementHabilitation, "auteur"> & { auteur: string | null })[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((data ?? []).map((e) => e.auteur).filter((x): x is string => !!x))];
  const noms = new Map<string, string>();
  if (ids.length) {
    const { data: users } = await getAdminClient()
      .from("app_user")
      .select("user_id, name, email")
      .in("user_id", ids)
      .returns<{ user_id: string; name: string | null; email: string | null }[]>();
    for (const u of users ?? []) noms.set(u.user_id, u.name || u.email || "");
  }

  const evenements: EvenementHabilitation[] = (data ?? []).map((e) => ({
    ...e,
    auteur: e.auteur ? noms.get(e.auteur) || null : null,
  }));
  return NextResponse.json({ evenements });
}
