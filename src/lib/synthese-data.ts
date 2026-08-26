// Chargement des donnees des deux syntheses de `/bilans/syntheses` :
//   - la vue « 4 semaines » des absences a venir (mini-calendrier jour par jour,
//     hors interimaires) ;
//   - le planning previsionnel des interimaires, groupe par agence, avec la liste
//     des interimaires SANS besoin (non planifies) de chaque agence.
//
// Lecture sous RLS (`getServerClient`) : l'ecran est derriere l'authentification
// et le site courant borne deja chaque table. On garde donc `getServerClient`
// plutot que le client admin — pas de `site_id` a poser a la main (cf.
// isolation-site.test.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { horaireTxt, type MapsHoraire, type HM, type TpCfg } from "@/lib/horaires";
import { estInterim } from "@/lib/interim";
import type { QuartRef } from "@/lib/quarts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, "public", any>;

// Abreviation courte d'un motif pour la case du mini-calendrier (« Congés payés »
// -> « CP », « Maladie » -> « MAL »). Sert de repere imprimable, la couleur seule
// n'etant pas fiable (impression N&B, daltonisme). Le libelle complet reste en
// info-bulle et dans la legende « Par motif ».
export function abregerMotif(libelle: string): string {
  const mots = libelle.trim().split(/\s+/).filter(Boolean);
  if (mots.length >= 2) return mots.slice(0, 3).map((m) => m[0]).join("").toUpperCase();
  return libelle.trim().slice(0, 3).toUpperCase();
}

// ---------------------------------------------------------------------------
// Absences a venir sur 4 semaines (hors interim) — mini-calendrier jour/jour
// ---------------------------------------------------------------------------

export type CelluleAbsence = {
  motifId: string | null;
  libelle: string;
  couleur: string | null;
  abbr: string;
};
export type LigneAbsence4 = {
  personneId: string;
  nom: string;
  prenom: string;
  atelierId: string | null;
  atelierNom: string;
  equipeNom: string;
  jours: Record<string, CelluleAbsence>; // cle = iso (jour ouvre)
  total: number; // nb de jours absents dans la fenetre affichee
};
export type RecapMotif = {
  motifId: string | null;
  libelle: string;
  couleur: string | null;
  abbr: string;
  personnes: number;
  jours: number;
};
export type Absences4 = { lignes: LigneAbsence4[]; recap: RecapMotif[] };

/**
 * Absences posees sur les `workdayIsos` (jours ouvres des 4 semaines affichees),
 * hors interim. On ne garde que les personnes ayant au moins une absence sur la
 * fenetre. Filtrable par atelier (d'affectation) et par motif.
 *
 * Contrairement a la vue d'origine, on ne reconstruit PAS les periodes completes :
 * le mini-calendrier montre uniquement les jours qui tombent dans la fenetre, jour
 * par jour — c'est une projection, pas un releve historique.
 */
export async function chargerAbsences4Semaines(
  supabase: DB,
  workdayIsos: string[],
  filtreAtelier?: string,
  filtreMotif?: string
): Promise<Absences4> {
  // 1) Jours d'absence tombant dans la fenetre. fetchAll : au-dela de 1000 lignes,
  //    PostgREST tronque en silence (cf. L8).
  const jours = await fetchAll<{ personne_id: string; jour: string; motif_absence_id: string | null }>(() =>
    supabase
      .from("placement")
      .select("personne_id, jour, motif_absence_id")
      .in("jour", workdayIsos)
      .not("motif_absence_id", "is", null)
      .order("personne_id")
      .order("jour")
      .returns<{ personne_id: string; jour: string; motif_absence_id: string | null }[]>()
  );
  const persIds = [...new Set(jours.map((r) => r.personne_id))];
  if (!persIds.length) return { lignes: [], recap: [] };

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
  const atNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));
  const eqNom = new Map((eqD ?? []).map((e) => [e.id, e.nom]));
  const motif = new Map((motifD ?? []).map((m) => [m.id, m]));

  // 3) Cellules par personne / jour (premier motif rencontre pour un jour donne).
  const cellsByPerson = new Map<string, Record<string, CelluleAbsence>>();
  for (const r of jours) {
    const p = persById.get(r.personne_id);
    if (!p || estInterim(p.type_contrat)) continue;
    if (filtreMotif && r.motif_absence_id !== filtreMotif) continue;
    const cells = cellsByPerson.get(r.personne_id) ?? cellsByPerson.set(r.personne_id, {}).get(r.personne_id)!;
    if (cells[r.jour]) continue; // un seul motif par case
    const m = r.motif_absence_id ? motif.get(r.motif_absence_id) : undefined;
    cells[r.jour] = {
      motifId: r.motif_absence_id,
      libelle: m?.libelle ?? "Absence",
      couleur: m?.couleur ?? null,
      abbr: abregerMotif(m?.libelle ?? "Absence"),
    };
  }

  // 4) Lignes (une par personne conservee) + recap par motif.
  const lignes: LigneAbsence4[] = [];
  const recap = new Map<string, { libelle: string; couleur: string | null; abbr: string; pers: Set<string>; jours: number }>();
  for (const [pid, cells] of cellsByPerson) {
    const p = persById.get(pid);
    if (!p) continue;
    if (filtreAtelier && p.atelier_id !== filtreAtelier) continue;
    const isos = Object.keys(cells);
    if (!isos.length) continue;
    lignes.push({
      personneId: pid,
      nom: p.nom,
      prenom: p.prenom,
      atelierId: p.atelier_id,
      atelierNom: p.atelier_id ? atNom.get(p.atelier_id) ?? "—" : "—",
      equipeNom: p.equipe_id ? eqNom.get(p.equipe_id) ?? "—" : "—",
      jours: cells,
      total: isos.length,
    });
    for (const iso of isos) {
      const c = cells[iso];
      const key = c.motifId ?? "—";
      const cur = recap.get(key) ?? { libelle: c.libelle, couleur: c.couleur, abbr: c.abbr, pers: new Set<string>(), jours: 0 };
      cur.pers.add(pid);
      cur.jours += 1;
      recap.set(key, cur);
    }
  }
  lignes.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));

  const recapArr: RecapMotif[] = [...recap.entries()]
    .map(([motifId, v]) => ({ motifId: motifId === "—" ? null : motifId, libelle: v.libelle, couleur: v.couleur, abbr: v.abbr, personnes: v.pers.size, jours: v.jours }))
    .sort((a, b) => b.jours - a.jours);

  return { lignes, recap: recapArr };
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
export type InterimDispo = { personneId: string; nom: string; prenom: string };
export type GroupeAgence = { agence: string; lignes: LigneInterim[]; sansBesoin: InterimDispo[] };

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

  // 4) Groupe par agence. On garde TOUTES les agences ayant au moins un
  //    interimaire (non parti) : celles sans aucun placement reapparaissent avec
  //    leur seule liste « sans besoin », pour communiquer a l'agence qu'aucun de
  //    ses interimaires n'est requis cette semaine.
  const parAgence = new Map<string, { lignes: LigneInterim[]; sansBesoin: InterimDispo[] }>();
  for (const p of interims) {
    const agence = (p.agence_interim ?? "").trim() || "Agence non renseignée";
    const g = parAgence.get(agence) ?? parAgence.set(agence, { lignes: [], sansBesoin: [] }).get(agence)!;
    const cells = cellsByPerson.get(p.id);
    if (cells && Object.keys(cells).length > 0) {
      g.lignes.push({
        personneId: p.id,
        nom: p.nom,
        prenom: p.prenom,
        atelierNom: p.atelier_id ? atNom.get(p.atelier_id) ?? "—" : "—",
        cells,
      });
    } else {
      g.sansBesoin.push({ personneId: p.id, nom: p.nom, prenom: p.prenom });
    }
  }

  const groupes: GroupeAgence[] = [...parAgence.entries()]
    .map(([agence, g]) => ({
      agence,
      lignes: g.lignes.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom)),
      sansBesoin: g.sansBesoin.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom)),
    }))
    .sort((a, b) => a.agence.localeCompare(b.agence));
  return groupes;
}
