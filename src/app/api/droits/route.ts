import { NextResponse, type NextRequest } from "next/server";
import { MODULE_KEYS, moduleWriteGuard, verifierChangementDroit, type Niveau } from "@/lib/permissions";
import { getCurrentSite } from "@/lib/current-site";
import { getAllRoles } from "@/lib/roles-server";

// POST /api/droits { role, module, niveau }
// Enregistre un droit (role x module) a la volee, pour le titulaire du droit
// « utilisateurs: write ».
//
// La regle de securite vit dans `verifierChangementDroit` (lib/permissions), pas
// ici : elle est ainsi testable sans passer par HTTP. Elle porte trois verrous,
// tous calcules sur la matrice, sans nommer aucun role :
//   1. anti-verrou            : on ne modifie pas les droits de son propre role ;
//   2. anti-retrogradation    : ni ceux d'un role qui detient plus que soi
//                               (c'est ce verrou qui rend l'admin intouchable) ;
//   3. anti-escalade          : on n'accorde pas un niveau qu'on n'a pas soi-meme.
const VALID: Niveau[] = ["none", "read", "write"];

export async function POST(req: NextRequest) {
  // La matrice decide, y compris pour l'ecran qui l'edite — et le client admin
  // qui va avec : role_permission est sous RLS `is_admin()`, un titulaire du droit
  // « utilisateurs » qui n'est pas admin se faisait refuser sans explication.
  const garde = await moduleWriteGuard("utilisateurs");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });

  const body = (await req.json().catch(() => null)) as { role?: string; module?: string; niveau?: string } | null;
  const role = String(body?.role ?? "");
  const module = String(body?.module ?? "");
  const niveau = String(body?.niveau ?? "") as Niveau;
  // Rôle valide = intégré OU personnalisé du site courant (role_custom, 0042/0053).
  // Ne PAS valider contre les seuls ROLES intégrés : éditer les droits d'un rôle
  // personnalisé retombait alors en 400 « Paramètres invalides » → « Échec » à l'écran.
  const rolesValides = new Set((await getAllRoles()).map((r) => r.code));
  if (!rolesValides.has(role) || !MODULE_KEYS.includes(module) || !VALID.includes(niveau)) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }

  const verdict = await verifierChangementDroit(garde.profile.role, role, module, niveau);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  // MULTI-SITE (0053) : PK composite (role, module, site_id). L'upsert
  // cible ce triplet ; site_id vient du contexte, jamais du body.
  const site = await getCurrentSite();
  const { error } = await garde.supabase
    .from("role_permission")
    .upsert({ role, module, niveau, site_id: site.id }, { onConflict: "role,module,site_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
