"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Bascule « Conducteurs » : ne montre que les personnes ayant au moins une
// compétence (niveau ≥ 1) sur au moins un poste `categorie = 'conducteur'` actif.
// Combiné aux autres filtres (intersection) ; la recherche par nom passe outre.
// Portée par ?cond=1 dans l'URL.
export default function ConducteurToggle({
  actif = false,
  semaine = "",
  quart = "",
  atelier = "",
  equipe = "",
  search = "",
}: {
  actif?: boolean;
  semaine?: string;
  quart?: string;
  atelier?: string;
  equipe?: string;
  search?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go() {
    const p = new URLSearchParams();
    if (equipe) p.set("equipe", equipe);
    if (atelier) p.set("atelier", atelier);
    if (semaine) p.set("semaine", semaine);
    if (quart) p.set("quart", quart);
    if (search) p.set("search", search);
    if (!actif) p.set("cond", "1"); // on l'active
    const qs = p.toString();
    start(() => router.push(qs ? `/planning?${qs}` : "/planning"));
  }

  return (
    <div className="filterrow" style={{ opacity: pending ? 0.5 : 1, transition: "opacity .1s", justifyContent: "flex-end" }}>
      <button
        type="button"
        onClick={go}
        title={actif ? "Filtre Conducteurs actif — cliquer pour tout afficher" : "N'afficher que les personnes compétentes sur au moins un poste conducteur"}
        style={{
          height: 30,
          padding: "0 10px",
          fontSize: 12,
          fontWeight: 600,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: actif ? "var(--primary)" : "#fff",
          color: actif ? "#fff" : "var(--text)",
          cursor: "pointer",
        }}
      >
        🚛 Cond.
      </button>
    </div>
  );
}
