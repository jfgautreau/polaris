// Palette FERMÉE des couleurs de niveau du carré magique. On limite volontairement
// le choix aux 4 teintes historiques (cf. demande produit) : rouge → orange →
// vert clair → vert. La couleur de chaque niveau POSITIF est paramétrable par site
// (colonne competence_niveau_libelle.couleur, migration 0063) ; le niveau 0 reste
// toujours « blanc / contour seul » (aucune compétence).
export const COULEURS_NIVEAU = [
  { hex: "#dc2626", nom: "Rouge" },
  { hex: "#f59e0b", nom: "Orange" },
  { hex: "#84cc16", nom: "Vert clair" },
  { hex: "#16a34a", nom: "Vert" },
] as const;

// Ensemble des hex autorisés (validation côté serveur avant écriture).
export const HEX_NIVEAUX_AUTORISES: ReadonlySet<string> = new Set(
  COULEURS_NIVEAU.map((c) => c.hex)
);

// Couleur par défaut de chaque niveau positif = échelle historique. Sert de repli
// tant qu'aucune couleur n'est enregistrée (site neuf, ou migration 0063 non
// appliquée).
export const COULEUR_NIVEAU_DEFAUT: Record<number, string> = {
  1: "#dc2626",
  2: "#f59e0b",
  3: "#84cc16",
  4: "#16a34a",
};

// Map complète niveau -> couleur (0 = null/contour), en fusionnant d'éventuelles
// couleurs personnalisées par-dessus les défauts. `custom` ne contient que les
// niveaux réellement personnalisés en base.
export function couleursNiveau(custom: Record<number, string> = {}): Record<number, string | null> {
  const out: Record<number, string | null> = { 0: null };
  for (let n = 1; n <= 4; n++) out[n] = custom[n] ?? COULEUR_NIVEAU_DEFAUT[n];
  return out;
}
