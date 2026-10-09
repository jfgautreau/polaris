"use client";

import ModaleDeplacable from "@/components/ModaleDeplacable";
import HabMark from "./HabMark";
import AutorisationMark from "./AutorisationMark";

const LIGNES: { statut: "vert" | "orange" | "rouge" | "aucun"; titre: string; texte: string }[] = [
  { statut: "vert", titre: "Valable", texte: "plus de 90 jours avant échéance, ou formation sans date de validité." },
  { statut: "orange", titre: "Bientôt dépassée", texte: "moins de 90 jours avant échéance : à replanifier." },
  { statut: "rouge", titre: "Plus valide", texte: "échéance dépassée." },
  { statut: "aucun", titre: "Non habilité", texte: "aucune formation enregistrée pour cette personne sur ce poste." },
];

export default function HabLegendeModal({ onClose }: { onClose: () => void }) {
  return (
    <ModaleDeplacable onClose={onClose} largeur={720}>
        <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Statut des habilitations</h2>
          <button type="button" className="btn-sm btn-ghost" onClick={onClose} style={{ width: "auto" }}>
            ✕
          </button>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {LIGNES.map((l) => (
            <li key={l.statut} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ flexShrink: 0 }}>
                <HabMark statut={l.statut} />
              </span>
              <span>
                <strong>{l.titre}</strong> — {l.texte}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7 }}>
          <AutorisationMark size={16} />
          <span>
            en bas d&apos;une colonne = formation soumise à <strong>autorisation</strong>{" "}
            (date propre à chaque personne, visible dans l&apos;infobulle de la case).
          </span>
        </p>
        <p className="muted" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 3, background: "#e5e7eb", border: "1px solid #cbd5e1" }} />
          <span>
            case grise = habilitation <strong>supprimée</strong> ; le détail reste dans
            l&apos;historique de la case.
          </span>
        </p>
        <p className="muted" style={{ marginTop: 6, fontWeight: 600 }}>
          Saisie : cliquez une pastille de la grille. L&apos;échéance est calculée depuis la date de
          passage et la durée de validité.
        </p>
    </ModaleDeplacable>
  );
}
