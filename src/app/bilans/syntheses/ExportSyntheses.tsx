"use client";

import { documentPdf } from "@/lib/pdf";
import { classeurXlsx } from "@/lib/xlsx";
import { nomFichierSur, telechargerFichier, TYPE_PDF, TYPE_XLSX } from "@/lib/telecharger";
import { pdfAbsences, pdfInterim, xlsxAbsences, xlsxInterim, type ColonneAbsence, type JourExport } from "@/lib/syntheses-export";
import type { Absences4, GroupeAgence } from "@/lib/synthese-data";
import { BoutonExcel, BoutonPdf } from "@/app/bilans/BoutonsExport";

// Boutons PDF / Excel des Synthèses : fichiers construits dans le navigateur à
// partir des données déjà affichées (filtres compris).
type Props =
  | { vue: "interim"; groupes: GroupeAgence[]; jours: JourExport[]; semaineLabel: string }
  | { vue: "absences"; abs: Absences4; colonnes: ColonneAbsence[]; rangeLabel: string; filtres: string };

export default function ExportSyntheses(props: Props) {
  if (props.vue === "interim") {
    const { groupes, jours, semaineLabel } = props;
    const sem = nomFichierSur(semaineLabel.split(" ")[0]);
    const vide = groupes.length === 0;
    return (
      <>
        <BoutonPdf
          disabled={vide}
          title="Télécharger le PDF de toutes les agences (une agence par page)"
          onClick={() => telechargerFichier(documentPdf(pdfInterim(groupes, jours, semaineLabel)), `interim-${sem}.pdf`, TYPE_PDF)}
        />
        <BoutonExcel
          disabled={vide}
          title="Télécharger le planning des intérimaires (toutes agences) au format Excel"
          onClick={() => telechargerFichier(classeurXlsx(xlsxInterim(groupes, jours, semaineLabel)), `interim-${sem}.xlsx`, TYPE_XLSX)}
        />
      </>
    );
  }
  const { abs, colonnes, rangeLabel, filtres } = props;
  const nom = `absences-${nomFichierSur(rangeLabel.replace("→", "a"))}`;
  const vide = abs.lignes.length === 0;
  return (
    <>
      <BoutonPdf
        disabled={vide}
        title="Télécharger le PDF des absences sur 4 semaines"
        onClick={() => telechargerFichier(documentPdf(pdfAbsences(abs, colonnes, rangeLabel, filtres)), `${nom}.pdf`, TYPE_PDF)}
      />
      <BoutonExcel
        disabled={vide}
        title="Télécharger les absences sur 4 semaines au format Excel (avec l'onglet « Par motif »)"
        onClick={() => telechargerFichier(classeurXlsx(xlsxAbsences(abs, colonnes)), `${nom}.xlsx`, TYPE_XLSX)}
      />
    </>
  );
}

// Export d'UNE agence (bouton dans son bloc) : le fichier à lui envoyer.
export function ExportAgence({ groupe, jours, semaineLabel }: { groupe: GroupeAgence; jours: JourExport[]; semaineLabel: string }) {
  const nom = `interim-${nomFichierSur(semaineLabel.split(" ")[0])}-${nomFichierSur(groupe.agence)}`;
  return (
    <span className="noprint" style={{ display: "inline-flex", gap: 6 }}>
      <BoutonPdf
        compact
        libelle="PDF agence"
        title={`Télécharger le PDF de l'agence ${groupe.agence}`}
        onClick={() => telechargerFichier(documentPdf(pdfInterim([groupe], jours, semaineLabel)), `${nom}.pdf`, TYPE_PDF)}
      />
      <BoutonExcel
        compact
        libelle="Excel agence"
        title={`Télécharger le planning de l'agence ${groupe.agence} au format Excel`}
        onClick={() => telechargerFichier(classeurXlsx(xlsxInterim([groupe], jours, semaineLabel)), `${nom}.xlsx`, TYPE_XLSX)}
      />
    </span>
  );
}
