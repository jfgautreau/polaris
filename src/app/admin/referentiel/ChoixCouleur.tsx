"use client";

import { useEffect, useState } from "react";

// Choix d'une couleur dans une palette FERMÉE de petites pastilles, nom en
// info-bulle — jamais d'<input type="color">. Le volet s'ouvre en
// `position: fixed` (la page du Référentiel défile) et se ferme au clic ailleurs
// ou au défilement. Sert à la couleur d'une ligne (PDF du Placement, 0082) et à
// celle d'un service (Excel intérim, 0093 — « Aucune » possible).
export type Teinte = { code: string; nom: string };

export default function ChoixCouleur({
  libelle,
  titre,
  palette,
  actuelle,
  onChange,
  aucune = false,
}: {
  libelle: string;
  titre: string; // « Couleur de la ligne sur les PDF du Placement »
  palette: Teinte[];
  actuelle: Teinte | null;
  onChange: (code: string | null) => void;
  aucune?: boolean; // propose « Aucune couleur »
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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

  const pastille = (fond: string | null, taille: number): React.CSSProperties => ({
    boxSizing: "border-box",
    width: taille,
    height: taille,
    padding: 0,
    margin: 0,
    borderRadius: 5,
    background: fond ?? "repeating-linear-gradient(45deg, #fff 0 3px, #e2e8f0 3px 6px)",
    cursor: "pointer",
  });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }}>
      {libelle}
      <button
        type="button"
        title={`${titre} : ${actuelle?.nom ?? "aucune"}`}
        aria-label={`${titre} : ${actuelle?.nom ?? "aucune"}`}
        onClick={(e) => {
          if (pos) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 4, left: r.left });
        }}
        style={{ ...pastille(actuelle?.code ?? null, 22), border: "2px solid #fff", boxShadow: "0 0 0 1px #94a3b8" }}
      />
      {pos && (
        <>
          <span onClick={() => setPos(null)} style={{ position: "fixed", inset: 0, zIndex: 59 }} />
          <div
            role="listbox"
            aria-label={titre}
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
            {aucune && (
              <button
                type="button"
                role="option"
                aria-selected={!actuelle}
                title="Aucune couleur"
                aria-label="Aucune couleur"
                onClick={() => {
                  setPos(null);
                  if (actuelle) onChange(null);
                }}
                style={{ ...pastille(null, 20), border: "1px solid #cbd5e1", outline: !actuelle ? "2px solid #111" : "none", outlineOffset: 2 }}
              />
            )}
            {palette.map((c) => {
              const sel = c.code === actuelle?.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  title={c.nom}
                  aria-label={c.nom}
                  onClick={() => {
                    setPos(null);
                    if (!sel) onChange(c.code);
                  }}
                  style={{ ...pastille(c.code, 20), border: "1px solid rgba(0,0,0,0.08)", outline: sel ? "2px solid #111" : "none", outlineOffset: 2 }}
                />
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}
