"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Opt = { id: string; label: string; couleur?: string };

// Filtre Equipe a trois modes, portes par ?equipe :
//   • absent        -> "Auto"   : equipes du quart cette semaine (rotation + fixe).
//   • ?equipe=all   -> "Toutes" : aucune equipe filtree.
//   • ?equipe=<id>  -> une equipe precise.
// Auto est le defaut a l'ouverture ; l'utilisateur force en cliquant Toutes ou une
// equipe. Le calcul de l'ensemble « Auto » vit cote serveur (page.tsx).
export default function PlanningFilters({
  equipes = [],
  equipe = "",
  semaine = "",
  quart = "",
  atelier = "",
  search = "",
  cond = false,
}: {
  equipes?: Opt[];
  equipe?: string;
  semaine?: string;
  quart?: string;
  atelier?: string;
  search?: string;
  cond?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(eq: string) {
    const p = new URLSearchParams();
    if (eq) p.set("equipe", eq);
    if (atelier) p.set("atelier", atelier);
    if (semaine) p.set("semaine", semaine);
    if (quart) p.set("quart", quart);
    if (search) p.set("search", search);
    if (cond) p.set("cond", "1");
    const qs = p.toString();
    start(() => router.push(qs ? `/planning?${qs}` : "/planning"));
  }

  const isAuto = equipe === "";
  const isAll = equipe === "all";

  return (
    <div className="filterrow" style={{ opacity: pending ? 0.5 : 1, transition: "opacity .1s" }}>
      <span className="lbl">Équipe</span>
      <div className="segments">
        <button
          type="button"
          className={isAuto ? "seg active" : "seg"}
          onClick={() => go("")}
          title="Equipes qui travaillent sur ce quart cette semaine (rotation + quart fixe)"
        >
          Auto
        </button>
        <button
          type="button"
          className={isAll ? "seg active" : "seg"}
          onClick={() => go("all")}
        >
          Toutes
        </button>
        {equipes.map((e) => (
          <button
            key={e.id}
            type="button"
            className={equipe === e.id ? "seg active" : "seg"}
            onClick={() => go(e.id)}
            style={
              equipe === e.id && e.couleur
                ? { background: e.couleur, color: "#1e293b", borderColor: e.couleur }
                : undefined
            }
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: 2,
                background: e.couleur ?? "#cbd5e1",
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}
