"use client";

import { useState } from "react";
import { PALETTE_COULEURS } from "@/components/PastillesCouleur";
import { texteSur } from "@/lib/couleur-texte";

// Couleurs d'un motif d'absence (Param. RH, 2026-11-27) : fond de la case, couleur
// du texte (0099 ; « Auto » = noir ou blanc selon le fond) et APERÇU du code tel
// qu'il s'affichera au Planning. Les deux valeurs partent avec le formulaire par
// des inputs cachés (reliés par `form=` en édition inline). Jamais
// d'<input type="color"> (cf. CLAUDE.md) : palettes de pastilles.

const TEXTES = ["#111827", "#ffffff", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#0e7490", "#1d4ed8", "#6d28d9", "#be185d"];
const FONDS = ["#111827", "#ffffff", ...PALETTE_COULEURS];

const pastille = (c: string, choisie: boolean): React.CSSProperties => ({
  boxSizing: "border-box",
  width: 20,
  height: 20,
  borderRadius: 5,
  background: c,
  border: "1px solid rgba(0,0,0,0.25)",
  outline: choisie ? "2px solid #111" : "none",
  outlineOffset: 1,
  cursor: "pointer",
  padding: 0,
  margin: 0,
});

export default function CouleursMotif({
  form,
  fondInitial,
  texteInitial,
  code,
  avecTexte,
}: {
  form?: string;
  fondInitial: string;
  texteInitial: string | null;
  code: string;
  // false tant que la migration 0099 n'est pas jouée : pas de choix du texte.
  avecTexte: boolean;
}) {
  const [fond, setFond] = useState(fondInitial || "#e5e7eb");
  const [texte, setTexte] = useState(texteInitial ?? "");
  const [ouvert, setOuvert] = useState<"" | "fond" | "texte">("");
  const meme = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const couleurTexte = texteSur(fond, texte);

  const volet: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 40,
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    padding: 8,
  };
  const declencheur: React.CSSProperties = { boxSizing: "border-box", height: 22, borderRadius: 5, border: "1px solid #94a3b8", cursor: "pointer", padding: 0, margin: 0 };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
      <input type="hidden" name="couleur" value={fond} form={form} />
      {avecTexte && <input type="hidden" name="couleur_texte" value={texte} form={form} />}
      <button type="button" onClick={() => setOuvert(ouvert === "fond" ? "" : "fond")} title="Couleur de la case" aria-label="Couleur de la case" style={{ ...declencheur, width: 34, background: fond }} />
      {avecTexte && (
        <button
          type="button"
          onClick={() => setOuvert(ouvert === "texte" ? "" : "texte")}
          title={texte ? "Couleur du texte" : "Couleur du texte : automatique (noir ou blanc selon la case)"}
          aria-label="Couleur du texte"
          style={{ ...declencheur, width: 26, background: "#fff", color: couleurTexte === "#ffffff" ? "#111827" : couleurTexte, fontWeight: 800, fontSize: 13, lineHeight: 1 }}
        >
          A
        </button>
      )}
      <span
        title="Aperçu : le code tel qu'il s'affiche au Planning"
        style={{ minWidth: 44, textAlign: "center", padding: "3px 8px", borderRadius: 4, background: fond, color: couleurTexte, fontSize: 12, border: "1px solid #cbd5e1" }}
      >
        {code || "Code"}
      </span>
      {ouvert !== "" && (
        <>
          <span onClick={() => setOuvert("")} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
          {ouvert === "fond" ? (
            <div role="listbox" aria-label="Couleur de la case" style={{ ...volet, display: "grid", gridTemplateColumns: "repeat(12, 20px)", gap: 5 }}>
              {FONDS.map((c) => (
                <button key={c} type="button" role="option" aria-selected={meme(fond, c)} title={c} aria-label={`Couleur ${c}`} onClick={() => { setFond(c); setOuvert(""); }} style={pastille(c, meme(fond, c))} />
              ))}
            </div>
          ) : (
            <div role="listbox" aria-label="Couleur du texte" style={{ ...volet, display: "flex", alignItems: "center", gap: 5 }}>
              <button
                type="button"
                role="option"
                aria-selected={texte === ""}
                title="Automatique : noir ou blanc, selon la couleur de la case"
                onClick={() => { setTexte(""); setOuvert(""); }}
                style={{ ...pastille("#fff", texte === ""), width: "auto", padding: "0 6px", color: "#111827", fontSize: 11, fontWeight: 600 }}
              >
                Auto
              </button>
              {TEXTES.map((c) => (
                <button key={c} type="button" role="option" aria-selected={meme(texte, c)} title={c} aria-label={`Texte ${c}`} onClick={() => { setTexte(c); setOuvert(""); }} style={pastille(c, meme(texte, c))} />
              ))}
            </div>
          )}
        </>
      )}
    </span>
  );
}
