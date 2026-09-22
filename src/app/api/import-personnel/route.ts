import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { moduleWriteGuard } from "@/lib/permissions";
import { messageErreur } from "@/lib/erreurs";
import { fetchAll } from "@/lib/fetch-all";
import { normaliseNom, normalisePrenom } from "@/lib/noms";
import { lirePremiereFeuilleXlsx } from "@/lib/xlsx-min";
import {
  parseBasePersonnel,
  resoudreTypeContrat,
  suggererCorrespondance,
  rapprocher,
  type EffectifItem,
  type PersonneImport,
} from "@/lib/import-personnel-rh";

// POST /api/import-personnel  (multipart/form-data)
//   op=preview  { fichier }                                   -> aperçu
//   op=apply    { fichier, correspondances, exclure }         -> crée les personnes
//
// Import de la « Base personnel » depuis un fichier Excel (export RH), écran
// Paramètres RH. Chaque ligne = une personne ; les personnes sont groupées par
// SECTION (atelier + équipe) dans le fichier. La section n'ayant pas les mêmes
// libellés que Polaris, on demande à l'écran une CORRESPONDANCE section ->
// (atelier, équipe) parmi les référentiels du site (pré-suggérée par recoupement
// de mots). À l'application, on CRÉE les personnes nouvelles (matricule ou
// nom+prénom inconnus) + leur période de contrat initiale. Les personnes déjà
// présentes sont laissées intactes (import additif, jamais destructeur).
//
// Garde : motifs:write (écran Paramètres RH). Écriture via le client admin
// site-borné rendu par moduleWriteGuard.

const TAILLE_MAX_OCTETS = 5 * 1024 * 1024; // cf. audit S3 (protection OOM)

const CONTRATS_FALLBACK = ["CDI", "CDD", "INTERIM"];

type Ref = { id: string; nom: string };

// Clé stable d'une ligne pour l'inclusion/exclusion à l'écran : le n° de ligne
// du fichier est unique (matricule pouvant manquer ou se répéter).
const cle = (p: PersonneImport) => String(p.ligne);

export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("motifs");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { supabase, profile } = garde;
  const siteId = profile.siteId;

  const cl = Number(req.headers.get("content-length") ?? "0");
  if (cl > TAILLE_MAX_OCTETS) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${(TAILLE_MAX_OCTETS / 1024 / 1024).toFixed(0)} Mo).` },
      { status: 413 },
    );
  }

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
  if (fichier.size > TAILLE_MAX_OCTETS) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${(TAILLE_MAX_OCTETS / 1024 / 1024).toFixed(0)} Mo).` },
      { status: 413 },
    );
  }

  // Lecture du classeur.
  let fichierParse;
  try {
    const matrice = lirePremiereFeuilleXlsx(await fichier.arrayBuffer());
    fichierParse = parseBasePersonnel(matrice);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lecture du fichier impossible.";
    return NextResponse.json({ error: `Fichier Excel illisible : ${msg}` }, { status: 400 });
  }

  if (fichierParse.personnes.length === 0) {
    return NextResponse.json({ error: "Aucune personne lisible dans ce fichier." }, { status: 400 });
  }

  try {
    // Référentiels du site : effectif existant (dédoublonnage), ateliers,
    // équipes, codes de contrat autorisés.
    const [ateliersR, equipesR, typesR] = await Promise.all([
      supabase.from("atelier").select("id, nom").eq("site_id", siteId).eq("actif", true).order("nom"),
      supabase.from("equipe").select("id, nom").eq("site_id", siteId).eq("actif", true).order("nom"),
      supabase.from("type_contrat").select("code").eq("site_id", siteId),
    ]);
    if (ateliersR.error) throw ateliersR.error;
    if (equipesR.error) throw equipesR.error;
    const ateliers = (ateliersR.data ?? []) as Ref[];
    const equipes = (equipesR.data ?? []) as Ref[];
    const idsAtelier = new Set(ateliers.map((a) => a.id));
    const idsEquipe = new Set(equipes.map((e) => e.id));

    const codes = new Set<string>(CONTRATS_FALLBACK);
    if (!typesR.error) for (const r of (typesR.data ?? []) as { code: string }[]) codes.add(r.code);
    const codesArr = [...codes];

    // Effectif existant pour le rapprochement. ⚠️ >1000 possible -> fetchAll.
    const existants = await fetchAll<EffectifItem>(() =>
      supabase.from("personne").select("id, matricule, nom, prenom, statut").eq("site_id", siteId).order("nom"),
    );

    // Évalue chaque ligne : type résolu + rapprochement (existant/doute/nouveau).
    const evaluees = fichierParse.personnes.map((p) => {
      const typeResolu = resoudreTypeContrat(p.typeSource, codesArr);
      const rap = rapprocher(p, existants);
      return { ...p, typeResolu, statut: rap.statut, candidats: rap.candidats };
    });

    if (op === "preview") {
      const sections = fichierParse.sections.map((raw) => {
        const sug = suggererCorrespondance(raw, ateliers, equipes);
        return { raw, atelierId: sug.atelierId, equipeId: sug.equipeId, effectif: evaluees.filter((e) => e.section === raw).length };
      });
      const nouveaux = evaluees.filter((e) => e.statut === "nouveau").length;
      const doutes = evaluees.filter((e) => e.statut === "doute").length;
      const existantsCnt = evaluees.filter((e) => e.statut === "existant").length;
      return NextResponse.json({
        ok: true,
        personnes: evaluees.map((e) => ({
          cle: cle(e),
          matricule: e.matricule,
          nom: e.nom,
          prenom: e.prenom,
          sexe: e.sexe,
          typeSource: e.typeSource,
          typeResolu: e.typeResolu,
          dateDebut: e.dateDebut,
          dateFin: e.dateFin,
          section: e.section,
          statut: e.statut,
          candidats: e.candidats,
        })),
        sections,
        ateliers,
        equipes,
        resume: { total: evaluees.length, nouveaux, doutes, existants: existantsCnt },
      });
    }

    if (op === "apply") {
      const correspondances = JSON.parse(String(form.get("correspondances") ?? "{}")) as Record<
        string,
        { atelierId: string | null; equipeId: string | null }
      >;
      // Décisions explicites de l'écran : la liste des clés à créer. Un « doute »
      // n'est créé QUE si l'utilisateur a confirmé « nouvelle personne » ; un
      // « existant » (matricule connu) n'est jamais créé.
      const aCreerCles = new Set(JSON.parse(String(form.get("aCreer") ?? "[]")) as string[]);

      // Validation cross-site des ids de correspondance (le service_role bypass
      // la RLS : un id d'un autre site rattacherait en silence).
      for (const [raw, m] of Object.entries(correspondances)) {
        if (m.atelierId && !idsAtelier.has(m.atelierId))
          return NextResponse.json({ error: `Service inconnu pour la section « ${raw} ».` }, { status: 400 });
        if (m.equipeId && !idsEquipe.has(m.equipeId))
          return NextResponse.json({ error: `Équipe inconnue pour la section « ${raw} ».` }, { status: 400 });
      }

      // Lignes à créer : celles cochées à l'écran, jamais un « existant »
      // (garde-fou serveur même si le client l'envoyait par erreur).
      const aCreer = evaluees.filter((e) => aCreerCles.has(cle(e)) && e.statut !== "existant");

      type PersonneRow = {
        id: string;
        nom: string;
        prenom: string;
        sexe: "H" | "F" | null;
        matricule: string | null;
        type_contrat: string;
        atelier_id: string | null;
        equipe_id: string | null;
        date_debut: string | null;
        date_fin: string | null;
        site_id: string;
      };
      type ContratRow = {
        personne_id: string;
        type_contrat: string;
        agence_interim: null;
        date_debut: string | null;
        date_fin: string | null;
        site_id: string;
      };

      const personnesRows: PersonneRow[] = [];
      const contratsRows: ContratRow[] = [];
      for (const e of aCreer) {
        const id = randomUUID();
        const corr = correspondances[e.section] ?? { atelierId: null, equipeId: null };
        const dateDebut = e.dateDebut ?? new Date().toISOString().slice(0, 10);
        personnesRows.push({
          id,
          nom: normaliseNom(e.nom),
          prenom: normalisePrenom(e.prenom),
          sexe: e.sexe,
          matricule: e.matricule.trim() || null,
          type_contrat: e.typeResolu,
          atelier_id: corr.atelierId,
          equipe_id: corr.equipeId,
          date_debut: dateDebut,
          date_fin: e.dateFin,
          site_id: siteId,
        });
        contratsRows.push({
          personne_id: id,
          type_contrat: e.typeResolu,
          agence_interim: null,
          date_debut: dateDebut,
          date_fin: e.dateFin,
          site_id: siteId,
        });
      }

      let crees = 0;
      if (personnesRows.length) {
        const insP = await supabase.from("personne").insert(personnesRows);
        if (insP.error) throw insP.error;
        // Insertion des périodes APRÈS les personnes (FK). Les ids étant
        // générés côté serveur, aucune dépendance à l'ordre de retour.
        const insC = await supabase.from("contrat_periode").insert(contratsRows);
        if (insC.error) throw insC.error;
        crees = personnesRows.length;

        // Rafraîchit le cache statut (A_VENIR/ACTIF/PARTI). Best-effort : le
        // trigger l'a déjà posé à l'insert du contrat, un échec ici n'invalide
        // pas l'import (l'erreur reste dans l'objet retour, non levée).
        await supabase.rpc("rafraichir_statuts_personnes", { p_site: siteId });
      }

      return NextResponse.json({
        ok: true,
        resume: {
          crees,
          existants: evaluees.filter((e) => e.statut === "existant").length,
          rapproches: evaluees.filter((e) => e.statut === "doute" && !aCreerCles.has(cle(e))).length,
          exclus: evaluees.filter((e) => e.statut === "nouveau" && !aCreerCles.has(cle(e))).length,
        },
      });
    }

    return NextResponse.json({ error: "Op inconnue." }, { status: 400 });
  } catch (e) {
    const pg = e as { code?: string; message?: string; details?: string | null };
    const msg = messageErreur({ code: pg?.code, message: pg?.message ?? "Erreur", details: pg?.details ?? null });
    return NextResponse.json({ error: msg ?? "Erreur" }, { status: 400 });
  }
}
