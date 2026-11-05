// Couleur pastel d'un service (`atelier.couleur`, migration 0093).
//
// Sert à l'Excel agence des Synthèses intérim : chaque case du jour prend la
// couleur du service du poste tenu ce jour-là. Choisie au Référentiel dans cette
// palette fermée (jamais de sélecteur libre). Teintes claires, lisibles sous un
// texte noir et à l'impression.
//
// Pas de jaune : le jaune signale l'intérim, et le jaune fluo les cases modifiées
// depuis la dernière extraction (cf. syntheses-export.ts).

export type CouleurService = { code: string; nom: string };

export const SERVICE_COULEURS: CouleurService[] = [
  { code: "#dbeafe", nom: "Bleu" },
  { code: "#e0f2fe", nom: "Ciel" },
  { code: "#cffafe", nom: "Turquoise" },
  { code: "#ccfbf1", nom: "Menthe" },
  { code: "#dcfce7", nom: "Vert" },
  { code: "#e2efda", nom: "Sauge" },
  { code: "#ffedd5", nom: "Pêche" },
  { code: "#fee2e2", nom: "Corail" },
  { code: "#fce7f3", nom: "Rose" },
  { code: "#f3e8ff", nom: "Lilas" },
  { code: "#ede9fe", nom: "Lavande" },
  { code: "#f5ebe0", nom: "Sable" },
  { code: "#e5e7eb", nom: "Gris" },
];

const PAR_CODE = new Map(SERVICE_COULEURS.map((c) => [c.code, c]));

/** Couleur de la palette (insensible à la casse), sinon false. */
export function estCouleurService(v: unknown): v is string {
  return typeof v === "string" && PAR_CODE.has(v.toLowerCase());
}

/** Couleur enregistrée → entrée de la palette ; null si vide ou hors palette. */
export function couleurDeService(code: string | null | undefined): CouleurService | null {
  return code ? PAR_CODE.get(code.toLowerCase()) ?? null : null;
}
