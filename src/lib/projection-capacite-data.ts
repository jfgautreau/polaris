// Chargement serveur de la projection de capacite. Rassemble matrice,
// habilitations datees, besoin (ordonnancement puis semaine-type), effectif
// (contrats), rotation et absences, puis appelle le moteur pur
// `projection-capacite.ts` jour par jour et agrege par semaine.
//
// Deux couches (cf. CLAUDE.md, reponse « les deux ») :
//   • structurelle : qui est dans l'effectif a la date + habilite. Ignore quart
//     et absence. Montre la capacite de fond.
//   • reelle       : retire les absences declarees et contraint chaque personne
//     a son quart de la semaine (rotation datee / quart fixe).
//
// ⚠️ RLS : appele avec getServerClient() (bilan en lecture), donc scope au site
// courant automatiquement — aucun site_id a forcer ici.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { getSemaineType, getSemaineOuverture, typeQuartActif, typeLigneOuverte } from "@/lib/semaine-type";
import { rotationForWeek, type RotationRef } from "@/lib/rotation";
import { contratCouvreLe, type Periode } from "@/lib/personne-statut";
import { isoDate } from "@/lib/week";
import {
  buildJourFlow,
  type BesoinPoste,
  type PersonneDispo,
  type SemaineProjection,
} from "@/lib/projection-capacite";

export type Couche = "structurelle" | "reelle";

export type SemaineDetail = SemaineProjection & {
  besoinParPoste: Record<string, number>;
  ruptureParPoste: Record<string, number>;
};

export type PosteMeta = { id: string; nom: string; atelierId: string | null; atelierNom: string };

export type ProjectionResult = {
  semaines: SemaineDetail[];
  postes: PosteMeta[];
  couche: Couche;
  nbSemaines: number;
};

type LigneRow = {
  id: string;
  nom: string;
  atelier_id: string | null;
  poste: { id: string; nom: string; actif: boolean; effectif_requis: number; niveau_min_requis: number }[];
};

export async function chargerProjection(
  supabase: SupabaseClient,
  opts: { lundiDepart: string; nbSemaines: number; atelier?: string; couche: Couche }
): Promise<ProjectionResult> {
  const { lundiDepart, nbSemaines, atelier, couche } = opts;

  // Toutes les dates de l'horizon (lundis + 7 jours chacun).
  const lundis: string[] = [];
  {
    const [y, m, d] = lundiDepart.split("-").map(Number);
    const base = new Date(y, m - 1, d);
    for (let w = 0; w < nbSemaines; w++) {
      const dt = new Date(base);
      dt.setDate(base.getDate() + w * 7);
      lundis.push(isoDate(dt));
    }
  }
  const horizonIsos: string[] = [];
  for (const l of lundis) {
    const [y, m, d] = l.split("-").map(Number);
    for (let k = 0; k < 7; k++) {
      const dt = new Date(y, m - 1, d + k);
      horizonIsos.push(isoDate(dt));
    }
  }
  const [
    { data: lignesD },
    { data: quartsD },
    { data: jqD },
    ovD,
    { data: pqOffD },
    { data: persD },
    contratD,
    matD,
    { data: pcrD },
    { data: equipesD },
    { data: atD },
  ] = await Promise.all([
    supabase.from("ligne").select("id, nom, atelier_id, poste(id, nom, actif, effectif_requis, niveau_min_requis)").eq("actif", true).returns<LigneRow[]>(),
    supabase.from("quart").select("code").returns<{ code: string }[]>(),
    supabase.from("jour_quart").select("jour, quart_code, actif").in("jour", horizonIsos).returns<{ jour: string; quart_code: string; actif: boolean }[]>(),
    fetchAll<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }>(() =>
      supabase.from("ouverture_quart").select("jour, ligne_id, quart_code, ouverte").in("jour", horizonIsos).order("jour").order("ligne_id").order("quart_code").returns<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }[]>()
    ),
    supabase.from("poste_quart").select("poste_id, quart_code").eq("actif", false).returns<{ poste_id: string; quart_code: string }[]>(),
    supabase.from("personne").select("id, equipe_id").returns<{ id: string; equipe_id: string | null }[]>(),
    fetchAll<{ personne_id: string; date_debut: string | null; date_fin: string | null }>(() =>
      supabase.from("contrat_periode").select("personne_id, date_debut, date_fin").order("id").returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>()
    ),
    fetchAll<{ personne_id: string; poste_id: string; niveau_actuel: number }>(() =>
      supabase.from("matrice").select("personne_id, poste_id, niveau_actuel").order("id").returns<{ personne_id: string; poste_id: string; niveau_actuel: number }[]>()
    ),
    supabase.from("poste_competence_requise").select("poste_id, competence_id, competence:competence_id(duree_validite_mois)").returns<{ poste_id: string; competence_id: string; competence: { duree_validite_mois: number | null } | null }[]>(),
    supabase.from("equipe").select("id, quart_fixe").eq("actif", true).returns<{ id: string; quart_fixe: string | null }[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).returns<{ id: string; nom: string }[]>(),
  ]);

  const atelierNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));
  const lignes = (lignesD ?? []).filter((l) => !atelier || l.atelier_id === atelier);

  // Postes affiches (scope atelier) + meta.
  const postes: PosteMeta[] = [];
  const posteMin = new Map<string, number>();
  const posteActif = new Set<string>();
  for (const l of lignes)
    for (const p of l.poste ?? [])
      if (p.actif) {
        postes.push({ id: p.id, nom: p.nom, atelierId: l.atelier_id, atelierNom: l.atelier_id ? atelierNom.get(l.atelier_id) ?? "—" : "—" });
        posteMin.set(p.id, p.niveau_min_requis);
        posteActif.add(p.id);
      }
  const quarts = (quartsD ?? []).map((q) => q.code);
  const pqOff = new Set((pqOffD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`));

  // Ordonnancement reel (quarts actifs / lignes ouvertes) + detection « jour ordonnance ».
  const actMap = new Map<string, boolean>();
  const joursOrdonnances = new Set<string>();
  for (const r of jqD ?? []) { actMap.set(`${r.quart_code}:${r.jour}`, r.actif); joursOrdonnances.add(r.jour); }
  const ouvMap = new Map<string, boolean>();
  for (const r of ovD) ouvMap.set(`${r.quart_code}:${r.ligne_id}:${r.jour}`, r.ouverte);

  // Gabarit de besoin pour les jours non ordonnances (semaine-type).
  const semType = await getSemaineType(supabase);
  const semOuv = await getSemaineOuverture(supabase);

  // Besoins (poste, quart) ouverts un jour donne + drapeau gabarit.
  const besoinsJour = (iso: string): { besoins: BesoinPoste[]; gabarit: boolean } => {
    const ordonnance = joursOrdonnances.has(iso);
    const quartActif = (q: string) => (ordonnance ? actMap.get(`${q}:${iso}`) ?? false : typeQuartActif(semType, iso, q));
    const ligneOuverte = (lid: string, q: string) => (ordonnance ? ouvMap.get(`${q}:${lid}:${iso}`) ?? true : typeLigneOuverte(semOuv, iso, q, lid));
    const besoins: BesoinPoste[] = [];
    for (const q of quarts) {
      if (!quartActif(q)) continue;
      for (const l of lignes) {
        if (!ligneOuverte(l.id, q)) continue;
        for (const p of l.poste ?? []) {
          if (!p.actif || pqOff.has(`${p.id}:${q}`)) continue;
          const eff = p.effectif_requis ?? 0;
          if (eff > 0) besoins.push({ cle: `${p.id}:${q}`, posteId: p.id, quart: q, effectifRequis: eff, gabarit: !ordonnance });
        }
      }
    }
    return { besoins, gabarit: !ordonnance };
  };

  // Qualification datee : niveau matrice + habilitations valides a la date.
  const matNiveau = new Map<string, number>();
  for (const r of matD) matNiveau.set(`${r.personne_id}:${r.poste_id}`, r.niveau_actuel);
  const habPoste = new Map<string, string[]>(); // poste -> competences requises
  const dureeComp: Record<string, number | null> = {};
  for (const r of pcrD ?? []) {
    (habPoste.get(r.poste_id) ?? habPoste.set(r.poste_id, []).get(r.poste_id)!).push(r.competence_id);
    dureeComp[r.competence_id] = r.competence?.duree_validite_mois ?? null;
  }
  // Echeance effective d'une habilitation detenue : `${pid}:${cid}` -> expiration | null (a vie).
  const habExp = new Map<string, string | null>();
  const compRequisesIds = [...new Set([...habPoste.values()].flat())];
  if (compRequisesIds.length) {
    const det = await fetchAll<{ personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null }>(() =>
      supabase.from("personne_competence").select("personne_id, competence_id, date_obtention, date_expiration").in("competence_id", compRequisesIds).order("id").returns<{ personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null }[]>()
    );
    for (const d of det) habExp.set(`${d.personne_id}:${d.competence_id}`, d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp[d.competence_id]));
  }

  // Vrai si `pid` peut tenir `posteId` a la date `iso` : niveau requis atteint ET
  // toutes les habilitations exigees detenues et valides ce jour-la.
  const qualifie = (pid: string, posteId: string, iso: string): boolean => {
    if ((matNiveau.get(`${pid}:${posteId}`) ?? 0) < (posteMin.get(posteId) ?? 0)) return false;
    const requises = habPoste.get(posteId);
    if (requises)
      for (const cid of requises) {
        const exp = habExp.get(`${pid}:${cid}`);
        if (exp === undefined) return false; // habilitation non detenue
        if (!habValable({ expiration: exp })) return false; // sans echeance -> valable
        if (exp !== null && iso > exp) return false; // expiree a cette date
      }
    return true;
  };

  // Effectif : contrats par personne (presence datee).
  const contrats = new Map<string, Periode[]>();
  for (const c of contratD) (contrats.get(c.personne_id) ?? contrats.set(c.personne_id, []).get(c.personne_id)!).push({ date_debut: c.date_debut, date_fin: c.date_fin });
  const present = (pid: string, iso: string): boolean => {
    const cs = contrats.get(pid);
    if (!cs || cs.length === 0) return true; // pas de contrat renseigne -> on fait confiance
    return contratCouvreLe(cs, iso);
  };

  // Couche reelle : absences declarees + rotation des quarts.
  const equipeDe = new Map((persD ?? []).map((p) => [p.id, p.equipe_id]));
  const quartFixe = new Map((equipesD ?? []).map((e) => [e.id, e.quart_fixe]));
  const rotRefs: RotationRef[] = [];
  let absSet = new Map<string, Set<string>>();
  if (couche === "reelle") {
    const { data: rr } = await supabase.from("rotation_reference").select("semaine, equipe_id, quart_code").returns<RotationRef[]>();
    for (const r of rr ?? []) rotRefs.push(r);
    const abs = await fetchAll<{ personne_id: string; jour: string; motif_absence_id: string | null }>(() =>
      supabase.from("placement").select("personne_id, jour, motif_absence_id").in("jour", horizonIsos).order("id").returns<{ personne_id: string; jour: string; motif_absence_id: string | null }[]>()
    );
    absSet = new Map<string, Set<string>>();
    for (const r of abs) if (r.motif_absence_id) (absSet.get(r.jour) ?? absSet.set(r.jour, new Set()).get(r.jour)!).add(r.personne_id);
  }

  const allPersonnes = (persD ?? []).map((p) => p.id);
  // Postes qu'une personne pourrait tenir (independant de la date) — reduit le
  // balayage : on ne teste la qualification datee que sur ce sous-ensemble.
  const postesPotentiels = new Map<string, string[]>();
  for (const r of matD) {
    if (!posteActif.has(r.poste_id)) continue;
    if (r.niveau_actuel < (posteMin.get(r.poste_id) ?? 0)) continue;
    (postesPotentiels.get(r.personne_id) ?? postesPotentiels.set(r.personne_id, []).get(r.personne_id)!).push(r.poste_id);
  }

  // Boucle principale : par semaine, par jour ouvre.
  const semaines: SemaineDetail[] = [];
  for (const lundi of lundis) {
    const rotWeek = couche === "reelle" ? rotationForWeek(rotRefs, lundi) : {};
    const quartDePersonne = (pid: string): string | null => {
      if (couche !== "reelle") return null; // structurel : aucun quart impose
      const eq = equipeDe.get(pid);
      if (!eq) return null;
      const fixe = quartFixe.get(eq);
      if (fixe) return fixe;
      return rotWeek[eq] ?? null;
    };

    let besoinSem = 0, couvrableSem = 0;
    const besoinParPoste: Record<string, number> = {};
    const ruptureParPoste: Record<string, number> = {};
    const clesRupture = new Set<string>();
    let gabaritSem = false;

    for (let k = 0; k < 7; k++) {
      const [y, m, d] = lundi.split("-").map(Number);
      const iso = isoDate(new Date(y, m - 1, d + k));
      const { besoins, gabarit } = besoinsJour(iso);
      if (besoins.length === 0) continue;
      gabaritSem = gabaritSem || gabarit;
      for (const b of besoins) besoinParPoste[b.posteId] = (besoinParPoste[b.posteId] ?? 0) + b.effectifRequis;

      const clesOuvertes = new Set(besoins.map((b) => b.cle));
      const dispo: PersonneDispo[] = [];
      const abs = absSet.get(iso);
      for (const pid of allPersonnes) {
        if (!present(pid, iso)) continue;
        if (couche === "reelle" && abs?.has(pid)) continue;
        const pq = quartDePersonne(pid);
        const peutTenir: string[] = [];
        for (const posteId of postesPotentiels.get(pid) ?? []) {
          if (!qualifie(pid, posteId, iso)) continue;
          for (const q of quarts) {
            if (pq && q !== pq) continue; // couche reelle : seulement son quart
            const cle = `${posteId}:${q}`;
            if (clesOuvertes.has(cle)) peutTenir.push(cle);
          }
        }
        if (peutTenir.length) dispo.push({ id: pid, peutTenir });
      }

      const flow = buildJourFlow(dispo, besoins);
      besoinSem += flow.besoin;
      couvrableSem += flow.couvrable;
      for (const r of flow.ruptures) {
        ruptureParPoste[r.posteId] = (ruptureParPoste[r.posteId] ?? 0) + r.manque;
        clesRupture.add(r.cle);
      }
    }

    semaines.push({
      semaine: lundi,
      besoin: besoinSem,
      couvrable: couvrableSem,
      taux: besoinSem === 0 ? 1 : couvrableSem / besoinSem,
      postesEnRupture: [...clesRupture],
      gabarit: gabaritSem,
      besoinParPoste,
      ruptureParPoste,
    });
  }

  return { semaines, postes, couche, nbSemaines };
}

// Cause dominante d'une rupture de poste sur une semaine (heuristique, pour
// l'affichage du detail). Non implementee ici : etape 5.
export type CauseRupture = "banc" | "absence" | "depart" | "habilitation";
