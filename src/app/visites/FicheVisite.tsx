"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import type { LigneVisite, TypeVisite, UsageAnci, VisiteRow } from "@/lib/visites-data";
import {
  AVIS,
  COULEUR_STATUT,
  LIBELLE_STATUT,
  REGIME_CODES,
  delaiTexte,
  fmtFr,
  libelleAvis,
  libelleRegime,
  type RegimeCode,
} from "@/lib/visites";

// Fiche d'une personne : pourquoi son régime, ce qui est dû, ce qui a été fait,
// et la saisie d'une visite. Aucun champ ne recueille d'information médicale —
// l'avis est un choix parmi quatre, le commentaire est logistique, et une
// contrainte d'affectation ne porte pas de motif.
export default function FicheVisite({
  ligne,
  types,
  usages,
  quarts,
  postes,
  aujourdhui,
  canEdit,
  onClose,
}: {
  ligne: LigneVisite;
  types: TypeVisite[];
  usages: UsageAnci[];
  quarts: { code: string; libelle: string }[];
  postes: { id: string; nom: string }[];
  aujourdhui: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [edite, setEdite] = useState<VisiteRow | null>(null);

  const typesActifs = types.filter((t) => t.actif);
  const usagesActifs = usages.filter((u) => u.actif);
  const usageLabel = (code: string) => usages.find((u) => u.code === code)?.libelle ?? code;
  const typeLabel = (id: string) => types.find((t) => t.id === id)?.libelle ?? "Visite";

  const vide = (): VisiteRow => ({
    id: "",
    personne_id: ligne.id,
    type_id: typesActifs[0]?.id ?? "",
    date_rdv: null,
    date_visite: null,
    avis: null,
    prochaine_date: null,
    commentaire: null,
    anci: [],
  });
  const saisie = edite ?? vide();

  async function envoyer(payload: Record<string, unknown>): Promise<boolean> {
    setEnCours(true);
    setMsg(null);
    const res = await fetch("/api/visites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setEnCours(false);
    if (!res || !res.ok) {
      const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setMsg(j.error ?? "Échec de l'enregistrement.");
      return false;
    }
    router.refresh();
    return true;
  }

  const champ: React.CSSProperties = { fontSize: 13, padding: "4px 6px", width: "100%" };
  const bloc: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" };
  const cs = COULEUR_STATUT[ligne.statut];

  const visitesTriees = [...ligne.visites].sort((a, b) =>
    (b.date_visite ?? b.date_rdv ?? "").localeCompare(a.date_visite ?? a.date_rdv ?? ""),
  );

  return (
    <ModaleDeplacable onClose={onClose} largeur={1020} zIndex={90}>
      <div className="mdd-drag" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", cursor: "grab", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          {ligne.nom} {ligne.prenom}
        </h2>
        <span className="muted" style={{ fontSize: 13 }}>
          {ligne.matricule ?? "sans matricule"} · {ligne.equipe} · {ligne.atelier}
          {ligne.arrivee ? ` · arrivé(e) le ${fmtFr(ligne.arrivee)}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: cs.bg, color: cs.fg }}>
          {LIBELLE_STATUT[ligne.statut]} · {libelleRegime(ligne.regime)}
        </span>
      </div>

      {msg && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{msg}</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div style={bloc}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Pourquoi ce régime</h3>
            {ligne.raisons.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Aucun déclencheur : suivi simple.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {ligne.raisons.map((r, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>
                    <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginRight: 6 }}>
                      {r.source === "quart" ? "quart" : r.source === "poste" ? "poste" : r.source === "habilitation" ? "habilitation" : "saisi"}
                    </span>
                    {r.texte}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={ligne.suiviAdapte}
                  disabled={!canEdit || enCours}
                  onChange={(e) =>
                    void envoyer({
                      op: "suivi.set",
                      personne_id: ligne.id,
                      suivi_adapte: e.target.checked,
                      regime_force: ligne.regimeForce ?? "",
                    })
                  }
                  style={{ width: "auto" }}
                />
                Suivi adapté
              </label>
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                Régime imposé
                <select
                  value={ligne.regimeForce ?? ""}
                  disabled={!canEdit || enCours}
                  onChange={(e) =>
                    void envoyer({
                      op: "suivi.set",
                      personne_id: ligne.id,
                      suivi_adapte: ligne.suiviAdapte,
                      regime_force: e.target.value,
                    })
                  }
                  style={{ fontSize: 12.5 }}
                >
                  <option value="">aucun (calculé)</option>
                  {REGIME_CODES.map((r: RegimeCode) => (
                    <option key={r} value={r}>
                      {libelleRegime(r)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
              « Suivi adapté » se coche sans motif : la raison médicale reste chez le médecin du
              travail.
            </p>
          </div>

          <div style={bloc}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Ce qui est dû</h3>
            {ligne.prochaine ? (
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong>{ligne.prochaine.libelle}</strong>
                <span className="muted" style={{ display: "block", fontSize: 12 }}>
                  {ligne.prochaine.due
                    ? `${fmtFr(ligne.prochaine.due)} · ${delaiTexte(ligne.prochaine.due, aujourdhui)} · ${ligne.prochaine.motif}`
                    : ligne.prochaine.motif}
                </span>
              </p>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Aucune échéance calculable.</p>
            )}
            {ligne.ancisRequis.length > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 13 }}>
                Attestations exigées :{" "}
                {ligne.ancisRequis.map((u) => (
                  <span
                    key={u}
                    style={{
                      fontSize: 11.5,
                      borderRadius: 4,
                      padding: "1px 6px",
                      marginRight: 4,
                      background: ligne.anciManquants.includes(u) ? "#fff7ed" : "#e3f4e8",
                      color: ligne.anciManquants.includes(u) ? "#9a3412" : "#15803d",
                      border: `1px solid ${ligne.anciManquants.includes(u) ? "#fdba74" : "#86efac"}`,
                    }}
                  >
                    {usageLabel(u)} {ligne.anciManquants.includes(u) ? "· à renouveler" : "· valable"}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div style={bloc}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Contraintes d&apos;affectation</h3>
            {ligne.contraintes.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Aucune.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {ligne.contraintes.map((c) => (
                  <li key={c.id} style={{ marginBottom: 4 }}>
                    Pas de{" "}
                    <strong>
                      {c.quart_code
                        ? `quart ${quarts.find((q) => q.code === c.quart_code)?.libelle ?? c.quart_code}`
                        : `poste ${postes.find((p) => p.id === c.poste_id)?.nom ?? "inconnu"}`}
                    </strong>{" "}
                    du {fmtFr(c.date_debut)} {c.date_fin ? `au ${fmtFr(c.date_fin)}` : "(sans fin prévue)"}
                    {canEdit && (
                      <button
                        type="button"
                        className="btn-sm btn-ghost"
                        style={{ color: "var(--danger)", margin: "0 0 0 6px", padding: 0 }}
                        disabled={enCours}
                        onClick={() => void envoyer({ op: "contrainte.delete", id: c.id })}
                        title="Retirer la contrainte"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <AjoutContrainte personneId={ligne.id} quarts={quarts} postes={postes} envoyer={envoyer} enCours={enCours} />}
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
              Une contrainte ne dit jamais pourquoi. Elle peut faire apparaître un avertissement au
              Placement, si ce cas est activé dans les paramètres.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div style={bloc}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>
              {edite?.id ? "Modifier la visite" : "Planifier ou enregistrer une visite"}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 12, gridColumn: "span 2" }}>
                Type
                <select
                  value={saisie.type_id}
                  disabled={!canEdit}
                  onChange={(e) => setEdite({ ...saisie, type_id: e.target.value })}
                  style={champ}
                >
                  {typesActifs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.libelle}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Rendez-vous le
                <input
                  type="date"
                  value={saisie.date_rdv ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setEdite({ ...saisie, date_rdv: e.target.value || null })}
                  style={champ}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Réalisée le
                <input
                  type="date"
                  value={saisie.date_visite ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setEdite({ ...saisie, date_visite: e.target.value || null })}
                  style={champ}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Avis rendu
                <select
                  value={saisie.avis ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setEdite({ ...saisie, avis: e.target.value || null })}
                  style={champ}
                >
                  <option value="">—</option>
                  {AVIS.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.libelle}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Prochaine visite fixée au
                <input
                  type="date"
                  value={saisie.prochaine_date ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setEdite({ ...saisie, prochaine_date: e.target.value || null })}
                  style={champ}
                />
              </label>
              <label style={{ fontSize: 12, gridColumn: "span 2" }}>
                Commentaire (logistique seulement)
                <input
                  value={saisie.commentaire ?? ""}
                  disabled={!canEdit}
                  placeholder="ex. convoqué, absent au rendez-vous"
                  onChange={(e) => setEdite({ ...saisie, commentaire: e.target.value || null })}
                  style={champ}
                />
              </label>
            </div>
            {usagesActifs.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Attestations délivrées par cette visite</span>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
                  {usagesActifs.map((u) => (
                    <label key={u.id} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={saisie.anci.includes(u.code)}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setEdite({
                            ...saisie,
                            anci: e.target.checked ? [...saisie.anci, u.code] : saisie.anci.filter((x) => x !== u.code),
                          })
                        }
                        style={{ width: "auto" }}
                      />
                      {u.libelle}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {canEdit && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-sm"
                  disabled={enCours || !saisie.type_id}
                  onClick={async () => {
                    const ok = await envoyer({ op: "visite.save", ...saisie, personne_id: ligne.id });
                    if (ok) setEdite(null);
                  }}
                >
                  Enregistrer
                </button>
                {edite?.id && (
                  <button type="button" className="btn-sm btn-ghost" onClick={() => setEdite(null)} disabled={enCours}>
                    Annuler
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={bloc}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Historique</h3>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>Type</th>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>Avis</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {visitesTriees.map((v) => (
                  <tr key={v.id} style={{ borderTop: "1px solid #eceef1" }}>
                    <td style={{ padding: "3px 4px", fontVariantNumeric: "tabular-nums" }}>
                      {v.date_visite ? fmtFr(v.date_visite) : `RDV ${fmtFr(v.date_rdv)}`}
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      {typeLabel(v.type_id)}
                      {v.anci.length > 0 && (
                        <span className="muted" style={{ display: "block", fontSize: 11 }}>
                          attestation : {v.anci.map(usageLabel).join(", ")}
                        </span>
                      )}
                      {v.commentaire && (
                        <span className="muted" style={{ display: "block", fontSize: 11 }}>{v.commentaire}</span>
                      )}
                    </td>
                    <td style={{ padding: "3px 4px" }}>{libelleAvis(v.avis)}</td>
                    <td style={{ padding: "3px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="btn-sm btn-ghost"
                            style={{ margin: 0, padding: 0 }}
                            onClick={() => setEdite(v)}
                            title="Modifier"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="btn-sm btn-ghost"
                            style={{ color: "var(--danger)", margin: "0 0 0 6px", padding: 0 }}
                            disabled={enCours}
                            onClick={async () => {
                              if (!window.confirm("Supprimer cette visite de l'historique ?")) return;
                              const ok = await envoyer({ op: "visite.delete", id: v.id });
                              if (ok && edite?.id === v.id) setEdite(null);
                            }}
                            title="Supprimer"
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {visitesTriees.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ padding: "6px 4px" }}>
                      Aucune visite enregistrée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ModaleDeplacable>
  );
}

// Ajout d'une contrainte : quart OU poste, sur une période. Volontairement
// minimal — aucun champ ne recueille de motif.
function AjoutContrainte({
  personneId,
  quarts,
  postes,
  envoyer,
  enCours,
}: {
  personneId: string;
  quarts: { code: string; libelle: string }[];
  postes: { id: string; nom: string }[];
  envoyer: (p: Record<string, unknown>) => Promise<boolean>;
  enCours: boolean;
}) {
  const [cible, setCible] = useState("");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");

  const champ: React.CSSProperties = { fontSize: 12.5, padding: "3px 5px" };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
      <label style={{ fontSize: 12 }}>
        Exclure
        <select value={cible} onChange={(e) => setCible(e.target.value)} style={{ ...champ, display: "block", maxWidth: 220 }}>
          <option value="">choisir…</option>
          <optgroup label="Quart">
            {quarts.map((q) => (
              <option key={q.code} value={`q:${q.code}`}>
                {q.libelle}
              </option>
            ))}
          </optgroup>
          <optgroup label="Poste">
            {postes.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.nom}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label style={{ fontSize: 12 }}>
        Du
        <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={{ ...champ, display: "block" }} />
      </label>
      <label style={{ fontSize: 12 }}>
        Au (facultatif)
        <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} style={{ ...champ, display: "block" }} />
      </label>
      <button
        type="button"
        className="btn-sm btn-ghost"
        disabled={enCours || !cible || !debut}
        onClick={async () => {
          const ok = await envoyer({
            op: "contrainte.add",
            personne_id: personneId,
            quart_code: cible.startsWith("q:") ? cible.slice(2) : "",
            poste_id: cible.startsWith("p:") ? cible.slice(2) : "",
            date_debut: debut,
            date_fin: fin,
          });
          if (ok) {
            setCible("");
            setDebut("");
            setFin("");
          }
        }}
      >
        Ajouter
      </button>
    </div>
  );
}
