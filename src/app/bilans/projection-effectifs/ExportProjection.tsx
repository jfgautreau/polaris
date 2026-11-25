"use client";

import { classeurXlsx, type FeuilleXlsx } from "@/lib/xlsx";
import { telechargerFichier, TYPE_XLSX } from "@/lib/telecharger";
import { BoutonExcel } from "@/app/bilans/BoutonsExport";

// Extraction Excel de la projection : un onglet par tableau de l'écran (bilan,
// postes, recrutements, formations, départs, saturation), filtre de service compris.
export default function ExportProjection({ feuilles, nomFichier }: { feuilles: FeuilleXlsx[]; nomFichier: string }) {
  return (
    <BoutonExcel
      onClick={() => telechargerFichier(classeurXlsx(feuilles), nomFichier, TYPE_XLSX)}
      title={`Télécharger la projection au format Excel (${feuilles.length} onglets)`}
    />
  );
}
