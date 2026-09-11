// Rapport « Assez de compétences ? » — aide à la VALIDATION DES CONGÉS, avant
// toute affectation de planning. Pour chaque service, chaque jour ouvré et chaque
// CRÉNEAU (matin / après-midi / nuit / journée) de la quinzaine : reste-t-il assez
// de personnes présentes et compétentes pour tenir les postes requis ? Une
// personne polyvalente ne tient qu'UN poste à la fois — jamais comptée deux fois.
//
// FRÈRE de la Projection de capacité (`projection-capacite-data.ts`). Le cœur de
// calcul est partagé : `buildJourFlow` (affectation optimale par flot maximum, une
// personne = une place), et l'affectation est GLOBALE au site chaque jour (un seul
// graphe pour tous les services + tous les créneaux). Le filtre de service ne fait
// que masquer des lignes à l'écran, il n'assouplit jamais la contrainte.
//
// BESOIN — par (poste × quart POSTÉ), pas par poste :
//   • Par défaut (semaine non initialisée), source RÉFÉRENTIEL : chaque quart POSTÉ
//     où le poste est ACTIVÉ (`poste_quart`, défaut actif) compte pour son
//     `effectif_requis`. Un poste matin ET après-midi pèse donc 3 + 3 = 6.
//   • ⚠️ « Journée » (régulière) ≠ matin + après-midi. C'est l'AGRÉGAT pleine-journée
//     (activation = OU des quarts tournants), jamais un créneau qui s'ajoute. Un poste
//     en matin/après-midi ne compte donc PAS la journée, même si la case reste cochée
//     au référentiel. La journée n'est comptée que pour un poste en régulière (journée
//     comme seul quart). Cf. `quartsEffectifs`.
//   • Quand l'ORDONNANCEMENT a initialisé le jour, on prend ses données (plus fines :
//     quarts réellement actifs `jour_quart` et lignes ouvertes `ouverture_quart`).
//   • PTNR (`remplacable = false`) exclus, comme au Cockpit et à Polyvalence.
//
// ⚠️ RLS : appelé avec getServerClient() (bilan en lecture) → scopé au site courant.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { rotationForWeek, type RotationRef } from "@/lib/rotation";
import { contratCouvreLe, type Periode } from "@/lib/personne-statut";
import { isoDate, isoWeekNumber } from "@/lib/week";
import { chargerPosteQuart, etatQuart } from "@/lib/poste-quart";
import { buildJourFlow, type BesoinPoste, type PersonneDispo } from "@/lib/projection-capacite";

export type JourCol = {
  iso: string;
  jourCourt: string;
  num: string;
  semaine: number;
  premierDeSemaine: boolean;
};

// Un créneau d'un poste un jour : besoin, couvrable, manque.
export type QuartCase = { quart: string; label: string; besoin: number; couvrable: number; deficit: number };
// Une case (poste × jour) = les créneaux ouverts ce jour + le manque total.
export type PosteJourCase = { ouvert: boolean; quarts: QuartCase[]; deficit: number };

export type PosteCouverture = {
  id: string;
  nom: string;
  categorie: string;
  besoinResume: { label: string; besoin: number }[]; // structure de besoin (référentiel) pour la colonne « Besoin »
  jours: PosteJourCase[]; // aligné sur cols
  enTension: boolean;
};

// État agrégé d'un service un jour.
export type ServiceJour = { besoin: number; deficit: number; reserve: number };

export type ServiceCouverture = {
  atelierId: string;
  atelierNom: string;
  nbPostes: number;
  jours: ServiceJour[]; // aligné sur cols
  enTension: boolean;
  postes: PosteCouverture[]; // TOUS les postes du service
};

export type CouvertureResult = {
  cols: JourCol[];
  services: ServiceCouverture[];
  nbServices: number;
  nbEnTension: number;
  pireJour: { iso: string | null; places: number };
  nbAbsents: number;
  joursSansTension: number;
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

// Libellé court d'un quart pour l'affichage par créneau.
function labelQuart(code: string, creneau: string | null): string {
  if (creneau === "matin") return "M";
  if (creneau === "aprem") return "A";
  if (code === "nuit") return "N";
  if (code === "journee") return "J";
  return code.slice(0, 1).toUpperCase();
}

export async function chargerCouvertureConges(
  supabase: SupabaseClient,
  opts: { lundiDepart: string; nbSemaines?: number }
): Promise<CouvertureResult> {
  const nbSemaines = opts.nbSemaines ?? 2;

  // Colonnes = jours ouvrés (Lun→Ven) de chaque semaine.
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
    pq,
    { data: jqD },
    ovD,
    { data: rr },
    { data: tpP },
    { data: tpF },
  ] = await Promise.all([
    supabase.from("ligne").select("id, nom, atelier_id, poste(id, nom, actif, effectif_requis, niveau_min_requis, categorie, remplacable)").eq("actif", true).returns<LigneRow[]>(),
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
    supabase.from("quart").select("code, creneau, ordre").order("ordre").returns<{ code: string; creneau: string | null; ordre: number }[]>(),
    chargerPosteQuart(supabase),
    supabase.from("jour_quart").select("jour, quart_code, actif").in("jour", horizonIsos).returns<{ jour: string; quart_code: string; actif: boolean }[]>(),
    fetchAll<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }>(() =>
      supabase.from("ouverture_quart").select("jour, ligne_id, quart_code, ouverte").in("jour", horizonIsos).order("jour").order("ligne_id").order("quart_code").returns<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }[]>()
    ),
    supabase.from("rotation_reference").select("semaine, equipe_id, quart_code").returns<RotationRef[]>(),
    supabase.from("tp_periode").select("personne_id, date_debut, date_fin, tp_config").lte("date_debut", lastIso).or(`date_fin.is.null,date_fin.gte.${firstIso}`).returns<TpRow[]>(),
    supabase.from("personne").select("id, tp_config").eq("temps_partiel", true).returns<{ id: string; tp_config: TpConfig }[]>(),
  ]);

  const atelierNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));
  const quarts = (quartsD ?? []).map((q) => q.code); // triés par ordre
  const labelDe = new Map((quartsD ?? []).map((q) => [q.code, labelQuart(q.code, q.creneau)]));

  // « Journée » (pleine journée / régulière) = quart sans créneau au plus petit
  // ordre — MÊME détection que l'ordonnancement (reset-week). C'est l'AGRÉGAT de
  // la journée (activation = OU des quarts tournants), pas un créneau qui s'ajoute
  // à matin/après-midi. Règle de besoin : on compte les quarts POSTÉS du poste ;
  // la journée ne compte QUE si c'est le seul quart du poste (poste en régulière),
  // sinon elle doublonnerait matin + après-midi + nuit.
  const journeeCode = [...(quartsD ?? [])].filter((q) => !q.creneau).sort((a, b) => a.ordre - b.ordre)[0]?.code ?? null;
  const quartsEffectifs = (ouverts: string[]): string[] => {
    const postes = journeeCode ? ouverts.filter((c) => c !== journeeCode) : ouverts;
    return postes.length > 0 ? postes : ouverts; // journée seule = régulière
  };

  // Postes du besoin : actifs, remplaçables (PTNR exclus), et qui tournent avec un
  // effectif > 0 sur AU MOINS UN quart (effectif par quart, cf. src/lib/poste-quart.ts).
  // `posteEff` = effectif par défaut du poste, repli du helper.
  type PosteBesoin = { id: string; nom: string; categorie: string; ligneId: string; atelierId: string; atelierNom: string; posteEff: number };
  const postesBesoin: PosteBesoin[] = [];
  const posteMin = new Map<string, number>();
  const posteService = new Map<string, string>();
  for (const l of lignesD ?? []) {
    const aid = l.atelier_id ?? "—";
    for (const p of l.poste ?? []) {
      if (!p.actif) continue;
      posteMin.set(p.id, p.niveau_min_requis);
      if (p.remplacable === false) continue;
      const posteEff = p.effectif_requis ?? 0;
      const aBesoin = quarts.some((q) => { const e = etatQuart(pq, p.id, q, posteEff); return e.tourne && e.effectif > 0; });
      if (!aBesoin) continue;
      postesBesoin.push({ id: p.id, nom: p.nom, categorie: p.categorie ?? "operateur", ligneId: l.id, atelierId: aid, atelierNom: l.atelier_id ? atelierNom.get(l.atelier_id) ?? "—" : "Sans service", posteEff });
      posteService.set(p.id, aid);
    }
  }
  const besoinPosteIds = new Set(postesBesoin.map((p) => p.id));

  // Ordonnancement réel + détection « jour ordonnancé ».
  const actMap = new Map<string, boolean>();
  const joursOrdonnances = new Set<string>();
  for (const r of jqD ?? []) { actMap.set(`${r.quart_code}:${r.jour}`, r.actif); joursOrdonnances.add(r.jour); }
  const ouvMap = new Map<string, boolean>();
  for (const r of ovD) ouvMap.set(`${r.quart_code}:${r.ligne_id}:${r.jour}`, r.ouverte);

  // Besoins (poste × quart) ouverts un jour donné. Référentiel par défaut
  // (poste_quart), ordonnancement quand le jour est initialisé.
  const besoinsJour = (iso: string): BesoinPoste[] => {
    const ordonnance = joursOrdonnances.has(iso);
    const out: BesoinPoste[] = [];
    for (const p of postesBesoin) {
      const ouverts: string[] = [];
      for (const q of quarts) {
        const { tourne, effectif } = etatQuart(pq, p.id, q, p.posteEff);
        if (!tourne || effectif <= 0) continue; // ne tourne pas (« – ») ou besoin 0
        const ouvert = ordonnance
          ? (actMap.get(`${q}:${iso}`) ?? false) && (ouvMap.get(`${q}:${p.ligneId}:${iso}`) ?? true)
          : true; // référentiel : chaque quart posté du poste compte
        if (ouvert) ouverts.push(q);
      }
      for (const q of quartsEffectifs(ouverts)) out.push({ cle: `${p.id}:${q}`, posteId: p.id, quart: q, effectifRequis: etatQuart(pq, p.id, q, p.posteEff).effectif });
    }
    return out;
  };

  // Qualification datée : niveau matrice ≥ requis ET habilitations valides.
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
        if (exp === undefined) return false;
        if (!habValable({ expiration: exp })) return false;
        if (exp !== null && iso > exp) return false;
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

  // Absences : placement.motif_absence_id + filet table `absence`.
  const absSet = new Map<string, Set<string>>();
  const marquerAbsent = (iso: string, pid: string) => (absSet.get(iso) ?? absSet.set(iso, new Set()).get(iso)!).add(pid);
  const abs = await fetchAll<{ personne_id: string; jour: string; motif_absence_id: string | null }>(() =>
    supabase.from("placement").select("personne_id, jour, motif_absence_id").in("jour", horizonIsos).order("id").returns<{ personne_id: string; jour: string; motif_absence_id: string | null }[]>()
  );
  for (const r of abs) if (r.motif_absence_id) marquerAbsent(r.jour, r.personne_id);
  const { data: absPer } = await supabase.from("absence").select("personne_id, date_debut, date_fin").lte("date_debut", lastIso).or(`date_fin.is.null,date_fin.gte.${firstIso}`).returns<{ personne_id: string; date_debut: string; date_fin: string | null }[]>();
  for (const a of absPer ?? []) for (const iso of horizonIsos) if (iso >= a.date_debut && (!a.date_fin || iso <= a.date_fin)) marquerAbsent(iso, a.personne_id);

  // Temps partiel : périodes datées + repli tp_config, indisponibilité pilotée
  // par la rotation datée (une semaine sur deux).
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

  // Postes qu'une personne peut potentiellement tenir (niveau de fond).
  const postesPotentiels = new Map<string, string[]>();
  for (const r of matD) {
    if (!besoinPosteIds.has(r.poste_id)) continue;
    if (r.niveau_actuel < (posteMin.get(r.poste_id) ?? 0)) continue;
    (postesPotentiels.get(r.personne_id) ?? postesPotentiels.set(r.personne_id, []).get(r.personne_id)!).push(r.poste_id);
  }

  const allPersonnes = (persD ?? []).map((p) => p.id);
  const servicesIds = [...new Set(postesBesoin.map((p) => p.atelierId))];

  // Accumulateurs.
  const jourParService = new Map<string, ServiceJour[]>();
  for (const sid of servicesIds) jourParService.set(sid, cols.map(() => ({ besoin: 0, deficit: 0, reserve: 0 })));
  const casesPoste = new Map<string, PosteJourCase[]>();
  for (const p of postesBesoin) casesPoste.set(p.id, cols.map(() => ({ ouvert: false, quarts: [], deficit: 0 })));
  const absentsHorizon = new Set<string>();
  const placesNonCouvertesJour = cols.map(() => 0);

  for (let ci = 0; ci < cols.length; ci++) {
    const iso = cols[ci].iso;
    const rotWeek = rotationForWeek(rotRefs, lundiDeCol[ci]);
    const absJour = absSet.get(iso);
    const besoins = besoinsJour(iso);
    const besoinsCles = new Set(besoins.map((b) => b.cle));

    const dispo: PersonneDispo[] = [];
    const reserveCount = new Map<string, number>();
    for (const pid of allPersonnes) {
      if (!present(pid, iso)) continue;
      if (absJour?.has(pid)) { absentsHorizon.add(pid); continue; }
      if (tpIndisponible(pid, iso, rotWeek)) continue;
      const peutTenir: string[] = [];
      const servicesCouvrables = new Set<string>();
      for (const posteId of postesPotentiels.get(pid) ?? []) {
        if (!qualifie(pid, posteId, iso)) continue;
        let servable = false;
        for (const q of quarts) { const cle = `${posteId}:${q}`; if (besoinsCles.has(cle)) { peutTenir.push(cle); servable = true; } }
        if (servable) { const sid = posteService.get(posteId); if (sid) servicesCouvrables.add(sid); }
      }
      if (peutTenir.length) dispo.push({ id: pid, peutTenir });
      for (const sid of servicesCouvrables) reserveCount.set(sid, (reserveCount.get(sid) ?? 0) + 1);
    }
    if (absJour) for (const pid of absJour) if (present(pid, iso)) absentsHorizon.add(pid);

    const flow = buildJourFlow(dispo, besoins);
    const ruptureMap = new Map<string, number>();
    for (const r of flow.ruptures) ruptureMap.set(r.cle, r.manque);

    let placesJour = 0;
    for (const b of besoins) {
      const def = ruptureMap.get(b.cle) ?? 0;
      const cell = casesPoste.get(b.posteId)![ci];
      cell.ouvert = true;
      cell.quarts.push({ quart: b.quart, label: labelDe.get(b.quart) ?? b.quart, besoin: b.effectifRequis, couvrable: b.effectifRequis - def, deficit: def });
      cell.deficit += def;
      const sid = posteService.get(b.posteId);
      if (sid) { const sj = jourParService.get(sid)![ci]; sj.besoin += b.effectifRequis; sj.deficit += def; }
      placesJour += def;
    }
    placesNonCouvertesJour[ci] = placesJour;
    for (const sid of servicesIds) {
      const sj = jourParService.get(sid)![ci];
      if (sj.deficit === 0) sj.reserve = Math.max(0, (reserveCount.get(sid) ?? 0) - sj.besoin);
    }
  }

  // Résumé de besoin (référentiel) par poste, pour la colonne « Besoin ».
  const resumeDe = (p: PosteBesoin): { label: string; besoin: number }[] =>
    quartsEffectifs(quarts.filter((q) => { const e = etatQuart(pq, p.id, q, p.posteEff); return e.tourne && e.effectif > 0; }))
      .map((q) => ({ label: labelDe.get(q) ?? q, besoin: etatQuart(pq, p.id, q, p.posteEff).effectif }));

  const services: ServiceCouverture[] = servicesIds
    .map((sid) => {
      const postesDuService = postesBesoin.filter((p) => p.atelierId === sid);
      const jours = jourParService.get(sid)!;
      const postes: PosteCouverture[] = postesDuService.map((p) => {
        const cases = casesPoste.get(p.id)!;
        return { id: p.id, nom: p.nom, categorie: p.categorie, besoinResume: resumeDe(p), jours: cases, enTension: cases.some((c) => c.deficit > 0) };
      });
      return { atelierId: sid, atelierNom: postesDuService[0]?.atelierNom ?? "Sans service", nbPostes: postesDuService.length, jours, enTension: jours.some((j) => j.deficit > 0), postes };
    })
    .sort((a, b) => a.atelierNom.localeCompare(b.atelierNom));

  const nbEnTension = services.filter((s) => s.enTension).length;
  let pireJour: { iso: string | null; places: number } = { iso: null, places: 0 };
  for (let i = 0; i < cols.length; i++) if (placesNonCouvertesJour[i] > pireJour.places) pireJour = { iso: cols[i].iso, places: placesNonCouvertesJour[i] };
  const joursSansTension = placesNonCouvertesJour.filter((p) => p === 0).length;

  return { cols, services, nbServices: services.length, nbEnTension, pireJour, nbAbsents: absentsHorizon.size, joursSansTension };
}

type TpConfig = { off?: Record<string, string[]> } | null;
type TpRow = { personne_id: string; date_debut: string; date_fin: string | null; tp_config: TpConfig };
