"use client";

import { useState } from "react";

// Choix d'une couleur dans une palette de pastilles prédéfinies — jamais
// d'<input type="color"> (la boîte de dialogue du système fait planter l'onglet,
// cf. CLAUDE.md). La valeur part avec le formulaire par un input caché (relié
// par `form=` pour l'édition inline des écrans de paramétrage).
//
// Le volet s'ouvre en `position: absolute` sous la pastille : il doit rester
// juste en dessous même dans une modale déplaçable (un ancêtre transformé
// fausserait un `position: fixed`).

// Palette par défaut : pâle, moyen, soutenu, de teinte en teinte, puis neutres.
export const PALETTE_COULEURS = [
  "#fecaca", "#fed7aa", "#fde68a", "#d9f99d", "#bbf7d0", "#a5f3fc", "#bfdbfe", "#ddd6fe", "#f5d0fe", "#fbcfe8", "#e2e8f0", "#e7e5e4",
  "#f87171", "#fb923c", "#facc15", "#a3e635", "#4ade80", "#22d3ee", "#60a5fa", "#a78bfa", "#e879f9", "#f472b6", "#94a3b8", "#a8a29e",
  "#b91c1c", "#c2410c", "#a16207", "#4d7c0f", "#15803d", "#0e7490", "#1d4ed8", "#6d28d9", "#a21caf", "#be185d", "#475569", "#57534e",
];

export default function PastillesCouleur({
  name,
  defaultValue,
  form,
  palette = PALETTE_COULEURS,
  colonnes = 12,
}: {
  name: string;
  defaultValue: string;
  form?: string;
  palette?: string[];
  colonnes?: number;
}) {
  const [val, setVal] = useState(defaultValue || palette[0]);
  const [ouvert, setOuvert] = useState(false);
  const estChoisie = (c: string) => val.toLowerCase() === c.toLowerCase();

  return (
    <span style={{ position: "relative", display: "inline-block", verticalAlign: "middle" }}>
      <input type="hidden" name={name} value={val} form={form} />
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        title="Choisir une couleur"
        aria-label="Choisir une couleur"
        aria-expanded={ouvert}
        style={{
          boxSizing: "border-box",
          width: 34,
          height: 22,
          borderRadius: 5,
          background: val,
          border: "1px solid #94a3b8",
          cursor: "pointer",
          padding: 0,
          margin: 0,
        }}
      />
      {ouvert && (
        <>
          <span onClick={() => setOuvert(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
          <div
            role="listbox"
            aria-label="Palette de couleurs"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 40,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              padding: 8,
              display: "grid",
              gridTemplateColumns: `repeat(${colonnes}, 20px)`,
              gap: 5,
            }}
          >
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={estChoisie(c)}
                aria-label={`Couleur ${c}`}
                title={c}
                onClick={() => {
                  setVal(c);
                  setOuvert(false);
                }}
                style={{
                  boxSizing: "border-box",
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: c,
                  border: "1px solid rgba(0,0,0,0.12)",
                  outline: estChoisie(c) ? "2px solid #111" : "none",
                  outlineOffset: 1,
                  cursor: "pointer",
                  padding: 0,
                  margin: 0,
                }}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}
