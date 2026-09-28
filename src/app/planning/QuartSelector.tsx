"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import SlideSwitch from "@/components/SlideSwitch";

type Quart = { code: string; libelle: string };

// Selecteur de quart : preserve le mode Equipe (auto / all / id) tel quel dans
// l'URL. Le mode « Auto » (equipe absente) recalcule automatiquement l'ensemble
// des equipes affichees pour le nouveau quart cote serveur — pas besoin de forcer
// une equipe ici comme on le faisait auparavant.
//
// Bascule « Suivre le quart / Suivre l'équipe » (?vue=equipe) : en « Suivre
// l'équipe », chaque semaine affiche le quart de l'équipe choisie cette semaine-là,
// si bien qu'aucun segment n'est actif ; cliquer un quart revient à « Suivre le
// quart » sur ce quart. `suivreEquipeRaison` non vide = bascule indisponible
// (aucune équipe unique choisie, ou équipe à quart fixe) et son explication.
export default function QuartSelector({
  quarts,
  current,
  semaine,
  atelier = "",
  equipe = "",
  search = "",
  cond = false,
  suivreEquipe = false,
  suivreEquipeRaison = "",
}: {
  quarts: Quart[];
  current: string;
  semaine: string;
  atelier?: string;
  equipe?: string;
  search?: string;
  cond?: boolean;
  suivreEquipe?: boolean;
  suivreEquipeRaison?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go(code: string, vueEquipe: boolean) {
    const p = new URLSearchParams();
    if (equipe) p.set("equipe", equipe);
    if (atelier) p.set("atelier", atelier);
    if (semaine) p.set("semaine", semaine);
    if (search) p.set("search", search);
    if (cond) p.set("cond", "1");
    // En « Suivre l'équipe », le serveur déduit le quart de chaque semaine.
    if (vueEquipe) p.set("vue", "equipe");
    else p.set("quart", code);
    start(() => router.push(`/planning?${p.toString()}`));
  }
  const indispo = suivreEquipeRaison !== "";
  return (
    <div className="filterrow" style={{ opacity: pending ? 0.5 : 1, transition: "opacity .1s" }}>
      <span className="lbl">Quart</span>
      <div className="segments">
        {quarts.map((q) => (
          <button
            key={q.code}
            type="button"
            className={!suivreEquipe && q.code === current ? "seg active" : "seg"}
            onClick={() => go(q.code, false)}
            title={suivreEquipe ? `Revenir à « Suivre le quart » sur ${q.libelle}` : undefined}
          >
            {q.libelle}
          </button>
        ))}
      </div>
      <span style={{ marginLeft: 10, opacity: indispo ? 0.45 : 1 }}>
        <SlideSwitch
          on={suivreEquipe}
          onChange={(v) => {
            if (!indispo) go(current, v);
          }}
          offLabel="Suivre le quart"
          onLabel="Suivre l'équipe"
          width={230}
          title={
            indispo
              ? suivreEquipeRaison
              : suivreEquipe
                ? "Chaque semaine affiche le quart de l'équipe cette semaine-là. Cliquer pour garder le même quart sur les 3 semaines."
                : "Afficher chaque semaine sur le quart de l'équipe (matin, puis après-midi…) pour recopier d'une semaine sur l'autre"
          }
        />
      </span>
    </div>
  );
}
