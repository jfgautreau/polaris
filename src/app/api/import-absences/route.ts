import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { messageErreur } from "@/lib/erreurs";
import {
  parseFichierAbsencesRh,
  apparier,
  type PersonnePolaris,
  type EquivalenceApprise,
} from "@/lib/import-absences-rh";

// POST /api/import-absences  (multipart/form-data)
//   op=preview  { fichier }                        -> aperçu (appariement, motifs à créer)
//   op=apply    { fichier, resolutions: JSON }     -> écrit les absences
//
// Import des absences exportées par le logiciel RH (GT), depuis Paramètres RH.
// Décisions (cf. src/lib/import-absences-rh.ts et discussion 2026-09-08) :
//  - une ligne datée = une journée entière d'absence ;
//  - motifs reliés par motif_absence.code_gt ; un code inconnu CRÉE le motif ;
//  - personnes appariées par NOM (matricules RH ≠ Polaris), équivalences
//    mémorisées dans import_absence_personne ;
//  - à l'application : on REMPLACE les jours d'absence sur la fenêtre couverte
//    par le fichier, pour les personnes résolues (le fichier RH fait foi).
//
// La garde est motifs:write (écran Paramètres RH) ; l'écriture passe par le
// client admin site-borné rendu par moduleWriteGuard.

const CODES_UNDEF = new Set(["42703", "42P01"]); // colonne / table inexistante
const MSG_MIGRATION =
  "Structure manquante : exécutez la migration 0066 (code GT + équivalences d'import) dans le SQL Editor.";

// Le CSV RH est le plus souvent en Windows-1252/ANSI. On tente l'UTF-8, et on
// retombe sur latin1 dès qu'un caractère de remplacement (�) apparaît.
function decoder(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  const utf8 = new TextDecoder("utf-8").decode(u8);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("latin1").decode(u8);
}

// Code court dérivé d'un code GT (« 00CLFA » -> « CLFA »), borné à 6 caractères
// et rendu unique dans le site (suffixe numérique en cas de collision).
function codeCourtUnique(codeGt: string, pris: Set<string>): string {
  const base = (codeGt.replace(/^0+/, "") || codeGt).slice(0, 6).toUpperCase() || "MOT";
  let c = base;
  let n = 1;
  while (pris.has(c)) {
    const suffixe = String(++n);
    c = base.slice(0, Math.max(1, 6 - suffixe.length)) + suffixe;
  }
  pris.add(c);
  return c;
}

// Absence subie (non planifiée) : maladie, accident, absence non indemnisée…
function devineNonPlanifie(libelle: string): boolean {
  const t = libelle
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return /malad|accident|acc\.?\s?trav|absence non|injustif|hospitalis/.test(t);
}

export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("motifs");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { supabase, profile } = garde;
  const siteId = profile.siteId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Requête invalide (form-data attendu)." }, { status: 400 });
  }
  const op = String(form.get("op") ?? "").trim();
  const fichier = form.get("fichier");
  if (!(fichier instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant." }, { status: 400 });
  }
  const texte = decoder(await fichier.arrayBuffer());
  const parse = parseFichierAbsencesRh(texte);

  if (parse.personnes.length === 0) {
    return NextResponse.json({ error: "Aucune absence lisible dans ce fichier." }, { status: 400 });
  }

  try {
    // Référentiels du site : effectif, motifs (code GT), équivalences apprises.
    const [persR, motR, apprR] = await Promise.all([
      supabase.from("personne").select("id, nom, prenom, statut").eq("site_id", siteId).order("nom"),
      supabase.from("motif_absence").select("id, libelle, code_court, code_gt").eq("site_id", siteId),
      supabase.from("import_absence_personne").select("matricule_rh, personne_id, ignorer").eq("site_id", siteId),
    ]);
    for (const r of [persR, motR, apprR]) {
      if (r.error && CODES_UNDEF.has((r.error as { code?: string }).code ?? "")) {
        return NextResponse.json({ error: MSG_MIGRATION }, { status: 400 });
      }
      if (r.error) throw r.error;
    }

    const personnes = (persR.data ?? []) as (PersonnePolaris & { statut: string | null })[];
    const motifs = (motR.data ?? []) as { id: string; libelle: string; code_court: string; code_gt: string | null }[];
    const apprises: Record<string, EquivalenceApprise> = {};
    for (const a of (apprR.data ?? []) as { matricule_rh: string; personne_id: string | null; ignorer: boolean }[]) {
      apprises[a.matricule_rh] = { personneId: a.personne_id, ignorer: a.ignorer };
    }

    const parCodeGt = new Map<string, string>(); // code_gt -> motif_id
    for (const m of motifs) if (m.code_gt) parCodeGt.set(m.code_gt, m.id);

    const resultats = apparier(parse.personnes, personnes, apprises);

    // Motifs présents dans le fichier mais sans code GT connu -> à créer.
    const motifsACreer = [...parse.motifs.entries()]
      .filter(([code]) => !parCodeGt.has(code))
      .map(([codeGt, libelle]) => ({ codeGt, libelle }));

    if (op === "preview") {
      return NextResponse.json({
        ok: true,
        fenetre: { min: parse.dateMin, max: parse.dateMax },
        personnes: resultats,
        motifsACreer,
        effectif: personnes.map((p) => ({
          id: p.id,
          libelle: `${p.nom} ${p.prenom}`.trim() + (p.statut && p.statut !== "ACTIF" ? ` (${p.statut})` : ""),
        })),
      });
    }

    if (op === "apply") {
      const resolutions = JSON.parse(String(form.get("resolutions") ?? "{}")) as Record<string, string>;
      const min = parse.dateMin!;
      const max = parse.dateMax!;
      const idsSite = new Set(personnes.map((p) => p.id));

      // 1) Créer les motifs manquants (code GT), récupérer leur id.
      let motifsCrees = 0;
      if (motifsACreer.length) {
        const prisCourts = new Set(motifs.map((m) => m.code_court?.toUpperCase()).filter(Boolean) as string[]);
        const aInserer = motifsACreer.map(({ codeGt, libelle }) => ({
          libelle: libelle || codeGt,
          code_court: codeCourtUnique(codeGt, prisCourts),
          code_gt: codeGt,
          couleur: "#e5e7eb",
          non_planifie: devineNonPlanifie(libelle),
          site_id: siteId,
        }));
        const { data: crees, error } = await supabase
          .from("motif_absence")
          .insert(aInserer)
          .select("id, code_gt");
        if (error) throw error;
        for (const c of (crees ?? []) as { id: string; code_gt: string | null }[]) {
          if (c.code_gt) parCodeGt.set(c.code_gt, c.id);
        }
        motifsCrees = crees?.length ?? 0;
      }

      // 2) Mémoriser les équivalences (matricule RH -> personne / ignorer) pour
      //    les imports suivants. On n'enregistre que ce que le fichier contient.
      const upEquiv: {
        site_id: string; matricule_rh: string; personne_id: string | null;
        ignorer: boolean; nom_fichier: string; updated_at: string;
      }[] = [];
      const now = new Date().toISOString();
      for (const r of resultats) {
        const choix = resolutions[r.matriculeRh];
        // Choix explicite de l'utilisateur (ou reprise du défaut affiché).
        const personneId = choix !== undefined ? (choix || null) : r.personneId;
        const ignorer = choix !== undefined ? choix === "" : r.ignorer;
        if (personneId && !idsSite.has(personneId)) continue; // sécurité : hors site
        upEquiv.push({
          site_id: siteId, matricule_rh: r.matriculeRh, personne_id: personneId,
          ignorer, nom_fichier: r.nomComplet, updated_at: now,
        });
      }
      if (upEquiv.length) {
        const { error } = await supabase
          .from("import_absence_personne")
          .upsert(upEquiv, { onConflict: "site_id,matricule_rh" });
        if (error) throw error;
      }

      // 3) Construire les lignes de placement (un jour = une journée d'absence).
      type Row = {
        personne_id: string; jour: string; motif_absence_id: string;
        poste_id: null; equipe_id: null; quart_code: null; numero_rotation: null;
        absence_id: null; non_travaille: boolean; created_by: string; site_id: string;
      };
      const rows: Row[] = [];
      const idsResolues = new Set<string>();
      let jamaisMappes = 0; // jours dont le code GT n'a pas pu être résolu (ne devrait pas arriver après création)
      for (const rhp of parse.personnes) {
        const eq = upEquiv.find((e) => e.matricule_rh === rhp.matriculeRh);
        const pid = eq && !eq.ignorer ? eq.personne_id : null;
        if (!pid) continue;
        idsResolues.add(pid);
        for (const j of rhp.jours) {
          const motifId = parCodeGt.get(j.codeGt);
          if (!motifId) { jamaisMappes++; continue; }
          rows.push({
            personne_id: pid, jour: j.dateIso, motif_absence_id: motifId,
            poste_id: null, equipe_id: null, quart_code: null, numero_rotation: null,
            absence_id: null, non_travaille: false, created_by: profile.authId, site_id: siteId,
          });
        }
      }

      let joursImportes = 0;
      if (idsResolues.size) {
        const ids = [...idsResolues];
        // 4) REMPLACER la fenêtre : on efface les absences existantes de ces
        //    personnes sur [min, max] (le fichier RH fait foi), puis on pose
        //    les jours du fichier. Les affectations poste hors-fichier ne sont
        //    pas touchées ; celles d'un jour marqué absent sont écrasées par le
        //    upsert (clé unique personne_id+jour), comme creer_absence.
        const delAbs = await supabase
          .from("absence").delete()
          .eq("site_id", siteId).in("personne_id", ids)
          .gte("date_debut", min).lte("date_fin", max);
        if (delAbs.error) throw delAbs.error;

        const delJours = await supabase
          .from("placement").delete()
          .eq("site_id", siteId).in("personne_id", ids)
          .gte("jour", min).lte("jour", max)
          .not("motif_absence_id", "is", null);
        if (delJours.error) throw delJours.error;

        if (rows.length) {
          const { error } = await supabase
            .from("placement")
            .upsert(rows, { onConflict: "personne_id,jour" });
          if (error) throw error;
          joursImportes = rows.length;
        }
      }

      const ignores = upEquiv.filter((e) => e.ignorer).length;
      const nonResolus = upEquiv.filter((e) => !e.ignorer && !e.personne_id).length;
      return NextResponse.json({
        ok: true,
        resume: {
          personnesImportees: idsResolues.size,
          joursImportes,
          motifsCrees,
          ignores,
          nonResolus,
          jamaisMappes,
          fenetre: { min, max },
        },
      });
    }

    return NextResponse.json({ error: "Op inconnue." }, { status: 400 });
  } catch (e) {
    const pg = e as { code?: string; message?: string; details?: string | null };
    if (CODES_UNDEF.has(pg?.code ?? "")) {
      return NextResponse.json({ error: MSG_MIGRATION }, { status: 400 });
    }
    const msg = messageErreur({ code: pg?.code, message: pg?.message ?? "Erreur", details: pg?.details ?? null });
    return NextResponse.json({ error: msg ?? "Erreur" }, { status: 400 });
  }
}
