"use client";

import { useRouter } from "next/navigation";
import { isoDate, mondayOf, addDays, type Jour } from "@/lib/week";

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function libDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MOIS[m - 1]}`;
}

export default function OrdoQuinzaineNav({
  base,
  debut,
  todayMonday,
  days,
}: {
  base: string;
  debut: string; // lundi ISO de départ
  todayMonday: string;
  days: Jour[];
}) {
  const router = useRouter();
  const go = (iso: string) => router.push(`${base}?debut=${iso}`);
  const start = new Date(debut + "T00:00");
  // Pas de deux semaines (14 j) : colonnes toujours alignées sur les lundis.
  const prev = isoDate(addDays(start, -14));
  const next = isoDate(addDays(start, 14));
  const fin = days.length ? days[days.length - 1].iso : debut;
  const estCourant = debut === todayMonday;

  return (
    <div className="toolbar" style={{ alignItems: "center", marginTop: 6, marginBottom: 12, gap: 8 }}>
      <button type="button" className="iconbtn" onClick={() => go(prev)} title="Quinzaine précédente">
        &lsaquo;
      </button>
      <button
        type="button"
        className={estCourant ? "btn-sm" : "btn-sm btn-ghost"}
        style={{ width: "auto" }}
        onClick={() => go(isoDate(mondayOf()))}
        title="Revenir à la semaine courante"
      >
        Aujourd&apos;hui
      </button>
      <button type="button" className="iconbtn" onClick={() => go(next)} title="Quinzaine suivante">
        &rsaquo;
      </button>
      <strong style={{ marginLeft: 6 }}>
        {libDate(debut)} → {libDate(fin)}
      </strong>
      <span className="muted" style={{ fontSize: 12 }}>· 15 jours</span>
    </div>
  );
}
