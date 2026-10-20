"use client";

// Boutons d'export des rapports : « PDF » (télécharge un vrai fichier PDF, cf.
// src/lib/pdf.ts — pas le dialogue d'impression) et « Excel » (.xlsx, cf.
// src/lib/xlsx.ts). Même gabarit que les actions de ReportActions ; `compact`
// pour les boutons répétés dans la page (un par agence…).

type Props = { onClick: () => void; disabled?: boolean; libelle?: string; title?: string; compact?: boolean };

const base = (compact: boolean, disabled: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: compact ? 32 : 38,
  padding: compact ? "0 12px" : "0 14px",
  margin: 0,
  width: "auto",
  borderRadius: compact ? 8 : 9,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

export function BoutonPdf({ onClick, disabled = false, libelle = "PDF", title, compact = false }: Props) {
  return (
    <button
      type="button"
      className="noprint"
      onClick={onClick}
      disabled={disabled}
      title={title ?? "Télécharger le fichier PDF"}
      style={{ ...base(compact, disabled), border: "1px solid var(--border)", background: "#fff", color: "#1d4ed8" }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M12 11v6" />
        <path d="m9.5 14.5 2.5 2.5 2.5-2.5" />
      </svg>
      {libelle}
    </button>
  );
}

export function BoutonExcel({ onClick, disabled = false, libelle = "Excel", title, compact = false }: Props) {
  return (
    <button
      type="button"
      className="noprint"
      onClick={onClick}
      disabled={disabled}
      title={title ?? "Télécharger le fichier Excel"}
      style={{ ...base(compact, disabled), border: "1px solid #15803d", background: "#16a34a", color: "#fff" }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      {libelle}
    </button>
  );
}
