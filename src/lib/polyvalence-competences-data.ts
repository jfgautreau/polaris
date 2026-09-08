// Rapport « Polyvalence & compétences » — FUSION des trois anciens rapports de
// compétences (Polyvalence, Plan de montée en compétence, Compétences critiques)
// en une seule lecture RH : constat → risque → action.
//
// Décision de cadrage (2026-09-08) : la couverture des postes est mesurée À
// L'OPÉRATIONNEL — une personne « tient » un poste si elle a le NIVEAU MINIMUM
// requis du poste (`poste.niveau_min_requis`) ET une HABILITATION VALIDE
// aujourd'hui. Le seuil « compétent » paramétrable (`site.seuil_competent`) n'est
// PLUS utilisé ici : il servait aux anciennes définitions « développement » qui
// donnaient trois comptes de fragilité incohérents entre les trois rapports.
//
//   • Polyvalence d'une personne = nombre de postes de SON service d'affectation
//     (`personne.atelier_id`) qu'elle peut tenir aujourd'hui (polyvalence interne).
//   • Relève d'un poste = personnes actives qui peuvent le tenir aujourd'hui.
//     Relève « sûre » = sans risque imminent (départ ≤ 180 j, retraite, ou
//     habilitation exigée expirant ≤ 90 j). Verdict critique / fragile / ok.
//   • Les PTNR (titulaire unique par conception) sont isolés, jamais mêlés aux
//     indicateurs de fragilité.
//
// ⚠️ RLS : appelé avec getServerClient() (bilan en lecture) → scopé au site
// courant automatiquement, aucun site_id à forcer.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isoDate, addDays } from "@/lib/week";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { deriverArriveeDepart, type Periode } from "@/lib/personne-statut";

export const H_DEPART = 180; // jours : horizon de vigilance sur les départs
export const H_HAB = 90; // jours : horizon de vigilance sur les habilitations

type Named = { id: string; nom: string; prenom: string; type_contrat: string; atelier_id: string | null };
type LigneRow = { id: string; nom: string; atelier_id: string | null; poste: { id: string; nom: string; actif: boolean; categorie: string | null; remplacable: boolean; niveau_min_requis: number }[] };
type Mat = { personne_id: string; poste_id: string; niveau_actuel: number; niveau_cible: number };
type Pcr = { poste_id: string; competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null };
type Pc = { personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null };
type Contrat = { personne_id: string; date_debut: string | null; date_fin: string | null; motif_fin: string | null };
type Comp = { id: string; nom: string; a_recycler: boolean; duree_validite_mois: number | null };

export type Membre = { id: string; nom: string; risque: string | null };
export type Verdict = "critique" | "fragile" | "ok";

export type PosteAnalyse = {
  id: string;
  nom: string;
  ligne: string;
  atelierId: string | null;
  atelierNom: string;
  categorie: string;
  remplacable: boolean;
  releve: Membre[];
  sure: number; // relève sans risque imminent
  cible: number; // nb de personnes dont l'objectif est de tenir ce poste
  verdict: Verdict;
};

export type PolyService = { atelierId: string; nom: string; moyenne: number; nbPersonnes: number };
export type PersonnePoly = { id: string; label: string; n: number };
export type CleARisque = { id: string; nom: string; contrat: string; date: string; retraite: boolean; postes: string[] };
export type Echeance = { personne: string; competence: string; date: string; statut: "expiree" | "urgent" | "proche" };
export type Formation = { personne: string; poste: string; ligne: string; atelierNom: string; actuel: number; cible: number; fragilite: Verdict };

export type PolyvalenceCompetencesResult = {
  nbActifs: number;
  nbPostes: number;
  // Bloc 1 — constat
  polyvalenceMoyenne: number;
  polyParService: PolyService[];
  personnesADevelopper: PersonnePoly[];
  // Bloc 2 — postes
  postesCritiquesFragiles: PosteAnalyse[]; // verdict != ok, PTR
  nbTenus: number; // postes PTR verdict ok
  ptnr: (PosteAnalyse & { vacant: boolean; aRisque: boolean })[];
  // Bloc 3 — risques
  clesARisque: CleARisque[];
  echeances: Echeance[];
  // Bloc 4 — action
  formations: Formation[]; // priorisées (fragilité poste), tronquées aux prioritaires
  nbFormationsPrioritaires: number;
  nbFormationsAutres: number;
  // KPIs
  nbSansReleveSure: number; // verdict critique (0 relève sûre) — PTR
  nbFragiles: number; // verdict fragile (1 relève sûre) — PTR
  ecartTotal: number; // couples personne×poste avec niveau < cible
  nbClesPartantes: number;
  nbEcheancesCritiques: number;
};

const estRetraite = (m: string | null) => !!m && /retrait/i.test(m);
const fmt = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export async function chargerPolyvalenceCompetences(
  supabase: SupabaseClient,
  opts: { atelier?: string }
): Promise<PolyvalenceCompetencesResult> {
  const atelier = opts.atelier ?? "";
  const todayIso = isoDate(new Date());
  const limDepart = isoDate(addDays(new Date(), H_DEPART));
  const limHab = isoDate(addDays(new Date(), H_HAB));
  const in30 = isoDate(addDays(new Date(), 30));

  const [{ data: persD }, { data: lignesD }, matD, { data: pcrD }, { data: compD }, { data: atD }, contratD] = await Promise.all([
    supabase.from("personne").select("id, nom, prenom, type_contrat, atelier_id").eq("statut", "ACTIF").order("nom").returns<Named[]>(),
    supabase.from("ligne").select("id, nom, atelier_id, poste(id, nom, actif, categorie, remplacable, niveau_min_requis)").eq("actif", true).order("nom").returns<LigneRow[]>(),
    fetchAll<Mat>(() => supabase.from("matrice").select("personne_id, poste_id, niveau_actuel, niveau_cible").order("id").returns<Mat[]>()),
    supabase.from("poste_competence_requise").select("poste_id, competence_id, competence:competence_id(nom, duree_validite_mois)").returns<Pcr[]>(),
    supabase.from("competence").select("id, nom, a_recycler, duree_validite_mois").eq("actif", true).returns<Comp[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    fetchAll<Contrat>(() => supabase.from("contrat_periode").select("personne_id, date_debut, date_fin, motif_fin").order("id").returns<Contrat[]>()),
  ]);

  const active = persD ?? [];
  const activeIds = new Set(active.map((p) => p.id));
  const persById = new Map(active.map((p) => [p.id, p]));
  const persNom = (id: string) => { const p = persById.get(id); return p ? `${p.nom} ${p.prenom ?? ""}`.trim() : "?"; };
  const atelierNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));

  // Départ prévu (dérivé des contrats) + motif du dernier contrat.
  const contrats = new Map<string, Contrat[]>();
  for (const c of contratD) (contrats.get(c.personne_id) ?? contrats.set(c.personne_id, []).get(c.personne_id)!).push(c);
  const departDe = new Map<string, { date: string; motif: string | null } | null>();
  for (const id of activeIds) {
    const cs = contrats.get(id) ?? [];
    const { date_depart_prevu } = deriverArriveeDepart(cs as Periode[]);
    if (!date_depart_prevu) { departDe.set(id, null); continue; }
    const dernier = cs.filter((c) => c.date_fin === date_depart_prevu).sort((a, b) => (b.date_fin ?? "").localeCompare(a.date_fin ?? ""))[0];
    departDe.set(id, { date: date_depart_prevu, motif: dernier?.motif_fin ?? null });
  }

  // Habilitations : requises par poste + échéance détenue par personne.
  const habPoste = new Map<string, { id: string; nom: string }[]>();
  for (const r of pcrD ?? []) (habPoste.get(r.poste_id) ?? habPoste.set(r.poste_id, []).get(r.poste_id)!).push({ id: r.competence_id, nom: r.competence?.nom ?? "habilitation" });
  const compById = new Map((compD ?? []).map((c) => [c.id, c]));
  const dureeComp = (cid: string) => compById.get(cid)?.duree_validite_mois ?? null;
  // Comps d'intérêt = exigées par un poste ∪ à recycler (pour l'échéancier).
  const compRequisesIds = new Set([...habPoste.values()].flat().map((c) => c.id));
  const compInteret = new Set<string>([...compRequisesIds, ...(compD ?? []).filter((c) => c.a_recycler).map((c) => c.id)]);
  const habExp = new Map<string, string | null>();
  if (compInteret.size) {
    const det = await fetchAll<Pc>(() => supabase.from("personne_competence").select("personne_id, competence_id, date_obtention, date_expiration").in("competence_id", [...compInteret]).order("id").returns<Pc[]>());
    for (const d of det) habExp.set(`${d.personne_id}:${d.competence_id}`, d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp(d.competence_id)));
  }

  const matNiveau = new Map<string, number>();
  for (const r of matD) matNiveau.set(`${r.personne_id}:${r.poste_id}`, r.niveau_actuel);

  // Postes du périmètre (filtre atelier via ligne.atelier_id).
  const lignes = (lignesD ?? []).filter((l) => !atelier || l.atelier_id === atelier);
  const postes = lignes.flatMap((l) => (l.poste ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, nom: p.nom, ligne: l.nom, atelierId: l.atelier_id, atelierNom: l.atelier_id ? atelierNom.get(l.atelier_id) ?? "—" : "Sans service", categorie: p.categorie ?? "operateur", remplacable: p.remplacable !== false, min: p.niveau_min_requis ?? 0 })));

  // Toutes les habilitations exigées détenues et valides aujourd'hui ?
  const habOkAujourdhui = (pid: string, cid: string) => {
    const exp = habExp.get(`${pid}:${cid}`);
    if (exp === undefined) return false;
    return habValable({ expiration: exp });
  };
  // Peut tenir le poste AUJOURD'HUI : niveau min. atteint ET habilitations valides.
  const peutTenir = (pid: string, posteId: string, min: number) => {
    if ((matNiveau.get(`${pid}:${posteId}`) ?? 0) < min) return false;
    for (const c of habPoste.get(posteId) ?? []) if (!habOkAujourdhui(pid, c.id)) return false;
    return true;
  };
  // Prochaine habilitation exigée à échéance ≤ H_HAB pour une personne sur un poste.
  const habEnRisque = (pid: string, posteId: string): { nom: string; exp: string } | null => {
    let pire: { nom: string; exp: string } | null = null;
    for (const c of habPoste.get(posteId) ?? []) {
      const exp = habExp.get(`${pid}:${c.id}`);
      if (exp && exp <= limHab && (!pire || exp < pire.exp)) pire = { nom: c.nom, exp };
    }
    return pire;
  };

  // ---- Analyse de chaque poste : relève, relève sûre, verdict ----
  const analyse: PosteAnalyse[] = postes.map((p) => {
    const releve: Membre[] = [];
    for (const id of activeIds) {
      if (!peutTenir(id, p.id, p.min)) continue;
      const dep = departDe.get(id);
      const hab = habEnRisque(id, p.id);
      let risque: string | null = null;
      if (dep && dep.date <= limDepart) risque = estRetraite(dep.motif) ? `retraite ${fmt(dep.date)}` : `départ ${fmt(dep.date)}`;
      else if (hab) risque = `${hab.nom} exp. ${fmt(hab.exp)}`;
      releve.push({ id, nom: persNom(id), risque });
    }
    const sure = releve.filter((m) => !m.risque).length;
    const verdict: Verdict = releve.length === 0 || sure === 0 ? "critique" : sure === 1 ? "fragile" : "ok";
    const cible = matD.filter((r) => r.poste_id === p.id && activeIds.has(r.personne_id) && r.niveau_cible >= p.min).length;
    return { id: p.id, nom: p.nom, ligne: p.ligne, atelierId: p.atelierId, atelierNom: p.atelierNom, categorie: p.categorie, remplacable: p.remplacable, releve, sure, cible, verdict };
  });
  const verdictDe = new Map(analyse.map((a) => [a.id, a.verdict]));

  const analyseRempl = analyse.filter((a) => a.remplacable);
  const analysePtnr = analyse.filter((a) => !a.remplacable);
  const postesCritiquesFragiles = analyseRempl
    .filter((a) => a.verdict !== "ok")
    .sort((a, b) => (a.verdict === b.verdict ? a.sure - b.sure || a.nom.localeCompare(b.nom) : a.verdict === "critique" ? -1 : 1));
  const nbTenus = analyseRempl.filter((a) => a.verdict === "ok").length;
  const nbSansReleveSure = analyseRempl.filter((a) => a.verdict === "critique").length;
  const nbFragiles = analyseRempl.filter((a) => a.verdict === "fragile").length;

  const ptnr = analysePtnr
    .map((a) => ({ ...a, vacant: a.releve.length === 0, aRisque: a.releve.length === 0 || a.releve.some((m) => m.risque) }))
    .sort((a, b) => Number(b.aRisque) - Number(a.aRisque) || a.nom.localeCompare(b.nom));

  // ---- Bloc 1 : polyvalence interne par service + personnes à développer ----
  // Postes actifs regroupés par service (indépendant du filtre atelier — la
  // polyvalence « interne » se lit toujours sur le service d'affectation).
  const postesParService = new Map<string, { id: string; min: number }[]>();
  for (const l of lignesD ?? []) {
    const sid = l.atelier_id;
    if (!sid) continue;
    for (const p of l.poste ?? []) if (p.actif) (postesParService.get(sid) ?? postesParService.set(sid, []).get(sid)!).push({ id: p.id, min: p.niveau_min_requis ?? 0 });
  }
  // Polyvalence d'une personne = nb de postes de SON service tenables aujourd'hui.
  const polyDe = new Map<string, number>();
  for (const p of active) {
    if (!p.atelier_id) continue; // sans service d'affectation : hors polyvalence interne
    const ps = postesParService.get(p.atelier_id) ?? [];
    let n = 0;
    for (const q of ps) if (peutTenir(p.id, q.id, q.min)) n++;
    polyDe.set(p.id, n);
  }
  const polyParService: PolyService[] = (atD ?? [])
    .map((a) => {
      const membres = active.filter((p) => p.atelier_id === a.id);
      const avec = membres.filter((p) => polyDe.has(p.id));
      const moyenne = avec.length ? avec.reduce((s, p) => s + (polyDe.get(p.id) ?? 0), 0) / avec.length : 0;
      return { atelierId: a.id, nom: a.nom, moyenne, nbPersonnes: avec.length };
    })
    .filter((s) => s.nbPersonnes > 0 && (!atelier || s.atelierId === atelier))
    .sort((a, b) => b.moyenne - a.moyenne);
  const totalPoly = [...polyDe.values()];
  const polyvalenceMoyenne = totalPoly.length ? totalPoly.reduce((s, n) => s + n, 0) / totalPoly.length : 0;
  const personnesADevelopper: PersonnePoly[] = active
    .filter((p) => polyDe.has(p.id) && (!atelier || p.atelier_id === atelier))
    .map((p) => ({ id: p.id, label: `${p.nom} ${p.prenom ?? ""}`.trim(), n: polyDe.get(p.id) ?? 0 }))
    .sort((a, b) => a.n - b.n)
    .slice(0, 10);

  // ---- Bloc 3 : personnes clés sur le départ + échéancier d'habilitations ----
  const soloDe = new Map<string, string[]>();
  for (const a of analyse) if (a.releve.length === 1) (soloDe.get(a.releve[0].id) ?? soloDe.set(a.releve[0].id, []).get(a.releve[0].id)!).push(a.nom);
  const clesARisque: CleARisque[] = [...soloDe.entries()]
    .map(([id, postesSolo]) => ({ id, dep: departDe.get(id), postes: postesSolo }))
    .filter((x) => x.dep && x.dep.date <= limDepart)
    .map((x) => ({ id: x.id, nom: persNom(x.id), contrat: persById.get(x.id)?.type_contrat ?? "", date: x.dep!.date, retraite: estRetraite(x.dep!.motif), postes: x.postes }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Échéancier : habilitations d'intérêt détenues, expirant ≤ H_HAB, personnes actives.
  const compNom = (cid: string) => compById.get(cid)?.nom ?? "?";
  const echeances: Echeance[] = [];
  const vus = new Set<string>();
  for (const id of activeIds) {
    for (const cid of compInteret) {
      const key = `${id}:${cid}`;
      const exp = habExp.get(key);
      if (!exp || exp > limHab || vus.has(key)) continue;
      vus.add(key);
      echeances.push({ personne: persNom(id), competence: compNom(cid), date: exp, statut: exp < todayIso ? "expiree" : exp <= in30 ? "urgent" : "proche" });
    }
  }
  echeances.sort((a, b) => a.date.localeCompare(b.date));
  const nbEcheancesCritiques = echeances.filter((e) => e.statut !== "proche").length;

  // ---- Bloc 4 : qui former, priorisé par fragilité du poste ----
  const scopedPosteIds = new Set(postes.map((p) => p.id));
  const posteInfo = new Map(postes.map((p) => [p.id, p]));
  const toutesFormations = matD
    .filter((r) => activeIds.has(r.personne_id) && scopedPosteIds.has(r.poste_id) && r.niveau_actuel < r.niveau_cible)
    .map((r) => {
      const p = posteInfo.get(r.poste_id)!;
      return { personne: persNom(r.personne_id), poste: p.nom, ligne: p.ligne, atelierNom: p.atelierNom, actuel: r.niveau_actuel, cible: r.niveau_cible, fragilite: verdictDe.get(r.poste_id) ?? "ok" as Verdict };
    });
  const ecartTotal = toutesFormations.length;
  const RANG: Record<Verdict, number> = { critique: 0, fragile: 1, ok: 2 };
  const prioritaires = toutesFormations
    .filter((f) => f.fragilite !== "ok")
    .sort((a, b) => RANG[a.fragilite] - RANG[b.fragilite] || b.cible - b.actuel - (a.cible - a.actuel) || a.atelierNom.localeCompare(b.atelierNom) || a.personne.localeCompare(b.personne));
  const nbFormationsPrioritaires = prioritaires.length;
  const nbFormationsAutres = ecartTotal - nbFormationsPrioritaires;

  return {
    nbActifs: active.length,
    nbPostes: postes.length,
    polyvalenceMoyenne,
    polyParService,
    personnesADevelopper,
    postesCritiquesFragiles,
    nbTenus,
    ptnr,
    clesARisque,
    echeances,
    formations: prioritaires.slice(0, 40),
    nbFormationsPrioritaires,
    nbFormationsAutres,
    nbSansReleveSure,
    nbFragiles,
    ecartTotal,
    nbClesPartantes: clesARisque.length,
    nbEcheancesCritiques,
  };
}
