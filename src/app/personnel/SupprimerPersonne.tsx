"use client";

import { useEffect, useState } from "react";
import ConfirmForm from "@/components/ConfirmForm";
import { supprimerPersonne } from "./actions";

type Impact = { postesPasses: number; postesAVenir: number; absences: number; habilitations: number; contrats: number };

// Lecture du décompte, hors composant : ne lève jamais (null = inconnu).
async function lireImpact(id: string): Promise<Impact | null> {
  try {
    const res = await fetch(`/api/personnel/${id}/impact`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Impact) : null;
  } catch {
    return null;
  }
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

// Ce que la suppression effacerait, en clair : « 42 jours placés sur un poste
// (dont 5 à venir), 3 jours d'absence, 2 habilitations, 1 contrat ».
function decrire(i: Impact): string {
  const postes = i.postesPasses + i.postesAVenir;
  const parts = [
    postes ? `${pluriel(postes, "jour placé", "jours placés")} sur un poste${i.postesAVenir ? ` (dont ${i.postesAVenir} à venir)` : ""}` : "",
    i.absences ? pluriel(i.absences, "jour d'absence", "jours d'absence") : "",
    i.habilitations ? pluriel(i.habilitations, "habilitation", "habilitations") : "",
    i.contrats ? pluriel(i.contrats, "contrat", "contrats") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "";
}

// Bouton « Supprimer (droit à l'oubli) » de la fiche Personnel, avec le
// décompte de ce qui disparaît (2026-11-04) : la confirmation nomme les jours
// placés, passés et à venir, pour qu'on ne supprime pas par erreur quelqu'un
// qui figure au planning. L'anonymisation reste l'alternative qui garde
// l'historique.
export default function SupprimerPersonne({ id }: { id: string }) {
  const [impact, setImpact] = useState<{ id: string; valeur: Impact | null } | null>(null);
  useEffect(() => {
    let actif = true;
    lireImpact(id).then((valeur) => { if (actif) setImpact({ id, valeur }); });
    return () => { actif = false; };
  }, [id]);

  const connu = impact?.id === id ? impact.valeur : undefined; // undefined = en cours
  const detail = connu ? decrire(connu) : "";
  const confirm = connu === undefined
    ? "Supprimer DÉFINITIVEMENT cette personne et tout son historique ? Action irréversible.\n\n(Le décompte de ses affectations est encore en cours de lecture.)"
    : connu === null
      ? "Supprimer DÉFINITIVEMENT cette personne et tout son historique ? Action irréversible.\n\n(Le décompte de ses affectations n'a pas pu être lu.)"
      : detail
        ? `Supprimer DÉFINITIVEMENT cette personne ?\n\nSeront effacés avec elle : ${detail}.\n\nAction irréversible. Pour garder l'historique (bilans), choisissez plutôt « Anonymiser ».`
        : "Supprimer DÉFINITIVEMENT cette personne ? Elle n'a aucune affectation, absence, habilitation ni contrat. Action irréversible.";

  return (
    <>
      <ConfirmForm
        action={supprimerPersonne}
        hidden={{ id }}
        label="Supprimer (droit à l'oubli)"
        className="btn-sm"
        confirm={confirm}
      />
      {detail && (
        <p style={{ flexBasis: "100%", margin: "6px 0 0", fontSize: 12, color: connu?.postesAVenir ? "#b45309" : "var(--muted, #64748b)" }}>
          {connu?.postesAVenir ? "⚠ " : ""}La supprimer effacerait : {detail}.
        </p>
      )}
    </>
  );
}
