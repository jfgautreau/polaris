"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import { fmtDateFr } from "@/lib/habilitations";
import type { EvenementHabilitation } from "@/app/api/habilitations/historique/route";

type Personne = { id: string; nom: string; prenom: string };
type Comp = { id: string; nom: string; duree_validite_mois: number | null; a_autorisation_conduite: boolean };

// Saisie / recyclage d'une habilitation. Ouverte au clic sur une pastille de la
// grille : personne, formation et date du jour sont deja renseignees, il ne reste
// qu'a valider. Les trois champs restent modifiables (mauvaise pastille cliquee,
// passage anterieur a saisir apres coup).
export default function HabMajModal({
  personnes,
  comps,
  initial,
  dateJour,
  onClose,
}: {
  personnes: Personne[];
  comps: Comp[];
  initial: { personneId: string; competenceId: string; dateObtention: string | null; autorisationRemise: boolean; commentaire: string | null };
  dateJour: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [personneId, setPersonneId] = useState(initial.personneId);
  const [competenceId, setCompetenceId] = useState(initial.competenceId);
  // Toujours la date du jour : on saisit une habilitation le jour ou on l'apprend.
  // L'eventuel passage precedent n'est rappele qu'a titre indicatif.
  const [dateObtention, setDateObtention] = useState(dateJour);
  // Autorisation : simple booleen ; la date d'autorisation vaut date_obtention
  // (sous-entendu de l'UI, cf. CLAUDE.md et /api/habilitations).
  const [autorRemise, setAutorRemise] = useState<boolean>(initial.autorisationRemise);
  const [commentaire, setCommentaire] = useState<string>(initial.commentaire ?? "");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  // Suppression : confirmation en deux temps, dans la modale plutot qu'en
  // `confirm()` natif (le reste de l'app n'utilise jamais les boites du navigateur).
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const comp = comps.find((c) => c.id === competenceId);
  // Recyclage : la personne detient deja cette formation (une date etait pre-remplie).
  const recyclage = !!initial.dateObtention;
  // On ne propose la suppression que sur la ligne effectivement ouverte : si l'on
  // change de personne ou de formation dans les listes, la cible n'existe plus
  // forcement et l'on supprimerait autre chose que ce qui est affiche.
  const peutSupprimer =
    recyclage && personneId === initial.personneId && competenceId === initial.competenceId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setErr(null);
    try {
      const res = await fetch("/api/habilitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personne_id: personneId,
          competence_id: competenceId,
          date_obtention: dateObtention,
          autorisation_remise: autorRemise,
          commentaire: commentaire || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Échec de l'enregistrement.");
      }
      router.refresh();
      onClose();
    } catch (e2) {
      setState("error");
      setErr(e2 instanceof Error ? e2.message : "Échec.");
    }
  }

  async function supprimer() {
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch("/api/habilitations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personne_id: initial.personneId, competence_id: initial.competenceId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Échec de la suppression.");
      }
      router.refresh();
      onClose();
    } catch (e2) {
      setDeleting(false);
      setConfirmDel(false);
      setErr(e2 instanceof Error ? e2.message : "Échec.");
    }
  }

  return (
    <ModaleDeplacable onClose={onClose} largeur={720} zIndex={80}>
          <div className="mdd-drag" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, cursor: "grab" }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>{recyclage ? "Recycler une habilitation" : "Enregistrer une habilitation"}</h2>
            <button type="button" onClick={onClose} title="Fermer" style={{ width: "auto", margin: 0, padding: "2px 10px", fontSize: 16 }}>
              ✕
            </button>
          </div>

          {recyclage && (
            <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>
              Dernier passage le <strong>{fmtDateFr(initial.dateObtention)}</strong>. Enregistrer
              remplace cette date par celle saisie ci-dessous.
            </p>
          )}

          <form onSubmit={submit} autoComplete="off" className="inline-form">
            <div className="field">
              <span>Personne</span>
              <select value={personneId} onChange={(e) => setPersonneId(e.target.value)} required>
                <option value="" disabled>Choisir...</option>
                {personnes.map((p) => (
                  <option key={p.id} value={p.id}>{p.nom} {p.prenom}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>Habilitation</span>
              <select value={competenceId} onChange={(e) => setCompetenceId(e.target.value)} required>
                <option value="" disabled>Choisir...</option>
                {comps.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}{c.duree_validite_mois ? ` (${c.duree_validite_mois} mois)` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>Date de passage</span>
              <input type="date" value={dateObtention} onChange={(e) => setDateObtention(e.target.value)} required />
            </div>
            {comp?.a_autorisation_conduite && (
              <div className="field" style={{ flex: "1 1 100%" }}>
                <span>Autorisation</span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={autorRemise}
                    onChange={(e) => setAutorRemise(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  <span>remise (date = date de passage)</span>
                </label>
              </div>
            )}
            <div className="field" style={{ flex: "1 1 100%" }}>
              <span>Commentaire</span>
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                rows={2}
                placeholder="Optionnel : n° d'autorisation, réserve du formateur…"
                style={{ resize: "vertical", minHeight: 44, fontFamily: "inherit", width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 100%", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" className="btn-sm" disabled={state === "saving"}>
                {state === "saving" ? "Enregistrement…" : "Enregistrer"}
              </button>

            {peutSupprimer && !confirmDel && (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                title="Supprimer cette habilitation"
                className="btn-sm"
                style={{
                  background: "#fff",
                  // Fond clair : la couleur du texte doit etre posee explicitement,
                  // le style global des boutons impose du blanc (cf. CLAUDE.md).
                  color: "var(--danger)",
                  border: "1px solid var(--danger)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
                Supprimer
              </button>
            )}

            {peutSupprimer && confirmDel && (
              <>
                <button
                  type="button"
                  onClick={supprimer}
                  disabled={deleting}
                  className="btn-sm"
                  style={{ background: "var(--danger)", color: "#fff", border: "1px solid var(--danger)" }}
                >
                  {deleting ? "Suppression…" : "Confirmer la suppression"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDel(false)}
                  disabled={deleting}
                  className="btn-sm btn-ghost"
                >
                  Annuler
                </button>
              </>
            )}
            </div>
          </form>

          {peutSupprimer && confirmDel && (
            <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8, marginBottom: 0 }}>
              L&apos;habilitation sera retirée du dossier de la personne. Elle restera visible
              dans l&apos;historique ci-dessous.
            </p>
          )}

          {err && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 0 }}>{err}</p>}
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            L&apos;expiration est calculée automatiquement (passage + durée de validité).
          </p>

          <HistoriqueHabilitation personneId={initial.personneId} competenceId={initial.competenceId} />
    </ModaleDeplacable>
  );
}

// Historique de l'habilitation ouverte (migration 0084) : rien n'est perdu à la
// suppression ni au recyclage. Chargé à l'ouverture, pour le couple
// personne × habilitation de la pastille cliquée.
const LIB_ACTION: Record<EvenementHabilitation["action"], string> = {
  ajout: "Ajout",
  modification: "Modification",
  suppression: "Suppression",
};

function HistoriqueHabilitation({ personneId, competenceId }: { personneId: string; competenceId: string }) {
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
