"use client";

import { useEffect, useState } from "react";
import { LIGNE_COULEURS, couleurDeLigne } from "@/lib/ligne-couleurs";

// Couleur d'une ligne sur les PDF du Placement (0082). Palette fermée de
// petites pastilles, nom en info-bulle — jamais d'<input type="color">. Le
// volet s'ouvre en `position: fixed` (la page du Référentiel défile) et se
// ferme au clic ailleurs ou au défilement.
export default function CouleurLigne({
  couleur,
  rang,
  onChange,
}: {
  couleur: string | null;
  rang: number;
  onChange: (c: string) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const actuelle = couleurDeLigne(couleur, rang);

  useEffect(() => {
    if (!pos) return;
    const fermer = () => setPos(null);
    window.addEventListener("scroll", fermer, true);
    window.addEventListener("resize", fermer);
    return () => {
      window.removeEventListener("scroll", fermer, true);
      window.removeEventListener("resize", fermer);
    };
  }, [pos]);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }}>
      Couleur
      <button
        type="button"
        title={`Couleur de la ligne sur les PDF du Placement : ${actuelle.nom}`}
        aria-label={`Couleur de la ligne : ${actuelle.nom}`}
        onClick={(e) => {
          if (pos) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 4, left: r.left });
        }}
        style={{
          boxSizing: "border-box",
          width: 22,
          height: 22,
          padding: 0,
          margin: 0,
          borderRadius: 5,
          background: actuelle.lc,
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px #94a3b8",
          cursor: "pointer",
        }}
      />
      {pos && (
        <>
          <span onClick={() => setPos(null)} style={{ position: "fixed", inset: 0, zIndex: 59 }} />
          <div
            role="listbox"
            aria-label="Couleur de la ligne"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 60,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              padding: 8,
              display: "grid",
              gridTemplateColumns: "repeat(7, 20px)",
              gap: 6,
            }}
          >
            {LIGNE_COULEURS.map((c) => {
              const sel = c.lc === actuelle.lc;
              return (
                <button
                  key={c.lc}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  title={c.nom}
                  onClick={() => {
                    setPos(null);
                    if (!sel) onChange(c.lc);
                  }}
                  aria-label={c.nom}
                  style={{
                    boxSizing: "border-box",
                    width: 20,
                    height: 20,
                    padding: 0,
                    margin: 0,
                    borderRadius: 5,
                    background: c.lc,
                    border: "none",
                    outline: sel ? "2px solid #111" : "none",
                    outlineOffset: 2,
                    cursor: "pointer",
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}
