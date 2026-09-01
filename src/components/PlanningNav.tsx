"use client";

import { useRouter } from "next/navigation";
import { parseMonday, isoDate, addDays, mondayOf, isoWeekNumber } from "@/lib/week";

const MOIS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

// Navigation planning : Annee / Mois (segments) + pastilles des semaines du mois.
// Cliquer une semaine ouvre la vue 3 semaines (S-1 / S / S+1) centree dessus.
export default function PlanningNav({
  base,
  semaine,
  extra = {},
}: {
  base: string;
  semaine: string;
  extra?: Record<string, string>;
}) {
  const router = useRouter();
  const center = parseMonday(semaine);
  const centerIso = isoDate(center);
  const todayMonday = isoDate(mondayOf());

  // Mois "ISO" de la semaine centrale = mois du jeudi de cette semaine.
  const thu = addDays(center, 3);
  const navYear = thu.getFullYear();
  const navMonth = thu.getMonth();

  const goWeek = (mondayIso: string) => {
    const p = new URLSearchParams({ ...extra, semaine: mondayIso });
    router.push(`${base}?${p.toString()}`);
  };
  const goMonth = (y: number, m: number) => goWeek(isoDate(mondayOf(new Date(y, m, 1))));

  // Bande continue de semaines centree sur la semaine affichee (decouplee des mois :
  // plus de probleme de semaine a cheval). Chaque semaine = numero ISO + date du lundi.
  const weeks: { num: number; iso: string; date: string }[] = [];
  for (let k = -4; k <= 4; k++) {
    const m = addDays(center, k * 7);
    weeks.push({
      num: isoWeekNumber(m),
      iso: isoDate(m),
      date: `${String(m.getDate()).padStart(2, "0")}/${String(m.getMonth() + 1).padStart(2, "0")}`,
    });
  }
  const years = [navYear - 1, navYear, navYear + 1];
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  const greenDot = (
    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#16a34a", marginRight: 5, verticalAlign: "middle" }} />
  );

  const monthBtn = (m: number) => {
    const isCur = navYear === curYear && m === curMonth;
    return (
      <button key={m} type="button" className={m === navMonth ? "seg active" : "seg"} onClick={() => goMonth(navYear, m)}>
        {isCur && m !== navMonth && greenDot}
        {MOIS[m]}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Annee */}
      <div className="filterrow">
        <span className="lbl">Année</span>
        <div className="segments">
          {years.map((y) => (
            <button key={y} type="button" className={y === navYear ? "seg active" : "seg"} onClick={() => goMonth(y, navMonth)}>
              {y === curYear && y !== navYear && greenDot}
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Mois */}
      <div className="filterrow">
        <span className="lbl">Mois</span>
        <div className="segments">{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(monthBtn)}</div>
      </div>

      {/* Semaine : bande continue centree (navigation deplacee dans le bandeau dates) */}
      <div className="filterrow">
        <span className="lbl">Semaine</span>
        <div className="segments">
          {weeks.map((w) => {
            const isCenter = w.iso === centerIso;
            const isToday = w.iso === todayMonday;
            return (
              <button key={w.iso} type="button" className={isCenter ? "seg active" : "seg"} onClick={() => goWeek(w.iso)} title={isToday ? "Semaine en cours" : `Lundi ${w.date}`}>
                {isToday && !isCenter && greenDot}
                S{w.num}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
