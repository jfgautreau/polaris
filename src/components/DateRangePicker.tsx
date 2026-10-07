"use client";

import { useState } from "react";
import {
  grilleMois, moisSuivant, moisPrecedent, clicPlage, etatCase, libelleMois,
  JOURS_COURTS, isoAujourdhui, STYLE_AUJOURDHUI, ANNEAU_AUJOURDHUI_SELECTION, type Plage,
} from "@/lib/calendrier";

// Calendrier de plage type « Booking » : deux clics (début puis fin), deux mois
// affichés côte à côte. La logique vit dans src/lib/calendrier.ts (testée) ; ce
// composant ne fait que peindre la grille et remonter la plage choisie.
export default function DateRangePicker({
  value,
  onChange,
  mois,
}: {
  value: Plage;
  onChange: (p: Plage) => void;
  // Nombre de mois affichés côte à côte (1 sur mobile, 2 par défaut).
  mois?: number;
}) {
  const nbMois = mois ?? 2;
  // Point d'ancrage de l'affichage : le mois du début choisi, sinon le mois courant.
  const ancre = value.debut ? new Date(value.debut + "T00:00") : new Date();
  const [an, setAn] = useState(ancre.getFullYear());
  const [m0, setM0] = useState(ancre.getMonth());

  const reculer = () => { const [a, m] = moisPrecedent(an, m0); setAn(a); setM0(m); };
  const avancer = () => { const [a, m] = moisSuivant(an, m0); setAn(a); setM0(m); };

  const moisAffiches = Array.from({ length: nbMois }, (_, i) => {
    let a = an, m = m0;
    for (let k = 0; k < i; k++) [a, m] = moisSuivant(a, m);
    return { a, m };
  });

  const styleEtat = (etat: ReturnType<typeof etatCase>): React.CSSProperties => {
    const base: React.CSSProperties = {
      height: 34,
      border: "none",
      background: "transparent",
      cursor: "pointer",
      fontSize: 14,
      color: "#1f2937",
      padding: 0,
      margin: 0,
      borderRadius: 0,
      width: "100%",
    };
    if (etat === "hors") return { ...base, color: "#cbd5e1", cursor: "default" };
    if (etat === "debut" || etat === "fin")
      return { ...base, background: "#2563eb", color: "#fff", fontWeight: 700, borderRadius: 8 };
    if (etat === "dans") return { ...base, background: "#eff2f7", fontWeight: 600 };
    return base;
  };
  const aujourdhui = isoAujourdhui();
  const styleCase = (etat: ReturnType<typeof etatCase>, estAuj: boolean): React.CSSProperties => {
    const s = styleEtat(etat);
    if (!estAuj || etat === "hors") return s;
    if (etat === "debut" || etat === "fin") return { ...s, boxShadow: ANNEAU_AUJOURDHUI_SELECTION };
    return { ...s, ...STYLE_AUJOURDHUI };
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "#fff", overflowX: "auto" }}>
      {/* nowrap dès qu'on affiche 2 mois : `flexWrap: wrap` les empilait au
          moindre pixel manquant. En cas de fenêtre trop étroite, l'overflow-x
          du conteneur prend le relais plutôt que de casser la ligne. */}
      <div style={{ display: "flex", gap: 20, flexWrap: nbMois > 1 ? "nowrap" : "wrap", justifyContent: "center" }}>
        {moisAffiches.map(({ a, m }, idx) => (
          <div key={`${a}-${m}`} style={{ width: 244, flex: "0 0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              {idx === 0 ? (
                <button type="button" onClick={reculer} aria-label="Mois précédent" style={navBtn}>‹</button>
              ) : <span style={{ width: 28 }} />}
              <strong style={{ fontSize: 15, textTransform: "capitalize" }}>{libelleMois(a, m)}</strong>
              {idx === moisAffiches.length - 1 ? (
                <button type="button" onClick={avancer} aria-label="Mois suivant" style={navBtn}>›</button>
              ) : <span style={{ width: 28 }} />}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  {JOURS_COURTS.map((j) => (
                    <th key={j} style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8", padding: "0 0 6px", textAlign: "center" }}>{j}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, sem) => (
                  <tr key={sem}>
                    {grilleMois(a, m).slice(sem * 7, sem * 7 + 7).map((c) => {
                      const etat = etatCase(c, value);
                      return (
                        <td key={c.iso} style={{ padding: 0, textAlign: "center" }}>
                          <button
                            type="button"
                            disabled={etat === "hors"}
                            onClick={() => onChange(clicPlage(value, c.iso))}
                            style={styleCase(etat, c.iso === aujourdhui)}
                            title={c.iso === aujourdhui ? `Aujourd’hui — ${c.iso.split("-").reverse().join("/")}` : c.iso.split("-").reverse().join("/")}
                          >
                            {c.jour}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 2px 0", textAlign: "center" }}>
        {!value.debut
          ? "Cliquez la date de début."
          : !value.fin
            ? "Cliquez la date de fin."
            : `${value.debut.split("-").reverse().join("/")} → ${value.fin.split("-").reverse().join("/")}`}
      </p>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  color: "#334155",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
};
