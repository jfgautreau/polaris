"use client";

import PastillesCouleur from "@/components/PastillesCouleur";

// Couleur d'une équipe : palette pastel (le texte de la grille reste lisible
// dessus). Le composant de pastilles est partagé (src/components/PastillesCouleur).
const PRESETS = [
  "#fecaca", "#fed7aa", "#fde68a", "#d9f99d", "#bbf7d0", "#a7f3d0",
  "#99f6e4", "#a5f3fc", "#bae6fd", "#bfdbfe", "#c7d2fe", "#ddd6fe",
  "#e9d5ff", "#f5d0fe", "#fbcfe8", "#fecdd3", "#e2e8f0", "#fef08a",
];

export default function TeamColorPicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  return <PastillesCouleur name={name} defaultValue={defaultValue || "#bfdbfe"} palette={PRESETS} colonnes={6} />;
}
