"use client";

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import { FillIcon } from "@/components/icons";

type Jour = { iso: string; nom: string; num: string; firstOfWeek?: boolean };
type Quart = { code: string; libelle: string; ordre: number; creneau: string | null };
type Ligne = { id: string; nom: string; atelierNom: string; quarts: string[] };
type WeekBlock = { num: number; year: number; span: number };
type Profil = { id: string; nom: string; par_defaut: boolean };

const NAME_W = 150;
const QCOL_W = 24;

function abbr(libelle: string) {
  return libelle.replace(/[^0-9A-Za-zÀ-ÿ]/g, "").slice(0, 3);
}

export default function OrdoGrid({
  days,
  weekBlocks = [],
  todayIso,
  currentWeekIsos = [],
  quarts,
  columnQuarts,
  journeeQuart,
  lignes,
  jourQuartState,
  ouvertureState,
  profils = [],
  canEdit = true,
}: {
  days: Jour[];
  weekBlocks?: WeekBlock[];
  todayIso: string;
  currentWeekIsos?: string[];
  quarts: Quart[];
  columnQuarts: Quart[];
  journeeQuart: Quart | null;
  lignes: Ligne[];
  jourQuartState: Record<string, boolean>;
  ouvertureState: Record<string, boolean>;
  profils?: Profil[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  // Refs vers les tables Activation / Corps / Journée : le survol d'une case
  // peint le même <col> dans les trois → croix de navigation (colonne + ligne)
  // identique à la Matrice de polyvalence. Écriture directe dans le DOM (aucun
  // rendu React déclenché), gratuit sur des centaines de cellules.
  const activationRef = useRef<HTMLTableElement>(null);
  const bodyRef = useRef<HTMLTableElement>(null);
  const journeeRef = useRef<HTMLTableElement>(null);
  const hoverCol = useRef(-1);
  const paintCol = (index: number, on: boolean) => {
    for (const t of [activationRef.current, bodyRef.current, journeeRef.current]) {
      const col = t?.querySelector("colgroup")?.children[index] as HTMLElement | undefined;
      if (col) col.style.background = on ? "#f6f8fb" : "";
    }
  };
  const onCellOver = (e: React.MouseEvent) => {
    const td = (e.target as HTMLElement).closest("td");
    if (!td) return;
    // Index dans le colgroup partagé : colonne 0 = libellé, puis N colonnes.
    const idx = td.cellIndex;
    // Sur la table Journée, une case couvre ncq colonnes (colSpan). On
    // développe : le cellIndex donne l'index de la 1re col couverte. Pour un
    // survol, on peint la 1re col du jour — plus explicite qu'un halo qui
    // s'élargit inutilement.
    if (idx === hoverCol.current) return;
    if (hoverCol.current > 0) paintCol(hoverCol.current, false);
    hoverCol.current = idx;
    if (idx > 0) paintCol(idx, true);
  };
  const onLeave = () => {
    if (hoverCol.current > 0) paintCol(hoverCol.current, false);
    hoverCol.current = -1;
  };
  const [jq, setJq] = useState<Record<string, boolean>>(jourQuartState);
  const [ov, setOv] = useState<Record<string, boolean>>(ouvertureState);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [initIsos, setInitIsos] = useState<string[] | null>(null);
  // Bandeau d'information après une fermeture qui laisse des affectations en
  // place (décision 2026-09-10) : l'ordo n'a JAMAIS le pouvoir de retirer les
  // gens du planning ; on prévient les ateliers concernés (Condi, Fab…) qu'ils
  // ont un sureffectif à régler. Placement / Planning peignent le compteur en
  // orange sureffectif dès que besoin passe à 0 avec des personnes affectées.
  const [notice, setNotice] = useState<{
    affectes: { nom: string; prenom: string; atelier: string }[];
    ateliers: string[];
    quart: boolean;
  } | null>(null);
  const [conflitReset, setConflitReset] = useState<{
    affectes: { nom: string; prenom: string }[];
    isos: string[];
    profilId?: string;
  } | null>(null);

  const rotatingCodes = columnQuarts.map((q) => q.code);
  // Lignes réellement affichables dans la grille du haut : celles qui tournent sur
  // au moins un quart colonne (matin / après-midi / nuit). Une ligne qui ne tourne
  // que sur la « journée » n'a que des « · » ici → on ne crée pas sa rangée (elle
  // reste visible dans la section Journée en dessous). Idem : un atelier vidé de
  // toutes ses lignes ne crée plus d'en-tête.
  const gridLignes = lignes.filter((l) => l.quarts.some((c) => rotatingCodes.includes(c)));
  const quartActif = (code: string, iso: string) => jq[`${code}:${iso}`] ?? false;
  // Journée : active DÈS QU'un quart tournant l'est (règle métier). On la maintient
  // aussi dans l'état optimiste pour que l'édition des lignes « journée » suive.
  const recomputeJournee = (state: Record<string, boolean>, iso: string) => {
    if (!journeeQuart) return state;
    const or = rotatingCodes.some((c) => state[`${c}:${iso}`] ?? false);
    return { ...state, [`${journeeQuart.code}:${iso}`]: or };
  };
  const journeeActif = (iso: string) => rotatingCodes.some((c) => jq[`${c}:${iso}`] ?? false);

  const dayInitialized = (iso: string) => quarts.some((q) => `${q.code}:${iso}` in jq);

  const blockIsos: string[][] = [];
  {
    let idx = 0;
    for (const w of weekBlocks) {
      blockIsos.push(days.slice(idx, idx + w.span).map((d) => d.iso));
      idx += w.span;
    }
  }

  function resetWeek(isos: string[]) {
    if (!canEdit || !isos.length) return;
    const dejaInit = isos.some((iso) => dayInitialized(iso));
    if (dejaInit && !window.confirm("Cette semaine est déjà initialisée. La ré-initialiser (écraser) avec un profil de semaine type ?")) return;
    setInitIsos(isos);
  }

  async function applyProfil(isos: string[], profilId?: string, force = false) {
    setInitIsos(null);
    setSaving(true);
    setErreur(null);
    try {
      const res = await fetch("/api/ordonnancement/reset-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isos, profil_id: profilId, force }),
      });
      if (res.status === 409) {
        const jc = (await res.json().catch(() => ({}))) as { conflit?: boolean; affectes?: { nom: string; prenom: string }[]; error?: string };
        if (jc.conflit && Array.isArray(jc.affectes)) {
          setConflitReset({ affectes: jc.affectes, isos, profilId });
        } else {
          setErreur(jc.error ?? "Échec.");
        }
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { jq?: Record<string, boolean>; fermetures?: string[]; error?: string };
      if (res.ok) {
        const set = new Set(isos);
        setJq((s) => ({ ...s, ...(j.jq ?? {}) }));
        setOv((s) => {
          const n = { ...s };
          for (const k of Object.keys(n)) if (set.has(k.slice(-10))) delete n[k];
          for (const key of j.fermetures ?? []) n[key] = false;
          return n;
        });
        router.refresh();
      } else {
        setErreur(j.error ?? "Échec.");
      }
    } finally {
      setSaving(false);
    }
  }

  const ligneOuverte = (code: string, lg: string, iso: string) =>
    quartActif(code, iso) ? (ov[`${code}:${lg}:${iso}`] ?? true) : false;

  async function post(body: object, rollback: () => void, quart: boolean) {
    setSaving(true);
    setErreur(null);
    try {
      const res = await fetch("/api/ordonnancement/quart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        rollback();
        setErreur(j.error ?? "Échec.");
        return;
      }
      // Fermeture réussie : la réponse peut porter une liste d'affectations
      // désormais en sureffectif → on affiche un bandeau d'info pour prévenir
      // les ateliers concernés. Ce n'est PAS une erreur, la fermeture est
      // appliquée ; les affectations elles-mêmes ne sont plus supprimées.
      const j = (await res.json().catch(() => ({}))) as {
        affectes?: { nom: string; prenom: string; atelier: string }[];
        ateliers?: string[];
      };
      if (Array.isArray(j.affectes) && j.affectes.length > 0) {
        setNotice({ affectes: j.affectes, ateliers: j.ateliers ?? [], quart });
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  function toggleQuart(code: string, iso: string) {
    if (!canEdit) return;
    const prev = quartActif(code, iso);
    const next = !prev;
    const cle = `${code}:${iso}`;
    const apply = () => setJq((s) => recomputeJournee({ ...s, [cle]: next }, iso));
    const rollback = () => setJq((s) => recomputeJournee({ ...s, [cle]: prev }, iso));
    apply();
    post({ type: "quart", quart_code: code, jour: iso, value: next }, rollback, true);
  }
  function toggleLigne(code: string, lg: string, iso: string) {
    if (!canEdit || !quartActif(code, iso)) return;
    const prev = ligneOuverte(code, lg, iso);
    const next = !prev;
    const cle = `${code}:${lg}:${iso}`;
    const apply = () => setOv((s) => ({ ...s, [cle]: next }));
    const rollback = () => setOv((s) => ({ ...s, [cle]: prev }));
    apply();
    post({ type: "ligne", quart_code: code, ligne_id: lg, jour: iso, value: next }, rollback, false);
  }

  const currentSet = new Set(currentWeekIsos);
  const currentBlockIdx = blockIsos.findIndex((isos) => isos.some((iso) => currentSet.has(iso)));
  const dayBg = (iso: string) => (iso === todayIso ? "#dbeafe" : currentSet.has(iso) ? "#eff6ff" : undefined);
  const sepDay = (d: Jour): React.CSSProperties =>
    d.firstOfWeek ? { borderLeft: "2px solid #94a3b8" } : { borderLeft: "1px solid #e2e8f0" };

  const groupsFrom = (src: Ligne[]) => {
    const out: { atelierNom: string; lignes: Ligne[] }[] = [];
    for (const l of src) {
      let g = out[out.length - 1];
      if (!g || g.atelierNom !== l.atelierNom) { g = { atelierNom: l.atelierNom, lignes: [] }; out.push(g); }
      g.lignes.push(l);
    }
    return out;
  };

  const ncq = columnQuarts.length || 1;
  const gridStyle: React.CSSProperties = {
    borderCollapse: "collapse",
    tableLayout: "fixed",
    width: "100%",
    minWidth: NAME_W + days.length * ncq * QCOL_W,
  };
  // Colgroup PARTAGÉ par la table d'en-tête (figée) et la table de corps
  // (défilante) : colonnes alignées, méthode du Planning.
  const ColsGrid = () => (
    <colgroup>
      <col style={{ width: NAME_W }} />
      {days.map((d) => columnQuarts.map((q) => <col key={`${d.iso}:${q.code}`} style={{ width: QCOL_W }} />))}
    </colgroup>
  );

  const gridCell = (l: Ligne, d: Jour, q: Quart, firstOfDay: boolean) => {
    const dispo = l.quarts.includes(q.code);
    const active = quartActif(q.code, d.iso);
    const on = ligneOuverte(q.code, l.id, d.iso);
    const border: React.CSSProperties = firstOfDay ? sepDay(d) : { borderLeft: "1px solid #eef2f7" };
    const ck = `${d.iso}:${q.code}`;
    if (!dispo) {
      return (
        <td key={ck} style={{ textAlign: "center", background: "#f8fafc", color: "#cbd5e1", ...border }} title={`Cette ligne ne tourne pas en ${q.libelle}`}>
          ·
        </td>
      );
    }
    return (
      <td
        key={ck}
        style={{ textAlign: "center", background: !active ? "#f1f5f9" : on ? undefined : "#fee2e2", ...border }}
        title={active ? `${l.nom} — ${q.libelle} — ${on ? "ouverte" : "fermée"}` : `${q.libelle} inactif ce jour (activez le quart)`}
      >
        <input type="checkbox" checked={on} disabled={!canEdit || !active} onChange={() => toggleLigne(q.code, l.id, d.iso)} style={{ width: "auto", margin: "0 auto", display: "block", cursor: canEdit && active ? "pointer" : "not-allowed" }} />
      </td>
    );
  };

  // En-tête commun (semaines + Initialiser / dates / quarts) — rendu à l'identique
  // dans la carte figée. Pas de première colonne « Ligne » (elle est portée par
  // le corps) : ici la colonne de gauche reçoit la ligne « Activation ».
  const gridHead = (
    <thead>
      <tr>
        <th rowSpan={3} style={{ width: NAME_W, textAlign: "left", verticalAlign: "bottom", background: "#fff" }}>&nbsp;</th>
        {weekBlocks.map((w, i) => {
          const isCurrent = i === currentBlockIdx;
          return (
            <th key={i} colSpan={w.span * ncq} style={{ textAlign: "center", fontSize: 12, borderLeft: "2px solid #94a3b8", background: isCurrent ? "#dbeafe" : "#f8fafc", fontWeight: isCurrent ? 700 : undefined }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {w.year} · S{w.num}
                {isCurrent && <span className="muted" style={{ fontWeight: 400 }}>(en cours)</span>}
                {canEdit && (
                  <button type="button" className="btn-sm btn-ghost" onClick={() => resetWeek(blockIsos[i] ?? [])} title="Initialiser cette semaine avec la semaine type (ré-applique / écrase si déjà fait)" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 6px", fontSize: 12, lineHeight: 1.2 }}>
                    <FillIcon size={13} /> Initialiser
                  </button>
                )}
              </span>
            </th>
          );
        })}
      </tr>
      <tr>
        {days.map((d) => (
          <th key={d.iso} colSpan={ncq} style={{ textAlign: "center", background: dayBg(d.iso) ?? "#fff", ...sepDay(d) }}>
            {d.nom.slice(0, 2)} <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>{d.num}</span>
          </th>
        ))}
      </tr>
      <tr>
        {days.map((d) =>
          columnQuarts.map((q, qi) => (
            <th key={`${d.iso}:${q.code}`} style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: "#475569", padding: "2px 0", background: dayBg(d.iso) ?? "#f8fafc", ...(qi === 0 ? sepDay(d) : { borderLeft: "1px solid #eef2f7" }) }} title={q.libelle}>
              {abbr(q.libelle)}
            </th>
          ))
        )}
      </tr>
    </thead>
  );

  return (
    <div className="gridband" style={{ paddingTop: 4 }}>
      {erreur && (
        <div role="alert" style={{ margin: "0 0 8px", padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontSize: 13, fontWeight: 600, flex: "0 0 auto" }}>
          {erreur}
          <button type="button" onClick={() => setErreur(null)} style={{ float: "right", background: "transparent", border: "none", color: "#991b1b", cursor: "pointer", fontSize: 14, width: "auto", margin: 0, padding: 0 }}>✕</button>
        </div>
      )}

      {columnQuarts.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Aucun quart en rotation configuré.</p></div>
      ) : (
        <>
          {/* --- Carte d'en-tête FIGÉE : dates/quarts + ligne « Activation ». --- */}
          <div className="card ordo-cross" style={{ position: "relative", overflowX: "hidden", overflowY: "auto", scrollbarGutter: "stable", flex: "0 0 auto", padding: "6px 12px" }} onMouseOver={onCellOver} onMouseLeave={onLeave}>
            <div style={{ position: "absolute", top: 6, right: 16, fontSize: 12, zIndex: 2 }} className="muted">{saving ? "enregistrement…" : ""}</div>
            <table className="matrix rowh" ref={activationRef} style={gridStyle}>
              <ColsGrid />
              {gridHead}
              <tbody>
                <tr>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700, background: "#f1f5f9" }}>Activation</td>
                  {days.map((d) =>
                    columnQuarts.map((q, qi) => {
                      const on = quartActif(q.code, d.iso);
                      const init = dayInitialized(d.iso);
                      return (
                        <td key={`${d.iso}:${q.code}`} style={{ textAlign: "center", background: on ? "#dcfce7" : init ? "#fee2e2" : "#f1f5f9", ...(qi === 0 ? sepDay(d) : { borderLeft: "1px solid #eef2f7" }) }} title={`${q.libelle} — ${on ? "actif" : "inactif"}${init ? "" : " (semaine non initialisée)"}`}>
                          <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => toggleQuart(q.code, d.iso)} style={{ width: "auto", margin: "0 auto", display: "block", cursor: canEdit ? "pointer" : "default" }} />
                        </td>
                      );
                    })
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {/* --- Carte de corps DÉFILANTE : lignes par atelier + journée en dessous. --- */}
          <div className="card grow ordo-cross" style={{ overflowX: "hidden", overflowY: "auto", scrollbarGutter: "stable", flex: "1 1 auto", minHeight: 120, padding: "0 12px 12px" }} onMouseOver={onCellOver} onMouseLeave={onLeave}>
            <table className="matrix rowh" ref={bodyRef} style={gridStyle}>
              <ColsGrid />
              <tbody>
                {groupsFrom(gridLignes).map((g) => (
                  <Fragment key={`ate:${g.atelierNom}`}>
                    <tr>
                      <td colSpan={1 + days.length * ncq} style={{ background: "#eef2f7", fontWeight: 700, fontSize: 12, padding: "3px 8px" }}>{g.atelierNom}</td>
                    </tr>
                    {g.lignes.map((l) => (
                      <tr key={l.id}>
                        <td style={{ whiteSpace: "nowrap", paddingLeft: 14 }}>{l.nom}</td>
                        {days.map((d) => columnQuarts.map((q, qi) => gridCell(l, d, q, qi === 0)))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {gridLignes.length === 0 && (
                  <tr><td colSpan={1 + days.length * ncq} className="muted">Aucune ligne active.</td></tr>
                )}
              </tbody>
            </table>

            {/* Journée : à part, en dessous. Activation DÉRIVÉE (aucune case à cocher) :
                les lignes sont éditables dès qu'un quart tournant est actif ce jour. */}
            {journeeQuart && (() => {
              const jLignes = lignes.filter((l) => l.quarts.includes(journeeQuart.code));
              // Même colgroup + gridStyle que la grille du haut : chaque case
              // « journée » occupe les ncq sous-colonnes (colSpan) du jour → les
              // colonnes des deux tableaux sont alignées à l'identique.
              return (
                <div style={{ marginTop: 22 }}>
                  <h2 style={{ margin: "0 0 2px" }}>{journeeQuart.libelle} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(pleine journée — active dès qu&apos;un quart tourne)</span></h2>
                  <table className="matrix rowh" ref={journeeRef} style={gridStyle}>
                    <ColsGrid />
                    <thead>
                      <tr>
                        <th style={{ width: NAME_W, textAlign: "left" }}>Ligne</th>
                        {days.map((d) => (
                          <th key={d.iso} colSpan={ncq} style={{ textAlign: "center", ...sepDay(d), background: dayBg(d.iso) }}>
                            {d.nom.slice(0, 2)} <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>{d.num}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupsFrom(jLignes).map((g) => (
                        <Fragment key={`jate:${g.atelierNom}`}>
                          <tr>
                            <td colSpan={1 + days.length * ncq} style={{ background: "#eef2f7", fontWeight: 700, fontSize: 12, padding: "3px 8px" }}>{g.atelierNom}</td>
                          </tr>
                          {g.lignes.map((l) => (
                            <tr key={l.id}>
                              <td style={{ whiteSpace: "nowrap", paddingLeft: 14 }}>{l.nom}</td>
                              {days.map((d) => {
                                const active = journeeActif(d.iso);
                                const on = ligneOuverte(journeeQuart.code, l.id, d.iso);
                                return (
                                  <td key={d.iso} colSpan={ncq} style={{ textAlign: "center", background: !active ? "#f1f5f9" : on ? undefined : "#fee2e2", ...sepDay(d) }} title={active ? `${l.nom} — ${on ? "ouverte" : "fermée"}` : "Journée inactive ce jour (aucun quart actif)"}>
                                    <input type="checkbox" checked={on} disabled={!canEdit || !active} onChange={() => toggleLigne(journeeQuart.code, l.id, d.iso)} style={{ width: "auto", margin: "0 auto", display: "block", cursor: canEdit && active ? "pointer" : "not-allowed" }} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                      {jLignes.length === 0 && (
                        <tr><td colSpan={1 + days.length * ncq} className="muted">Aucune ligne en {journeeQuart.libelle}.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* Modale : choix du profil de semaine type à appliquer. */}
      {initIsos && (
        <ModaleDeplacable onClose={() => setInitIsos(null)} largeur={460}>
            <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
              <h2 style={{ margin: 0 }}>Initialiser — choisir un profil</h2>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setInitIsos(null)} style={{ width: "auto" }}>✕</button>
            </div>
            {profils.length === 0 ? (
              <>
                <p className="muted">Aucun profil de semaine type défini.</p>
                <button type="button" className="btn-sm" style={{ width: "auto" }} onClick={() => applyProfil(initIsos)}>Appliquer le défaut</button>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {profils.map((p) => (
                  <button key={p.id} type="button" className="btn-sm" style={{ width: "auto", textAlign: "left" }} onClick={() => applyProfil(initIsos, p.id)}>
                    {p.nom}{p.par_defaut ? "  · par défaut" : ""}
                  </button>
                ))}
              </div>
            )}
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              La semaine sélectionnée sera (ré)initialisée avec le profil choisi.
            </p>
        </ModaleDeplacable>
      )}

      {/* Bandeau d'information après une fermeture qui laisse des affectations en
          place. AUCUNE désaffectation : on prévient les ateliers concernés qu'ils
          verront un sureffectif dans Placement / Planning et qu'ils doivent
          adapter leur planning. Rien à confirmer, un seul bouton « OK ». */}
      {notice && (
        <ModaleDeplacable onClose={() => setNotice(null)} largeur={500}>
          <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
            <h2 style={{ margin: 0, color: "#b45309" }}>ℹ Prévenir l&apos;atelier</h2>
            <button type="button" className="btn-sm btn-ghost" onClick={() => setNotice(null)} style={{ width: "auto" }}>✕</button>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            {notice.quart ? "Ce quart a été fermé" : "Cette ligne a été fermée"} alors que{" "}
            {notice.affectes.length === 1 ? "une personne y était affectée" : `${notice.affectes.length} personnes y étaient affectées`}.
            Les affectations sont conservées : elles apparaissent désormais en <strong>sureffectif</strong> dans Placement et Planning.
          </p>
          {notice.ateliers.length > 0 && (
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>
              Prévenir {notice.ateliers.length === 1 ? "l'atelier" : "les ateliers"}{" "}
              <span style={{ color: "#b45309" }}>{notice.ateliers.join(" et ")}</span>{" "}
              de modifier leur planning en conséquence.
            </p>
          )}
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13, maxHeight: 220, overflowY: "auto" }}>
            {notice.affectes.map((p, i) => (
              <li key={i}>
                {p.nom} {p.prenom}
                {p.atelier && <span className="muted"> — {p.atelier}</span>}
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn-sm" style={{ width: "auto" }} onClick={() => setNotice(null)}>OK</button>
          </div>
        </ModaleDeplacable>
      )}

      {/* Re-initialisation bloquee par des affectations : proposer de forcer. */}
      {conflitReset && (
        <ModaleDeplacable onClose={() => setConflitReset(null)} largeur={480}>
          <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
            <h2 style={{ margin: 0, color: "#b45309" }}>⚠ Semaine occupée</h2>
            <button type="button" className="btn-sm btn-ghost" onClick={() => setConflitReset(null)} style={{ width: "auto" }}>✕</button>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            {conflitReset.affectes.length === 1 ? "Une personne est affectée" : `${conflitReset.affectes.length} personnes sont affectées`}{" "}
            sur cette semaine. La réinitialiser retirera {conflitReset.affectes.length === 1 ? "son affectation" : "leurs affectations"} sur poste (les absences sont conservées) :
          </p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13, maxHeight: 220, overflowY: "auto" }}>
            {conflitReset.affectes.map((p, i) => (
              <li key={i}>{p.nom} {p.prenom}</li>
            ))}
          </ul>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto" }} onClick={() => setConflitReset(null)}>Annuler</button>
            <button type="button" className="btn-sm" style={{ width: "auto", background: "#b45309", border: "1px solid #b45309" }} onClick={() => { const c = conflitReset; setConflitReset(null); if (c) applyProfil(c.isos, c.profilId, true); }}>Réinitialiser quand même et retirer</button>
          </div>
        </ModaleDeplacable>
      )}
    </div>
  );
}
