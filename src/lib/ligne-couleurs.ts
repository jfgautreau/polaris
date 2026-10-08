// Couleur d'une ligne de production (`ligne.couleur`, migration 0082).
//
// Sert aux PDF du Placement : une ligne qui tourne (au moins une personne
// placée) prend sa couleur — liseré, bandeau pâle sur le nom des postes, nom
// foncé. Choisie au Référentiel dans cette palette fermée (pas de sélecteur
// libre) ; seule la teinte de base est stockée, le pâle et le foncé s'en
// déduisent ici.
//
// Ni rouge, ni orange, ni vert : sur la feuille, ces trois teintes disent déjà
// « manque », « surnombre », « complet ».

export type CouleurLigne = { lc: string; pale: string; dark: string; nom: string };

// Ordre d'affichage de la palette : par teinte, des bleus aux neutres. Les huit
// teintes d'origine (attribution automatique, migration 0082) en font partie.
export const LIGNE_COULEURS: CouleurLigne[] = [
  { lc: "#0284c7", pale: "#e0f2fe", dark: "#075985", nom: "Bleu ciel" },
  { lc: "#0369a1", pale: "#dbeefa", dark: "#024a72", nom: "Azur" },
  { lc: "#2557c7", pale: "#dfe8fb", dark: "#183c8c", nom: "Bleu" },
  { lc: "#1e3a8a", pale: "#dbe4f7", dark: "#172c69", nom: "Marine" },
  { lc: "#3f6e8c", pale: "#e1ebf2", dark: "#2b4d63", nom: "Acier" },
  { lc: "#0891b2", pale: "#cffafe", dark: "#155e75", nom: "Cyan" },
  { lc: "#0f7a8a", pale: "#d9f0f2", dark: "#0b5560", nom: "Bleu canard" },
  { lc: "#155e75", pale: "#d5eef3", dark: "#0e4553", nom: "Pétrole" },
  { lc: "#6366f1", pale: "#e0e7ff", dark: "#3730a3", nom: "Pervenche" },
  { lc: "#4338ca", pale: "#e3e1fb", dark: "#2f2791", nom: "Indigo" },
  { lc: "#8b5cf6", pale: "#ede9fe", dark: "#5b21b6", nom: "Lavande" },
  { lc: "#7a3fc4", pale: "#ece2f9", dark: "#552a8c", nom: "Violet" },
  { lc: "#c026d3", pale: "#fae8ff", dark: "#86198f", nom: "Orchidée" },
  { lc: "#86198f", pale: "#f5e0f7", dark: "#5e1164", nom: "Prune" },
  { lc: "#db2777", pale: "#fce7f3", dark: "#9d174d", nom: "Rose" },
  { lc: "#b3307a", pale: "#f8e1ee", dark: "#7f1f56", nom: "Framboise" },
  { lc: "#8a5a2b", pale: "#f2e7da", dark: "#5f3d1c", nom: "Brun" },
  { lc: "#78716c", pale: "#f2f1ef", dark: "#44403c", nom: "Taupe" },
  { lc: "#64748b", pale: "#eef2f6", dark: "#334155", nom: "Gris bleu" },
  { lc: "#475569", pale: "#e2e8f0", dark: "#334155", nom: "Ardoise" },
  { lc: "#1f2937", pale: "#e5e7eb", dark: "#111827", nom: "Anthracite" },
];

// Ordre de l'attribution automatique (nouvelle ligne, ou ligne sans couleur) :
// des teintes bien distinctes d'abord — les huit d'origine, dans leur ordre.
const ORDRE_AUTO = [
  "#2557c7", "#7a3fc4", "#0f7a8a", "#b3307a", "#4338ca", "#8a5a2b", "#0369a1", "#86198f",
  "#db2777", "#0891b2", "#1e3a8a", "#c026d3", "#3f6e8c", "#8b5cf6", "#475569", "#6366f1",
  "#155e75", "#78716c", "#0284c7", "#64748b", "#1f2937",
];

const PAR_CODE = new Map(LIGNE_COULEURS.map((c) => [c.lc, c]));

/** Même ensemble que la palette (vérifié par le test). */
export const ORDRE_AUTO_LIGNES = ORDRE_AUTO;

export const estCouleurLigne = (v: unknown): v is string => typeof v === "string" && PAR_CODE.has(v.toLowerCase());

/** Couleur d'une ligne ; sans couleur enregistrée (ou inconnue), repli sur son rang. */
export function couleurDeLigne(couleur: string | null | undefined, rang: number): CouleurLigne {
  return (couleur && PAR_CODE.get(couleur.toLowerCase())) || PAR_CODE.get(ORDRE_AUTO[rang % ORDRE_AUTO.length])!;
}

/** Pour une nouvelle ligne : la teinte la moins utilisée parmi les lignes du service. */
export function couleurLibre(dejaPrises: (string | null)[]): string {
  const n = new Map<string, number>(ORDRE_AUTO.map((c) => [c, 0]));
  for (const c of dejaPrises) if (c && n.has(c)) n.set(c, n.get(c)! + 1);
  let best = ORDRE_AUTO[0];
  for (const c of ORDRE_AUTO) if (n.get(c)! < n.get(best)!) best = c;
  return best;
}
