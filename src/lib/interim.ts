// Repère visuel des intérimaires : un fond JAUNE, partagé par tous les écrans.
//
// La couleur était incohérente : l'affichage TV surlignait les intérimaires en
// VERT (#bbf7d0), les autres écrans ne les distinguaient pas du tout. On unifie
// sur le jaune, seule source de vérité ici — changer la teinte se fait à un seul
// endroit.
//
// Jaune choisi pour ne heurter aucune couleur métier déjà en place : les équipes
// ont leurs propres teintes, le rouge dit « absence » / « habilitation manquante »,
// le vert « aujourd'hui » sur la TV. Le jaune restait libre.

export const INTERIM_BG = "#fde68a"; // ambre 200 : lisible en texte noir
export const INTERIM_BORDER = "#f59e0b"; // ambre 500, pour un liseré discret

// Intérim « classique » au sens LÉGAL : le code littéral INTERIM. Réservé à ce
// qui doit rester strictement l'intérim de mission — notamment l'alerte 18 mois
// (borne légale), dont le CDI intérimaire est exclu.
export function estInterim(typeContrat: string | null | undefined): boolean {
  return typeContrat === "INTERIM";
}

// Contrat PILOTÉ PAR UNE AGENCE d'intérim : intérim classique OU CDI intérimaire
// (ou tout futur type coché). Généralise `estInterim` (0072). La liste des codes
// concernés est site-scopée (drapeau type_contrat.avec_agence), chargée par
// `getTypesAgenceC()` puis passée ici. Sans liste fournie, on retombe sur le seul
// code historique INTERIM (compat écrans non encore mis à jour + fenêtre avant
// migration).
export function estAvecAgence(
  typeContrat: string | null | undefined,
  agenceCodes?: Iterable<string> | null,
): boolean {
  if (!typeContrat) return false;
  if (!agenceCodes) return estInterim(typeContrat);
  const set = agenceCodes instanceof Set ? agenceCodes : new Set(agenceCodes);
  return set.has(typeContrat);
}

// Style de fond à poser sur le libellé d'un intérimaire (nom, pastille…).
// Rend `{}` pour un non-agence : à étaler sur un objet de style existant
// (`{ ...styleInterim(p.type_contrat, agenceCodes) }`) sans rien casser.
export function styleInterim(
  typeContrat: string | null | undefined,
  agenceCodes?: Iterable<string> | null,
): React.CSSProperties {
  if (!estAvecAgence(typeContrat, agenceCodes)) return {};
  return { background: INTERIM_BG, borderRadius: 3 };
}
