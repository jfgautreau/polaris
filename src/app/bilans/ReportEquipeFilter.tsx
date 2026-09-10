"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Equipe = { id: string; nom: string; couleur?: string | null };

// Filtre Équipe des rapports Bilans : même UX que `ReportAtelierFilter`, mais
// ne restreint QUE la population analysée (personnes de l'équipe sélectionnée).
// Les objets purement structurels d'un rapport (postes, PTNR) restent globaux —
// seuls les blocs « personnes » et « écarts » se recalculent sur l'équipe.
export default function ReportEquipeFilter({
  equipes,
  equipe,
}: {
  equipes: Equipe[];
  equipe: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();

  function go(e: string) {
    const p = new URLSearchParams(sp.toString());
    if (e) p.set("equipe", e);
    else p.delete("equipe");
    const qs = p.toString();
    router.push(qs ? `${path}?${qs}` : path);
  }

  if (equipes.length === 0) return null;

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span className="muted" style={{ fontWeight: 600 }}>Équipe :</span>
      <div className="segments">
        <button type="button" className={equipe === "" ? "seg active" : "seg"} onClick={() => go("")}>
          Toutes
        </button>
        {equipes.map((e) => (
          <button
            key={e.id}
            type="button"
            className={equipe === e.id ? "seg active" : "seg"}
            onClick={() => go(e.id)}
            style={e.couleur ? { borderLeft: `4px solid ${e.couleur}` } : undefined}
          >
            {e.nom}
          </button>
        ))}
      </div>
    </div>
  );
}
