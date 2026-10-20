"use client";

import { classeurXlsx, type CelluleXlsx } from "@/lib/xlsx";

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
  function telecharger() {
    const octets = classeurXlsx({ nom: "Recyclages", colonnes, lignes });
    const blob = new Blob([octets as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      type="button"
      onClick={telecharger}
      disabled={lignes.length === 0}
      title={lignes.length === 0 ? "Aucune ligne à extraire" : `Télécharger ${lignes.length} ligne(s) au format Excel`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 38,
        padding: "0 14px",
        margin: 0,
        borderRadius: 9,
        border: "1px solid #15803d",
        background: "#16a34a",
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        cursor: lignes.length === 0 ? "default" : "pointer",
        opacity: lignes.length === 0 ? 0.5 : 1,
        whiteSpace: "nowrap",
        width: "auto",
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Excel
    </button>
  );
}
