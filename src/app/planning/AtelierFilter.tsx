"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Opt = { id: string; label: string };

export default function AtelierFilter({
  ateliers = [],
  atelier = "",
  equipe = "",
  quart = "",
  semaine = "",
  search = "",
  cond = false,
}: {
  ateliers?: Opt[];
  atelier?: string;
  equipe?: string;
  quart?: string;
  semaine?: string;
  search?: string;
  cond?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(at: string) {
    const p = new URLSearchParams();
    if (equipe) p.set("equipe", equipe);
    if (at) p.set("atelier", at);
    if (semaine) p.set("semaine", semaine);
    if (quart) p.set("quart", quart);
    if (search) p.set("search", search);
    if (cond) p.set("cond", "1");
    const qs = p.toString();
    start(() => router.push(qs ? `/planning?${qs}` : "/planning"));
  }

  if (ateliers.length === 0) return null;

  return (
    <div className="filterrow" style={{ opacity: pending ? 0.5 : 1, transition: "opacity .1s" }}>
      <span className="lbl">Service</span>
      <div className="segments">
        <button type="button" className={atelier === "" ? "seg active" : "seg"} onClick={() => go("")}>
          Tous
        </button>
        {ateliers.map((a) => (
          <button
            key={a.id}
            type="button"
            className={atelier === a.id ? "seg active" : "seg"}
            onClick={() => go(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
