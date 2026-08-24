"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import SlideSwitch from "@/components/SlideSwitch";

// Filtres de l'ecran Projection : horizon (4/8/12 semaines) et couche
// (structurelle / reelle). Portes par l'URL, navigation en transition.
export default function ProjectionFilters({ horizon, couche }: { horizon: number; couche: "structurelle" | "reelle" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  const [pending, start] = useTransition();

  const go = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    const qs = p.toString();
    start(() => router.push(qs ? `${path}?${qs}` : path));
  };

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 14, opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="muted" style={{ fontWeight: 600 }}>Horizon :</span>
        <div className="segments">
          {[4, 8, 12].map((h) => (
            <button key={h} type="button" className={horizon === h ? "seg active" : "seg"} onClick={() => go({ h: String(h) })}>
              {h} sem.
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="muted" style={{ fontWeight: 600 }}>Vue :</span>
        <SlideSwitch
          on={couche === "reelle"}
          onChange={(v) => go({ couche: v ? "reelle" : "structurelle" })}
          offLabel="Structurelle"
          onLabel="Calendrier réel"
          width={200}
          title="Structurelle = capacité de fond (qui est habilité et dans l'effectif). Calendrier réel = en retirant les absences déclarées et les mi-temps indisponibles (temps partiel, une semaine sur deux selon la rotation)."
        />
      </div>
    </div>
  );
}
