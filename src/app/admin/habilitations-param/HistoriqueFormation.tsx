"use client";

import { useEffect, useState } from "react";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import type { EvenementFormationAffiche } from "@/app/api/habilitations-param/historique/route";

// Historique d'une formation (Param. Habilitation) : création, changements de
// réglage et recalculs d'échéances. Lecture seule, chargé à l'ouverture.
const LIB_ACTION: Record<EvenementFormationAffiche["action"], string> = {
  creation: "Création",
  modification: "Modification",
  suppression: "Suppression",
};

function dateHeure(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoriqueFormation({ id, nom, onClose }: { id: string; nom: string; onClose: () => void }) {
  const [evts, setEvts] = useState<EvenementFormationAffiche[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    fetch(`/api/habilitations-param/historique?${new URLSearchParams({ id })}`)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as { evenements?: EvenementFormationAffiche[]; error?: string };
        if (annule) return;
        if (!res.ok) setErr(j.error ?? "Historique indisponible.");
        else setEvts(j.evenements ?? []);
      })
      .catch(() => !annule && setErr("Historique indisponible."));
    return () => {
      annule = true;
    };
  }, [id]);

  const td: React.CSSProperties = { padding: "4px 6px", borderTop: "1px solid #eceef1", verticalAlign: "top" };

  return (
    <ModaleDeplacable onClose={onClose} largeur={760} zIndex={80}>
      <div className="mdd-drag" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, cursor: "grab" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Historique — {nom || "formation"}</h2>
        <button type="button" onClick={onClose} title="Fermer" style={{ width: "auto", margin: 0, padding: "2px 10px", fontSize: 16 }}>
          ✕
        </button>
      </div>
      {err && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{err}</p>}
      {!err && evts === null && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Chargement…</p>}
      {!err && evts && evts.length === 0 && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Aucun événement enregistré pour cette formation.</p>
      )}
      {!err && evts && evts.length > 0 && (
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "3px 6px", width: 120 }}>Le</th>
                <th style={{ padding: "3px 6px", width: 100 }}>Événement</th>
                <th style={{ padding: "3px 6px" }}>Détail</th>
                <th style={{ padding: "3px 6px", width: 140 }}>Par</th>
              </tr>
            </thead>
            <tbody>
              {evts.map((e) => (
                <tr key={e.id} style={{ color: e.action === "suppression" ? "var(--danger)" : undefined }}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{dateHeure(e.le)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{LIB_ACTION[e.action]}</td>
                  <td style={td}>
                    {e.changements.map((c) => (
                      <div key={c.champ}>
                        <span className="muted">{c.champ} : </span>
                        {e.action === "creation" ? (
                          c.apres
                        ) : (
                          <>
                            {c.avant} → <strong>{c.apres}</strong>
                          </>
                        )}
                      </div>
                    ))}
                    {e.echeancesRecalculees !== null && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {e.echeancesRecalculees} échéance{e.echeancesRecalculees > 1 ? "s" : ""} recalculée
                        {e.echeancesRecalculees > 1 ? "s" : ""}
                      </div>
                    )}
                  </td>
                  <td style={td}>{e.auteur ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModaleDeplacable>
  );
}
