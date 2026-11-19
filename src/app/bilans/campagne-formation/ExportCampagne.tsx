"use client";

import { classeurXlsx, type FeuilleXlsx } from "@/lib/xlsx";
import { telechargerFichier, TYPE_XLSX } from "@/lib/telecharger";
import { BoutonExcel } from "@/app/bilans/BoutonsExport";

// Extraction Excel : un onglet « Formés », un onglet « Non formés » — mêmes lignes
// que l'écran (filtres compris), construit dans le navigateur.
export default function ExportCampagne({ feuilles, nomFichier }: { feuilles: FeuilleXlsx[]; nomFichier: string }) {
  const n = feuilles.reduce((s, f) => s + f.lignes.length, 0);
  return (
    <BoutonExcel
      onClick={() => telechargerFichier(classeurXlsx(feuilles), nomFichier, TYPE_XLSX)}
      disabled={n === 0}
      title={n === 0 ? "Aucune ligne à extraire" : `Télécharger ${n} ligne(s) au format Excel (deux onglets)`}
    />
  );
}
