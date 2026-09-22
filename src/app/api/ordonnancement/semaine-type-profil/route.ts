import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";

// POST /api/ordonnancement/semaine-type-profil { op, ... }
// Gestion des profils de semaine type. Ecriture : droit `ordonnancement`.
//   op = create { nom }               -> cree un profil
//        rename { id, nom }
//        delete { id }                -> supprime (cascade gabarit)
//        set-default { id }           -> marque ce profil par defaut
const s = (v: unknown) => String(v ?? "").trim();

export async function POST(req: NextRequest) {
  // La matrice des droits decide, puis client admin : la RLS de ces tables
  // nomme des roles en dur (admin/ordo) et refuserait un titulaire du droit.
  const garde = await moduleWriteGuard("ordonnancement");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const supabase = garde.supabase;
  // MULTI-SITE : client admin (service_role) = bypass RLS. Toute écriture par
  // `id` DOIT être bornée par site_id, sinon un id forgé (ou set-default) touche
  // les profils d'un autre site. Cf. migration 0074 / audit isolation.
  const site_id = garde.profile.siteId;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  if (!op) return NextResponse.json({ error: "Requete invalide" }, { status: 400 });


  try {
    if (op === "create") {
      const nom = s(body?.nom) || "Nouveau profil";
      // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
      const { data, error } = await supabase
        .from("semaine_type_profil")
        .insert({ nom, site_id })
        .select("id, nom, par_defaut")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, row: data });
    }

    if (op === "rename") {
      const id = s(body?.id);
      const nom = s(body?.nom);
      if (!id || !nom) return NextResponse.json({ error: "Champs requis" }, { status: 400 });
      const { error } = await supabase.from("semaine_type_profil").update({ nom }).eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (op === "delete") {
      const id = s(body?.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const { error } = await supabase.from("semaine_type_profil").delete().eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (op === "set-default") {
      const id = s(body?.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      // Un seul profil par defaut a la fois — DANS LE SITE COURANT. Sans le
      // filtre site_id, ce reset effaçait le par_defaut de TOUS les sites.
      const { error: e1 } = await supabase.from("semaine_type_profil").update({ par_defaut: false }).eq("site_id", site_id).neq("id", id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("semaine_type_profil").update({ par_defaut: true }).eq("id", id).eq("site_id", site_id);
      if (e2) throw e2;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
