// Couleur d'une ligne de production (`ligne.couleur`, migration 0082).
//
// Sert aux PDF du Placement : une ligne qui tourne (au moins une personne
// placée) prend sa couleur — liseré, bandeau pâle sur le nom des postes, nom
// foncé. Choisie au Référentiel dans cette palette fermée (pas de sélecteur
// libre) ; seule la teinte de base est stockée, le pâle et le foncé s'en
// déduisent ici.
//
// Ni rouge, ni orange, ni vert : sur la feuille, ces trois teintes disent déjà
// « manque », « surnombre », « complet ». Les huit premières sont celles de
// l'attribution automatique d'origine (migration 0082, même ordre).

export type CouleurLigne = { lc: string; pale: string; dark: string; nom: string };

export const LIGNE_COULEURS: CouleurLigne[] = [
  { lc: "#2557c7", pale: "#dfe8fb", dark: "#183c8c", nom: "Bleu" },
  { lc: "#7a3fc4", pale: "#ece2f9", dark: "#552a8c", nom: "Violet" },
  { lc: "#0f7a8a", pale: "#d9f0f2", dark: "#0b5560", nom: "Bleu canard" },
  { lc: "#b3307a", pale: "#f8e1ee", dark: "#7f1f56", nom: "Framboise" },
  { lc: "#4338ca", pale: "#e3e1fb", dark: "#2f2791", nom: "Indigo" },
  { lc: "#8a5a2b", pale: "#f2e7da", dark: "#5f3d1c", nom: "Brun" },
  { lc: "#0369a1", pale: "#dbeefa", dark: "#024a72", nom: "Azur" },
  { lc: "#86198f", pale: "#f5e0f7", dark: "#5e1164", nom: "Prune" },
  { lc: "#1e3a8a", pale: "#dbe4f7", dark: "#172c69", nom: "Marine" },
  { lc: "#475569", pale: "#e2e8f0", dark: "#334155", nom: "Ardoise" },
];

const PAR_CODE = new Map(LIGNE_COULEURS.map((c) => [c.lc, c]));

export const estCouleurLigne = (v: unknown): v is string => typeof v === "string" && PAR_CODE.has(v.toLowerCase());

/** Couleur d'une ligne ; sans couleur enregistrée (ou inconnue), repli sur son rang. */
export function couleurDeLigne(couleur: string | null | undefined, rang: number): CouleurLigne {
  return (couleur && PAR_CODE.get(couleur.toLowerCase())) || LIGNE_COULEURS[rang % LIGNE_COULEURS.length];
}

/** Pour une nouvelle ligne : la teinte la moins utilisée parmi les lignes du service. */
export function couleurLibre(dejaPrises: (string | null)[]): string {
  const n = new Map<string, number>(LIGNE_COULEURS.map((c) => [c.lc, 0]));
  for (const c of dejaPrises) if (c && n.has(c)) n.set(c, n.get(c)! + 1);
  let best = LIGNE_COULEURS[0].lc;
  for (const c of LIGNE_COULEURS) if (n.get(c.lc)! < n.get(best)!) best = c.lc;
  return best;
}
