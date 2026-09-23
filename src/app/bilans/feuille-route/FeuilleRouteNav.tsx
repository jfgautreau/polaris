"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Navigation temporelle du rapport « feuille de route » : décale la fenêtre de
// 24 semaines vers le futur (pas de 4 semaines) pour aller voir plus loin. Le
// passé n'a pas de sens (projection) → borne basse = la semaine courante.
const PAS_JOURS = 28; // 4 semaines

function ajoute(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function frCourt(iso: string): string {
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a.slice(2)}`;
}

export default function FeuilleRouteNav({
  debut,
  today,
  finIso,
}: {
  debut: string; // lundi de début de fenêtre (pivot)
  today: string; // lundi de la semaine courante (borne basse)
  finIso: string; // lundi de la dernière semaine affichée
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const auDebut = debut <= today;

  function aller(cibleIso: string | null) {
    const q = new URLSearchParams(params.toString());
    if (!cibleIso || cibleIso <= today) q.delete("debut");
    else q.set("debut", cibleIso);
    const s = q.toString();
    startTransition(() => router.push(s ? `${pathname}?${s}` : pathname));
  }

  const btn: React.CSSProperties = {
    margin: 0,
    padding: "4px 10px",
    fontSize: 13,
    lineHeight: 1.2,
    border: "1px solid var(--border)",
    background: "#fff",
    color: "var(--text)",
    borderRadius: 7,
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px", flexWrap: "wrap" }}>
      <button
        type="button"
        style={{ ...btn, opacity: auDebut || pending ? 0.5 : 1, cursor: auDebut ? "default" : "pointer" }}
        disabled={auDebut || pending}
        onClick={() => aller(ajoute(debut, -PAS_JOURS))}
        title="4 semaines plus tôt"
      >
        ‹ 4 sem.
      </button>
      <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 190, textAlign: "center" }}>
        {frCourt(debut)} → {frCourt(finIso)}
        {auDebut && <strong style={{ color: "var(--text)" }}> · à partir d&apos;aujourd&apos;hui</strong>}
      </span>
      <button
        type="button"
        style={{ ...btn, opacity: pending ? 0.5 : 1 }}
        disabled={pending}
        onClick={() => aller(ajoute(debut, PAS_JOURS))}
        title="4 semaines plus tard"
      >
        4 sem. ›
      </button>
      {!auDebut && (
        <button type="button" style={btn} disabled={pending} onClick={() => aller(null)} title="Revenir à la semaine courante">
          Aujourd&apos;hui
        </button>
      )}
    </div>
  );
}
