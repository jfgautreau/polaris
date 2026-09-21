"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Quart = { code: string; libelle: string };

// Filtre Quart des rapports Bilans : même UX que `ReportAtelierFilter`. Il ne
// touche PAS la population comptée — il réduit le BESOIN au quart choisi (une
// équipe ne couvre qu'un quart à la fois). « Tous » = besoin de tous les quarts
// (comportement historique).
export default function ReportQuartFilter({
  quarts,
  quart,
}: {
  quarts: Quart[];
  quart: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();

  function go(q: string) {
    const p = new URLSearchParams(sp.toString());
    if (q) p.set("quart", q);
    else p.delete("quart");
    const qs = p.toString();
    router.push(qs ? `${path}?${qs}` : path);
  }

  if (quarts.length === 0) return null;

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span className="muted" style={{ fontWeight: 600 }}>Quart :</span>
      <div className="segments">
        <button type="button" className={quart === "" ? "seg active" : "seg"} onClick={() => go("")}>
          Tous
        </button>
        {quarts.map((q) => (
          <button
            key={q.code}
            type="button"
            className={quart === q.code ? "seg active" : "seg"}
            onClick={() => go(q.code)}
          >
            {q.libelle}
          </button>
        ))}
      </div>
    </div>
  );
}
