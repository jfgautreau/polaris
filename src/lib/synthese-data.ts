// Chargement des donnees des deux syntheses de `/bilans/syntheses` :
//   - la liste des absences de la semaine (hors interimaires) ;
//   - le planning previsionnel des interimaires, groupe par agence.
//
// Les deux partent de la SEMAINE choisie (lundi -> dimanche). Lecture sous RLS
// (`getServerClient`) : l'ecran est derriere l'authentification et le site
// courant borne deja chaque table. On garde donc `getServerClient` plutot que le
// client admin — pas de `site_id` a poser a la main (cf. isolation-site.test.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { grouperAbsences, type JourAbsence } from "@/lib/absences-periodes";
import { horaireTxt, type MapsHoraire, type HM, type TpCfg } from "@/lib/horaires";
import { estInterim } from "@/lib/interim";
import type { QuartRef } from "@/lib/quarts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// Absences de la semaine (hors interim)
// ---------------------------------------------------------------------------

export type LigneAbsence = {
  personneId: string;
  nom: string;
  prenom: string;
  atelierId: string | null;
  atelierNom: string;
  equipeId: string | null;
  equipeNom: string;
  motifId: string | null;
  motifLibelle: string;
  motifCouleur: string | null;
  debut: string;
  fin: string;
  jours: number;
  declaree: boolean;
};

/**
 * Absences dont la periode CHEVAUCHE la semaine [lundi, dimanche], pour tout
 * l'effectif hors interim. On montre la periode COMPLETE (une absence qui
 * deborde la semaine garde ses vraies bornes) : on reconstruit donc les periodes
 * a partir de TOUS les jours d'absence des personnes concernees, pas des seuls
 * jours de la semaine.
 */
export async function chargerAbsencesSemaine(
  supabase: DB,
  weekIsos: string[]
): Promise<LigneAbsence[]> {
  const lundi = weekIsos[0];
  const dimanche = weekIsos[weekIsos.length - 1];

  // 1) Qui est absent au moins un jour de la semaine ?
  const { data: touchesD } = await supabase
    .from("placement")
    .select("personne_id")
    .in("jour", weekIsos)
    .not("motif_absence_id", "is", null)
    .returns<{ personne_id: string }[]>();
  const persIds = [...new Set((touchesD ?? []).map((r) => r.personne_id))];
  if (!persIds.length) return [];

  // 2) Details des personnes (on ecarte les interimaires) + tables de libelles.
  const [{ data: persD }, { data: atD }, { data: eqD }, { data: motifD }] = await Promise.all([
    supabase
      .from("personne")
      .select("id, nom, prenom, type_contrat, atelier_id, equipe_id")
      .in("id", persIds)
      .returns<{ id: string; nom: string; prenom: string; type_contrat: string; atelier_id: string | null; equipe_id: string | null }[]>(),
    supabase.from("atelier").select("id, nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("equipe").select("id, nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("motif_absence").select("id, libelle, couleur").returns<{ id: string; libelle: string; couleur: string | null }[]>(),
  ]);
  const persById = new Map((persD ?? []).map((p) => [p.id, p]));
  const nonInterimIds = (persD ?? []).filter((p) => !estInterim(p.type_contrat)).map((p) => p.id);
  if (!nonInterimIds.length) return [];
  const atNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));
  const eqNom = new Map((eqD ?? []).map((e) => [e.id, e.nom]));
  const motif = new Map((motifD ?? []).map((m) => [m.id, m]));

  // 3) TOUS les jours d'absence de ces personnes (periodes completes). fetchAll :
  //    au-dela de 1000 lignes, PostgREST tronque en silence (cf. L8).
  const jours = await fetchAll<{ personne_id: string; jour: string; motif_absence_id: string | null; absence_id: string | null }>(() =>
    supabase
      .from("placement")
      .select("personne_id, jour, motif_absence_id, absence_id")
      .in("personne_id", nonInterimIds)
      .not("motif_absence_id", "is", null)
      .order("personne_id")
      .order("jour")
      .returns<{ personne_id: string; jour: string; motif_absence_id: string | null; absence_id: string | null }[]>()
  );
  const parPersonne = new Map<string, JourAbsence[]>();
  for (const j of jours) {
    (parPersonne.get(j.personne_id) ?? parPersonne.set(j.personne_id, []).get(j.personne_id)!).push({
      jour: j.jour,
      motif_absence_id: j.motif_absence_id,
      absence_id: j.absence_id,
    });
  }

  // 4) Regroupement en periodes, puis on ne garde que celles qui chevauchent la
  //    semaine : debut <= dimanche ET fin >= lundi.
  const lignes: LigneAbsence[] = [];
  for (const pid of nonInterimIds) {
    const p = persById.get(pid);
    if (!p) continue;
    const periodes = grouperAbsences(parPersonne.get(pid) ?? []);
    for (const per of periodes) {
      if (per.debut > dimanche || per.fin < lundi) continue;
      const m = per.motif_absence_id ? motif.get(per.motif_absence_id) : undefined;
      lignes.push({
        personneId: pid,
        nom: p.nom,
        prenom: p.prenom,
        atelierId: p.atelier_id,
        atelierNom: p.atelier_id ? atNom.get(p.atelier_id) ?? "—" : "—",
        equipeId: p.equipe_id,
        equipeNom: p.equipe_id ? eqNom.get(p.equipe_id) ?? "—" : "—",
        motifId: per.motif_absence_id,
        motifLibelle: m?.libelle ?? "Absence",
        motifCouleur: m?.couleur ?? null,
        debut: per.debut,
        fin: per.fin,
        jours: per.jours,
        declaree: per.declaree,
      });
    }
  }
  // Tri : par nom, puis date de debut.
  lignes.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom) || a.debut.localeCompare(b.debut));
  return lignes;
}

// ---------------------------------------------------------------------------
// Planning previsionnel des interimaires, par agence
// ---------------------------------------------------------------------------

export type CelluleInterim = { posteNom: string; atelierNom: string; distant: boolean; horaire: string };
export type LigneInterim = {
  personneId: string;
  nom: string;
  prenom: string;
  atelierNom: string; // atelier d'affectation (— si aucun)
  cells: Record<string, CelluleInterim[]>; // cle = iso
};
export type GroupeAgence = { agence: string; lignes: LigneInterim[] };

export async function chargerHorairesInterim(
  supabase: DB,
  weekIsos: string[],
  quarts: QuartRef[]
): Promise<GroupeAgence[]> {
  // 1) Les interimaires du site (non partis).
  const { data: persD } = await supabase
    .from("personne")
    .select("id, nom, prenom, agence_interim, atelier_id, statut")
    .eq("type_contrat", "INTERIM")
    .neq("statut", "PARTI")
    .returns<{ id: string; nom: string; prenom: string; agence_interim: string | null; atelier_id: string | null; statut: string }[]>();
  const interims = persD ?? [];
  if (!interims.length) return [];
  const interimIds = interims.map((p) => p.id);

  // 2) Leurs placements de la semaine (sur poste), + tables de resolution.
  const [placements, { data: lignesSiteD }, { data: atD }, hor, { data: exc }, { data: tpH }] = await Promise.all([
    fetchAll<{ personne_id: string; poste_id: string | null; jour: string; quart_code: string | null }>(() =>
      supabase
        .from("placement")
        .select("personne_id, poste_id, jour, quart_code")
        .in("jour", weekIsos)
        .in("personne_id", interimIds)
        .not("poste_id", "is", null)
        .order("id")
        .returns<{ personne_id: string; poste_id: string | null; jour: string; quart_code: string | null }[]>()
    ),
    supabase.from("ligne").select("id, atelier_id, poste(id, nom)").returns<{ id: string; atelier_id: string | null; poste: { id: string; nom: string }[] }[]>(),
    supabase.from("atelier").select("id, nom").returns<{ id: string; nom: string }[]>(),
    fetchAll<{ poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null }>(() =>
      supabase
        .from("horaire_poste")
        .select("poste_id, quart_code, jour, debut, fin")
        .order("poste_id")
        .order("quart_code")
        .order("jour")
        .returns<{ poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null }[]>()
    ),
    supabase
      .from("horaire_exception")
      .select("personne_id, jour, debut, fin")
      .in("jour", weekIsos)
      .in("personne_id", interimIds)
      .returns<{ personne_id: string; jour: string; debut: string | null; fin: string | null }[]>(),
    supabase
      .from("personne")
      .select("id, tp_config")
      .in("id", interimIds)
      .eq("temps_partiel", true)
      .returns<{ id: string; tp_config: TpCfg | null }[]>(),
  ]);

  // Poste -> { nom, atelierId } sur tout le site (pret possible vers un autre atelier).
  const posteInfo = new Map<string, { nom: string; atelierId: string | null }>();
  for (const l of lignesSiteD ?? []) for (const p of l.poste ?? []) posteInfo.set(p.id, { nom: p.nom, atelierId: l.atelier_id });
  const atNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));

  // Maps de resolution d'horaire (cf. src/lib/horaires.ts).
  const horMap = new Map<string, HM>();
  for (const h of hor) horMap.set(`${h.poste_id}:${h.quart_code}:${h.jour}`, { debut: h.debut, fin: h.fin });
  const excMap = new Map<string, HM>();
  for (const e of exc ?? []) excMap.set(`${e.personne_id}:${e.jour}`, { debut: e.debut, fin: e.fin });
  const tpCfgMap = new Map<string, TpCfg>();
  for (const r of tpH ?? []) if (r.tp_config) tpCfgMap.set(r.id, r.tp_config);
  const maps: MapsHoraire = { horMap, excMap, tpCfgMap };

  // 3) Cellules par personne / jour.
  const cellsByPerson = new Map<string, Record<string, CelluleInterim[]>>();
  const persById = new Map(interims.map((p) => [p.id, p]));
  for (const r of placements) {
    if (!r.poste_id) continue;
    const info = posteInfo.get(r.poste_id);
    const cells = cellsByPerson.get(r.personne_id) ?? cellsByPerson.set(r.personne_id, {}).get(r.personne_id)!;
    const arr = (cells[r.jour] ??= []);
    const affId = persById.get(r.personne_id)?.atelier_id ?? null;
    arr.push({
      posteNom: info?.nom ?? "?",
      atelierNom: info?.atelierId ? atNom.get(info.atelierId) ?? "—" : "—",
      distant: !!info && info.atelierId !== affId && affId !== null,
      horaire: horaireTxt(maps, quarts, r.personne_id, r.poste_id, r.quart_code, r.jour),
    });
  }

  // 4) On ne garde que les interimaires PLACES cette semaine (un previsionnel
  //    sans affectation n'a rien a envoyer). Groupe par agence.
  const parAgence = new Map<string, LigneInterim[]>();
  for (const p of interims) {
    const cells = cellsByPerson.get(p.id);
    if (!cells || Object.keys(cells).length === 0) continue;
    const agence = (p.agence_interim ?? "").trim() || "Agence non renseignée";
    (parAgence.get(agence) ?? parAgence.set(agence, []).get(agence)!).push({
      personneId: p.id,
      nom: p.nom,
      prenom: p.prenom,
      atelierNom: p.atelier_id ? atNom.get(p.atelier_id) ?? "—" : "—",
      cells,
    });
  }

  const groupes: GroupeAgence[] = [...parAgence.entries()]
    .map(([agence, lignes]) => ({
      agence,
      lignes: lignes.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom)),
    }))
    .sort((a, b) => a.agence.localeCompare(b.agence));
  return groupes;
}
