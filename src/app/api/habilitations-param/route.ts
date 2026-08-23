import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";

// POST /api/habilitations-param { op, ... }
// Paramétrage des formations / habilitations. Ecriture admin.
// Modele : competence (a_recycler=true) avec categorie / groupe / ordre /
// a_autorisation_conduite. Ops : create | update | delete.
const COLS = "id, nom, categorie, groupe, duree_validite_mois, a_autorisation_conduite, ordre, actif, a_recycler";
const CATS = ["reglementaire", "interne"];
const s = (v: unknown) => String(v ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Droit de module, et non « admin » en dur : la matrice accorde ce module a
  // d'autres roles, l'API doit honorer ce qu'elle promet.
  if (!(await canWriteModule(profile.role, "habilitations_param"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  // Client admin : les tables de parametrage sont protegees par une RLS
  // `is_admin()`. Le droit de module a deja ete verifie ci-dessus, et
  // canWriteModule exclut le chef d'equipe par construction.
  const supabase = getAdminClient();
  // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
  const site_id = profile.siteId;

  try {
    if (op === "create") {
      const categorie = CATS.includes(s(body.categorie)) ? s(body.categorie) : "reglementaire";
      const groupe = orNull(s(body.groupe));
      const nom = s(body.nom) || "Nouvelle formation";
      const { data, error } = await supabase
        .from("competence")
        .insert({ nom, type: "ACQUIS", a_recycler: true, actif: true, categorie, groupe, site_id })
        .select(COLS)
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, row: data });
    }

    if (op === "update") {
      const id = s(body.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const patchIn = (body.patch ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(patchIn)) {
        const v = patchIn[k];
        switch (k) {
          case "nom":
          case "groupe":
            patch[k] = k === "nom" ? s(v) : orNull(s(v));
            break;
          case "categorie":
            if (CATS.includes(s(v))) patch.categorie = s(v);
            break;
          case "duree_validite_mois": {
            const n = Number(v);
            patch.duree_validite_mois = v === "" || Number.isNaN(n) ? null : Math.max(1, Math.floor(n));
            break;
          }
          case "a_autorisation_conduite":
            patch.a_autorisation_conduite = v === true || v === "true";
            break;
          case "ordre":
            patch.ordre = Math.max(0, Math.floor(Number(v) || 0));
            break;
          case "actif":
            patch.actif = v === true || v === "true";
            break;
        }
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
      const { error } = await supabase.from("competence").update(patch).eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (op === "delete") {
      const id = s(body.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const { error } = await supabase.from("competence").delete().eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
