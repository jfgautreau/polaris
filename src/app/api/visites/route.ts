import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { verifierIdSite } from "@/lib/verifier-site";
import { AVIS, estRegime } from "@/lib/visites";

// POST /api/visites { op, ... }
//
// Écritures du module Visites médicales : la visite elle-même, le réglage de
// suivi d'une personne, et les contraintes d'affectation. Droit `visites`
// (matrice de modules), jamais un rôle en dur.
//
// RAPPEL PRODUIT : aucune donnée de santé ne transite ici. `avis` est borné à
// quatre valeurs (attestation, apte, apte avec aménagements, inapte), le
// commentaire est logistique, et une contrainte d'affectation n'a PAS de motif.
//
// Ops : visite.save | visite.delete | suivi.set | contrainte.add | contrainte.delete

const s = (v: unknown) => String(v ?? "").trim();
const dateOuNull = (v: unknown): string | null => {
  const t = s(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
const AVIS_CODES = AVIS.map((a) => a.code) as string[];

export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("visites");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { supabase, profile } = garde;
  const site_id = profile.siteId;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  // --- Une visite (planifiée puis réalisée) ---------------------------------
  if (op === "visite.save") {
    const id = s(body.id);
    const personne_id = s(body.personne_id);
    const type_id = s(body.type_id);
    if (!personne_id || !type_id) return NextResponse.json({ error: "Personne et type de visite obligatoires." }, { status: 400 });

    // MULTI-SITE : les UUID viennent du client, le client est en service_role.
    const [errPers, errType] = await Promise.all([
      verifierIdSite(supabase, "personne", personne_id, site_id, "Personne"),
      verifierIdSite(supabase, "visite_type", type_id, site_id, "Type de visite"),
    ]);
    if (errPers) return NextResponse.json({ error: errPers }, { status: 400 });
    if (errType) return NextResponse.json({ error: errType }, { status: 400 });

    const avisBrut = s(body.avis);
    const ligne = {
      personne_id,
      type_id,
      date_rdv: dateOuNull(body.date_rdv),
      date_visite: dateOuNull(body.date_visite),
      avis: AVIS_CODES.includes(avisBrut) ? avisBrut : null,
      prochaine_date: dateOuNull(body.prochaine_date),
      commentaire: s(body.commentaire) || null,
      site_id,
    };
    if (!ligne.date_rdv && !ligne.date_visite) {
      return NextResponse.json({ error: "Indiquez au moins une date de rendez-vous ou de réalisation." }, { status: 400 });
    }

    let visiteId = id;
    if (id) {
      const { error } = await supabase.from("visite").update(ligne).eq("id", id).eq("site_id", site_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    } else {
      const { data, error } = await supabase
        .from("visite")
        .insert({ ...ligne, created_by: profile.authId })
        .select("id")
        .single<{ id: string }>();
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      visiteId = data.id;
    }

    // Attestations de non contre-indication délivrées : on réécrit la liste
    // complète (effacer puis poser), elle est minuscule et toujours envoyée
    // en entier par l'écran.
    const usages = Array.isArray(body.anci) ? body.anci.map(s).filter(Boolean) : [];
    const { error: errDel } = await supabase.from("visite_anci").delete().eq("visite_id", visiteId).eq("site_id", site_id);
    if (errDel) return NextResponse.json({ error: errDel.message }, { status: 403 });
    if (usages.length) {
      const { data: connus } = await supabase
        .from("visite_anci_usage")
        .select("code")
        .eq("site_id", site_id)
        .in("code", usages)
        .returns<{ code: string }[]>();
      const valides = new Set((connus ?? []).map((u) => u.code));
      const rows = usages.filter((u) => valides.has(u)).map((usage_code) => ({ visite_id: visiteId, usage_code, site_id }));
      if (rows.length) {
        const { error } = await supabase.from("visite_anci").insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }
    return NextResponse.json({ ok: true, id: visiteId });
  }

  if (op === "visite.delete") {
    const id = s(body.id);
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const { error } = await supabase.from("visite").delete().eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  // --- Réglage de suivi d'une personne (sans motif) -------------------------
  if (op === "suivi.set") {
    const personne_id = s(body.personne_id);
    if (!personne_id) return NextResponse.json({ error: "Personne manquante" }, { status: 400 });
    const errPers = await verifierIdSite(supabase, "personne", personne_id, site_id, "Personne");
    if (errPers) return NextResponse.json({ error: errPers }, { status: 400 });

    const forceBrut = s(body.regime_force);
    const { error } = await supabase.from("personne_suivi").upsert(
      {
        personne_id,
        suivi_adapte: body.suivi_adapte === true || body.suivi_adapte === "true",
        regime_force: estRegime(forceBrut) ? forceBrut : null,
        site_id,
      },
      { onConflict: "personne_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  // --- Contraintes d'affectation (sans motif) -------------------------------
  if (op === "contrainte.add") {
    const personne_id = s(body.personne_id);
    const quart_code = s(body.quart_code) || null;
    const poste_id = s(body.poste_id) || null;
    const date_debut = dateOuNull(body.date_debut);
    const date_fin = dateOuNull(body.date_fin);
    if (!personne_id || !date_debut) {
      return NextResponse.json({ error: "Personne et date de début obligatoires." }, { status: 400 });
    }
    if (!quart_code && !poste_id) {
      return NextResponse.json({ error: "Indiquez un quart ou un poste à exclure." }, { status: 400 });
    }
    if (date_fin && date_fin < date_debut) {
      return NextResponse.json({ error: "La date de fin précède la date de début." }, { status: 400 });
    }
    const [errPers, errPoste, quartRes] = await Promise.all([
      verifierIdSite(supabase, "personne", personne_id, site_id, "Personne"),
      verifierIdSite(supabase, "poste", poste_id, site_id, "Poste"),
      quart_code
        ? supabase.from("quart").select("code").eq("code", quart_code).eq("site_id", site_id).maybeSingle<{ code: string }>()
        : null,
    ]);
    if (errPers) return NextResponse.json({ error: errPers }, { status: 400 });
    if (errPoste) return NextResponse.json({ error: errPoste }, { status: 400 });
    if (quart_code && !quartRes?.data) return NextResponse.json({ error: "Quart inconnu sur votre site." }, { status: 400 });

    const { error } = await supabase
      .from("contrainte_affectation")
      .insert({ personne_id, quart_code, poste_id, date_debut, date_fin, created_by: profile.authId, site_id });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (op === "contrainte.delete") {
    const id = s(body.id);
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const { error } = await supabase.from("contrainte_affectation").delete().eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
}
