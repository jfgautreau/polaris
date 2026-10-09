// Règles de recopie du Planning (décision du 2026-10-09), pures et testées.
//
// Valeurs d'une case : "" vide · "X" non travaillé · "TP" temps partiel posé ·
// "m:<id>" absence · sinon l'identifiant d'un poste.
//
//  - Seuls un POSTE et le NON TRAVAILLÉ se recopient. Une absence ou un TP sont
//    des périodes, gérées ailleurs : on ne les prolonge jamais par recopie.
//  - Une recopie ne touche JAMAIS une case déjà remplie (poste, NT, absence, TP).
//  - Recopier une case VIDE (bouton » d'une personne seulement) vide la suite :
//    elle efface les postes et les NT, jamais une absence ni un TP.
//  - Case bloquée (jour fermé, TP calculé, hors contrat, placé sur un autre
//    quart) : jamais touchée.
//  - Poste qui ne tourne pas sur le quart du jour cible : non recopié, signalé.

export type CaseCible = {
  iso: string;
  valeur: string;
  bloquee: boolean;
  /** Le poste source ne tourne pas sur le quart de ce jour. */
  horsCycle: boolean;
};

export type PlanRecopie = {
  ecrire: { iso: string; valeur: string }[];
  /** Cases laissées telles quelles parce que déjà remplies (ou protégées). */
  laissees: number;
  horsCycle: number;
};

export const estPoste = (v: string) => v !== "" && v !== "X" && v !== "TP" && !v.startsWith("m:");
/** Valeur qui se recopie : un poste ou le non travaillé. */
export const estRecopiable = (v: string) => estPoste(v) || v === "X";

export function planRecopie(source: string, cibles: CaseCible[], viderPermis: boolean): PlanRecopie {
  const plan: PlanRecopie = { ecrire: [], laissees: 0, horsCycle: 0 };
  const vider = source === "";
  if (vider && !viderPermis) return plan;
  if (!vider && !estRecopiable(source)) return plan;
  for (const c of cibles) {
    if (c.bloquee) continue;
    if (vider) {
      if (estRecopiable(c.valeur)) plan.ecrire.push({ iso: c.iso, valeur: "" });
      else if (c.valeur !== "") plan.laissees++; // absence ou TP : protégés
      continue;
    }
    if (c.valeur !== "") {
      plan.laissees++;
      continue;
    }
    if (estPoste(source) && c.horsCycle) {
      plan.horsCycle++;
      continue;
    }
    plan.ecrire.push({ iso: c.iso, valeur: source });
  }
  return plan;
}

/** Compte rendu bref d'une recopie. */
export function compteRendu(ecrites: number, laissees: number, horsCycle: number, refus: number, vider = false): string {
  const parts = [
    vider ? `${ecrites} case(s) vidée(s)` : `${ecrites} case(s) recopiée(s)`,
    laissees ? (vider ? `${laissees} absence(s) ou TP conservé(s)` : `${laissees} déjà remplie(s) laissée(s)`) : "",
    horsCycle ? `${horsCycle} poste(s) hors cycle ce jour-là` : "",
    refus ? `${refus} refus (hors contrat…) : case(s) remise(s) à leur valeur` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
