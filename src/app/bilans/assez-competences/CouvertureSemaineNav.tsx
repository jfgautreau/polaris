"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

// Navigation par quinzaine (2 semaines) du rapport « Assez de compétences ? ».
// Portée par l'URL (?debut=<lundiISO>), flèches par 14 jours.
export default function CouvertureSemaineNav({ lundiDepart, label }: { lundiDepart: string; label: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  const [pending, start] = useTransition();

  const go = (debut: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set("debut", debut);
    start(() => router.push(`${path}?${p.toString()}`));
  };
  const decale = (jours: number) => {
    const [y, m, d] = lundiDepart.split("-").map(Number);
    const dt = new Date(y, m - 1, d + jours);
    go(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  };

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 6, opacity: pending ? 0.6 : 1 }}>
      <button type="button" className="seg" onClick={() => decale(-14)} aria-label="Quinzaine précédente" style={{ minWidth: 34 }}>‹</button>
      <div style={{ minWidth: 190, textAlign: "center", fontWeight: 600, fontSize: 13, padding: "0 6px" }}>{label}</div>
      <button type="button" className="seg" onClick={() => decale(14)} aria-label="Quinzaine suivante" style={{ minWidth: 34 }}>›</button>
    </div>
  );
}
