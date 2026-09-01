// Nuancier des couleurs de niveau du carré magique. La couleur de chaque niveau
// POSITIF est paramétrable par site (colonne competence_niveau_libelle.couleur,
// migrations 0063 puis 0065) ; le niveau 0 reste toujours « blanc / contour seul »
// (aucune compétence).
//
// Nuancier = dégradé continu ROUGE → VERT en 12 teintes (bas → haut de l'échelle),
// cohérent avec la lecture du carré magique. Liste FERMÉE : validation côté serveur
// avant écriture, rendu cohérent partout.
export const NUANCIER: readonly string[] = [
  "#c52020", "#c54120", "#c56220", "#c58120", "#c5a220", "#c5c320",
  "#a7c520", "#86c520", "#65c520", "#47c520", "#26c520", "#20c53c",
] as const;

// Ensemble des hex autorisés (validation côté serveur avant écriture).
export const HEX_NIVEAUX_AUTORISES: ReadonlySet<string> = new Set(NUANCIER);

// Couleur par défaut de chaque niveau positif = jalons du dégradé rouge → vert.
// Sert de repli tant qu'aucune couleur n'est enregistrée (site neuf, ou migration
// non appliquée). Chaque valeur appartient au NUANCIER.
export const COULEUR_NIVEAU_DEFAUT: Record<number, string> = {
  1: "#c52020",
  2: "#c58120",
  3: "#86c520",
  4: "#20c53c",
};

// Map complète niveau -> couleur (0 = null/contour), en fusionnant d'éventuelles
// couleurs personnalisées par-dessus les défauts. `custom` ne contient que les
// niveaux réellement personnalisés en base.
export function couleursNiveau(custom: Record<number, string> = {}): Record<number, string | null> {
  const out: Record<number, string | null> = { 0: null };
  for (let n = 1; n <= 4; n++) out[n] = custom[n] ?? COULEUR_NIVEAU_DEFAUT[n];
  return out;
}
