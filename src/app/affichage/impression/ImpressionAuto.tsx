"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PrintIcon } from "@/components/icons";

// Impression des services cochés : chaque atelier commence sur une nouvelle
// feuille A3 portrait, à la largeur de la page, et coule sur plusieurs feuilles
// si besoin (règles @media print de la page, comme l'écran TV). Plus de mise à
// l'échelle mesurée : le navigateur pagine tout seul.
const imprimer = () => window.print();

export default function ImpressionAuto() {
  // Lancement automatique de l'impression au chargement, après un court délai
  // pour laisser la mise en page (polices, tableaux) se stabiliser.
  useEffect(() => {
    const t = setTimeout(imprimer, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="noprint"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--border)" }}
    >
      <button
        type="button"
        onClick={imprimer}
        title="Imprimer / enregistrer en PDF (A3 portrait, chaque service sur une nouvelle page)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          background: "#fff",
          color: "#1d4ed8",
          border: "1px solid var(--border)",
          borderRadius: 9,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        <PrintIcon /> Imprimer
      </button>
      <Link href="/affichage" style={{ color: "#6b7280", textDecoration: "none" }}>
        ← Choix des services
      </Link>
    </div>
  );
}
