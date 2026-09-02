"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PrintIcon } from "@/components/icons";

// Impression « tous les plannings » : chaque atelier occupe UNE page A3
// verticale. Comme sur l'écran TV (AffichageBarre) et au Placement, aucune règle
// CSS ne sait « faire rentrer » un contenu — on mesure puis on met à l'échelle.
// A3 portrait à 96 dpi, marges 8 mm : 1060 x 1525 px utiles.
const PAGE_L = 1060;
const PAGE_H = 1525;

// ⚠️ Échelle UNIFORME entre les pages : à l'inverse de l'écran TV (une seule
// feuille, mise à l'échelle au mieux), on veut ici la MÊME taille de police d'un
// atelier à l'autre. Chaque bloc est rendu à la largeur exacte de la page
// (PAGE_L), puis on applique à TOUS le même facteur = le plus petit qui fasse
// tenir la page la plus haute. Plafonné à 1.0 : on ne grossit jamais au-delà de
// la taille naturelle (police plus compacte, jamais gonflée).
function ajusterEtImprimer() {
  const blocs = Array.from(document.querySelectorAll<HTMLElement>(".atelier-contenu"));
  for (const el of blocs) {
    el.style.transformOrigin = "top left";
    el.style.transform = "none";
    el.style.width = `${PAGE_L}px`;
  }
  // Facteur commun : la page la plus dense impose l'échelle de toutes les autres.
  let f = 1;
  for (const el of blocs) f = Math.min(f, PAGE_H / el.scrollHeight);
  for (const el of blocs) el.style.transform = `scale(${f})`;
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
