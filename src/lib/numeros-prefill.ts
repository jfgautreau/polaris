// Numéro de rotation des titulaires posés par le pré-remplissage « TP +
// pré-affectation » (décision du 2026-10-15). Règle pure, testée.
//
// Un poste numéroté (« 12, 15-17 ») a une case par numéro au Placement ; un
// titulaire sans numéro tombe dans la zone « sans numéro » et perd l'horaire de
// sa place (horaire_place, 0088). Le pré-remplissage lui donne donc une place :
//   1. un numéro LIBRE TOUS LES JOURS de la semaine où il est posé, en préférant
//      (dans l'ordre) celui qu'il tient déjà cette semaine sur ce poste, puis son
//      dernier numéro sur ce poste, puis l'ordre du Référentiel ;
//   2. à défaut, jour par jour, le premier libre dans le même ordre ;
//   3. sinon `null` : aucune place libre ce jour-là (surnombre), signalé.
// « Libre » = aucune autre personne sur ce poste, ce quart, ce jour, à ce numéro.

export function numerosPourSemaine(
  numeros: string[],
  jours: string[],
  prisLe: (iso: string) => Set<string>,
  preferes: (string | null | undefined)[],
): Record<string, string | null> {
  const ordre = [...new Set([...preferes.filter((n): n is string => !!n && numeros.includes(n)), ...numeros])];
  const out: Record<string, string | null> = {};
  const toute = ordre.find((n) => jours.every((iso) => !prisLe(iso).has(n)));
  for (const iso of jours) out[iso] = toute ?? ordre.find((n) => !prisLe(iso).has(n)) ?? null;
  return out;
}
