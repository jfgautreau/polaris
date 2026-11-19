// Bilan « Campagne de formation » (2026-11-19) — règles pures, testées.
//
// Demande de la SSE : une ou deux fois par an, pour UNE formation, l'état de tout
// l'effectif actif, en deux blocs :
//   - FORMÉS : la personne détient la formation ; son état est jugé à la DATE DE LA
//     SESSION (une habilitation valide aujourd'hui mais échue ce jour-là est à recycler) ;
//   - NON FORMÉS : le vivier, avec ses repères de disponibilité — déjà formé autrefois
//     (habilitation supprimée, retrouvée dans l'historique 0084), absent ou en temps
//     partiel le jour de la session, contrat terminé avant la session.
// Échéance = `date_expiration` stockée, à défaut obtention + durée (règle de l'écran
// Habilitations, addMonthsIso). Sans l'une ni l'autre : la formation n'expire pas.

import { addMonthsIso } from "@/lib/habilitations";

// Fenêtre « à recycler de préférence » après la date de session (jours).
export const MARGE_RECYCLAGE_J = 90;

export type EtatForme = "expiree" | "a_recycler" | "valide" | "permanente";
export const LIBELLE_ETAT: Record<EtatForme, string> = {
  expiree: "À recycler",
  a_recycler: "À recycler de préférence",
  valide: "Valide",
  permanente: "Sans échéance",
};

export type FormationC = { id: string; nom: string; duree_validite_mois: number | null };
export type DetentionC = { personne_id: string; date_obtention: string | null; date_expiration: string | null };
export type SuppressionC = { personne_id: string; date_obtention: string | null; created_at: string };
export type PersonneC = {
  id: string;
  nom: string;
  prenom: string;
  type_contrat: string;
  atelier_id: string | null;
  equipe_id: string | null;
  poste_fixe_id: string | null;
  depart: string | null; // fin du dernier contrat si tout est fermé
};

export type LigneForme = {
  personne: PersonneC;
  obtention: string | null;
  expiration: string | null;
  joursASession: number | null; // échéance - date de session (< 0 = échue ce jour-là)
  etat: EtatForme;
  departAvant: string | null; // contrat terminé avant la session
};

export type LigneNonForme = {
  personne: PersonneC;
  // Habilitation supprimée retrouvée dans l'historique : date de suppression (AAAA-MM-JJ)
  // et date d'obtention qu'elle portait.
  ancienne: { supprimeeLe: string; obtention: string | null } | null;
  indispo: string[]; // raisons (absence, TP, fin de contrat) ; vide = disponible
};

export type Campagne = { formes: LigneForme[]; nonFormes: LigneNonForme[] };

// Écart en jours entre deux dates ISO (b - a), sans effet d'heure d'été.
export function ecartJours(a: string, b: string): number {
  const t = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

export function etatA(joursASession: number | null): EtatForme {
  if (joursASession === null) return "permanente";
  if (joursASession < 0) return "expiree";
  if (joursASession <= MARGE_RECYCLAGE_J) return "a_recycler";
  return "valide";
}

const ORDRE_ETAT: Record<EtatForme, number> = { expiree: 0, a_recycler: 1, valide: 2, permanente: 3 };

const fmt = (iso: string) => iso.split("-").reverse().join("/");

export function construireCampagne(
  formation: FormationC,
  detentions: DetentionC[],
  suppressions: SuppressionC[],
  personnes: PersonneC[],
  opts: {
    session: string; // AAAA-MM-JJ
    absences: Map<string, string>; // personne_id → libellé du motif, le jour de la session
    tp: Set<string>; // personne_id en temps partiel (matérialisé) le jour de la session
    // Tri du vivier : clé de service (ordre d'affichage) pour regrouper.
    cleService?: (p: PersonneC) => string;
  },
): Campagne {
  const detParPersonne = new Map(detentions.map((d) => [d.personne_id, d]));
  // Dernière suppression par personne (l'historique peut en porter plusieurs).
  const derniereSuppr = new Map<string, SuppressionC>();
  for (const s of suppressions) {
    const prec = derniereSuppr.get(s.personne_id);
    if (!prec || s.created_at > prec.created_at) derniereSuppr.set(s.personne_id, s);
  }
  const cle = opts.cleService ?? (() => "");
  const parNom = (a: PersonneC, b: PersonneC) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom);

  const formes: LigneForme[] = [];
  const nonFormes: LigneNonForme[] = [];
  for (const p of personnes) {
    const departAvant = p.depart && p.depart < opts.session ? p.depart : null;
    const d = detParPersonne.get(p.id);
    if (d) {
      const expiration = d.date_expiration ?? addMonthsIso(d.date_obtention, formation.duree_validite_mois);
      const joursASession = expiration ? ecartJours(opts.session, expiration) : null;
      formes.push({ personne: p, obtention: d.date_obtention, expiration, joursASession, etat: etatA(joursASession), departAvant });
      continue;
    }
    const s = derniereSuppr.get(p.id);
    const indispo: string[] = [];
    const motif = opts.absences.get(p.id);
    if (motif) indispo.push(`Absent le ${fmt(opts.session)} (${motif})`);
    if (opts.tp.has(p.id)) indispo.push(`Temps partiel le ${fmt(opts.session)}`);
    if (departAvant) indispo.push(`Fin de contrat le ${fmt(departAvant)}`);
    nonFormes.push({
      personne: p,
      ancienne: s ? { supprimeeLe: s.created_at.slice(0, 10), obtention: s.date_obtention } : null,
      indispo,
    });
  }

  formes.sort(
    (a, b) =>
      ORDRE_ETAT[a.etat] - ORDRE_ETAT[b.etat] ||
      (a.expiration ?? "9999").localeCompare(b.expiration ?? "9999") ||
      parNom(a.personne, b.personne),
  );
  // Vivier : disponibles d'abord, puis par service et par nom ; indisponibles en fin.
  nonFormes.sort(
    (a, b) =>
      Number(a.indispo.length > 0) - Number(b.indispo.length > 0) ||
      cle(a.personne).localeCompare(cle(b.personne)) ||
      parNom(a.personne, b.personne),
  );
  return { formes, nonFormes };
}

// Paramètres d'URL.
export function lireSession(v: string | undefined, aujourdhui: string): string {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  const [y, m, d] = aujourdhui.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 30));
  return dt.toISOString().slice(0, 10);
}
export const lireInterim = (v: string | undefined): boolean => v === "oui";
