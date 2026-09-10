import { NextResponse, type NextRequest } from "next/server";
import { userAdminGuard } from "@/lib/permissions";

// POST /api/users/active { user_id, active }
// Active / desactive un compte : met a jour app_user.is_active ET banni (ou leve le
// ban) cote Supabase Auth, car is_active seul ne bloque pas la connexion.
// Droit « utilisateurs » + anti-escalade (on ne desactive pas un compte qui nous
// domine) ; on ne peut pas se desactiver soi-meme (evite l'auto-verrou).
const BAN_LONG = "876000h"; // ~100 ans

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { user_id?: string; active?: boolean } | null;
  const user_id = String(body?.user_id ?? "");
  const active = body?.active === true;
  if (!user_id) return NextResponse.json({ error: "user_id manquant" }, { status: 400 });

  const garde = await userAdminGuard({ cibleUserId: user_id });
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });

  if (user_id === garde.profile.authId && !active) {
    return NextResponse.json({ error: "Impossible de se désactiver soi-même." }, { status: 400 });
  }

  const admin = garde.supabase;
  // MULTI-SITE (defense en profondeur, audit S7) : userAdminGuard a deja
  // valide que la cible est sur le site de l'appelant (sauf super_admin),
  // mais l'update lui-meme portait uniquement sur user_id. On borne aussi
  // par site pour rester coherent avec le pattern « lecture + ecriture
  // toujours bornees sur site_id » du reste de la base.
  let updateQ = admin.from("app_user").update({ is_active: active }).eq("user_id", user_id);
  if (!garde.profile.estSuperAdmin) {
    updateQ = updateQ.eq("site_id", garde.profile.siteId);
  }
  const { error: dbErr } = await updateQ;
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });

  const { error: authErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: active ? "none" : BAN_LONG });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
