"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultQuartActif } from "@/lib/week";

type Quart = { code: string; libelle: string; ordre: number; creneau: string | null };
type Ligne = { id: string; nom: string; atelierNom: string; quarts: string[] };
type Profil = { id: string; nom: string; par_defaut: boolean };

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
// iso de reference par jour de semaine (fallback defaultQuartActif : 2024-01-01 = lundi).
const REF_ISO = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06", "2024-01-07"];

const NAME_W = 160;
const QCOL_W = 46;

function abbr(libelle: string) {
  return libelle.replace(/[^0-9A-Za-zÀ-ÿ]/g, "").slice(0, 3);
}

export default function SemaineTypeEditor({
  columnQuarts,
  journeeQuart,
  lignes = [],
  initial,
  initialOuverture = {},
  profils = [],
  profilId = null,
}: {
  columnQuarts: Quart[];
  journeeQuart: Quart | null;
  lignes?: Ligne[];
  initial: Record<string, boolean>; // `${code}:${jour 0-6}` -> actif
  initialOuverture?: Record<string, boolean>; // `${code}:${ligne}:${jour 0-6}` -> ouverte
  profils?: Profil[];
  profilId?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, boolean>>(initial);
  const [ouv, setOuv] = useState<Record<string, boolean>>(initialOuverture);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const rotatingCodes = columnQuarts.map((q) => q.code);
  const ncq = columnQuarts.length || 1;
  // Lignes affichables dans la grille du haut : au moins un quart colonne
  // (matin / après-midi / nuit). Une ligne « journée seule » n'aurait que des
  // « · » ici → on ne crée pas sa rangée (elle reste dans la section Journée).
  const gridLignes = lignes.filter((l) => l.quarts.some((c) => rotatingCodes.includes(c)));

  const goProfil = (id: string) => router.push(`/ordonnancement/semaine-type?profil=${id}`);
  async function profilOp(op: string, payload: Record<string, unknown>) {
    const res = await fetch("/api/ordonnancement/semaine-type-profil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, ...payload }),
    });
    return res.ok ? ((await res.json().catch(() => ({}))) as { row?: Profil }) : null;
  }
  async function newProfil() {
    const nom = window.prompt("Nom du nouveau profil (ex. Été) :", "")?.trim();
    if (!nom) return;
    const j = await profilOp("create", { nom });
    if (j?.row) goProfil(j.row.id);
  }
  async function renameProfil() {
    if (!profilId) return;
    const cur = profils.find((p) => p.id === profilId);
    const nom = window.prompt("Renommer le profil :", cur?.nom ?? "")?.trim();
    if (!nom) return;
    if (await profilOp("rename", { id: profilId, nom })) router.refresh();
  }
  async function deleteProfil() {
    if (!profilId) return;
    if (profils.length <= 1) { window.alert("Impossible de supprimer le dernier profil."); return; }
    if (!window.confirm("Supprimer ce profil de semaine type ? Son gabarit sera perdu.")) return;
    if (await profilOp("delete", { id: profilId })) router.push("/ordonnancement/semaine-type");
  }
  async function setDefaultProfil() {
    if (!profilId) return;
    if (await profilOp("set-default", { id: profilId })) router.refresh();
  }

  const flash = (ok: boolean) => {
    setSave(ok ? "saved" : "error");
    setTimeout(() => setSave("idle"), 1500);
  };

  const actif = (code: string, j: number) => {
    const k = `${code}:${j}`;
    return k in state ? state[k] : defaultQuartActif(REF_ISO[j], code);
  };
  // Journée DÉRIVÉE : active dès qu'un quart tournant l'est ce jour-là.
  const journeeActif = (j: number) => rotatingCodes.some((c) => actif(c, j));
  const quartActifPourLigne = (code: string, j: number) =>
    journeeQuart && code === journeeQuart.code ? journeeActif(j) : actif(code, j);

  const ligneOuverte = (code: string, lg: string, j: number) => {
    const k = `${code}:${lg}:${j}`;
    return k in ouv ? ouv[k] : true;
  };

  async function toggle(code: string, j: number) {
    if (!profilId) return;
    const next = !actif(code, j);
    setState((s) => ({ ...s, [`${code}:${j}`]: next }));
    setSave("saving");
    try {
      const res = await fetch("/api/ordonnancement/semaine-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profil_id: profilId, quart_code: code, jour_semaine: j, value: next }),
      });
      flash(res.ok);
    } catch {
      flash(false);
    }
  }

  async function toggleLigne(code: string, lg: string, j: number) {
    if (!profilId || !quartActifPourLigne(code, j)) return; // quart inactif -> lignes fermées
    const next = !ligneOuverte(code, lg, j);
    setOuv((s) => ({ ...s, [`${code}:${lg}:${j}`]: next }));
    setSave("saving");
    try {
      const res = await fetch("/api/ordonnancement/semaine-type-ouverture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profil_id: profilId, quart_code: code, ligne_id: lg, jour_semaine: j, value: next }),
      });
      flash(res.ok);
    } catch {
      flash(false);
    }
  }

  const sepDay: React.CSSProperties = { borderLeft: "2px solid #94a3b8" };
  const dowRed = (j: number) => (j === 6 ? { color: "var(--danger)" } : undefined);

  const groupsFrom = (src: Ligne[]) => {
    const out: { atelierNom: string; lignes: Ligne[] }[] = [];
    for (const l of src) {
      let g = out[out.length - 1];
      if (!g || g.atelierNom !== l.atelierNom) { g = { atelierNom: l.atelierNom, lignes: [] }; out.push(g); }
      g.lignes.push(l);
    }
    return out;
  };

  const gridStyle: React.CSSProperties = {
    borderCollapse: "collapse",
    tableLayout: "fixed",
    width: "100%",
    minWidth: NAME_W + JOURS.length * ncq * QCOL_W,
  };
  const ColsGrid = () => (
    <colgroup>
      <col style={{ width: NAME_W }} />
      {JOURS.map((_, j) => columnQuarts.map((q) => <col key={`${j}:${q.code}`} style={{ width: QCOL_W }} />))}
    </colgroup>
  );

  const gridCell = (l: Ligne, j: number, q: Quart, firstOfDay: boolean) => {
    const dispo = l.quarts.includes(q.code);
    const on = actif(q.code, j);
    const open = ligneOuverte(q.code, l.id, j);
    const border: React.CSSProperties = firstOfDay ? sepDay : { borderLeft: "1px solid #eef2f7" };
    const ck = `${j}:${q.code}`;
    if (!dispo) {
      return <td key={ck} style={{ textAlign: "center", background: "#f8fafc", color: "#cbd5e1", ...border }} title={`Cette ligne ne tourne pas en ${q.libelle}`}>·</td>;
    }
    return (
      <td key={ck} style={{ textAlign: "center", background: !on ? "#f1f5f9" : open ? undefined : "#fee2e2", ...border }} title={on ? `${l.nom} — ${q.libelle} — ${open ? "ouverte" : "fermée"}` : `${q.libelle} inactif`}>
        <input type="checkbox" checked={open} disabled={!on} onChange={() => toggleLigne(q.code, l.id, j)} style={{ width: "auto", margin: "0 auto", display: "block", cursor: on ? "pointer" : "not-allowed" }} />
      </td>
    );
  };

  return (
    <div className="card section" style={{ overflowX: "auto" }}>
      {/* Sélecteur de profil + gestion */}
      <div className="toolbar" style={{ alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span className="muted" style={{ fontWeight: 600 }}>Profil :</span>
        <select value={profilId ?? ""} onChange={(e) => e.target.value && goProfil(e.target.value)} disabled={profils.length === 0} style={{ width: "auto", minWidth: 180 }}>
          {profils.length === 0 && <option value="">Aucun profil</option>}
          {profils.map((p) => (
            <option key={p.id} value={p.id}>{p.nom}{p.par_defaut ? " · défaut" : ""}</option>
          ))}
        </select>
        <button type="button" className="btn-sm btn-ghost" style={{ width: "auto" }} onClick={newProfil}>＋ Nouveau</button>
        <button type="button" className="btn-sm btn-ghost" style={{ width: "auto" }} onClick={renameProfil} disabled={!profilId}>Renommer</button>
        <button type="button" className="btn-sm btn-ghost" style={{ width: "auto" }} onClick={setDefaultProfil} disabled={!profilId || !!profils.find((p) => p.id === profilId)?.par_defaut}>Définir par défaut</button>
        <button type="button" className="btn-sm btn-ghost" style={{ width: "auto", color: "var(--danger)" }} onClick={deleteProfil} disabled={!profilId || profils.length <= 1}>Supprimer</button>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: save === "error" ? "var(--danger)" : save === "saved" ? "var(--ok)" : "var(--muted)" }}>
          {save === "saving" ? "Enregistrement…" : save === "saved" ? "Enregistré ✓" : save === "error" ? "Échec" : ""}
        </span>
      </div>
      {profils.length === 0 && (
        <p className="muted" style={{ marginTop: -4 }}>Aucun profil : créez-en un (« ＋ Nouveau ») pour commencer.</p>
      )}

      {columnQuarts.length === 0 ? (
        <p className="muted">Aucun quart en rotation configuré.</p>
      ) : (
        <>
          {/* Grille unique : Activation (quarts tournants) + lignes par atelier. */}
          <table className="matrix rowh" style={gridStyle}>
            <ColsGrid />
            <thead>
              <tr>
                <th rowSpan={2} style={{ width: NAME_W, textAlign: "left", verticalAlign: "bottom" }}>Ligne</th>
                {JOURS.map((jl, j) => (
                  <th key={j} colSpan={ncq} style={{ textAlign: "center", ...sepDay, ...dowRed(j) }}>{jl}</th>
                ))}
              </tr>
              <tr>
                {JOURS.map((_, j) =>
                  columnQuarts.map((q, qi) => (
                    <th key={`${j}:${q.code}`} style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569", padding: "2px 0", ...(qi === 0 ? sepDay : { borderLeft: "1px solid #eef2f7" }) }} title={q.libelle}>
                      {abbr(q.libelle)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {/* Ligne « Activation » : bascule des quarts tournants par jour. */}
              <tr>
                <td style={{ whiteSpace: "nowrap", fontWeight: 700, background: "#f1f5f9" }}>Activation</td>
                {JOURS.map((_, j) =>
                  columnQuarts.map((q, qi) => {
                    const on = actif(q.code, j);
                    return (
                      <td key={`${j}:${q.code}`} style={{ textAlign: "center", background: on ? "#dcfce7" : "#fee2e2", ...(qi === 0 ? sepDay : { borderLeft: "1px solid #eef2f7" }) }} title={`${q.libelle} — ${on ? "actif" : "inactif"}`}>
                        <input type="checkbox" checked={on} disabled={!profilId} onChange={() => toggle(q.code, j)} style={{ width: "auto", margin: "0 auto", display: "block", cursor: profilId ? "pointer" : "default" }} />
                      </td>
                    );
                  })
                )}
              </tr>
              {groupsFrom(gridLignes).map((g) => (
                <Fragment key={`ate:${g.atelierNom}`}>
                  <tr>
                    <td colSpan={1 + JOURS.length * ncq} style={{ background: "#eef2f7", fontWeight: 700, fontSize: 12, padding: "3px 8px" }}>{g.atelierNom}</td>
                  </tr>
                  {g.lignes.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: "nowrap", paddingLeft: 14 }}>{l.nom}</td>
                      {JOURS.map((_, j) => columnQuarts.map((q, qi) => gridCell(l, j, q, qi === 0)))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {gridLignes.length === 0 && (
                <tr><td colSpan={1 + JOURS.length * ncq} className="muted">Aucune ligne active.</td></tr>
              )}
            </tbody>
          </table>

          {/* Journée : à part, activation DÉRIVÉE. Colonnes alignées (colgroup partagé). */}
          {journeeQuart && (() => {
            const jLignes = lignes.filter((l) => l.quarts.includes(journeeQuart.code));
            return (
              <div style={{ marginTop: 22 }}>
                <h2 style={{ margin: "0 0 2px", fontSize: 16 }}>{journeeQuart.libelle} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(pleine journée — active dès qu&apos;un quart tourne)</span></h2>
                <table className="matrix rowh" style={gridStyle}>
                  <ColsGrid />
                  <thead>
                    <tr>
                      <th style={{ width: NAME_W, textAlign: "left" }}>Ligne</th>
                      {JOURS.map((jl, j) => (
                        <th key={j} colSpan={ncq} style={{ textAlign: "center", ...sepDay, ...dowRed(j) }}>{jl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupsFrom(jLignes).map((g) => (
                      <Fragment key={`jate:${g.atelierNom}`}>
                        <tr>
                          <td colSpan={1 + JOURS.length * ncq} style={{ background: "#eef2f7", fontWeight: 700, fontSize: 12, padding: "3px 8px" }}>{g.atelierNom}</td>
                        </tr>
                        {g.lignes.map((l) => (
                          <tr key={l.id}>
                            <td style={{ whiteSpace: "nowrap", paddingLeft: 14 }}>{l.nom}</td>
                            {JOURS.map((_, j) => {
                              const on = journeeActif(j);
                              const open = ligneOuverte(journeeQuart.code, l.id, j);
                              return (
                                <td key={j} colSpan={ncq} style={{ textAlign: "center", background: !on ? "#f1f5f9" : open ? undefined : "#fee2e2", ...sepDay }} title={on ? `${l.nom} — ${open ? "ouverte" : "fermée"}` : "Journée inactive ce jour"}>
                                  <input type="checkbox" checked={open} disabled={!on} onChange={() => toggleLigne(journeeQuart.code, l.id, j)} style={{ width: "auto", margin: "0 auto", display: "block", cursor: on ? "pointer" : "not-allowed" }} />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    {jLignes.length === 0 && (
                      <tr><td colSpan={1 + JOURS.length * ncq} className="muted">Aucune ligne en {journeeQuart.libelle}.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            Ce gabarit définit l&apos;état par défaut appliqué par le bouton <strong>« Initialiser »</strong> d&apos;une semaine.
            La ligne <strong>Activation</strong> pilote matin / après-midi / nuit ; la <strong>journée</strong> est active dès qu&apos;un de ces quarts l&apos;est.
            Décochez une case de ligne pour la fermer par défaut ce jour-là ; une case grise « · » = la ligne ne tourne pas sur ce quart.
          </p>
        </>
      )}
    </div>
  );
}
