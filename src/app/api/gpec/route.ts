import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { messageErreur } from "@/lib/erreurs";
import { verifierIdSite } from "@/lib/verifier-site";
import { MOTIFS_DEPART, PALIERS } from "@/lib/gpec";

// POST /api/gpec { op, ... }
//
// Hypothèses de la projection des effectifs (GPEC, 0097). Droit `gpec` en
// écriture ; client service_role, chaque écriture bornée au site de l'appelant
// et chaque identifiant venu du client (service, motif, ligne, personne, poste,
// quart) vérifié contre ce site.
//
// Ops : hyp.set | hyp.subi | hyp.motif
//       capa.create | capa.update | capa.delete
//       depart.create | depart.delete

const s = (v: unknown) => String(v ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const estDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
// Nombre positif ou vide (null). `undefined` = saisie invalide.
function nombreOuNull(v: unknown, max: number): number | null | undefined {
  if (v === null || v === undefined || s(v) === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined;
  return n;
}

// Réglages simples : champ → bornes.
const CHAMPS: Record<string, { min: number; max: number; entier?: boolean }> = {
  jours_ouvres: { min: 1, max: 366, entier: true },
  semaines_conges: { min: 0, max: 30 },
  semaines_modulation: { min: 0, max: 30 },
  seuil1: { min: 0.05, max: 3 },
  seuil2: { min: 0.05, max: 3 },
  seuil3: { min: 0.05, max: 3 },
};

export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("gpec");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { supabase, profile } = garde;
  const site_id = profile.siteId;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const refus = (error: string, status = 400) => NextResponse.json({ error }, { status });

  const annee = Number(body.annee);
  const anneeOk = Number.isInteger(annee) && annee >= 2020 && annee <= 2100;

  // --- Réglage simple de l'année ---------------------------------------------
  if (op === "hyp.set") {
    if (!anneeOk) return refus("Année invalide.");
    const champ = s(body.champ);
    const regle = CHAMPS[champ];
    if (!regle) return refus("Réglage inconnu.");
    const n = Number(String(body.valeur ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n < regle.min || n > regle.max) return refus(`Valeur attendue entre ${regle.min} et ${regle.max}.`);
    const valeur = regle.entier ? Math.round(n) : n;
    const { error } = await supabase
      .from("gpec_hypothese")
      .upsert({ site_id, annee, [champ]: valeur, updated_at: new Date().toISOString() }, { onConflict: "site_id,annee" });
    if (error) return refus(messageErreur(error) ?? "Enregistrement impossible.", 500);
    return NextResponse.json({ ok: true, valeur });
  }

  // --- Absentéisme subi forcé d'un service / motif exclu du calcul auto -------
  if (op === "hyp.subi" || op === "hyp.motif") {
    if (!anneeOk) return refus("Année invalide.");
    const { data: ligne, error: e1 } = await supabase
      .from("gpec_hypothese")
      .select("absences_subies, motifs_exclus")
      .eq("site_id", site_id)
      .eq("annee", annee)
      .maybeSingle<{ absences_subies: Record<string, number> | null; motifs_exclus: string[] | null }>();
    if (e1) return refus(messageErreur(e1) ?? "Lecture impossible.", 500);
    const patch: Record<string, unknown> = {};
    if (op === "hyp.subi") {
      const atelierId = s(body.atelier_id);
      const err = await verifierIdSite(supabase, "atelier", atelierId, site_id, "Service");
      if (!atelierId || err) return refus(err ?? "Service manquant.");
      const v = nombreOuNull(body.valeur, 40);
      if (v === undefined) return refus("Valeur attendue : un nombre de semaines entre 0 et 40.");
      const subies = { ...(ligne?.absences_subies ?? {}) };
      if (v === null) delete subies[atelierId];
      else subies[atelierId] = v;
      patch.absences_subies = subies;
    } else {
      const motifId = s(body.motif_id);
      const err = await verifierIdSite(supabase, "motif_absence", motifId, site_id, "Motif");
      if (!motifId || err) return refus(err ?? "Motif manquant.");
      const exclus = new Set(Array.isArray(ligne?.motifs_exclus) ? ligne.motifs_exclus : []);
      if (body.exclu === true) exclus.add(motifId);
      else exclus.delete(motifId);
      patch.motifs_exclus = [...exclus];
    }
    const { error } = await supabase
      .from("gpec_hypothese")
      .upsert({ site_id, annee, ...patch, updated_at: new Date().toISOString() }, { onConflict: "site_id,annee" });
    if (error) return refus(messageErreur(error) ?? "Enregistrement impossible.", 500);
    return NextResponse.json({ ok: true });
  }

  // --- Lignes capacitaires -----------------------------------------------------
  if (op === "capa.create") {
    if (!anneeOk) return refus("Année invalide.");
    const nom = s(body.nom);
    if (!nom || nom.length > 60) return refus("Nom attendu (60 caractères au plus).");
    const { data, error } = await supabase
      .from("gpec_ligne_capa")
      .insert({ site_id, annee, nom, ordre: Math.round(Date.now() / 1000) % 1000000 })
      .select("id")
      .single<{ id: string }>();
    if (error) return refus(messageErreur(error) ?? "Création impossible.", 500);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (op === "capa.update") {
    const id = s(body.id);
    if (!UUID.test(id)) return refus("Ligne capacitaire inconnue.");
    const patch: Record<string, unknown> = {};
    if ("nom" in body) {
      const nom = s(body.nom);
      if (!nom || nom.length > 60) return refus("Nom attendu (60 caractères au plus).");
      patch.nom = nom;
    }
    for (const champ of ["capacite_jour", "volume_annuel"] as const) {
      if (!(champ in body)) continue;
      const v = nombreOuNull(body[champ], 1e12);
      if (v === undefined) return refus("Valeur attendue : un nombre positif.");
      patch[champ] = v;
    }
    if ("volumes_mois" in body) {
      const brut = body.volumes_mois;
      if (!Array.isArray(brut) || brut.length !== 12) return refus("Douze volumes mensuels attendus.");
      const mois = brut.map((v) => nombreOuNull(v, 1e12));
      if (mois.some((v) => v === undefined)) return refus("Valeur attendue : un nombre positif.");
      patch.volumes_mois = mois.every((v) => v === null) ? null : mois;
    }
    if ("lignes" in body) {
      const ids = Array.isArray(body.lignes) ? [...new Set(body.lignes.map(s).filter((x) => UUID.test(x)))] : [];
      if (ids.length) {
        const { data: connues, error } = await supabase.from("ligne").select("id").eq("site_id", site_id).in("id", ids).returns<{ id: string }[]>();
        if (error) return refus(messageErreur(error) ?? "Vérification impossible.", 500);
        if ((connues ?? []).length !== ids.length) return refus("Ligne inconnue ou hors de votre site.");
      }
      patch.lignes = ids;
    }
    if ("paliers" in body) {
      const brut = (body.paliers ?? {}) as Record<string, unknown>;
      const { data: quarts, error } = await supabase.from("quart").select("code").eq("site_id", site_id).returns<{ code: string }[]>();
      if (error) return refus(messageErreur(error) ?? "Vérification impossible.", 500);
      const codes = new Set((quarts ?? []).map((q) => q.code));
      const paliers: Record<string, string[]> = {};
      for (const p of PALIERS) {
        const liste = brut[String(p)];
        if (!Array.isArray(liste)) continue; // palier non réglé = tous les quarts
        paliers[String(p)] = [...new Set(liste.map(s).filter((c) => codes.has(c)))];
      }
      patch.paliers = paliers;
    }
    if (!Object.keys(patch).length) return refus("Rien à modifier.");
    const { error } = await supabase.from("gpec_ligne_capa").update(patch).eq("id", id).eq("site_id", site_id);
    if (error) return refus(messageErreur(error) ?? "Enregistrement impossible.", 500);
    return NextResponse.json({ ok: true });
  }

  if (op === "capa.delete") {
    const id = s(body.id);
    if (!UUID.test(id)) return refus("Ligne capacitaire inconnue.");
    const { error } = await supabase.from("gpec_ligne_capa").delete().eq("id", id).eq("site_id", site_id);
    if (error) return refus(messageErreur(error) ?? "Suppression impossible.", 500);
    return NextResponse.json({ ok: true });
  }

  // --- Départs prévus ----------------------------------------------------------
  if (op === "depart.create") {
    if (!anneeOk) return refus("Année invalide.");
    const personne_id = s(body.personne_id) || null;
    const poste_id = personne_id ? null : s(body.poste_id) || null;
    if (!personne_id && !poste_id) return refus("Choisir une personne ou un poste.");
    const err =
      (await verifierIdSite(supabase, "personne", personne_id, site_id, "Personne")) ??
      (await verifierIdSite(supabase, "poste", poste_id, site_id, "Poste"));
    if (err) return refus(err);
    const date = s(body.date_prevue);
    if (date && !estDate(date)) return refus("Date invalide.");
    const motif = s(body.motif) || MOTIFS_DEPART[0];
    if (!MOTIFS_DEPART.includes(motif)) return refus("Motif inconnu.");
    const commentaire = s(body.commentaire).slice(0, 200) || null;
    const { data, error } = await supabase
      .from("gpec_depart")
      .insert({ site_id, annee, personne_id, poste_id, date_prevue: date || null, motif, commentaire })
      .select("id")
      .single<{ id: string }>();
    if (error) return refus(messageErreur(error) ?? "Création impossible.", 500);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (op === "depart.delete") {
    const id = s(body.id);
    if (!UUID.test(id)) return refus("Départ inconnu.");
    const { error } = await supabase.from("gpec_depart").delete().eq("id", id).eq("site_id", site_id);
    if (error) return refus(messageErreur(error) ?? "Suppression impossible.", 500);
    return NextResponse.json({ ok: true });
  }

  return refus("Opération inconnue.");
}
