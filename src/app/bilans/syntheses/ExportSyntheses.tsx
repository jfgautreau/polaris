"use client";

import { useState } from "react";
import { documentPdf } from "@/lib/pdf";
import { classeurXlsx } from "@/lib/xlsx";
import { nomFichierSur, telechargerFichier, TYPE_PDF, TYPE_XLSX } from "@/lib/telecharger";
import {
  pdfAbsences,
  pdfInterim,
  photoInterim,
  xlsxAbsences,
  xlsxInterim,
  type ColonneAbsence,
  type ComparaisonInterim,
  type JourExport,
} from "@/lib/syntheses-export";
import { nomFichierInterim } from "@/lib/nom-fichier-interim";
import type { Absences4, GroupeAgence } from "@/lib/synthese-data";
import { BoutonExcel, BoutonPdf } from "@/app/bilans/BoutonsExport";

// Contexte du nom des fichiers Excel intérim (forme réglée dans Param. RH, 0093).
export type ContexteFichierInterim = { forme: string | null; site: string; semaine: number; annee: number; lundi: string };

// Boutons PDF / Excel des Synthèses : fichiers construits dans le navigateur à
// partir des données déjà affichées (filtres compris).
// `nomApp` : nom de l'application du site (0095), imprimé au pied des PDF.
type Props = { nomApp: string } & (
  | { vue: "interim"; groupes: GroupeAgence[]; jours: JourExport[]; semaineLabel: string; fichier: ContexteFichierInterim }
  | { vue: "absences"; abs: Absences4; colonnes: ColonneAbsence[]; rangeLabel: string; filtres: string }
);

const nomExcel = (f: ContexteFichierInterim, agence: string, maintenant: Date) =>
  nomFichierInterim(f.forme, { agence, semaine: f.semaine, annee: f.annee, site: f.site, maintenant });

export default function ExportSyntheses(props: Props) {
  if (props.vue === "interim") {
    const { groupes, jours, semaineLabel, fichier, nomApp } = props;
    const sem = nomFichierSur(semaineLabel.split(" ")[0]);
    const vide = groupes.length === 0;
    return (
      <>
        <BoutonPdf
          disabled={vide}
          title="Télécharger le PDF de toutes les agences (une agence par page)"
          onClick={() => telechargerFichier(documentPdf(pdfInterim(groupes, jours, semaineLabel, undefined, nomApp)), `interim-${sem}.pdf`, TYPE_PDF)}
        />
        <BoutonExcel
          disabled={vide}
          title="Télécharger le planning des intérimaires (toutes agences) au format Excel, horodaté"
          onClick={() => {
            const maintenant = new Date();
            telechargerFichier(classeurXlsx(xlsxInterim(groupes, jours, semaineLabel, { maintenant })), nomExcel(fichier, "toutes agences", maintenant), TYPE_XLSX);
          }}
        />
      </>
    );
  }
  const { abs, colonnes, rangeLabel, filtres, nomApp } = props;
  const nom = `absences-${nomFichierSur(rangeLabel.replace("→", "a"))}`;
  const vide = abs.lignes.length === 0;
  return (
    <>
      <BoutonPdf
        disabled={vide}
        title="Télécharger le PDF des absences sur 4 semaines"
        onClick={() => telechargerFichier(documentPdf(pdfAbsences(abs, colonnes, rangeLabel, filtres, undefined, nomApp)), `${nom}.pdf`, TYPE_PDF)}
      />
      <BoutonExcel
        disabled={vide}
        title="Télécharger les absences sur 4 semaines au format Excel (avec l'onglet « Par motif »)"
        onClick={() => telechargerFichier(classeurXlsx(xlsxAbsences(abs, colonnes)), `${nom}.xlsx`, TYPE_XLSX)}
      />
    </>
  );
}

// Mémorise l'extraction (photo) et rend la précédente pour la comparaison. Ne
// lève jamais : un échec rend « indisponible » et son message.
async function comparerExtraction(agence: string, lundi: string, photo: ReturnType<typeof photoInterim>): Promise<{ comparaison: ComparaisonInterim; erreur: string | null }> {
  const res = await fetch("/api/syntheses/extraction-interim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agence, semaine_lundi: lundi, photo }),
  }).catch(() => null);
  if (!res) return { comparaison: { etat: "indisponible" }, erreur: "Serveur injoignable : fichier sans surlignage." };
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) return { comparaison: { etat: "indisponible" }, erreur: `${j?.error ?? "Comparaison impossible."} Fichier sans surlignage.` };
  return { comparaison: { etat: "ok", precedente: j.precedente ?? null, retires: j.retires ?? [] }, erreur: null };
}

// Export d'UNE agence (bouton dans son bloc) : le fichier à lui envoyer. L'Excel
// est horodaté et comparé à la dernière extraction de la même agence pour la
// même semaine (cases changées en jaune fluo).
export function ExportAgence({
  groupe,
  jours,
  semaineLabel,
  fichier,
  nomApp,
}: {
  groupe: GroupeAgence;
  jours: JourExport[];
  semaineLabel: string;
  fichier: ContexteFichierInterim;
  nomApp: string;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const nomPdf = `interim-${nomFichierSur(semaineLabel.split(" ")[0])}-${nomFichierSur(groupe.agence)}`;

  async function excel() {
    setEnCours(true);
    setErreur(null);
    const { comparaison, erreur: e } = await comparerExtraction(groupe.agence, fichier.lundi, photoInterim(groupe, jours));
    const maintenant = new Date();
    telechargerFichier(
      classeurXlsx(xlsxInterim([groupe], jours, semaineLabel, { maintenant, comparaison })),
      nomExcel(fichier, groupe.agence, maintenant),
      TYPE_XLSX,
    );
    setErreur(e);
    setEnCours(false);
  }

  return (
    <span className="noprint" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {erreur && <span role="alert" style={{ color: "#991b1b", fontSize: 12, fontWeight: 600 }}>{erreur}</span>}
      <BoutonPdf
        compact
        libelle="PDF agence"
        title={`Télécharger le PDF de l'agence ${groupe.agence}`}
        onClick={() => telechargerFichier(documentPdf(pdfInterim([groupe], jours, semaineLabel, undefined, nomApp)), `${nomPdf}.pdf`, TYPE_PDF)}
      />
      <BoutonExcel
        compact
        disabled={enCours}
        libelle={enCours ? "Excel…" : "Excel agence"}
        title={`Télécharger le planning de l'agence ${groupe.agence} au format Excel : horodaté, cases modifiées depuis la dernière extraction en jaune fluo`}
        onClick={() => void excel()}
      />
    </span>
  );
}
