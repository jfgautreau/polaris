"use client";

import { classeurXlsx, type CelluleXlsx } from "@/lib/xlsx";
import { telechargerFichier, TYPE_XLSX } from "@/lib/telecharger";
import { BoutonExcel } from "@/app/bilans/BoutonsExport";

// Extraction Excel du bilan : mêmes lignes que l'écran (filtres compris), fichier
// .xlsx construit dans le navigateur — aucun aller-retour serveur.
export default function ExportRecyclages({
  colonnes,
  lignes,
  nomFichier,
}: {
  colonnes: { titre: string; largeur?: number }[];
  lignes: CelluleXlsx[][];
  nomFichier: string;
}) {
  return (
    <BoutonExcel
      onClick={() => telechargerFichier(classeurXlsx({ nom: "Recyclages", colonnes, lignes }), nomFichier, TYPE_XLSX)}
      disabled={lignes.length === 0}
      title={lignes.length === 0 ? "Aucune ligne à extraire" : `Télécharger ${lignes.length} ligne(s) au format Excel`}
    />
  );
}
