import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { verifierIdSite } from "@/lib/verifier-site";
import { CATEGORIES, DESC_PARAMS, MAX_LEGAL, estRegime, type CategorieVisite } from "@/lib/visites";

// POST /api/visites-param { op, ... }
//
// Paramétrage du module Visites médicales. Droit `visites_param` : les RH
// règlent seules ce qui déclenche une visite, sans passer par un administrateur
// et sans recevoir le droit « Référentiel ».
//
// Les drapeaux posés sur les référentiels existants (quart.nuit,
// poste.suivi_renforce, competence.suivi_renforce, motif_absence.visite_reprise)
// s'écrivent ici et NULLE PART ailleurs : c'est la contrepartie de leur avoir
// ouvert ces tables sans leur ouvrir les écrans qui les gouvernent.
//
// Ops : param.set | regime.set | type.create/update/delete | usage.create/update/delete
//       quart.set | poste.set | competence.set | motif.set

const s = (v: unknown) => String(v ?? "").trim();
const bool = (v: unknown) => v === true || v === "true" || v === "1";
const orNull = (v: string) => (v === "" ? null : v);

export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("visites_param");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { supabase, profile } = garde;
  const site_id = profile.siteId;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  // --- Réglages simples (clé / valeur) --------------------------------------
  if (op === "param.set") {
    const cle = s(body.cle);
    const desc = DESC_PARAMS.find((d) => d.cle === cle);
    if (!desc) return NextResponse.json({ error: "Réglage inconnu" }, { status: 400 });
    let valeur: string;
    if (desc.type === "bool") {
      valeur = bool(body.valeur) ? "1" : "0";
    } else {
      const n = Number(body.valeur);
      if (!Number.isFinite(n)) return NextResponse.json({ error: "Valeur attendue : un nombre." }, { status: 400 });
      valeur = String(Math.min(desc.max ?? 9999, Math.max(desc.min ?? 0, Math.round(n))));
    }
    const { error } = await supabase.from("visite_parametre").upsert({ site_id, cle, valeur }, { onConflict: "site_id,cle" });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, valeur });
  }

  // --- Plafonds d'un régime -------------------------------------------------
  // Les maxima légaux ne sont PAS imposés ici : un service de santé au travail
  // peut fixer une périodicité plus courte, et le Code du travail lui-même
  // n'oblige à rien de plus court. Une valeur au-dessus du maximum est acceptée
  // mais signalée à l'écran — c'est un choix d'employeur, pas une faute de
  // frappe à corriger en silence.
  if (op === "regime.set") {
    const code = s(body.code);
    if (!estRegime(code)) return NextResponse.json({ error: "Régime inconnu" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if ("libelle" in body) patch.libelle = s(body.libelle) || code;
    if ("mois_renouvellement" in body) {
      const n = Number(body.mois_renouvellement);
      if (!Number.isFinite(n) || n < 1) return NextResponse.json({ error: "Durée invalide." }, { status: 400 });
      patch.mois_renouvellement = Math.min(120, Math.round(n));
    }
    if ("mois_intermediaire" in body) {
      const brut = s(body.mois_intermediaire);
      const n = Number(brut);
      patch.mois_intermediaire = brut === "" || !Number.isFinite(n) || n < 1 ? null : Math.min(120, Math.round(n));
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
    const { error } = await supabase.from("visite_regime").update(patch).eq("code", code).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, max: MAX_LEGAL[code] });
  }

  // --- Catalogue des types de visite ---------------------------------------
  if (op === "type.create") {
    const categorie = s(body.categorie);
    if (!CATEGORIES.includes(categorie as CategorieVisite)) {
      return NextResponse.json({ error: "Catégorie inconnue" }, { status: 400 });
    }
    const code = `custom_${Date.now().toString(36)}`;
    const { data, error } = await supabase
      .from("visite_type")
      .insert({ site_id, code, libelle: s(body.libelle) || "Nouvelle visite", categorie, ordre: 99 })
      .select("id, code, libelle, categorie, actif, ordre")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, row: data });
  }

  if (op === "type.update") {
    const id = s(body.id);
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const patchIn = (body.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ("libelle" in patchIn) patch.libelle = s(patchIn.libelle) || "Visite";
    if ("categorie" in patchIn && CATEGORIES.includes(s(patchIn.categorie) as CategorieVisite)) {
      patch.categorie = s(patchIn.categorie);
    }
    if ("actif" in patchIn) patch.actif = bool(patchIn.actif);
    if ("ordre" in patchIn) patch.ordre = Math.max(0, Math.round(Number(patchIn.ordre) || 0));
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
    const { error } = await supabase.from("visite_type").update(patch).eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (op === "type.delete") {
    const id = s(body.id);
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    // Une visite déjà saisie référence ce type : la contrainte de clé étrangère
    // refuse la suppression. On l'explique au lieu de renvoyer l'erreur brute.
    const { count, error: errCount } = await supabase
      .from("visite")
      .select("id", { count: "exact", head: true })
      .eq("type_id", id)
      .eq("site_id", site_id);
    if (errCount) return NextResponse.json({ error: errCount.message }, { status: 403 });
    if (count && count > 0) {
      return NextResponse.json(
        { error: `${count} visite(s) utilisent ce type. Désactivez-le plutôt que de le supprimer.` },
        { status: 409 },
      );
    }
    const { error } = await supabase.from("visite_type").delete().eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  // --- Usages d'attestation de non contre-indication ------------------------
  if (op === "usage.create") {
    const libelle = s(body.libelle) || "Nouvel usage";
    const code = `u_${Date.now().toString(36)}`;
    const { data, error } = await supabase
      .from("visite_anci_usage")
      .insert({ site_id, code, libelle, ordre: 99 })
      .select("id, code, libelle, actif, ordre")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, row: data });
  }

  if (op === "usage.update") {
    const id = s(body.id);
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const patchIn = (body.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ("libelle" in patchIn) patch.libelle = s(patchIn.libelle) || "Usage";
    if ("actif" in patchIn) patch.actif = bool(patchIn.actif);
    if ("ordre" in patchIn) patch.ordre = Math.max(0, Math.round(Number(patchIn.ordre) || 0));
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
    const { error } = await supabase.from("visite_anci_usage").update(patch).eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (op === "usage.delete") {
    const id = s(body.id);
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const { error } = await supabase.from("visite_anci_usage").delete().eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  // --- Drapeaux sur les référentiels ---------------------------------------
  if (op === "quart.set") {
    const code = s(body.code);
    if (!code) return NextResponse.json({ error: "Quart manquant" }, { status: 400 });
    const { error } = await supabase
      .from("quart")
      .update({ nuit: bool(body.nuit) })
      .eq("code", code)
      .eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (op === "poste.set") {
    const id = s(body.id);
    const errPoste = await verifierIdSite(supabase, "poste", id, site_id, "Poste");
    if (errPoste) return NextResponse.json({ error: errPoste }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if ("suivi_renforce" in body) patch.suivi_renforce = bool(body.suivi_renforce);
    if ("suivi_motif" in body) patch.suivi_motif = orNull(s(body.suivi_motif));
    if ("anci_usage" in body) {
      const err = await usageConnu(supabase, site_id, s(body.anci_usage));
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      patch.anci_usage = orNull(s(body.anci_usage));
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
    const { error } = await supabase.from("poste").update(patch).eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (op === "competence.set") {
    const id = s(body.id);
    const errComp = await verifierIdSite(supabase, "competence", id, site_id, "Habilitation");
    if (errComp) return NextResponse.json({ error: errComp }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if ("suivi_renforce" in body) patch.suivi_renforce = bool(body.suivi_renforce);
    if ("anci_usage" in body) {
      const err = await usageConnu(supabase, site_id, s(body.anci_usage));
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      patch.anci_usage = orNull(s(body.anci_usage));
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
    const { error } = await supabase.from("competence").update(patch).eq("id", id).eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (op === "motif.set") {
    const id = s(body.id);
    const errMotif = await verifierIdSite(supabase, "motif_absence", id, site_id, "Motif");
    if (errMotif) return NextResponse.json({ error: errMotif }, { status: 400 });
    const { error } = await supabase
      .from("motif_absence")
      .update({ visite_reprise: bool(body.visite_reprise) })
      .eq("id", id)
      .eq("site_id", site_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
}

// Un usage d'ANCI posé sur un poste ou une habilitation doit exister sur CE site :
// sinon l'exigence ne serait jamais satisfaite par aucune visite.
type Client = Awaited<ReturnType<typeof import("@/lib/supabase-server").getAdminClient>>;

async function usageConnu(supabase: Client, site_id: string, code: string): Promise<string | null> {
  if (!code) return null;
  const { data, error } = await supabase
    .from("visite_anci_usage")
    .select("code")
    .eq("code", code)
    .eq("site_id", site_id)
    .maybeSingle<{ code: string }>();
  if (error) return `Vérification impossible : ${error.message}`;
  if (!data) return "Usage d'attestation inconnu sur votre site.";
  return null;
}
