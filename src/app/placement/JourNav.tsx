"use client";

import { useMemo, useState } from "react";
import { grilleMois, moisSuivant, moisPrecedent, libelleMois, JOURS_COURTS } from "@/lib/calendrier";
import s from "./placement.module.css";

// Navigation par jour du Placement :
//  - les flèches ◀ / ▶ SAUTENT les jours sans ligne ouverte (elles vont au jour
//    ouvert précédent / suivant ; à défaut, ±1 jour pour ne jamais bloquer) ;
//  - le calendrier déroulant GRISE (désactive) les jours sans ligne ouverte.
// « Jour ouvert » = jour fourni par le serveur dans `openDays` (au moins une
// ligne de l'atelier ouverte sur le quart courant), calculé sur une fenêtre
// [winStart, winEnd] à laquelle la navigation du calendrier est bornée.

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtCourt = (iso: string) => {
  const d = new Date(iso + "T00:00");
  const jc = JOURS_COURTS[(d.getDay() + 6) % 7];
  return `${jc} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const keyMois = (a: number, m0: number) => a * 12 + m0;
const keyIso = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
};

export default function JourNav({
  jour,
  openDays,
  winStart,
  winEnd,
  onPick,
}: {
  jour: string;
  openDays: string[]; // jours ouverts (iso), triés croissant
  winStart: string;
  winEnd: string;
  onPick: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const openSet = useMemo(() => new Set(openDays), [openDays]);
  const anchor = new Date(jour + "T00:00");
  const [an, setAn] = useState(anchor.getFullYear());
  const [m0, setM0] = useState(anchor.getMonth());

  const minKey = keyIso(winStart);
  const maxKey = keyIso(winEnd);
  const curKey = keyMois(an, m0);

  // Jour ouvert précédent / suivant. Repli ±1 jour si aucun jour ouvert connu
  // dans cette direction, pour que les flèches ne se bloquent jamais.
  const prevOpen = () => {
    let best: string | null = null;
    for (const d of openDays) {
      if (d < jour) best = d;
      else break;
    }
    onPick(best ?? addDaysIso(jour, -1));
  };
  const nextOpen = () => {
    let best: string | null = null;
    for (const d of openDays) {
      if (d > jour) {
        best = d;
        break;
      }
    }
    onPick(best ?? addDaysIso(jour, 1));
  };

  const reculerMois = () => {
    if (curKey <= minKey) return;
    const [a, m] = moisPrecedent(an, m0);
    setAn(a);
    setM0(m);
  };
  const avancerMois = () => {
    if (curKey >= maxKey) return;
    const [a, m] = moisSuivant(an, m0);
    setAn(a);
    setM0(m);
  };

  const ouvrir = () => {
    setAn(anchor.getFullYear());
    setM0(anchor.getMonth());
    setOpen((o) => !o);
  };
  const choisir = (iso: string) => {
    onPick(iso);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
      <button type="button" className={s.navbtn} onClick={prevOpen} title="Jour ouvert précédent">◀</button>
      <button type="button" className={s.navbtn} onClick={ouvrir} title="Choisir un jour" style={{ minWidth: 132, fontWeight: 600 }}>
        {fmtCourt(jour)}
      </button>
      <button type="button" className={s.navbtn} onClick={nextOpen} title="Jour ouvert suivant">▶</button>

      {open && (
        <>
          {/* Voile transparent : ferme le calendrier au clic extérieur. */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 6,
              zIndex: 41,
              width: 250,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,.14)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button type="button" onClick={reculerMois} disabled={curKey <= minKey} aria-label="Mois précédent" style={mBtn(curKey <= minKey)}>‹</button>
              <strong style={{ fontSize: 15, textTransform: "capitalize" }}>{libelleMois(an, m0)}</strong>
              <button type="button" onClick={avancerMois} disabled={curKey >= maxKey} aria-label="Mois suivant" style={mBtn(curKey >= maxKey)}>›</button>
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
                    {grilleMois(an, m0).slice(sem * 7, sem * 7 + 7).map((c) => {
                      const horsMois = !c.moisCourant;
                      const ferme = !openSet.has(c.iso);
                      const estJour = c.iso === jour;
                      return (
                        <td key={c.iso} style={{ padding: 0, textAlign: "center" }}>
                          <button
                            type="button"
                            disabled={horsMois || ferme}
                            onClick={() => choisir(c.iso)}
                            title={!horsMois && ferme ? "Aucune ligne ouverte ce jour-là" : c.iso.split("-").reverse().join("/")}
                            style={caseStyle(horsMois, ferme, estJour)}
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
            <p className="muted" style={{ fontSize: 11, margin: "8px 2px 0", textAlign: "center" }}>
              Les jours sans ligne ouverte sont grisés.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const mBtn = (dis: boolean): React.CSSProperties => ({
  width: 28,
  height: 28,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  color: dis ? "#cbd5e1" : "#334155",
  cursor: dis ? "default" : "pointer",
  fontSize: 18,
  lineHeight: 1,
});

const caseStyle = (horsMois: boolean, ferme: boolean, estJour: boolean): React.CSSProperties => {
  const base: React.CSSProperties = {
    height: 34,
    width: "100%",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "#1f2937",
    padding: 0,
    margin: 0,
    borderRadius: 8,
  };
  if (horsMois) return { ...base, color: "#e2e8f0", cursor: "default" };
  if (estJour) return { ...base, background: "#0d9488", color: "#fff", fontWeight: 700 };
  if (ferme) return { ...base, color: "#cbd5e1", cursor: "not-allowed", background: "#f8fafc" };
  return base;
};
