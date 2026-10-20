// Bilan « Recyclages à prévoir » (2026-10-20) — règles pures, testées.
//
// Une ligne = une personne ACTIVE × une formation à recycler (`competence.a_recycler`,
// active) qu'elle détient, dont l'échéance tombe dans l'horizon choisi (expirées
// comprises). Échéance = `date_expiration` stockée, à défaut date d'obtention + durée
// de validité (même règle que l'écran Habilitations, cf. addMonthsIso). Une formation
// sans durée et sans date d'expiration saisie n'expire jamais : elle n'apparaît pas,
// mais le bilan la signale (à compléter au paramétrage).
//
// Type de formation = `competence.categorie` : « reglementaire » | « interne » ;
// une formation non classée (null) a son propre filtre, pour ne pas disparaître.

import { addMonthsIso, joursRestants } from "@/lib/habilitations";

export type TypeFormation = "reglementaire" | "interne" | "aucune";
export const TYPES_FORMATION: { v: TypeFormation | ""; t: string }[] = [
  { v: "", t: "Toutes" },
  { v: "reglementaire", t: "Réglementaires" },
  { v: "interne", t: "Internes" },
  { v: "aucune", t: "Non classées" },
];
export const libelleType = (t: TypeFormation): string =>
  t === "reglementaire" ? "Réglementaire" : t === "interne" ? "Interne" : "Non classée";

// Horizon : jours avant l'échéance. « expirees » = déjà passées seulement.
export type Horizon = "expirees" | "30" | "90" | "180" | "365" | "tout";
export const HORIZONS: { v: Horizon; t: string }[] = [
  { v: "expirees", t: "Expirées" },
  { v: "30", t: "≤ 30 j" },
  { v: "90", t: "≤ 90 j" },
  { v: "180", t: "≤ 6 mois" },
  { v: "365", t: "≤ 1 an" },
  { v: "tout", t: "Toutes échéances" },
];
export const HORIZON_DEFAUT: Horizon = "90";
export const lireHorizon = (v: string | undefined): Horizon =>
  HORIZONS.some((h) => h.v === v) ? (v as Horizon) : HORIZON_DEFAUT;
export const lireType = (v: string | undefined): TypeFormation | "" =>
  v === "reglementaire" || v === "interne" || v === "aucune" ? v : "";

export type Formation = { id: string; nom: string; categorie: string | null; duree_validite_mois: number | null; ordre: number };
export type Detention = { personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null };
export type PersonneR = { id: string; nom: string; prenom: string; type_contrat: string; atelier_id: string | null; equipe_id: string | null; depart: string | null };

export type LigneRecyclage = {
  formationId: string;
  formation: string;
  type: TypeFormation;
  personneId: string;
  nom: string;
  prenom: string;
  typeContrat: string;
  atelierId: string | null;
  equipeId: string | null;
  dernierPassage: string | null;
  expiration: string;
  jours: number; // < 0 = expirée depuis -jours
  // Fin de contrat ANTÉRIEURE à l'échéance : le recyclage n'est sans doute pas utile.
  departAvant: string | null;
};

export const typeDe = (categorie: string | null): TypeFormation =>
  categorie === "reglementaire" ? "reglementaire" : categorie === "interne" ? "interne" : "aucune";

export function dansHorizon(jours: number, h: Horizon): boolean {
  if (h === "tout") return true;
  if (h === "expirees") return jours < 0;
  return jours <= Number(h);
}

// Rouge < 30 j (expirées comprises) · orange 30-90 j · vert au-delà — code couleur
// de l'écran Habilitations.
export function urgence(jours: number): "rouge" | "orange" | "vert" {
  return jours < 30 ? "rouge" : jours <= 90 ? "orange" : "vert";
}

export function libelleJours(jours: number): string {
  if (jours < 0) return `expirée depuis ${-jours} j`;
  if (jours === 0) return "expire aujourd'hui";
  return `dans ${jours} j`;
}

export function construireRecyclages(
  formations: Formation[],
  detentions: Detention[],
  personnes: PersonneR[],
  opts: { type: TypeFormation | ""; horizon: Horizon; formation?: string; aujourdhui?: (iso: string) => number | null },
): LigneRecyclage[] {
  const jr = opts.aujourdhui ?? joursRestants;
  const fById = new Map(formations.map((f) => [f.id, f]));
  const pById = new Map(personnes.map((p) => [p.id, p]));
  const out: LigneRecyclage[] = [];
  for (const d of detentions) {
    const f = fById.get(d.competence_id);
    const p = pById.get(d.personne_id);
    if (!f || !p) continue;
    if (opts.formation && f.id !== opts.formation) continue;
    const type = typeDe(f.categorie);
    if (opts.type && type !== opts.type) continue;
    const expiration = d.date_expiration ?? addMonthsIso(d.date_obtention, f.duree_validite_mois);
    if (!expiration) continue; // n'expire jamais
    const jours = jr(expiration);
    if (jours === null || !dansHorizon(jours, opts.horizon)) continue;
    out.push({
      formationId: f.id,
      formation: f.nom,
      type,
      personneId: p.id,
      nom: p.nom,
      prenom: p.prenom,
      typeContrat: p.type_contrat,
      atelierId: p.atelier_id,
      equipeId: p.equipe_id,
      dernierPassage: d.date_obtention,
      expiration,
      jours,
      departAvant: p.depart && p.depart < expiration ? p.depart : null,
    });
  }
  // Par formation (ordre du paramétrage, puis nom), puis échéance la plus proche.
  const ordre = (id: string) => fById.get(id)?.ordre ?? 0;
  out.sort(
    (a, b) =>
      ordre(a.formationId) - ordre(b.formationId) ||
      a.formation.localeCompare(b.formation) ||
      a.expiration.localeCompare(b.expiration) ||
      a.nom.localeCompare(b.nom) ||
      a.prenom.localeCompare(b.prenom),
  );
  return out;
}

// Formations qui n'expirent jamais faute de durée de validité : aucune détention
// n'a de date d'expiration saisie. À signaler, pas à lister.
export function formationsSansEcheance(formations: Formation[], detentions: Detention[]): Formation[] {
  const avecDate = new Set(detentions.filter((d) => d.date_expiration).map((d) => d.competence_id));
  return formations.filter((f) => f.duree_validite_mois == null && !avecDate.has(f.id));
}
