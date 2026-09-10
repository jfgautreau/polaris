"use client";

import ModaleDeplacable from "@/components/ModaleDeplacable";
import { Pie, RestrictionMark } from "./Pie";

export default function LegendeModal({
  niveauLibelles,
  nbNiveaux,
  couleurs,
  onClose,
}: {
  niveauLibelles: { niveau: number; libelle: string }[];
  nbNiveaux: number;
  couleurs: Record<number, string | null>;
  onClose: () => void;
}) {
  // Libellés propres au SITE (competence_niveau_libelle, site-scopé depuis
  // 0053). Aucun texte codé en dur : un site sans échelle configurée (ex. un
  // site fraîchement créé) affiche juste « Niveau N » — plutôt que d'emprunter
  // les définitions d'un autre site. L'échelle se règle dans /admin/competences.
  const label = (n: number) => niveauLibelles.find((x) => x.niveau === n)?.libelle ?? "";
  return (
    <ModaleDeplacable onClose={onClose} largeur={820}>
        <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Niveaux de compétence</h2>
          <button type="button" className="btn-sm btn-ghost" onClick={onClose} style={{ width: "auto" }}>✕</button>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {Array.from({ length: nbNiveaux + 1 }, (_, n) => n).map((n) => (
            <li key={n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ flexShrink: 0 }}><Pie level={n} max={nbNiveaux} couleurs={couleurs} /></span>
              <span><strong>Niveau {n}</strong>{label(n) ? ` — ${label(n)}` : ""}</span>
            </li>
          ))}
          <li style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <span style={{ flexShrink: 0 }}><RestrictionMark /></span>
            <span><strong style={{ color: "#b91c1c" }}>Restriction</strong> — restriction médicale ou physique sur ce poste : la personne ne doit pas y être affectée (exclue des bilans, alerte dans le planning).</span>
          </li>
        </ul>
        <p className="muted" style={{ marginTop: 10 }}>
          <strong>Le petit chiffre en haut à droite d&apos;une case rappelle l&apos;autre niveau</strong> :
          en mode <em>Actuel</em>, la pastille montre le niveau actuel et le petit
          chiffre est la <strong>cible</strong> visée ; en mode <em>Cible</em>, la
          pastille montre la cible et le petit chiffre est le <strong>niveau actuel</strong>.
          On voit ainsi d&apos;un coup d&apos;œil l&apos;écart à combler.
          Un <span style={{ color: "#b91c1c", fontWeight: 700 }}>✕</span> à cette place
          signale une restriction sur l&apos;autre niveau. Le petit chiffre n&apos;apparaît
          qu&apos;à partir de 1 (une cible à 0 reste implicite).
        </p>
        <p className="muted" style={{ marginTop: 6, fontWeight: 600 }}>
          Saisie : clic = +1 · clic droit = −1 · enregistrement automatique.
          En mode <em>Actuel</em>, la cible suit automatiquement pour rester ≥ actuel.
        </p>
    </ModaleDeplacable>
  );
}
