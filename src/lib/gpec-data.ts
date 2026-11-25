// GPEC — lectures et assemblage de la projection des effectifs (rapport de
// Bilans + écran des hypothèses). Les règles sont dans `gpec.ts` (pures).
//
// Rien n'est ressaisi : référentiel (lignes, postes, effectif par quart),
// matrice, postes fixes, contrats et absences sont lus tels quels. Seules les
// hypothèses de l'année viennent des tables `gpec_*` (0097), lues en
// service_role bornées au site — `gpec_depart` est nominative et n'a aucune
// lecture sous RLS. L'appelant a passé la garde du module `gpec` AVANT.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/fetch-all";
import { getAteliersTousC, getLignesPostesC, getNbNiveauxC, getPosteQuartC, getQuartsC, getTypesAgenceC, getValiditesC } from "@/lib/refdata";
import { actifLe } from "@/lib/referentiel-validite";
import { etatQuart, pqDepuisLignes } from "@/lib/poste-quart";
import { deriverArriveeDepart, type Periode } from "@/lib/personne-statut";
import { estNonPlanifie } from "@/lib/absenteisme";
import { isoDate } from "@/lib/week";
import {
  affecterVivier,
  besoinTheorique,
  calculerPoste,
  coefEtp,
  cumuler,
  hypothesesDefaut,
  quartsOuverts,
  saturationLigne,
  semainesSubies,
  joursRetenus,
  ORDRE_CATEGORIE,
  type Cumul,
  type Hypotheses,
  type LigneCapa,
  type Palier,
  type PosteCalcul,
  type Saturation,
} from "@/lib/gpec";

type HypRow = {
  jours_ouvres: number;
  semaines_conges: number;
  semaines_modulation: number;
  seuil1: number;
  seuil2: number;
  seuil3: number;
  absences_subies: Record<string, number> | null;
  motifs_exclus: string[] | null;
};
type CapaRow = {
  id: string;
  nom: string;
  capacite_jour: number | null;
  volume_annuel: number | null;
  volumes_mois: (number | null)[] | null;
  lignes: string[] | null;
  paliers: Record<string, string[]> | null;
};
type DepartRow = { id: string; personne_id: string | null; poste_id: string | null; date_prevue: string | null; motif: string; commentaire: string | null };
type Pers = { id: string; nom: string; prenom: string | null; type_contrat: string; atelier_id: string | null; equipe_id: string | null; poste_fixe_id: string | null; statut: string };
type Mat = { personne_id: string; poste_id: string; niveau_actuel: number; niveau_cible: number };
type Contrat = { personne_id: string; date_debut: string | null; date_fin: string | null };
type Abs = { personne_id: string; motif_absence_id: string | null };
type Motif = { id: string; libelle: string | null; code_court: string | null; non_planifie?: boolean | null };

export type CapaAffichee = LigneCapa & { sat: Saturation; nomsLignes: string[] };
export type SubiService = { atelierId: string; nom: string; effectif: number; auto: number; force: number | null; retenu: number };
export type LignePoste = PosteCalcul & {
  nom: string;
  ligne: string;
  atelierId: string;
  atelierNom: string;
  categorie: string;
  ptnr: boolean; // poste non remplaçable : besoin réel = besoin théorique (pas de coefficient d’absence)
  parQuart: string; // détail du besoin théorique, ex. « Matin 2 · Après-midi 2 »
  capaNom: string | null; // null = ligne non rattachée (organisation actuelle)
  palier: Palier | null;
  vivier: number; // personnes sans poste fixe qui tiennent le poste
  enCible: number; // non-titulaires dont la cible de la matrice vise ce poste
  aFormer: number;
  aRecruter: number;
};
export type DepartAffiche = { id: string | null; personneId: string | null; nom: string; poste: string; service: string; date: string | null; motif: string; commentaire: string; source: "contrat" | "saisi" };
export type FormationAffichee = { personne: string; service: string; poste: string; ligne: string; niveau: number; requis: number; type: "titulariser" | "progresser" };
export type GroupeBilan = { atelierId: string; atelierNom: string; categorie: string; cumul: Cumul };

export type Gpec = {
  hyp: Hypotheses;
  capas: CapaAffichee[];
  quarts: { code: string; libelle: string }[];
  ateliers: { id: string; nom: string }[];
  subi: SubiService[];
  joursSubisParMotif: Record<string, Record<string, number>>; // service → motif → jours (12 mois)
  postes: LignePoste[];
  groupes: GroupeBilan[];
  parService: { atelierId: string; atelierNom: string; cumul: Cumul }[];
  total: Cumul;
  departs: DepartAffiche[];
  formations: FormationAffichee[];
  // Points d'attention
  lignesNonRattachees: string[];
  nbSansPosteFixe: number;
  nbComptes: number;
  nbInterim: number;
  // Listes pour l'écran des hypothèses
  lignesRef: { id: string; nom: string; atelierNom: string }[];
  postesRef: { id: string; nom: string; ligne: string }[];
  personnesRef: { id: string; nom: string; poste: string }[];
  motifsNonPlanifies: { id: string; libelle: string }[];
};

const num = (v: unknown, defaut: number) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : defaut);

// Hypothèses + lignes capacitaires + départs saisis de l'année (service_role,
// borné au site).
async function lireHypotheses(siteId: string, annee: number) {
  const admin = getAdminClient();
  const [hypR, capaR, depR] = await Promise.all([
    admin.from("gpec_hypothese").select("jours_ouvres, semaines_conges, semaines_modulation, seuil1, seuil2, seuil3, absences_subies, motifs_exclus").eq("site_id", siteId).eq("annee", annee).maybeSingle<HypRow>(),
    admin.from("gpec_ligne_capa").select("id, nom, capacite_jour, volume_annuel, volumes_mois, lignes, paliers").eq("site_id", siteId).eq("annee", annee).order("ordre").order("nom").returns<CapaRow[]>(),
    admin.from("gpec_depart").select("id, personne_id, poste_id, date_prevue, motif, commentaire").eq("site_id", siteId).eq("annee", annee).order("created_at").returns<DepartRow[]>(),
  ]);
  // Table absente (migration 0097 pas encore exécutée) : on le dit clairement.
  const erreur = hypR.error ?? capaR.error ?? depR.error;
  if (erreur) throw new Error(erreur.message);

  const d = hypothesesDefaut(annee);
  const r = hypR.data;
  const hyp: Hypotheses = r
    ? {
        annee,
        joursOuvres: num(r.jours_ouvres, d.joursOuvres),
        semConges: num(r.semaines_conges, d.semConges),
        semModulation: num(r.semaines_modulation, d.semModulation),
        seuil1: num(r.seuil1, d.seuil1),
        seuil2: num(r.seuil2, d.seuil2),
        seuil3: num(r.seuil3, d.seuil3),
        subiForce: r.absences_subies ?? {},
        motifsExclus: Array.isArray(r.motifs_exclus) ? r.motifs_exclus : [],
      }
    : d;
  const capas: LigneCapa[] = (capaR.data ?? []).map((c) => ({
    id: c.id,
    nom: c.nom,
    capaciteJour: c.capacite_jour === null ? null : Number(c.capacite_jour),
    volumeAnnuel: c.volume_annuel === null ? null : Number(c.volume_annuel),
    volumesMois: Array.isArray(c.volumes_mois) ? Array.from({ length: 12 }, (_, i) => (c.volumes_mois![i] === null || c.volumes_mois![i] === undefined ? null : Number(c.volumes_mois![i]))) : null,
    lignes: Array.isArray(c.lignes) ? c.lignes : [],
    paliers: c.paliers ?? {},
  }));
  return { hyp, capas, departsSaisis: depR.data ?? [] };
}

// `supabase` = client RLS de la page (lectures opérationnelles du site courant).
export async function chargerGpec(supabase: SupabaseClient, siteId: string, annee: number): Promise<Gpec> {
  const aujourdhui = isoDate(new Date());
  const finAnnee = `${annee}-12-31`;
  const il12Mois = new Date();
  il12Mois.setFullYear(il12Mois.getFullYear() - 1);
  const debutAbs = isoDate(il12Mois);

  const [{ hyp, capas, departsSaisis }, lignesPostes, pqRows, quarts, ateliersTous, typesAgence, nbNiveaux, ligneVal, posteVal, persD, matD, contratD, absD, motifsR] = await Promise.all([
    lireHypotheses(siteId, annee),
    getLignesPostesC(),
    getPosteQuartC(),
    getQuartsC(),
    getAteliersTousC(),
    getTypesAgenceC(),
    getNbNiveauxC(),
    getValiditesC("ligne"),
    getValiditesC("poste"),
    supabase.from("personne").select("id, nom, prenom, type_contrat, atelier_id, equipe_id, poste_fixe_id, statut").eq("site_id", siteId).in("statut", ["ACTIF", "A_VENIR"]).order("nom").returns<Pers[]>(),
    fetchAll<Mat>(() => supabase.from("matrice").select("personne_id, poste_id, niveau_actuel, niveau_cible").eq("site_id", siteId).order("id").returns<Mat[]>()),
    fetchAll<Contrat>(() => supabase.from("contrat_periode").select("personne_id, date_debut, date_fin").eq("site_id", siteId).order("id").returns<Contrat[]>()),
    fetchAll<Abs>(() => supabase.from("placement").select("personne_id, motif_absence_id").eq("site_id", siteId).not("motif_absence_id", "is", null).gte("jour", debutAbs).lte("jour", aujourdhui).order("id").returns<Abs[]>()),
    supabase.from("motif_absence").select("id, libelle, code_court, non_planifie").eq("site_id", siteId).returns<Motif[]>(),
  ]);

  const pq = pqDepuisLignes(pqRows);
  const valL = new Map(ligneVal.map((v) => [v.id, v]));
  const valP = new Map(posteVal.map((v) => [v.id, v]));
  const ateliers = ateliersTous.filter((a) => a.actif).map((a) => ({ id: a.id, nom: a.nom }));
  const atelierNom = new Map(ateliersTous.map((a) => [a.id, a.nom]));
  const rangAtelier = new Map(ateliers.map((a, i) => [a.id, i]));
  const agence = new Set(typesAgence);

  // ---- Population : contrats comptés = hors intérim / agence ----
  const personnes = persD.data ?? [];
  const comptes = personnes.filter((p) => !agence.has(p.type_contrat));
  const compteIds = new Set(comptes.map((p) => p.id));
  const persById = new Map(personnes.map((p) => [p.id, p]));
  const nomDe = (id: string) => { const p = persById.get(id); return p ? `${p.nom} ${p.prenom ?? ""}`.trim() : "?"; };

  // ---- Référentiel du périmètre (actif aujourd'hui, hors postes « en attente ») ----
  const lignes = lignesPostes.filter((l) => l.actif && actifLe(valL.get(l.id), aujourdhui));
  const capaDeLigne = new Map<string, LigneCapa>();
  for (const c of capas) for (const lid of c.lignes) if (!capaDeLigne.has(lid)) capaDeLigne.set(lid, c);
  const satDe = new Map(capas.map((c) => [c.id, saturationLigne(c, hyp)]));
  const nomLigne = new Map(lignesPostes.map((l) => [l.id, l.nom]));

  // ---- Absentéisme subi par service (12 derniers mois, motifs non planifiés) ----
  const exclus = new Set(hyp.motifsExclus);
  const motifs = motifsR.data ?? [];
  const nonPlanifie = new Set(motifs.filter((m) => estNonPlanifie(m)).map((m) => m.id));
  // Jours par service ET par motif, sans exclusion : l’écran des hypothèses
  // recalcule lui-même quand on coche / décoche un motif exclu.
  const joursSubisParMotif: Record<string, Record<string, number>> = {};
  for (const a of absD) {
    if (!a.motif_absence_id || !nonPlanifie.has(a.motif_absence_id)) continue;
    const p = persById.get(a.personne_id);
    if (!p || !compteIds.has(p.id) || !p.atelier_id) continue;
    const parMotif = (joursSubisParMotif[p.atelier_id] ??= {});
    parMotif[a.motif_absence_id] = (parMotif[a.motif_absence_id] ?? 0) + 1;
  }
  const subi: SubiService[] = ateliers.map((a) => {
    const effectif = comptes.filter((p) => p.atelier_id === a.id && p.statut === "ACTIF").length;
    const auto = semainesSubies(joursRetenus(joursSubisParMotif[a.id], exclus), effectif);
    const f = hyp.subiForce[a.id];
    const force = typeof f === "number" && Number.isFinite(f) ? f : null;
    return { atelierId: a.id, nom: a.nom, effectif, auto, force, retenu: force ?? auto };
  });
  const subiDe = new Map(subi.map((s) => [s.atelierId, s.retenu]));
  const semProgramme = hyp.semConges + hyp.semModulation;

  // ---- Matrice ----
  const niveau = new Map<string, number>();
  const cible = new Map<string, number>();
  for (const r of matD) {
    niveau.set(`${r.personne_id}:${r.poste_id}`, r.niveau_actuel);
    cible.set(`${r.personne_id}:${r.poste_id}`, r.niveau_cible);
  }

  // ---- Départs : fins de contrat connues + départs saisis ----
  const contrats = new Map<string, Periode[]>();
  for (const c of contratD) (contrats.get(c.personne_id) ?? contrats.set(c.personne_id, []).get(c.personne_id)!).push(c);
  const partants = new Map<string, DepartAffiche>(); // personne → départ (un seul par personne)
  const posteDe = new Map<string, { nom: string; ligne: string; atelierId: string }>();
  for (const l of lignesPostes) for (const p of l.poste) posteDe.set(p.id, { nom: p.nom, ligne: l.nom, atelierId: l.atelier_id });
  const posteNomDe = (id: string | null) => (id ? posteDe.get(id)?.nom ?? "—" : "—");
  const serviceDe = (p: Pers | undefined) => (p?.atelier_id ? atelierNom.get(p.atelier_id) ?? "—" : "—");
  for (const d of departsSaisis) {
    if (!d.personne_id || !compteIds.has(d.personne_id)) continue;
    const p = persById.get(d.personne_id);
    partants.set(d.personne_id, { id: d.id, personneId: d.personne_id, nom: nomDe(d.personne_id), poste: posteNomDe(p?.poste_fixe_id ?? null), service: serviceDe(p), date: d.date_prevue, motif: d.motif, commentaire: d.commentaire ?? "", source: "saisi" });
  }
  for (const p of comptes) {
    if (partants.has(p.id)) continue;
    const fin = deriverArriveeDepart(contrats.get(p.id) ?? []).date_depart_prevu;
    if (fin && fin <= finAnnee) partants.set(p.id, { id: null, personneId: p.id, nom: nomDe(p.id), poste: posteNomDe(p.poste_fixe_id), service: serviceDe(p), date: fin, motif: "Fin de contrat", commentaire: "", source: "contrat" });
  }
  const anonymes = departsSaisis.filter((d) => !d.personne_id && d.poste_id);
  const departsAnonymes = new Map<string, number>();
  for (const d of anonymes) departsAnonymes.set(d.poste_id!, (departsAnonymes.get(d.poste_id!) ?? 0) + 1);

  // ---- Titulaires (poste fixe) et vivier (sans poste fixe, non partants) ----
  const titulaires = new Map<string, Pers[]>();
  for (const p of comptes) if (p.poste_fixe_id) (titulaires.get(p.poste_fixe_id) ?? titulaires.set(p.poste_fixe_id, []).get(p.poste_fixe_id)!).push(p);
  const libres = comptes.filter((p) => !p.poste_fixe_id && !partants.has(p.id));

  // ---- Calcul poste par poste ----
  type Brut = { ligne: LignePoste; candidats: string[]; min: number };
  const bruts: Brut[] = [];
  for (const l of lignes) {
    const capa = capaDeLigne.get(l.id) ?? null;
    const palier = capa ? satDe.get(capa.id)?.palier ?? null : null;
    // Ligne rattachée dont la saturation n'est pas calculable : organisation actuelle.
    const ouverts = capa && palier ? quartsOuverts(capa, palier) : null;
    const coef = coefEtp(semProgramme, subiDe.get(l.atelier_id) ?? 0);
    for (const p of l.poste) {
      if (!p.actif || p.zone_attente || !actifLe(valP.get(p.id), aujourdhui)) continue;
      const effectifParQuart: Record<string, number> = {};
      for (const q of quarts) {
        const e = etatQuart(pq, p.id, q.code, p.effectif_requis ?? 0);
        if (e.tourne) effectifParQuart[q.code] = e.effectif;
      }
      const ptnr = p.remplacable === false;
      const parQuart = quarts
        .filter((q) => q.code in effectifParQuart && (!ouverts || ouverts.has(q.code)))
        .map((q) => `${q.libelle} ${effectifParQuart[q.code]}`)
        .join(" · ");
      const min = Math.max(1, p.niveau_min_requis ?? 0);
      const tit = titulaires.get(p.id) ?? [];
      const calc = calculerPoste({
        id: p.id,
        besoinTheorique: besoinTheorique(effectifParQuart, ouverts),
        // PTNR : personne ne le remplace pendant ses absences, on ne « coefficiente » donc pas.
        coef: ptnr ? 1 : coef,
        niveauMin: min,
        nbNiveaux,
        titulaires: tit.map((t) => ({ id: t.id, niveau: niveau.get(`${t.id}:${p.id}`) ?? 0 })),
        departs: tit.filter((t) => partants.has(t.id)).length + (departsAnonymes.get(p.id) ?? 0),
      });
      if (calc.besoinTheorique === 0 && calc.disponibilite === 0 && calc.departs === 0) continue; // poste sans objet cette année
      const candidats = libres
        .filter((x) => (niveau.get(`${x.id}:${p.id}`) ?? 0) >= min)
        .sort((a, b) => (niveau.get(`${b.id}:${p.id}`) ?? 0) - (niveau.get(`${a.id}:${p.id}`) ?? 0) || a.nom.localeCompare(b.nom))
        .map((x) => x.id);
      const enCible = comptes.filter((x) => x.poste_fixe_id !== p.id && (cible.get(`${x.id}:${p.id}`) ?? 0) >= min && (niveau.get(`${x.id}:${p.id}`) ?? 0) < min).length;
      bruts.push({
        min,
        candidats,
        ligne: { ...calc, nom: p.nom, ligne: l.nom, atelierId: l.atelier_id, atelierNom: atelierNom.get(l.atelier_id) ?? "Sans service", categorie: p.categorie ?? "operateur", ptnr, parQuart, capaNom: capa?.nom ?? null, palier, vivier: candidats.length, enCible, aFormer: 0, aRecruter: 0 },
      });
    }
  }

  // Vivier affecté sans double compte, puis répartition à former / à recruter.
  const affectes = affecterVivier(bruts.map((b) => ({ posteId: b.ligne.id, manque: b.ligne.deficit })), new Map(bruts.map((b) => [b.ligne.id, b.candidats])));
  const formations: FormationAffichee[] = [];
  for (const b of bruts) {
    const pris = affectes.get(b.ligne.id) ?? [];
    b.ligne.aFormer = pris.length;
    b.ligne.aRecruter = b.ligne.deficit - pris.length;
    for (const pid of pris) formations.push({ personne: nomDe(pid), service: b.ligne.atelierNom, poste: b.ligne.nom, ligne: b.ligne.ligne, niveau: niveau.get(`${pid}:${b.ligne.id}`) ?? 0, requis: b.min, type: "titulariser" });
    for (const t of titulaires.get(b.ligne.id) ?? []) {
      const n = niveau.get(`${t.id}:${b.ligne.id}`) ?? 0;
      if (n < b.min && !partants.has(t.id)) formations.push({ personne: nomDe(t.id), service: b.ligne.atelierNom, poste: b.ligne.nom, ligne: b.ligne.ligne, niveau: n, requis: b.min, type: "progresser" });
    }
  }
  const rang = (id: string) => rangAtelier.get(id) ?? 9999;
  const rangCat = (c: string) => { const i = ORDRE_CATEGORIE.indexOf(c); return i < 0 ? 99 : i; };
  const postes = bruts.map((b) => b.ligne).sort((a, b) => rang(a.atelierId) - rang(b.atelierId) || rangCat(a.categorie) - rangCat(b.categorie) || a.ligne.localeCompare(b.ligne) || a.nom.localeCompare(b.nom));
  formations.sort((a, b) => a.service.localeCompare(b.service) || a.poste.localeCompare(b.poste) || a.personne.localeCompare(b.personne));

  // ---- Bilan par service × catégorie ----
  const groupes: GroupeBilan[] = [];
  const parService: Gpec["parService"] = [];
  for (const aId of [...new Set(postes.map((p) => p.atelierId))]) {
    const duService = postes.filter((p) => p.atelierId === aId);
    for (const cat of [...new Set(duService.map((p) => p.categorie))]) {
      groupes.push({ atelierId: aId, atelierNom: duService[0].atelierNom, categorie: cat, cumul: cumuler(duService.filter((p) => p.categorie === cat)) });
    }
    parService.push({ atelierId: aId, atelierNom: duService[0].atelierNom, cumul: cumuler(duService) });
  }

  const departs: DepartAffiche[] = [
    ...partants.values(),
    ...anonymes.map((d): DepartAffiche => {
      const po = posteDe.get(d.poste_id!);
      return { id: d.id, personneId: null, nom: "Départ sans nom", poste: po?.nom ?? "—", service: po ? atelierNom.get(po.atelierId) ?? "—" : "—", date: d.date_prevue, motif: d.motif, commentaire: d.commentaire ?? "", source: "saisi" };
    }),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.nom.localeCompare(b.nom));

  return {
    hyp,
    capas: capas.map((c) => ({ ...c, sat: satDe.get(c.id)!, nomsLignes: c.lignes.map((id) => nomLigne.get(id)).filter((n): n is string => !!n) })),
    quarts: quarts.map((q) => ({ code: q.code, libelle: q.libelle })),
    ateliers,
    subi,
    joursSubisParMotif,
    postes,
    groupes,
    parService,
    total: cumuler(postes),
    departs,
    formations,
    lignesNonRattachees: lignes.filter((l) => !capaDeLigne.has(l.id) && l.poste.some((p) => p.actif && !p.zone_attente)).map((l) => l.nom),
    nbSansPosteFixe: comptes.filter((p) => !p.poste_fixe_id).length,
    nbComptes: comptes.length,
    nbInterim: personnes.length - comptes.length,
    lignesRef: lignes.map((l) => ({ id: l.id, nom: l.nom, atelierNom: atelierNom.get(l.atelier_id) ?? "" })).sort((a, b) => a.atelierNom.localeCompare(b.atelierNom) || a.nom.localeCompare(b.nom)),
    postesRef: lignes.flatMap((l) => l.poste.filter((p) => p.actif && !p.zone_attente).map((p) => ({ id: p.id, nom: p.nom, ligne: l.nom }))).sort((a, b) => a.nom.localeCompare(b.nom)),
    personnesRef: comptes.map((p) => ({ id: p.id, nom: nomDe(p.id), poste: posteNomDe(p.poste_fixe_id) })),
    motifsNonPlanifies: motifs.filter((m) => nonPlanifie.has(m.id)).map((m) => ({ id: m.id, libelle: m.libelle ?? m.code_court ?? "?" })).sort((a, b) => a.libelle.localeCompare(b.libelle)),
  };
}
