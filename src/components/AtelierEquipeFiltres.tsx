"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Opt = { id: string; label: string };

// Filtres « Atelier » et « Équipe » en segments, portes par l'URL.
// Partage entre la Matrice et les Habilitations : meme presentation, meme
// comportement, un seul endroit a corriger. `base` est la route a repeindre.
export default function AtelierEquipeFiltres({
  base,
  ateliers = [],
  equipes = [],
  atelier = "",
  equipe = "",
}: {
  base: string;
  ateliers?: Opt[];
  equipes?: Opt[];
  atelier?: string;
  equipe?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(next: { atelier?: string; equipe?: string }) {
    const a = next.atelier ?? atelier;
    const e = next.equipe ?? equipe;
    const params = new URLSearchParams();
    if (a) params.set("atelier", a);
    if (e) params.set("equipe", e);
    const qs = params.toString();
    start(() => router.push(qs ? `${base}?${qs}` : base));
  }

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", opacity: pending ? 0.5 : 1, transition: "opacity .1s" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="muted">Service :</span>
        <div className="segments">
          <button type="button" className={atelier === "" ? "seg active" : "seg"} onClick={() => go({ atelier: "" })}>
            Tous
          </button>
          {ateliers.map((a) => (
            <button
              key={a.id}
              type="button"
              className={atelier === a.id ? "seg active" : "seg"}
              onClick={() => go({ atelier: a.id })}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="muted">Équipe :</span>
        <div className="segments">
          <button type="button" className={equipe === "" ? "seg active" : "seg"} onClick={() => go({ equipe: "" })}>
            Toutes
          </button>
          {equipes.map((e2) => (
            <button
              key={e2.id}
              type="button"
              className={equipe === e2.id ? "seg active" : "seg"}
              onClick={() => go({ equipe: e2.id })}
            >
              {e2.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
