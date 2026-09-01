// Nuancier des couleurs de niveau du carré magique. La couleur de chaque niveau
// POSITIF est paramétrable par site (colonne competence_niveau_libelle.couleur,
// migrations 0063 puis 0065) ; le niveau 0 reste toujours « blanc / contour seul »
// (aucune compétence).
//
// La palette a été ÉLARGIE au-delà des 4 teintes historiques (rouge → orange →
// vert clair → vert) vers un vrai nuancier, tout en restant une liste FERMÉE :
// validation côté serveur avant écriture, et rendu cohérent. Les 4 teintes
// historiques figurent en tête car elles servent de défaut d'échelle.
export const NUANCIER: readonly string[] = [
  // Rouges → oranges → jaunes (bas de l'échelle)
  "#dc2626", "#ef4444", "#ea580c", "#f97316", "#f59e0b", "#eab308",
  // Jaunes-verts → verts (haut de l'échelle)
  "#facc15", "#84cc16", "#65a30d", "#22c55e", "#16a34a", "#059669",
  // Turquoise → cyans → bleus
  "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#2563eb", "#4f46e5",
  // Violets → roses → gris
  "#7c3aed", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#64748b",
] as const;

// Ensemble des hex autorisés (validation côté serveur avant écriture).
export const HEX_NIVEAUX_AUTORISES: ReadonlySet<string> = new Set(NUANCIER);

// Couleur par défaut de chaque niveau positif = échelle historique. Sert de repli
// tant qu'aucune couleur n'est enregistrée (site neuf, ou migration non appliquée).
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
