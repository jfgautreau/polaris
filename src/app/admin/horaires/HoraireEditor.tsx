"use client";

import { useMemo, useRef, useState } from "react";

type Cell = { debut: string; fin: string };
type Poste = { id: string; nom: string; quarts: string[] }; // quarts = codes actifs
type LigneGroup = {
  ligneId: string;
  ligneNom: string;
  atelierId: string;
  atelierNom: string;
  postes: Poste[];
};
type Quart = { code: string; libelle: string };
type AtelierOpt = { id: string; nom: string };
type ApiCell = { poste_id: string; quart_code: string; jour: number; debut: string; fin: string };

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function HoraireEditor({
  ateliers,
  lignes,
  quarts,
  initial,
}: {
  ateliers: AtelierOpt[];
  lignes: LigneGroup[];
  quarts: Quart[];
  initial: Record<string, Cell>;
}) {
  const [vals, setVals] = useState<Record<string, Cell>>(initial);
  const [atelier, setAtelier] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [clip, setClip] = useState<{ from: string; cells: Record<string, Cell> } | null>(null);
  const [bulkQuart, setBulkQuart] = useState(quarts[0]?.code ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const key = (p: string, q: string, j: number) => `${p}:${q}:${j}`;
  const get = (p: string, q: string, j: number): Cell => vals[key(p, q, j)] ?? { debut: "", fin: "" };

  // Enregistrement dynamique. Une ref suit `vals` pour que le débounce lise la
  // valeur à jour de la case.
  const valsRef = useRef(vals);
  valsRef.current = vals;
  const cellTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const quartLib = useMemo(() => Object.fromEntries(quarts.map((q) => [q.code, q.libelle])), [quarts]);

  async function pushCells(cells: ApiCell[]) {
    if (cells.length === 0) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/horaires", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
  }

  // Débounce par case : à la fin de la saisie, on pousse debut + fin ensemble.
  function scheduleCell(p: string, q: string, j: number) {
    const k = key(p, q, j);
    if (cellTimers.current[k]) clearTimeout(cellTimers.current[k]);
    cellTimers.current[k] = setTimeout(() => {
      const c = valsRef.current[k] ?? { debut: "", fin: "" };
      pushCells([{ poste_id: p, quart_code: q, jour: j, debut: c.debut, fin: c.fin }]);
    }, 500);
  }

  const set = (p: string, q: string, j: number, champ: "debut" | "fin", v: string) => {
    setVals((s) => ({ ...s, [key(p, q, j)]: { ...(s[key(p, q, j)] ?? { debut: "", fin: "" }), [champ]: v } }));
    scheduleCell(p, q, j);
  };

  // Lignes regroupees par atelier (deja triees atelier puis ligne cote serveur).
  const byAtelier = useMemo(() => {
    const m = new Map<string, { atelierId: string; atelierNom: string; lignes: LigneGroup[] }>();
    for (const l of lignes) {
      const g = m.get(l.atelierId) ?? { atelierId: l.atelierId, atelierNom: l.atelierNom, lignes: [] };
      g.lignes.push(l);
      m.set(l.atelierId, g);
    }
    return [...m.values()];
  }, [lignes]);

  // Postes visibles (selon le filtre atelier) : portee des actions ciblees.
  const visiblePostes = useMemo(
    () => lignes.filter((l) => !atelier || l.atelierId === atelier).flatMap((l) => l.postes),
    [lignes, atelier]
  );
  const nomPoste = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of lignes) for (const p of l.postes) m[p.id] = p.nom;
    return m;
  }, [lignes]);

  // -- Actions par poste (ne touchent que les quarts actifs du poste) --
  function copyLundi(p: string, q: string) {
    const lun = get(p, q, 0);
    setVals((s) => {
      const n = { ...s };
      for (let j = 1; j < 7; j++) n[key(p, q, j)] = { ...lun };
      return n;
    });
    pushCells(Array.from({ length: 6 }, (_, i) => ({ poste_id: p, quart_code: q, jour: i + 1, debut: lun.debut, fin: lun.fin })));
  }
  function copierPoste(po: Poste) {
    const cells: Record<string, Cell> = {};
    for (const q of po.quarts) for (let j = 0; j < 7; j++) cells[`${q}:${j}`] = { ...get(po.id, q, j) };
    setClip({ from: po.id, cells });
  }
  function collerPoste(po: Poste) {
    if (!clip) return;
    const out: ApiCell[] = [];
    setVals((s) => {
      const n = { ...s };
      for (const q of po.quarts)
        for (let j = 0; j < 7; j++) {
          const c = clip.cells[`${q}:${j}`];
          if (c) n[key(po.id, q, j)] = { ...c };
        }
      return n;
    });
    for (const q of po.quarts)
      for (let j = 0; j < 7; j++) {
        const c = clip.cells[`${q}:${j}`];
        if (c) out.push({ poste_id: po.id, quart_code: q, jour: j, debut: c.debut, fin: c.fin });
      }
    pushCells(out);
  }
  function copyAutresPostes(ligne: LigneGroup, po: Poste) {
    if (!window.confirm("Recopier ces horaires sur tous les autres postes de la ligne ?")) return;
    const out: ApiCell[] = [];
    setVals((s) => {
      const n = { ...s };
      for (const other of ligne.postes) {
        if (other.id === po.id) continue;
        for (const q of other.quarts) for (let j = 0; j < 7; j++) n[key(other.id, q, j)] = { ...get(po.id, q, j) };
      }
      return n;
    });
    for (const other of ligne.postes) {
      if (other.id === po.id) continue;
      for (const q of other.quarts)
        for (let j = 0; j < 7; j++) {
          const src = get(po.id, q, j);
          out.push({ poste_id: other.id, quart_code: q, jour: j, debut: src.debut, fin: src.fin });
        }
    }
    pushCells(out);
  }

  // -- Suppressions ciblees (sur les postes visibles, quarts actifs) --
  const porteeLabel = atelier ? "le service sélectionné" : "tous les services";
  function viderJour(j: number) {
    if (!window.confirm(`Vider tous les horaires du ${JOURS[j]} (${porteeLabel}) ?`)) return;
    const out: ApiCell[] = [];
    setVals((s) => {
      const n = { ...s };
      for (const po of visiblePostes) for (const q of po.quarts) delete n[key(po.id, q, j)];
      return n;
    });
    for (const po of visiblePostes) for (const q of po.quarts) out.push({ poste_id: po.id, quart_code: q, jour: j, debut: "", fin: "" });
    pushCells(out);
  }
  function viderQuart(qc: string) {
    if (!quartLib[qc]) return;
    if (!window.confirm(`Vider tous les horaires du quart « ${quartLib[qc]} » (${porteeLabel}) ?`)) return;
    const out: ApiCell[] = [];
    setVals((s) => {
      const n = { ...s };
      for (const po of visiblePostes) if (po.quarts.includes(qc)) for (let j = 0; j < 7; j++) delete n[key(po.id, qc, j)];
      return n;
    });
    for (const po of visiblePostes)
      if (po.quarts.includes(qc)) for (let j = 0; j < 7; j++) out.push({ poste_id: po.id, quart_code: qc, jour: j, debut: "", fin: "" });
    pushCells(out);
  }

  const toggle = (lid: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(lid) ? n.delete(lid) : n.add(lid);
      return n;
    });
  const allLigneIds = lignes.map((l) => l.ligneId);
  const allCollapsed = allLigneIds.every((id) => collapsed.has(id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(allLigneIds));

  const saveLabel =
    saveState === "saving" ? "Enregistrement…" : saveState === "saved" ? "Enregistré ✓" : saveState === "error" ? "Échec d'enregistrement" : "";
  const saveColor = saveState === "error" ? "var(--danger)" : saveState === "saved" ? "var(--ok)" : "var(--muted)";

  return (
    <div>
      {/* Barre d'outils : ateliers + suppressions ciblees */}
      <div className="card" style={{ position: "sticky", top: 0, zIndex: 6, marginBottom: 16 }}>
        <div className="toolbar" style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span className="muted">Service :</span>
          <div className="segments">
            <button type="button" className={atelier === "" ? "seg active" : "seg"} onClick={() => setAtelier("")}>
              Tous
            </button>
            {ateliers.map((a) => (
              <button
                key={a.id}
                type="button"
                className={atelier === a.id ? "seg active" : "seg"}
                onClick={() => setAtelier(a.id)}
              >
                {a.nom}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, fontWeight: 600, minWidth: 120, textAlign: "right", color: saveColor }}>{saveLabel}</span>
          <button type="button" className="btn-sm btn-ghost" onClick={toggleAll}>
            {allCollapsed ? "Tout déplier" : "Tout replier"}
          </button>
        </div>
        <div className="toolbar" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <span className="muted">Vider ({porteeLabel}) :</span>
          <button type="button" className="btn-sm btn-ghost" onClick={() => viderJour(5)}>
            Samedi
          </button>
          <button type="button" className="btn-sm btn-ghost" onClick={() => viderJour(6)}>
            Dimanche
          </button>
          <span style={{ marginLeft: 8 }} className="muted">
            Quart :
          </span>
          <select value={bulkQuart} onChange={(e) => setBulkQuart(e.target.value)} style={{ width: "auto" }}>
            {quarts.map((q) => (
              <option key={q.code} value={q.code}>
                {q.libelle}
              </option>
            ))}
          </select>
          <button type="button" className="btn-sm btn-ghost" onClick={() => viderQuart(bulkQuart)}>
            Vider ce quart
          </button>
          {clip && (
            <span className="clip-banner">
              Horaires de « {nomPoste[clip.from] ?? "?"} » copiés — cliquez « Coller » sur un poste.
              <button type="button" className="btn-sm btn-ghost" onClick={() => setClip(null)} style={{ marginLeft: 8 }}>
                Annuler
              </button>
            </span>
          )}
        </div>
      </div>

      {byAtelier.map((grp) => {
        const showAtelier = !atelier || grp.atelierId === atelier;
        return (
          <div key={grp.atelierId || "none"} style={{ display: showAtelier ? undefined : "none" }}>
            <h2 style={{ fontSize: 18, margin: "18px 0 8px" }}>{grp.atelierNom}</h2>
            {grp.lignes.map((l) => {
              const isCol = collapsed.has(l.ligneId);
              return (
                <div key={l.ligneId} className="card section">
                  <div
                    className="toolbar"
                    style={{ alignItems: "center", cursor: "pointer", userSelect: "none" }}
                    onClick={() => toggle(l.ligneId)}
                  >
                    <span style={{ fontWeight: 700, fontSize: 15 }}>
                      {isCol ? "▸" : "▾"} {l.ligneNom}
                    </span>
                    <span className="muted">
                      {l.postes.length} poste{l.postes.length > 1 ? "s" : ""}
                    </span>
                  </div>

                  <div style={{ display: isCol ? "none" : "block" }}>
                    {l.postes.map((po) => (
                      <div key={po.id} className="section" style={{ overflowX: "auto", marginLeft: 8 }}>
                        <div className="toolbar" style={{ alignItems: "center", gap: 6 }}>
                          <h3 style={{ margin: 0, fontSize: 14 }}>{po.nom}</h3>
                          <button type="button" className="btn-sm btn-ghost" onClick={() => copierPoste(po)} title="Copier les horaires de ce poste">
                            Copier
                          </button>
                          <button
                            type="button"
                            className="btn-sm btn-ghost"
                            onClick={() => collerPoste(po)}
                            disabled={!clip}
                            title={clip ? "Coller les horaires copiés ici" : "Copiez d'abord un poste"}
                          >
                            Coller
                          </button>
                          {l.postes.length > 1 && (
                            <button
                              type="button"
                              className="btn-sm btn-ghost"
                              onClick={() => copyAutresPostes(l, po)}
                              title="Recopier sur tous les autres postes de la ligne"
                            >
                              ↓ postes
                            </button>
                          )}
                        </div>
                        {po.quarts.length === 0 ? (
                          <p className="muted" style={{ margin: "4px 0 0" }}>Aucun quart activé pour ce poste (voir Référentiel).</p>
                        ) : (
                          <table className="matrix" style={{ borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", minWidth: 96 }}>Quart</th>
                                {JOURS.map((j) => (
                                  <th key={j} style={{ textAlign: "center", minWidth: 92 }}>
                                    {j}
                                  </th>
                                ))}
                                <th style={{ minWidth: 110 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {po.quarts.map((qc) => (
                                <tr key={qc}>
                                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{quartLib[qc] ?? qc}</td>
                                  {JOURS.map((_, j) => {
                                    const c = get(po.id, qc, j);
                                    return (
                                      <td key={j} style={{ textAlign: "center", padding: 2 }}>
                                        <input
                                          type="time"
                                          value={c.debut}
                                          onChange={(e) => set(po.id, qc, j, "debut", e.target.value)}
                                          style={{ width: 82, fontSize: 12, padding: "2px 3px" }}
                                        />
                                        <input
                                          type="time"
                                          value={c.fin}
                                          onChange={(e) => set(po.id, qc, j, "fin", e.target.value)}
                                          style={{ width: 82, fontSize: 12, padding: "2px 3px", marginTop: 2 }}
                                        />
                                      </td>
                                    );
                                  })}
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    <button
                                      type="button"
                                      className="btn-sm btn-ghost"
                                      onClick={() => copyLundi(po.id, qc)}
                                      title="Recopier le lundi sur toute la semaine"
                                    >
                                      Lun → sem.
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {lignes.length === 0 && <p className="muted">Aucune ligne active avec des postes.</p>}
    </div>
  );
}
