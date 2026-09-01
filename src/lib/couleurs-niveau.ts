// Nuancier des couleurs de niveau du carré magique. La couleur de chaque niveau
// POSITIF est paramétrable par site (colonne competence_niveau_libelle.couleur,
// migrations 0063 puis 0065) ; le niveau 0 reste toujours « blanc / contour seul »
// (aucune compétence).
//
// Nuancier = dégradé ROUGE SANG → JAUNE POUSSIN → VERT PÉTANT en 20 teintes
// (bas → haut de l'échelle), pondéré vers le vert (le haut d'échelle offre le plus
// de nuances). Cohérent avec la lecture du carré magique. Liste FERMÉE :
// validation côté serveur avant écriture, rendu cohérent partout.
export const NUANCIER: readonly string[] = [
  "#dc1f18", "#e9401a", "#ed6623", "#f08b2d", "#f3af37",
  "#f6d042", "#f5ed3f", "#d8f136", "#b1ed2e", "#89e926",
  "#68e620", "#4ee51c", "#37e11a", "#20db1a", "#1ad528",
  "#1acf3a", "#19c642", "#19bd49", "#18b44f", "#17ab55",
] as const;

// Ensemble des hex autorisés (validation côté serveur avant écriture).
export const HEX_NIVEAUX_AUTORISES: ReadonlySet<string> = new Set(NUANCIER);

// Couleur par défaut de chaque niveau positif = jalons du dégradé (rouge sang,
// jaune poussin, vert, vert profond). Sert de repli tant qu'aucune couleur n'est
// enregistrée (site neuf, ou migration non appliquée). Chaque valeur appartient
// au NUANCIER.
export const COULEUR_NIVEAU_DEFAUT: Record<number, string> = {
  1: "#dc1f18",
  2: "#f5ed3f",
  3: "#37e11a",
  4: "#17ab55",
};

// Map complète niveau -> couleur (0 = null/contour), en fusionnant d'éventuelles
// couleurs personnalisées par-dessus les défauts. `custom` ne contient que les
// niveaux réellement personnalisés en base.
export function couleursNiveau(custom: Record<number, string> = {}): Record<number, string | null> {
  const out: Record<number, string | null> = { 0: null };
  for (let n = 1; n <= 4; n++) out[n] = custom[n] ?? COULEUR_NIVEAU_DEFAUT[n];
  return out;
}
