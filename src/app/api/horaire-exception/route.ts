import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { verifierIdSite } from "@/lib/verifier-site";

// POST /api/horaire-exception { op, personne_id, jour, debut?, fin?, motif?, jours? }
//   op = "save"  -> upsert (ou suppression si tout est vide)
//   op = "save-many" -> upsert du même horaire sur `jours` (recopie de la pendule)
//   op = "delete" -> suppression
// Droits : RLS (can_edit_personne) ; admin ou chef de l'equipe de la personne.
const s = (v: unknown) => String(v ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  const personne_id = s(body?.personne_id);
  const jour = s(body?.jour);
  if (!personne_id || !isDate(jour)) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  const supabase = (await canWriteModule(profile.role, "planning")) ? getAdminClient() : await getServerClient();

  if (op === "delete") {
    const { error } = await supabase
      .from("horaire_exception")
      .delete()
      .eq("site_id", profile.siteId)
      .eq("personne_id", personne_id)
      .eq("jour", jour);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  // Recopie de la pendule (» en tête de la fenêtre) : même horaire / commentaire
  // sur plusieurs jours de la personne, en une écriture.
  if (op === "save-many") {
    const jours = Array.isArray(body?.jours) ? (body.jours as unknown[]).map(s) : [];
    if (jours.length === 0 || jours.length > 31 || !jours.every(isDate)) {
      return NextResponse.json({ error: "Jours invalides" }, { status: 400 });
    }
    const debut = orNull(s(body?.debut));
    const fin = orNull(s(body?.fin));
    const motif = orNull(s(body?.motif));
    if (!debut && !fin && !motif) return NextResponse.json({ error: "Rien à recopier" }, { status: 400 });
    // En service_role, la RLS ne borne plus la personne au site : on le vérifie.
    const errSite = await verifierIdSite(supabase, "personne", personne_id, profile.siteId, "Personne");
    if (errSite) return NextResponse.json({ error: errSite }, { status: 400 });
    const { error } = await supabase.from("horaire_exception").upsert(
      jours.map((j) => ({ personne_id, jour: j, debut, fin, motif, created_by: profile.authId, site_id: profile.siteId })),
      { onConflict: "personne_id,jour" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, n: jours.length });
  }

  if (op === "save") {
    const debut = orNull(s(body?.debut));
    const fin = orNull(s(body?.fin));
    const motif = orNull(s(body?.motif));
    // Tout vide -> on efface l'exception (retour a l'horaire standard).
    if (!debut && !fin && !motif) {
      const { error } = await supabase
        .from("horaire_exception")
        .delete()
        .eq("site_id", profile.siteId)
        .eq("personne_id", personne_id)
        .eq("jour", jour);
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ ok: true, cleared: true });
    }
    // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
    const { error } = await supabase.from("horaire_exception").upsert(
      { personne_id, jour, debut, fin, motif, created_by: profile.authId, site_id: profile.siteId },
      { onConflict: "personne_id,jour" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
}
