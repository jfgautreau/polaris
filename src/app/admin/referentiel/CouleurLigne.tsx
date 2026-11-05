"use client";

import { LIGNE_COULEURS, couleurDeLigne } from "@/lib/ligne-couleurs";
import ChoixCouleur from "./ChoixCouleur";

// Couleur d'une ligne sur les PDF du Placement (0082) : palette fermée de
// `ligne-couleurs.ts`, attribution automatique par rang si la ligne n'en a pas.
const PALETTE = LIGNE_COULEURS.map((c) => ({ code: c.lc, nom: c.nom }));

export default function CouleurLigne({
  couleur,
  rang,
  onChange,
}: {
  couleur: string | null;
  rang: number;
  onChange: (c: string) => void;
}) {
  const c = couleurDeLigne(couleur, rang);
  return (
    <ChoixCouleur
      libelle="Couleur"
      titre="Couleur de la ligne sur les PDF du Placement"
      palette={PALETTE}
      actuelle={{ code: c.lc, nom: c.nom }}
      onChange={(code) => code && onChange(code)}
    />
  );
}
