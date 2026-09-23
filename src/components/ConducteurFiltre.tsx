"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { OperateurIcon } from "@/components/icons";

// Bascule « Conducteurs » générique (Matrice, Habilitations…) : ne montre que
// les personnes ayant au moins une compétence (niveau ≥ 1) sur au moins un poste
// `categorie = 'conducteur'` actif. Portée par `?cond=1`, elle PRÉSERVE les
// autres paramètres d'URL et reste sur la route courante. Le filtrage réel est
// fait côté serveur (page), comme au Planning ; la recherche par nom passe outre.
export default function ConducteurFiltre() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const actif = sp.get("cond") === "1";

  function go() {
    const p = new URLSearchParams(sp.toString());
    if (actif) p.delete("cond");
    else p.set("cond", "1");
    const qs = p.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <button
      type="button"
      onClick={go}
      aria-label="Filtre Conducteurs"
      aria-pressed={actif}
      title={
        actif
          ? "Filtre Conducteurs actif — cliquer pour tout afficher"
          : "N'afficher que les personnes compétentes sur au moins un poste conducteur"
      }
      style={{
        opacity: pending ? 0.5 : 1,
        transition: "opacity .1s",
        width: 30,
        height: 30,
        boxSizing: "border-box",
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // Annule le style global `button` (margin-top 18px + width 100%).
        margin: 0,
        padding: 0,
        lineHeight: 1,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: actif ? "var(--primary)" : "#fff",
        color: actif ? "#fff" : "var(--text)",
        cursor: "pointer",
      }}
    >
      <OperateurIcon size={20} />
    </button>
  );
}
