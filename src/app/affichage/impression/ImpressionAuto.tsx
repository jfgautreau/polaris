"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PrintIcon } from "@/components/icons";

// Impression des services cochés : une feuille A3 portrait par section (Matin,
// Après-midi, Nuit) de chaque service, mise à l'échelle au `beforeprint`
// (FeuillesImpression).
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
        title="Imprimer / enregistrer en PDF (A3 portrait, une page par section de chaque service)"
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
      {/* Retour à l'écran de base, sans le bouton Précédent du navigateur. */}
      <Link
        href="/affichage"
        prefetch={false}
        title="Revenir au choix des services (menu Affichage)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          background: "#fff",
          color: "#1d4ed8",
          border: "1px solid var(--border)",
          borderRadius: 9,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>&lsaquo;</span> Choix des services
      </Link>
    </div>
  );
}
