"use client";

import { useEffect, useState } from "react";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import { fmtDateFr } from "@/lib/habilitations";
import type { EvenementHabilitation } from "@/app/api/habilitations/historique/route";

// Historique de l'habilitation ouverte (migration 0084) : rien n'est perdu à la
// suppression ni au recyclage. Chargé à l'ouverture, pour le couple
// personne × habilitation de la pastille cliquée.
const LIB_ACTION: Record<EvenementHabilitation["action"], string> = {
  ajout: "Ajout",
  modification: "Modification",
  suppression: "Suppression",
};

export default function HistoriqueHabilitation({ personneId, competenceId }: { personneId: string; competenceId: string }) {
  const [evts, setEvts] = useState<EvenementHabilitation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!personneId || !competenceId) return;
    let annule = false;
    const qs = new URLSearchParams({ personne_id: personneId, competence_id: competenceId });
    fetch(`/api/habilitations/historique?${qs}`)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as { evenements?: EvenementHabilitation[]; error?: string };
        if (annule) return;
        if (!res.ok) setErr(j.error ?? "Historique indisponible.");
        else setEvts(j.evenements ?? []);
      })
      .catch(() => !annule && setErr("Historique indisponible."));
    return () => {
      annule = true;
    };
  }, [personneId, competenceId]);

  if (!personneId || !competenceId) return null;
  const td: React.CSSProperties = { padding: "3px 6px", borderTop: "1px solid #eceef1", verticalAlign: "top" };

  return (
    <div style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>Historique</h3>
      {err && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{err}</p>}
      {!err && evts === null && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Chargement…</p>}
      {!err && evts && evts.length === 0 && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Aucun événement enregistré.</p>
      )}
      {!err && evts && evts.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "3px 6px" }}>Le</th>
                <th style={{ padding: "3px 6px" }}>Événement</th>
                <th style={{ padding: "3px 6px" }}>Passage</th>
                <th style={{ padding: "3px 6px" }}>Expiration</th>
                <th style={{ padding: "3px 6px" }}>Commentaire</th>
                <th style={{ padding: "3px 6px" }}>Par</th>
              </tr>
            </thead>
            <tbody>
              {evts.map((e, i) => {
                // Une modification qui change la date de passage est un recyclage.
                const avant = evts[i + 1];
                const libelle =
                  e.action === "modification" && avant && avant.date_obtention !== e.date_obtention
                    ? "Recyclage"
                    : LIB_ACTION[e.action];
                const supp = e.action === "suppression";
                return (
                  <tr key={e.id} style={{ color: supp ? "var(--danger)" : undefined }}>
                    <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDateFr(e.created_at.slice(0, 10))}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{libelle}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", textDecoration: supp ? "line-through" : undefined }}>
                      {fmtDateFr(e.date_obtention)}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", textDecoration: supp ? "line-through" : undefined }}>
                      {fmtDateFr(e.date_expiration)}
                    </td>
                    <td style={td}>{e.commentaire ?? <span className="muted">—</span>}</td>
                    <td style={td}>{e.auteur ?? <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// Consultation seule de l'historique (vue Liste, droit de lecture suffisant) :
// on y retrouve aussi une habilitation supprimée et ses dates.
export function HabHistoriqueModal({
  personneId,
  competenceId,
  titre,
  onClose,
}: {
  personneId: string;
  competenceId: string;
  titre: string;
  onClose: () => void;
}) {
  return (
    <ModaleDeplacable onClose={onClose} largeur={760} zIndex={80}>
      <div className="mdd-drag" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, cursor: "grab" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{titre}</h2>
        <button type="button" onClick={onClose} title="Fermer" style={{ width: "auto", margin: 0, padding: "2px 10px", fontSize: 16 }}>
          ✕
        </button>
      </div>
      <HistoriqueHabilitation personneId={personneId} competenceId={competenceId} />
    </ModaleDeplacable>
  );
}
