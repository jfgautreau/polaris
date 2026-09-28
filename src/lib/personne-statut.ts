// Cycle de vie du personnel : source de verite du statut d'une personne.
//
// Le champ `personne.statut` est un CACHE, maintenu par un trigger DB
// (migration 0049). Les ecrans qui doivent decider "est-ce que je montre
// cette personne ?" utilisent ces helpers, pas le champ statut directement.
// Ainsi, meme si le cache est desynchronise (personne a jour, cron pas
// passe), la reponse reste correcte.
//
// Trois etats calcules a partir de deux dates :
//   • A_VENIR  : today < date_arrivee
//   • ACTIF    : date_arrivee ≤ today ≤ (date_depart_prevu | +∞)
//   • PARTI    : today > date_depart_prevu

export type StatutPersonne = "A_VENIR" | "ACTIF" | "PARTI";

export type PersonneDates = {
  date_arrivee: string | null;
  date_depart_prevu: string | null;
};

/** Statut d'une personne a une date donnee. */
export function statutALaDate(p: PersonneDates, iso: string): StatutPersonne {
  if (p.date_arrivee && iso < p.date_arrivee) return "A_VENIR";
  if (p.date_depart_prevu && iso > p.date_depart_prevu) return "PARTI";
  return "ACTIF";
}

/** Vrai si la personne est ACTIVE (au sens du statut, hors contrats) le jour donne. */
export function estActifLe(p: PersonneDates, iso: string): boolean {
  return statutALaDate(p, iso) === "ACTIF";
}

/** Statut aujourd'hui. */
export function statutAujourdhui(p: PersonneDates): StatutPersonne {
  return statutALaDate(p, isoToday());
}

/** Libelle FR court d'un statut. */
export function libelleStatut(s: StatutPersonne): string {
  switch (s) {
    case "A_VENIR": return "À venir";
    case "ACTIF":   return "Actif";
    case "PARTI":   return "Parti";
  }
}

/** Couleur de la pastille associee. */
export function couleurStatut(s: StatutPersonne): { bg: string; fg: string } {
  switch (s) {
    case "A_VENIR": return { bg: "#dbeafe", fg: "#1d4ed8" }; // bleu
    case "ACTIF":   return { bg: "#dcfce7", fg: "#166534" }; // vert
    case "PARTI":   return { bg: "#e5e7eb", fg: "#374151" }; // gris
  }
}

// Contrats -------------------------------------------------------------
// Regle metier (validee) : la personne n'apparait dans le planning et le
// placement que sur les jours OU un contrat est actif. Un "trou" entre deux
// contrats (fin de CDD le 30/06, CDI le 15/07) la masque du planning pour
// la duree du trou, meme si son statut administratif reste ACTIF.

export type Periode = { date_debut: string | null; date_fin: string | null };

/** Dates derivees d'une liste de contrats : date d'arrivee (plus ancien
 *  date_debut) et date de depart prevu (plus recente date_fin, uniquement
 *  si TOUS les contrats sont fermes). Miroir de la fonction SQL
 *  personne_arrivee_depart de la migration 0050. */
export function deriverArriveeDepart(contrats: Periode[]): PersonneDates {
  let arrivee: string | null = null;
  let maxFin: string | null = null;
  let auMoinsUnOuvert = false;
  for (const c of contrats) {
    if (!c.date_debut) continue;
    if (arrivee === null || c.date_debut < arrivee) arrivee = c.date_debut;
    if (c.date_fin === null) auMoinsUnOuvert = true;
    else if (maxFin === null || c.date_fin > maxFin) maxFin = c.date_fin;
  }
  return {
    date_arrivee: arrivee,
    date_depart_prevu: auMoinsUnOuvert ? null : maxFin,
  };
}

/** Vrai si au moins un contrat couvre la date iso. Une periode sans date_debut
 *  est ignoree (contrat pas encore renseigne) ; sans date_fin, elle est
 *  consideree ouverte (couvre tout ce qui vient apres date_debut). */
export function contratCouvreLe(contrats: Periode[], iso: string): boolean {
  for (const c of contrats) {
    if (!c.date_debut) continue;
    if (iso < c.date_debut) continue;
    if (c.date_fin && iso > c.date_fin) continue;
    return true;
  }
  return false;
}

/** Vrai si la personne est effectivement au travail le jour donne :
 *  statut ACTIF + un contrat couvre ce jour. C'est cette fonction que le
 *  planning et le placement doivent appeler pour masquer les personnes. */
export function estAuTravailLe(
  p: PersonneDates,
  contrats: Periode[],
  iso: string,
): boolean {
  if (!estActifLe(p, iso)) return false;
  // Aucun contrat renseigne = on fait confiance au statut (cas des donnees
  // historiques importees sans contrat_periode).
  if (contrats.length === 0) return true;
  return contratCouvreLe(contrats, iso);
}

// Utilitaires ---------------------------------------------------------

function isoToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${j}`;
}

/** Raison de REFUSER une affectation (poste, absence, NT, TP) d'une personne ce
 *  jour-là, ou `null` si elle est dans l'effectif (2026-09-28). Règle unique des
 *  routes d'écriture de placement :
 *   - contrats connus : il faut qu'un contrat couvre le jour — sinon partie,
 *     pas encore arrivée, ou entre deux contrats. L'historique d'une personne
 *     partie reste donc corrigeable sur les jours où elle était sous contrat ;
 *   - aucun contrat (données historiques) : seul le statut PARTI bloque.
 *  Retirer une affectation n'est jamais bloqué (c'est l'appelant qui l'exempte). */
export function motifInactivite(statut: string | null | undefined, contrats: Periode[], iso: string): string | null {
  if (contrats.length) {
    if (contratCouvreLe(contrats, iso)) return null;
    return statut === "PARTI" ? "personne partie (inactive)" : "hors effectif ce jour (aucun contrat ne couvre cette date)";
  }
  return statut === "PARTI" ? "personne partie (inactive)" : null;
}
