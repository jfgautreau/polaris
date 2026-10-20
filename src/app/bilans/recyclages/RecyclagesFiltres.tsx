"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HORIZONS, TYPES_FORMATION, type Horizon, type TypeFormation } from "@/lib/recyclages";

// Filtres propres au bilan des recyclages, portés par l'URL (le serveur les lit) :
// type de formation, horizon d'échéance, formation précise.
export default function RecyclagesFiltres({
  type,
  horizon,
  formation,
  formations,
  avecNonClassees,
}: {
  type: TypeFormation | "";
  horizon: Horizon;
  formation: string;
  formations: { id: string; nom: string }[];
  avecNonClassees: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  const [enCours, demarrer] = useTransition();

  function go(patch: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    demarrer(() => router.push(qs ? `${path}?${qs}` : path));
  }

  const ligne: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" };
  return (
    <div className="noprint" style={{ opacity: enCours ? 0.6 : 1, transition: "opacity .15s" }}>
      <div style={ligne}>
        <span className="muted" style={{ fontWeight: 600 }}>Formations :</span>
        <div className="segments">
          {TYPES_FORMATION.filter((t) => t.v !== "aucune" || avecNonClassees || type === "aucune").map((t) => (
            // Changer de type remet le choix de formation à « toutes » : la formation
            // retenue pourrait ne plus faire partie de la liste.
            <button key={t.v} type="button" className={type === t.v ? "seg active" : "seg"} onClick={() => go({ type: t.v, formation: "" })}>
              {t.t}
            </button>
          ))}
        </div>
        <select
          value={formation}
          onChange={(e) => go({ formation: e.target.value })}
          style={{ width: "auto", minWidth: 220, margin: 0 }}
          title="Limiter à une formation (organiser une session)"
        >
          <option value="">Toutes les formations</option>
          {formations.map((f) => (
            <option key={f.id} value={f.id}>{f.nom}</option>
          ))}
        </select>
      </div>
      <div style={ligne}>
        <span className="muted" style={{ fontWeight: 600 }}>Échéance :</span>
        <div className="segments">
          {HORIZONS.map((h) => (
            <button key={h.v} type="button" className={horizon === h.v ? "seg active" : "seg"} onClick={() => go({ horizon: h.v })}>
              {h.t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
