import { NextResponse, type NextRequest } from "next/server";
import { userAdminGuard } from "@/lib/permissions";
import { isRole } from "@/lib/roles";
import { getCustomRoles } from "@/lib/roles-server";
import { genererLienMotDePasse, motDePasseAleatoire } from "@/lib/password-link";

// POST /api/users/create { email, name, role }
// Cree un compte confirme puis renvoie un LIEN que l'admin transmet : c'est
// l'utilisateur qui choisit son mot de passe. Le compte est ouvert avec un mot de
// passe aleatoire que personne ne connait — il ne sert qu'a satisfaire Supabase.
// Aucun email n'est envoye (cf. src/lib/password-link.ts).
//
// Securite : droit « utilisateurs: write » (via la matrice) ET anti-escalade —
// on ne cree pas un compte plus puissant que soi, puisqu'on repart avec son lien
// de connexion.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    name?: string;
    role?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const name = body?.name?.trim() ?? "";
  const role = String(body?.role ?? "");

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Email invalide" }, { status: 400 });
  }
  const roleValide = isRole(role) || (await getCustomRoles()).some((r) => r.code === role);
  if (!roleValide) {
    return NextResponse.json({ error: "Role invalide" }, { status: 400 });
  }

  const garde = await userAdminGuard({ roleVise: role });
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const admin = garde.supabase;

  // MULTI-SITE : passe le site de l'appelant dans les metadata pour que
  // le trigger `handle_new_user` (0043) rattache la ligne app_user au
  // bon site des la creation. Sans cela, le trigger tombe sur son
  // fallback lebignon — un admin d'un autre site creerait des comptes
  // rattaches a Lebignon en silence.
  //   - user_metadata.site_id : lu par le trigger handle_new_user.
  //   - app_metadata.site_id  : source du site courant cote middleware
  //     (src/proxy.ts). app_metadata n'est modifiable qu'en service_role,
  //     JAMAIS par l'utilisateur (contrairement a user_metadata via
  //     supabase.auth.updateUser) : indispensable pour que le header
  //     x-site-id ne soit pas falsifiable et fasse fuiter un autre site.
  const siteId = garde.profile.siteId;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: motDePasseAleatoire(),
    email_confirm: true,
    user_metadata: { name, site_id: siteId },
    app_metadata: { site_id: siteId },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Positionne role + nom et ACTIVE le compte : le trigger `handle_new_user` cree
  // desormais la ligne inactive (fermeture par defaut, cf. migration 0036).
  // On repositionne site_id explicitement en plus du metadata : ceinture +
  // bretelles au cas ou le trigger echouerait a le lire depuis raw_user_meta_data.
  if (data.user) {
    const { error: majErr } = await admin
      .from("app_user")
      .update({ role, name, is_active: true, site_id: siteId })
      .eq("user_id", data.user.id);
    if (majErr) {
      return NextResponse.json({ error: `Compte cree mais non active : ${majErr.message}` }, { status: 500 });
    }
  }

  // Le compte existe : sans ce lien, l'utilisateur n'a aucun moyen d'entrer.
  // Si la generation echoue, on le dit clairement plutot que d'annoncer un succes
  // trompeur — l'admin pourra relancer via « Lien de mot de passe » sur la ligne.
  try {
    const origin = req.headers.get("origin") ?? req.nextUrl.origin;
    const lien = await genererLienMotDePasse(email, origin);
    return NextResponse.json({ ok: true, user_id: data.user?.id, lien, email });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      user_id: data.user?.id,
      email,
      lienErreur: e instanceof Error ? e.message : "Lien non généré.",
    });
  }
}
