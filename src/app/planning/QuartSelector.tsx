"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Quart = { code: string; libelle: string };

// Selecteur de quart : preserve le mode Equipe (auto / all / id) tel quel dans
// l'URL. Le mode « Auto » (equipe absente) recalcule automatiquement l'ensemble
// des equipes affichees pour le nouveau quart cote serveur — pas besoin de forcer
// une equipe ici comme on le faisait auparavant.
export default function QuartSelector({
  quarts,
  current,
  semaine,
  atelier = "",
  equipe = "",
  search = "",
  cond = false,
}: {
  quarts: Quart[];
  current: string;
  semaine: string;
  atelier?: string;
  equipe?: string;
  search?: string;
  cond?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go(code: string) {
    const p = new URLSearchParams();
    if (equipe) p.set("equipe", equipe);
    if (atelier) p.set("atelier", atelier);
    if (semaine) p.set("semaine", semaine);
    if (search) p.set("search", search);
    if (cond) p.set("cond", "1");
    p.set("quart", code);
    start(() => router.push(`/planning?${p.toString()}`));
  }
  return (
    <div className="filterrow" style={{ opacity: pending ? 0.5 : 1, transition: "opacity .1s" }}>
      <span className="lbl">Quart</span>
      <div className="segments">
        {quarts.map((q) => (
          <button
            key={q.code}
            type="button"
            className={q.code === current ? "seg active" : "seg"}
            onClick={() => go(q.code)}
          >
            {q.libelle}
          </button>
        ))}
      </div>
    </div>
  );
}
