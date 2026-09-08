// Rapport « Assez de compétences ? » — aide à la VALIDATION DES CONGÉS, avant
// toute affectation de planning. Pour chaque service et chaque jour ouvré de la
// quinzaine : reste-t-il assez de personnes présentes et compétentes pour tenir
// les postes requis ? Une personne polyvalente ne tient qu'UN poste à la fois —
// jamais comptée deux fois.
//
// C'est un FRÈRE de la Projection de capacité (`projection-capacite-data.ts`),
// avec deux différences assumées :
//   1. Le BESOIN vient du RÉFÉRENTIEL (`poste.effectif_requis`), pas de
//      l'ordonnancement : on veut le besoin théorique de chaque jour ouvré,
//      indépendamment de la semaine-type / des quarts (le planning n'est pas
//      encore fait). Les PTNR (`remplacable = false`, titulaire unique par
//      conception) sont exclus, comme dans le Cockpit et Polyvalence.
//   2. La maille est SERVICE × JOUR sur 2 semaines (10 jours ouvrés), pas la
//      semaine agrégée.
//
// Le cœur de calcul est partagé : `buildJourFlow` (affectation optimale par flot
// maximum, une personne = une place). L'AFFECTATION EST GLOBALE au site chaque
// jour (un seul graphe pour tous les services) : une personne utilisée sur un
// service ne peut pas l'être sur un autre le même jour. Le filtre de service à
// l'écran ne fait que masquer des lignes — il ne recalcule jamais une couverture
// « par service » qui rendrait les polyvalents disponibles deux fois.
//
// ⚠️ RLS : appelé avec getServerClient() (bilan en lecture), donc scopé au site
// courant automatiquement — aucun site_id à forcer ici.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { rotationForWeek, type RotationRef } from "@/lib/rotation";
import { contratCouvreLe, type Periode } from "@/lib/personne-statut";
import { isoDate, isoWeekNumber } from "@/lib/week";
import { buildJourFlow, type BesoinPoste, type PersonneDispo } from "@/lib/projection-capacite";

export type JourCol = {
  iso: string;
  jourCourt: string; // « Lun »
  num: string; // « 15/09 »
  semaine: number; // n° ISO
  premierDeSemaine: boolean; // vrai le lundi (marque la césure entre les 2 semaines)
};

export type PosteQuiCoince = {
  id: string;
  nom: string;
  categorie: string;
  besoin: number; // effectif_requis
  deficit: number[]; // par colonne (0 = pas de manque ce jour)
};

// État d'un service un jour : besoin, manque (déficit du flot global attribué à
// ce service) et réserve théorique (personnes présentes qualifiées non requises).
export type ServiceJour = {
  besoin: number;
  deficit: number; // places non tenables (source de vérité)
  reserve: number; // marge indicative si couvert (borne haute, cf. note UI)
};

export type ServiceCouverture = {
  atelierId: string;
  atelierNom: string;
  besoinJour: number; // besoin d'un jour ouvré (constant : référentiel)
  nbPostes: number;
  jours: ServiceJour[]; // aligné sur cols
  enTension: boolean; // au moins un jour en déficit
  postesQuiCoincent: PosteQuiCoince[]; // uniquement les postes en déficit ≥ 1 jour
};

export type CouvertureResult = {
  cols: JourCol[];
  services: ServiceCouverture[];
  nbServices: number;
  nbEnTension: number;
  pireJour: { iso: string | null; places: number }; // plus grand total de places non couvertes sur un jour
  nbAbsents: number; // personnes distinctes absentes ≥ 1 jour ouvré de la quinzaine
  joursSansTension: number; // colonnes sans aucun déficit
};

type LigneRow = {
  id: string;
  nom: string;
  atelier_id: string | null;
  poste: {
    id: string;
    nom: string;
    actif: boolean;
    effectif_requis: number;
    niveau_min_requis: number;
    categorie: string | null;
    remplacable: boolean | null;
  }[];
};

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];

export async function chargerCouvertureConges(
  supabase: SupabaseClient,
  opts: { lundiDepart: string; nbSemaines?: number }
): Promise<CouvertureResult> {
  const nbSemaines = opts.nbSemaines ?? 2;

  // Lundis de l'horizon + colonnes = jours ouvrés (Lun→Ven) de chaque semaine.
  const lundis: string[] = [];
  const cols: JourCol[] = [];
  {
    const [y, m, d] = opts.lundiDepart.split("-").map(Number);
    const base = new Date(y, m - 1, d);
    for (let w = 0; w < nbSemaines; w++) {
      const lundi = new Date(base.getFullYear(), base.getMonth(), base.getDate() + w * 7);
      lundis.push(isoDate(lundi));
      for (let k = 0; k < 5; k++) {
        const jour = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + k);
        cols.push({
          iso: isoDate(jour),
          jourCourt: JOURS_COURTS[k],
          num: `${String(jour.getDate()).padStart(2, "0")}/${String(jour.getMonth() + 1).padStart(2, "0")}`,
          semaine: isoWeekNumber(jour),
          premierDeSemaine: k === 0,
        });
      }
    }
  }
  const horizonIsos = cols.map((c) => c.iso);
  const firstIso = horizonIsos[0];
  const lastIso = horizonIsos[horizonIsos.length - 1];
  // Le lundi couvrant chaque colonne (pour la rotation datée du temps partiel).
  const lundiDeCol = cols.map((_, i) => lundis[Math.floor(i / 5)]);

  const [
    { data: lignesD },
    { data: atD },
    { data: persD },
    contratD,
    matD,
    { data: pcrD },
    { data: equipesD },
    { data: quartsD },
    { data: rr },
    { data: tpP },
    { data: tpF },
  ] = await Promise.all([
    supabase
      .from("ligne")
      .select("id, nom, atelier_id, poste(id, nom, actif, effectif_requis, niveau_min_requis, categorie, remplacable)")
      .eq("actif", true)
      .returns<LigneRow[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("personne").select("id, equipe_id").returns<{ id: string; equipe_id: string | null }[]>(),
    fetchAll<{ personne_id: string; date_debut: string | null; date_fin: string | null }>(() =>
      supabase.from("contrat_periode").select("personne_id, date_debut, date_fin").order("id").returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>()
    ),
    fetchAll<{ personne_id: string; poste_id: string; niveau_actuel: number }>(() =>
      supabase.from("matrice").select("personne_id, poste_id, niveau_actuel").order("id").returns<{ personne_id: string; poste_id: string; niveau_actuel: number }[]>()
    ),
    supabase.from("poste_competence_requise").select("poste_id, competence_id, competence:competence_id(duree_validite_mois)").returns<{ poste_id: string; competence_id: string; competence: { duree_validite_mois: number | null } | null }[]>(),
    supabase.from("equipe").select("id, quart_fixe").eq("actif", true).returns<{ id: string; quart_fixe: string | null }[]>(),
    supabase.from("quart").select("code, creneau").returns<{ code: string; creneau: string | null }[]>(),
    supabase.from("rotation_reference").select("semaine, equipe_id, quart_code").returns<RotationRef[]>(),
    supabase.from("tp_periode").select("personne_id, date_debut, date_fin, tp_config").lte("date_debut", lastIso).or(`date_fin.is.null,date_fin.gte.${firstIso}`).returns<TpRow[]>(),
    supabase.from("personne").select("id, tp_config").eq("temps_partiel", true).returns<{ id: string; tp_config: TpConfig }[]>(),
  ]);

  const atelierNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));

  // Postes du besoin : actifs, remplaçables (PTNR exclus), effectif_requis > 0.
  type PosteBesoin = { id: string; nom: string; categorie: string; atelierId: string; atelierNom: string; effectifRequis: number; niveauMin: number };
  const postesBesoin: PosteBesoin[] = [];
  const posteMin = new Map<string, number>();
  const posteService = new Map<string, string>(); // posteId -> atelierId
  const posteActif = new Set<string>();
  for (const l of lignesD ?? []) {
    const aid = l.atelier_id ?? "—";
    for (const p of l.poste ?? []) {
      if (!p.actif) continue;
      posteMin.set(p.id, p.niveau_min_requis);
      posteActif.add(p.id);
      if (p.remplacable === false) continue; // PTNR : titulaire unique, hors besoin
      const eff = p.effectif_requis ?? 0;
      if (eff <= 0) continue;
      postesBesoin.push({
        id: p.id,
        nom: p.nom,
        categorie: p.categorie ?? "operateur",
        atelierId: aid,
        atelierNom: l.atelier_id ? atelierNom.get(l.atelier_id) ?? "—" : "Sans service",
        effectifRequis: eff,
        niveauMin: p.niveau_min_requis,
      });
      posteService.set(p.id, aid);
    }
  }

  // Besoins d'un jour ouvré = constants (référentiel) : un BesoinPoste par poste,
  // clé = posteId (le quart n'a pas de sens ici, avant l'ordonnancement).
  const besoins: BesoinPoste[] = postesBesoin.map((p) => ({ cle: p.id, posteId: p.id, quart: "", effectifRequis: p.effectifRequis }));
  const besoinPosteIds = new Set(postesBesoin.map((p) => p.id));

  // Qualification datée : niveau matrice ≥ requis ET habilitations valides ce jour.
  const matNiveau = new Map<string, number>();
  for (const r of matD) matNiveau.set(`${r.personne_id}:${r.poste_id}`, r.niveau_actuel);
  const habPoste = new Map<string, string[]>();
  const dureeComp: Record<string, number | null> = {};
  for (const r of pcrD ?? []) {
    (habPoste.get(r.poste_id) ?? habPoste.set(r.poste_id, []).get(r.poste_id)!).push(r.competence_id);
    dureeComp[r.competence_id] = r.competence?.duree_validite_mois ?? null;
  }
  const habExp = new Map<string, string | null>();
  const compRequisesIds = [...new Set([...habPoste.values()].flat())];
  if (compRequisesIds.length) {
    const det = await fetchAll<{ personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null }>(() =>
      supabase.from("personne_competence").select("personne_id, competence_id, date_obtention, date_expiration").in("competence_id", compRequisesIds).order("id").returns<{ personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null }[]>()
    );
    for (const d of det) habExp.set(`${d.personne_id}:${d.competence_id}`, d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp[d.competence_id]));
  }
  const qualifie = (pid: string, posteId: string, iso: string): boolean => {
    if ((matNiveau.get(`${pid}:${posteId}`) ?? 0) < (posteMin.get(posteId) ?? 0)) return false;
    const requises = habPoste.get(posteId);
    if (requises)
      for (const cid of requises) {
        const exp = habExp.get(`${pid}:${cid}`);
        if (exp === undefined) return false; // non détenue
        if (!habValable({ expiration: exp })) return false;
        if (exp !== null && iso > exp) return false; // expirée à cette date
      }
    return true;
  };

  // Présence : contrats (hors-effectif déduit).
  const contrats = new Map<string, Periode[]>();
  for (const c of contratD) (contrats.get(c.personne_id) ?? contrats.set(c.personne_id, []).get(c.personne_id)!).push({ date_debut: c.date_debut, date_fin: c.date_fin });
  const present = (pid: string, iso: string): boolean => {
    const cs = contrats.get(pid);
    if (!cs || cs.length === 0) return true;
    return contratCouvreLe(cs, iso);
  };

  // Absences : placement.motif_absence_id (jour par jour) + filet table `absence`.
  const absSet = new Map<string, Set<string>>();
  const marquerAbsent = (iso: string, pid: string) => (absSet.get(iso) ?? absSet.set(iso, new Set()).get(iso)!).add(pid);
  const abs = await fetchAll<{ personne_id: string; jour: string; motif_absence_id: string | null }>(() =>
    supabase.from("placement").select("personne_id, jour, motif_absence_id").in("jour", horizonIsos).order("id").returns<{ personne_id: string; jour: string; motif_absence_id: string | null }[]>()
  );
  for (const r of abs) if (r.motif_absence_id) marquerAbsent(r.jour, r.personne_id);
  const { data: absPer } = await supabase.from("absence").select("personne_id, date_debut, date_fin").lte("date_debut", lastIso).or(`date_fin.is.null,date_fin.gte.${firstIso}`).returns<{ personne_id: string; date_debut: string; date_fin: string | null }[]>();
  for (const a of absPer ?? []) for (const iso of horizonIsos) if (iso >= a.date_debut && (!a.date_fin || iso <= a.date_fin)) marquerAbsent(iso, a.personne_id);

  // Temps partiel : périodes datées (tp_periode) + repli personne.tp_config,
  // indisponibilité pilotée par la rotation datée (une semaine sur deux).
  const equipeDe = new Map((persD ?? []).map((p) => [p.id, p.equipe_id]));
  const quartFixe = new Map((equipesD ?? []).map((e) => [e.id, e.quart_fixe]));
  const quartCreneau = new Map((quartsD ?? []).map((q) => [q.code, q.creneau]));
  const creneauDe = (q: string | null | undefined): "matin" | "aprem" | null => {
    const c = q ? quartCreneau.get(q) : null;
    return c === "matin" || c === "aprem" ? c : null;
  };
  const isoDow = (iso: string) => { const d = new Date(iso + "T00:00").getDay(); return d === 0 ? 7 : d; };
  const rotRefs: RotationRef[] = rr ?? [];
  const tpPeriodes = new Map<string, TpRow[]>();
  for (const r of tpP ?? []) (tpPeriodes.get(r.personne_id) ?? tpPeriodes.set(r.personne_id, []).get(r.personne_id)!).push(r);
  const tpFallback = new Map<string, TpConfig>();
  for (const r of tpF ?? []) if (!tpPeriodes.has(r.id)) tpFallback.set(r.id, r.tp_config);
  const tpConfigJour = (pid: string, iso: string): TpConfig => {
    const periodes = tpPeriodes.get(pid);
    if (periodes) {
      for (const p of periodes) if (p.date_debut <= iso && (!p.date_fin || p.date_fin >= iso)) return p.tp_config;
      return null;
    }
    return tpFallback.get(pid) ?? null;
  };
  const tpIndisponible = (pid: string, iso: string, rotWeek: Record<string, string>): boolean => {
    const cfg = tpConfigJour(pid, iso);
    if (!cfg) return false;
    const off = cfg.off?.[String(isoDow(iso))] ?? [];
    if (!off.length) return false;
    if (off.includes("matin") && off.includes("aprem")) return true;
    const eq = equipeDe.get(pid);
    if (eq) {
      const cr = creneauDe(quartFixe.get(eq) ?? rotWeek[eq] ?? null);
      if (cr && off.includes(cr)) return true;
    }
    return false;
  };

  // Postes qu'une personne peut potentiellement tenir (niveau de fond, sans date).
  const postesPotentiels = new Map<string, string[]>();
  for (const r of matD) {
    if (!besoinPosteIds.has(r.poste_id)) continue;
    if (r.niveau_actuel < (posteMin.get(r.poste_id) ?? 0)) continue;
    (postesPotentiels.get(r.personne_id) ?? postesPotentiels.set(r.personne_id, []).get(r.personne_id)!).push(r.poste_id);
  }

  const allPersonnes = (persD ?? []).map((p) => p.id);
  const servicesIds = [...new Set(postesBesoin.map((p) => p.atelierId))];
  const besoinService = new Map<string, number>();
  for (const p of postesBesoin) besoinService.set(p.atelierId, (besoinService.get(p.atelierId) ?? 0) + p.effectifRequis);

  // Accumulateurs par service et par (poste, colonne).
  const jourParService = new Map<string, ServiceJour[]>();
  for (const sid of servicesIds) jourParService.set(sid, cols.map(() => ({ besoin: besoinService.get(sid) ?? 0, deficit: 0, reserve: 0 })));
  const deficitParPoste = new Map<string, number[]>();
  for (const p of postesBesoin) deficitParPoste.set(p.id, cols.map(() => 0));
  const absentsHorizon = new Set<string>();
  const placesNonCouvertesJour = cols.map(() => 0);

  // Boucle jour par jour : affectation optimale GLOBALE, puis ventilation.
  for (let ci = 0; ci < cols.length; ci++) {
    const iso = cols[ci].iso;
    const rotWeek = rotationForWeek(rotRefs, lundiDeCol[ci]);
    const absJour = absSet.get(iso);

    const dispo: PersonneDispo[] = [];
    const reserveCount = new Map<string, number>(); // service -> nb personnes présentes qualifiées
    for (const pid of allPersonnes) {
      if (!present(pid, iso)) continue;
      if (absJour?.has(pid)) { absentsHorizon.add(pid); continue; }
      if (tpIndisponible(pid, iso, rotWeek)) continue;
      const peutTenir: string[] = [];
      const servicesCouvrables = new Set<string>();
      for (const posteId of postesPotentiels.get(pid) ?? []) {
        if (!qualifie(pid, posteId, iso)) continue;
        peutTenir.push(posteId);
        const sid = posteService.get(posteId);
        if (sid) servicesCouvrables.add(sid);
      }
      if (peutTenir.length) dispo.push({ id: pid, peutTenir });
      for (const sid of servicesCouvrables) reserveCount.set(sid, (reserveCount.get(sid) ?? 0) + 1);
    }
    // absents comptés même s'ils n'auraient tenu aucun poste (KPI congés) :
    if (absJour) for (const pid of absJour) if (present(pid, iso)) absentsHorizon.add(pid);

    const flow = buildJourFlow(dispo, besoins);
    let placesJour = 0;
    for (const r of flow.ruptures) {
      const arr = deficitParPoste.get(r.posteId);
      if (arr) arr[ci] += r.manque;
      const sid = posteService.get(r.posteId);
      if (sid) jourParService.get(sid)![ci].deficit += r.manque;
      placesJour += r.manque;
    }
    placesNonCouvertesJour[ci] = placesJour;
    // Réserve indicative par service (seulement là où c'est couvert).
    for (const sid of servicesIds) {
      const sj = jourParService.get(sid)![ci];
      if (sj.deficit === 0) sj.reserve = Math.max(0, (reserveCount.get(sid) ?? 0) - sj.besoin);
    }
  }

  // Montage des services (ordre : nom).
  const services: ServiceCouverture[] = servicesIds
    .map((sid) => {
      const postesDuService = postesBesoin.filter((p) => p.atelierId === sid);
      const jours = jourParService.get(sid)!;
      const enTension = jours.some((j) => j.deficit > 0);
      const postesQuiCoincent: PosteQuiCoince[] = postesDuService
        .map((p) => ({ id: p.id, nom: p.nom, categorie: p.categorie, besoin: p.effectifRequis, deficit: deficitParPoste.get(p.id) ?? cols.map(() => 0) }))
        .filter((p) => p.deficit.some((d) => d > 0));
      return {
        atelierId: sid,
        atelierNom: postesDuService[0]?.atelierNom ?? "Sans service",
        besoinJour: besoinService.get(sid) ?? 0,
        nbPostes: postesDuService.length,
        jours,
        enTension,
        postesQuiCoincent,
      };
    })
    .sort((a, b) => a.atelierNom.localeCompare(b.atelierNom));

  const nbEnTension = services.filter((s) => s.enTension).length;
  let pireJour: { iso: string | null; places: number } = { iso: null, places: 0 };
  for (let i = 0; i < cols.length; i++) if (placesNonCouvertesJour[i] > pireJour.places) pireJour = { iso: cols[i].iso, places: placesNonCouvertesJour[i] };
  const joursSansTension = placesNonCouvertesJour.filter((p) => p === 0).length;

  return {
    cols,
    services,
    nbServices: services.length,
    nbEnTension,
    pireJour,
    nbAbsents: absentsHorizon.size,
    joursSansTension,
  };
}

type TpConfig = { off?: Record<string, string[]> } | null;
type TpRow = { personne_id: string; date_debut: string; date_fin: string | null; tp_config: TpConfig };
