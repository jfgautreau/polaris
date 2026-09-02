"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PrintIcon } from "@/components/icons";

// Impression « tous les plannings » : chaque atelier occupe UNE page A3
// verticale. Comme sur l'écran TV (AffichageBarre) et au Placement, aucune règle
// CSS ne sait « faire rentrer » un contenu — on mesure puis on met à l'échelle,
// bloc par bloc. A3 portrait à 96 dpi, marges 8 mm : 1060 x 1525 px utiles.
const PAGE_L = 1060;
const PAGE_H = 1525;
const LARGEURS_ESSAI = [700, 820, 940, 1060, 1300, 1600, 1900];
const ECHELLE_MAX = 1.6;

function ajusterEtImprimer() {
  const pages = Array.from(document.querySelectorAll<HTMLElement>(".atelier-contenu"));
  for (const el of pages) {
    el.style.transformOrigin = "top left";
    el.style.transform = "none";
    let meilleur = { f: 0, w: PAGE_L };
    for (const w of LARGEURS_ESSAI) {
      el.style.width = `${w}px`;
      const f = Math.min(ECHELLE_MAX, PAGE_L / w, PAGE_H / el.scrollHeight);
      if (f > meilleur.f) meilleur = { f, w };
    }
    el.style.width = `${meilleur.w}px`;
    el.style.transform = `scale(${meilleur.f})`;
  }
  window.print();
}

export default function ImpressionAuto() {
  // Lancement automatique de l'impression au chargement. On laisse un court délai
  // pour que la mise en page (polices, tableaux) soit stabilisée avant de mesurer.
  useEffect(() => {
    const t = setTimeout(ajusterEtImprimer, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="noprint"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--border)" }}
    >
      <button
        type="button"
        onClick={ajusterEtImprimer}
        title="Imprimer / enregistrer en PDF (une page A3 par atelier)"
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
        <PrintIcon /> Imprimer tous les plannings
      </button>
      <Link href="/planning" style={{ color: "#6b7280", textDecoration: "none" }}>
        ← Retour au planning
      </Link>
    </div>
  );
}
