// Analyse d'absentéisme : distinction planifié / non planifié et facteur de
// Bradford. Regroupé ici (pur, testé) pour être réutilisable et facile à faire
// évoluer — notamment le jour où un vrai flag `motif_absence.non_planifie`
// existera en base (il suffira de remplacer estNonPlanifie par la lecture du flag).

export type MotifLite = { code_court?: string | null; libelle?: string | null };

// Heuristique de classification. Non planifié = absences subies (maladie,
// accident du travail, absence injustifiée) — celles qui cassent la ligne et
// qu'on ne peut pas anticiper. Tout le reste (CP, RTT, CET, formation,
// délégation, événement familial, convenance, récup, JNT…) est planifié.
// ⚠️ Faute de flag en base, on se base sur le libellé/code ; à basculer vers un
// paramètre dès qu'il existera.
export function estNonPlanifie(m: MotifLite): boolean {
  const s = `${m.code_court ?? ""} ${m.libelle ?? ""}`.toLowerCase();
  return /maladie|accident|injustif|\bat\b/.test(s);
}

// Facteur de Bradford = S² × D, où S = nombre d'épisodes distincts (spells) et
// D = nombre total de jours d'absence, sur une période glissante (12 mois en
// général). Il pénalise fortement les absences courtes et répétées, bien plus
// révélatrices d'un problème que quelques longues absences.
export function bradford(episodes: number, jours: number): number {
  return episodes * episodes * jours;
}

// Palier de lecture du Bradford (seuils usuels en entreprise).
export type PalierBradford = "ok" | "surveiller" | "alerte" | "critique";
export function palierBradford(score: number): PalierBradford {
  if (score >= 500) return "critique";
  if (score >= 200) return "alerte";
  if (score >= 51) return "surveiller";
  return "ok";
}
