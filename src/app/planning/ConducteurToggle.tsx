"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { OperateurIcon } from "@/components/icons";

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

  // 2026-09-10 : le bouton est désormais rendu en ligne (à droite de la barre
  // de recherche), donc plus dans une `.filterrow`. On garde juste le bouton
  // pour composition libre par le parent.
  return (
      <button
        type="button"
        onClick={go}
        aria-label="Filtre Conducteurs"
        aria-pressed={actif}
        title={actif ? "Filtre Conducteurs actif — cliquer pour tout afficher" : "N'afficher que les personnes compétentes sur au moins un poste conducteur"}
        style={{
          opacity: pending ? 0.5 : 1,
          transition: "opacity .1s",
          // Même gabarit que les trois boutons icône du dessus (🕐 🤒 🖨) :
          // 30×30, bordure grise, radius 8. Actif = fond bleu, icône blanche
          // (héritée via currentColor). Icône seule pour ne pas déborder la
          // colonne — la sémantique passe par le tooltip.
          width: 30,
          height: 30,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: actif ? "var(--primary)" : "#fff",
          color: actif ? "#fff" : "var(--text)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <OperateurIcon size={20} />
      </button>
  );
}
