"use client";

import { useState } from "react";
import AtelierEquipeFiltres from "@/components/AtelierEquipeFiltres";
import SlideSwitch from "@/components/SlideSwitch";
import PageTitle from "@/components/PageTitle";
import Link from "next/link";
import MatrixGrid from "./MatrixGrid";
import LegendeModal from "./LegendeModal";

type Poste = { id: string; nom: string; objectifActuel?: number; objectifCible?: number };
type Group = { ligneId: string; ligneNom: string; postes: Poste[] };
type Personne = { id: string; label: string; editable: boolean; interim?: boolean; avenir?: boolean; sansCompetence?: boolean };
type Cell = { a: number; c: number };
type Opt = { id: string; label: string };

export default function MatricePanel({
  groups,
  personnes,
  initial,
  canEditObjectif,
  ateliers,
  equipes,
  atelier,
  equipe,
  niveauLibelles,
  nbNiveaux,
  seuilCompetent,
  couleurs,
}: {
  groups: Group[];
  personnes: Personne[];
  initial: Record<string, Cell>;
  canEditObjectif: boolean;
  ateliers: Opt[];
  equipes: Opt[];
  atelier: string;
  equipe: string;
  niveauLibelles: { niveau: number; libelle: string }[];
  nbNiveaux: number;
  seuilCompetent: number;
  couleurs: Record<number, string | null>;
}) {
  const [mode, setMode] = useState<"actuel" | "cible">("actuel");
  const [showLegende, setShowLegende] = useState(false);
  // La recherche vit dans l'en-tete (ligne 1) et pilote la grille.
  const [search, setSearch] = useState("");

  return (
    <>
      {/* En-tete en deux lignes, commun a Personnel / Matrice / Habilitations.
          Ligne 1 : titre · recherche · legende et lien du bilan.
          Ligne 2 : bascule Actuel / Cible a gauche · filtres a droite. */}
      <div className="headband headband-top">
        <div className="hb-l1">
          <PageTitle module="matrice">Matrice de polyvalence</PageTitle>
          <span className="hb-search">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Rechercher un nom…" />
            {search && (
              <button type="button" className="clear" onClick={() => setSearch("")} title="Effacer la recherche">✕</button>
            )}
          </span>
          <span className="hb-fin">
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto", margin: 0 }} onClick={() => setShowLegende(true)}>
              📖 Légende
            </button>
            <Link href="/matrice/bilan" className="navlink" prefetch={false}>
              Voir le bilan &rarr;
            </Link>
          </span>
        </div>

        <div className="hb-l2">
          <SlideSwitch
            on={mode === "cible"}
            onChange={(v) => setMode(v ? "cible" : "actuel")}
            offLabel="Actuel"
            onLabel="Cible"
            offColor="#1d4ed8"
            onColor="#16a34a"
            width={156}
            title="Basculer entre niveau actuel et niveau cible"
          />
          <span className="hb-fin">
            <AtelierEquipeFiltres base="/matrice" ateliers={ateliers} equipes={equipes} atelier={atelier} equipe={equipe} />
          </span>
        </div>
      </div>

      <div className="gridband">
        {groups.length === 0 ? (
          <p className="muted">Aucun poste actif (vérifiez le référentiel / le filtre atelier).</p>
        ) : (
          <MatrixGrid groups={groups} personnes={personnes} initial={initial} canEditObjectif={canEditObjectif} mode={mode} search={search} nbNiveaux={nbNiveaux} seuilCompetent={seuilCompetent} couleurs={couleurs} />
        )}
      </div>

      {showLegende && <LegendeModal niveauLibelles={niveauLibelles} nbNiveaux={nbNiveaux} couleurs={couleurs} onClose={() => setShowLegende(false)} />}
    </>
  );
}
