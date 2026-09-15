"use client";

import Link from "next/link";

// Actions communes a tous les rapports : retour au cockpit et impression.
// Deux boutons de meme gabarit, masques a l'impression.
const TAILLE = 38;

const boite: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  height: TAILLE,
  padding: "0 14px",
  margin: 0,
  borderRadius: 9,
  border: "1px solid var(--border)",
  // Fond clair : la couleur du texte doit etre posee explicitement, le style
  // global des boutons impose du blanc (cf. CLAUDE.md).
  background: "#fff",
  color: "var(--text)",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function ReportActions({ children }: { children?: React.ReactNode }) {
  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {children}

      <Link href="/bilans" style={boite} title="Revenir au cockpit des rapports">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
        Cockpit
      </Link>

      {/* Bouton « PDF » explicite : ouvre le même dialogue d'impression (Chrome
          propose « Enregistrer au format PDF » comme destination). Beaucoup
          d'utilisateurs ne reconnaissent pas l'icône imprimante comme un export
          PDF — le libellé lève l'ambiguïté. */}
      <button
        type="button"
        onClick={() => window.print()}
        title="Enregistrer en PDF (dialogue d'impression → destination « PDF »)"
        style={{ ...boite, color: "#1d4ed8" }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        PDF
      </button>

      <button
        type="button"
        onClick={() => window.print()}
        title="Imprimer / enregistrer en PDF"
        aria-label="Imprimer"
        style={{ ...boite, width: TAILLE, padding: 0, color: "#1d4ed8" }}
      >
        {/* Meme imprimante que l'ecran Affichage : capot, corps, feuille. */}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 9V3h10v6" />
          <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
          <rect x="7" y="15" width="10" height="6" rx="1" />
        </svg>
      </button>
    </div>
  );
}
