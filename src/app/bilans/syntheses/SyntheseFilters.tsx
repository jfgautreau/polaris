"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import SlideSwitch from "@/components/SlideSwitch";

// Filtres de l'ecran Syntheses : bascule Absences <-> Interim, navigation de
// semaine (lundi -> dimanche), et — pour la vue Absences — atelier + motif.
// Portes par l'URL, navigation en transition (comme les autres ecrans).
type Opt = { id: string; nom: string };

export default function SyntheseFilters({
  vue,
  semaineIso,
  semaineLabel,
  ateliers,
  motifs,
  atelier,
  motif,
}: {
  vue: "absences" | "interim";
  semaineIso: string;
  semaineLabel: string;
  ateliers: Opt[];
  motifs: Opt[];
  atelier: string;
  motif: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  const [pending, start] = useTransition();

  const go = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    start(() => router.push(qs ? `${path}?${qs}` : path));
  };

  // Decalage de N semaines a partir du lundi courant.
  const decaler = (n: number) => {
    const [y, m, d] = semaineIso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n * 7);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    go({ sem: iso });
  };
  // Lundi de la semaine courante (pour « Cette semaine »).
  const lundiCourant = () => {
    const n = new Date();
    const x = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    go({ sem: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}` });
  };

  const navBtn: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "#fff",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  };

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 16, opacity: pending ? 0.6 : 1 }}>
      <SlideSwitch
        on={vue === "interim"}
        onChange={(v) => go({ vue: v ? "interim" : "absences" })}
        offLabel="Absences"
        onLabel="Intérim"
        width={200}
        title="Absences : liste des absences de la semaine (hors intérim). Intérim : planning prévisionnel des intérimaires, groupé par agence."
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" style={navBtn} onClick={() => decaler(-1)} title="Semaine précédente" aria-label="Semaine précédente">‹</button>
        <span style={{ fontWeight: 700, minWidth: 190, textAlign: "center" }}>{semaineLabel}</span>
        <button type="button" style={navBtn} onClick={() => decaler(1)} title="Semaine suivante" aria-label="Semaine suivante">›</button>
        <button
          type="button"
          onClick={lundiCourant}
          style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 600 }}
          title="Revenir à la semaine en cours"
        >
          Cette semaine
        </button>
      </div>

      {vue === "absences" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <select value={atelier} onChange={(e) => go({ atelier: e.target.value })} style={{ height: 32 }}>
            <option value="">Tous les ateliers</option>
            {ateliers.map((a) => (
              <option key={a.id} value={a.id}>{a.nom}</option>
            ))}
          </select>
          <select value={motif} onChange={(e) => go({ motif: e.target.value })} style={{ height: 32 }}>
            <option value="">Tous les motifs</option>
            {motifs.map((m) => (
              <option key={m.id} value={m.id}>{m.nom}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
