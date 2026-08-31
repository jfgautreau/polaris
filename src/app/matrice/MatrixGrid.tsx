"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { LevelMark, FILL, RESTRICT } from "./Pie";
import { usePersonGrid } from "@/components/usePersonGrid";
import { INTERIM_BG } from "@/lib/interim";
import g from "@/components/persongrid.module.css";
import s from "./matrice.module.css";

// Cycle de saisie : 0 -> 1 -> … -> N -> ❌ (restriction) -> 0, où N =
// nombre de niveaux activés pour le site (cf. buildCycle).
const buildCycle = (nb: number) => [...Array.from({ length: nb + 1 }, (_, i) => i), RESTRICT];
const lvlTxt = (n: number) => (n === RESTRICT ? "Restriction ❌" : String(n));
const norm = (s2: string) => s2.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Poste = { id: string; nom: string; objectifActuel?: number; objectifCible?: number };
type Group = { ligneId: string; ligneNom: string; postes: Poste[] };
type Personne = { id: string; label: string; editable: boolean; interim?: boolean; avenir?: boolean; sansCompetence?: boolean };
type Cell = { a: number; c: number };
// Agregat par poste, calcule en une seule passe sur toutes les personnes.
type Stat = { lvl: number[]; restrict: number; geA: number; geC: number };

const emptyStat = (nb: number): Stat => ({ lvl: Array(nb + 1).fill(0), restrict: 0, geA: 0, geC: 0 });

export default function MatrixGrid({
  groups = [],
  personnes = [],
  initial = {},
  canEditObjectif = false,
  mode = "actuel",
  search = "",
  nbNiveaux = 4,
  seuilCompetent = 2,
  couleurs = FILL,
}: {
  groups?: Group[];
  personnes?: Personne[];
  initial?: Record<string, Cell>;
  canEditObjectif?: boolean;
  mode?: "actuel" | "cible";
  search?: string; // saisie dans l'en-tete (cf. MatricePanel)
  nbNiveaux?: number; // niveaux positifs activés pour le site (1..nbNiveaux)
  seuilCompetent?: number; // niveau minimal « compétent » (bilan Compétences ≥N)
  couleurs?: Record<number, string | null>; // couleur par niveau (0 = contour)
}) {
  const EMPTY_STAT = useMemo(() => emptyStat(nbNiveaux), [nbNiveaux]);
  const CYCLE = useMemo(() => buildCycle(nbNiveaux), [nbNiveaux]);
  const niveaux = useMemo(() => Array.from({ length: nbNiveaux }, (_, i) => i + 1), [nbNiveaux]);
  const [cells, setCells] = useState<Record<string, Cell>>(initial);
  const [showBilan, setShowBilan] = useState(false);
  const [objActuel, setObjActuel] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    for (const gr of groups) for (const p of gr.postes) o[p.id] = p.objectifActuel ?? 0;
    return o;
  });
  const [objCible, setObjCible] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    for (const gr of groups) for (const p of gr.postes) o[p.id] = p.objectifCible ?? 0;
    return o;
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const objTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allPostes = useMemo(() => groups.flatMap((gr) => gr.postes), [groups]);
  // Filtre de recherche sur le nom (accents ignores). N'affecte que les lignes
  // affichees ; le bilan reste calcule sur l'ensemble.
  const shown = search.trim() ? personnes.filter((p) => norm(p.label).includes(norm(search))) : personnes;
  // Virtualisation des lignes : seules les personnes visibles sont rendues (cf.
  // usePersonGrid). `rowCount` suit le filtre de recherche.
  const { headCardRef, headTableRef, rowsTableRef, rowsCardProps, virtual } = usePersonGrid(g.colHover, 2, {
    rowCount: shown.length,
  });
  const rowsShown = virtual ? shown.slice(virtual.start, virtual.end) : shown;
  const key = (pid: string, poid: string) => `${pid}:${poid}`;
  const get = (k: string): Cell => cells[k] ?? { a: 0, c: 0 };

  // Une seule passe personnes x postes alimente les 9 lignes du bilan, au lieu
  // d'un balayage complet par ligne et par colonne.
  const stats = useMemo(() => {
    const m = new Map<string, Stat>();
    for (const p of allPostes) m.set(p.id, emptyStat(nbNiveaux));
    const useActuel = mode === "actuel";
    for (const pe of personnes) {
      for (const p of allPostes) {
        const st = m.get(p.id)!;
        const cell = cells[key(pe.id, p.id)];
        const a = cell?.a ?? 0;
        const c = cell?.c ?? 0;
        const affiche = useActuel ? a : c;
        if (affiche === RESTRICT) st.restrict++;
        else if (affiche >= 0 && affiche <= nbNiveaux) st.lvl[affiche]++;
        if (a >= seuilCompetent) st.geA++;
        if (c >= seuilCompetent) st.geC++;
      }
    }
    return m;
  }, [allPostes, personnes, cells, mode, nbNiveaux, seuilCompetent]);

  const statOf = (poid: string): Stat => stats.get(poid) ?? EMPTY_STAT;

  function saveObjectif(poid: string, champ: "actuel" | "cible", value: number) {
    if (champ === "actuel") setObjActuel((o) => ({ ...o, [poid]: value }));
    else setObjCible((o) => ({ ...o, [poid]: value }));
    setSaveState("saving");
    const tk = `${poid}:${champ}`;
    if (objTimers.current[tk]) clearTimeout(objTimers.current[tk]);
    objTimers.current[tk] = setTimeout(async () => {
      try {
        const res = await fetch("/api/poste/objectif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poste_id: poid, champ, objectif: value }),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }, 500);
  }

  function save(k: string, cell: Cell, pid: string, poid: string) {
    setSaveState("saving");
    if (timers.current[k]) clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(async () => {
      try {
        const res = await fetch("/api/matrice/cell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personne_id: pid, poste_id: poid, niveau_actuel: cell.a, niveau_cible: cell.c }),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }, 450);
  }

  function bump(pid: string, poid: string, delta: number) {
    const k = key(pid, poid);
    setCells((prev) => {
      const cur = prev[k] ?? { a: 0, c: 0 };
      const field = mode === "actuel" ? "a" : "c";
      const idx = CYCLE.indexOf(cur[field]);
      const nextVal = CYCLE[(((idx < 0 ? 0 : idx) + delta) % CYCLE.length + CYCLE.length) % CYCLE.length];
      const next = { ...cur, [field]: nextVal };
      save(k, next, pid, poid);
      return { ...prev, [k]: next };
    });
  }

  const saveLabel =
    saveState === "saving" ? "Enregistrement..." : saveState === "saved" ? "Enregistré" : saveState === "error" ? "Échec d'enregistrement" : "";

  // Colonne noms adaptative (px) partagee par les 2 tables -> colonnes alignees.
  const nameW = Math.min(320, Math.max(150, personnes.reduce((m, p) => Math.max(m, p.label.length), 0) * 7.2 + 30));
  // `colgroup` construit une fois : le meme element est reutilise par les deux
  // tables, ce qui garantit des colonnes alignees sans le recreer a chaque rendu.
  const cols = useMemo(
    () => (
      <colgroup>
        <col style={{ width: nameW }} />
        {allPostes.map((p) => (
          <col key={p.id} />
        ))}
      </colgroup>
    ),
    [nameW, allPostes]
  );

  return (
    <div
      className={`${g.grid} ${s.matrice}`}
      data-mode={mode}
      style={{ "--name-w": `${nameW}px`, "--n-cols": allPostes.length } as React.CSSProperties}
    >
      {/* Tableau 1 : en-tetes + bilan retractable (fixe) */}
      <div className={`card ${g.headCard}`} ref={headCardRef}>
        <div className={g.saveState} data-state={saveState}>
          {saveLabel}
        </div>

        <table className={`matrix ${g.table}`} ref={headTableRef}>
          {cols}
          <thead>
            <tr>
              <th rowSpan={2} className={g.cornerHead}>
                <button
                  type="button"
                  onClick={() => setShowBilan((b) => !b)}
                  title={showBilan ? "Masquer le bilan" : "Afficher le bilan"}
                  className={g.bilanToggle}
                >
                  {showBilan ? "− Bilan" : "+ Bilan"}
                </button>
              </th>
              {groups.map((gr) => (
                <th key={gr.ligneId} colSpan={gr.postes.length} className={g.groupHead} title={gr.ligneNom}>
                  <div className={g.groupLabel}>{gr.ligneNom}</div>
                </th>
              ))}
            </tr>
            <tr>
              {groups.flatMap((gr) =>
                gr.postes.map((p, i) => (
                  <th key={p.id} title={p.nom} className={i === 0 ? `${g.colHead} ${g.groupStart}` : g.colHead}>
                    {/* Nom de poste vertical, sur une seule ligne (table plus haute mais lisible). */}
                    <div className={g.colLabel}>{p.nom}</div>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {/* ---- Bilan (remonte sous les entetes, retractable) ---- */}
            {showBilan && (
              <>
                {niveaux.map((lvl) => (
                  <tr key={`niv${lvl}`} className={s.rowNiveau}>
                    <td className={s.bilanLabel}>
                      <span className={s.bilanSwatch}>
                        <span className={s.bilanDot} style={{ background: couleurs[lvl] ?? "#999" }} />
                        Nb de Niv. {lvl}
                      </span>
                    </td>
                    {allPostes.map((po) => {
                      const c = statOf(po.id).lvl[lvl];
                      return (
                        <td key={po.id} className={s.bilanTd} data-some={c > 0 ? "1" : "0"}>
                          {c}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className={s.rowRestrict}>
                  <td className={s.bilanLabel}>
                    <span className={s.bilanSwatch}>
                      <span className={s.restrictMark}>✕</span>{" "}
                      Nb restreint
                    </span>
                  </td>
                  {allPostes.map((po) => {
                    const c = statOf(po.id).restrict;
                    return (
                      <td key={po.id} className={s.bilanTd} data-some={c > 0 ? "1" : "0"}>
                        {c || ""}
                      </td>
                    );
                  })}
                </tr>
                {([
                  ["actuel", "geA", s.objActuel, objActuel] as const,
                  ["cible", "geC", s.objCible, objCible] as const,
                ]).map(([champ, field, cls, objMap]) => (
                  <Fragment key={champ}>
                    <tr className={`${s.rowObjectif} ${cls}`}>
                      <td className={s.bilanLabel}>Objectif {champ}</td>
                      {allPostes.map((po) => (
                        <td key={po.id} className={s.bilanTd}>
                          {canEditObjectif ? (
                            <input
                              type="number"
                              min={0}
                              value={objMap[po.id] ?? 0}
                              onChange={(e) => saveObjectif(po.id, champ, Math.max(0, Number(e.target.value) || 0))}
                              // La case contient toujours un nombre (0 par defaut) : au clic,
                              // on le selectionne pour que la frappe le REMPLACE. Sinon le
                              // curseur se pose a cote et l'on saisit « 03 » au lieu de « 3 ».
                              onFocus={(e) => e.currentTarget.select()}
                              // `onFocus` ne suffit pas : un clic dans un champ deja actif
                              // ne refocalise pas, et un clic pose un curseur apres le focus.
                              onClick={(e) => e.currentTarget.select()}
                              className={s.objInput}
                            />
                          ) : (
                            objMap[po.id] ?? 0
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr className={s.rowCouverture}>
                      <td className={s.bilanLabel}>Compétences {champ} (≥{seuilCompetent})</td>
                      {allPostes.map((po) => {
                        const c = statOf(po.id)[field];
                        const obj = objMap[po.id] ?? 0;
                        const manque = c < obj; // sous l'objectif -> rouge sur fond rouge
                        return (
                          <td
                            key={po.id}
                            className={s.bilanTd}
                            data-manque={manque ? "1" : "0"}
                            title={`${c} / objectif ${obj}${manque ? ` — manque ${obj - c}` : ""}`}
                          >
                            {c}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Tableau 2 : personnes (defile, occupe la hauteur restante) */}
      <div className={`card ${g.rowsCard}`} {...rowsCardProps}>
        <table className={`matrix ${g.table} ${g.rowsTable}`} ref={rowsTableRef}>
          {cols}
          <tbody>
            {/* Cale haute : reserve la hauteur des lignes non rendues au-dessus. */}
            {virtual && virtual.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={allPostes.length + 1} style={{ height: virtual.padTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {rowsShown.map((pers) => (
              <tr key={pers.id}>
                <td className={g.nameCell}>
                  {pers.sansCompetence && (
                    <span
                      title="Aucune compétence sur aucun poste (tous ateliers confondus)"
                      aria-label="Aucune compétence"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        height: 16,
                        margin: "0 6px 0 0",
                        borderRadius: 999,
                        background: "#f59e0b",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: 1,
                        verticalAlign: "middle",
                      }}
                    >
                      !
                    </span>
                  )}
                  {pers.avenir && (
                    <span title="À venir : recrutée, pas encore arrivée" style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 3, padding: "0 4px", fontSize: 10, fontWeight: 700, marginRight: 4 }}>À venir</span>
                  )}
                  <span style={{ ...(pers.interim ? { background: INTERIM_BG, borderRadius: 3, padding: "0 4px" } : undefined), ...(pers.avenir ? { fontStyle: "italic" } : undefined) }}>{pers.label}</span>
                  {!pers.editable && <span className="muted"> (lecture)</span>}
                </td>
                {allPostes.map((po) => {
                  const k = key(pers.id, po.id);
                  const cell = get(k);
                  const active = mode === "actuel" ? cell.a : cell.c;
                  const other = mode === "actuel" ? cell.c : cell.a;
                  if (!pers.editable) {
                    return (
                      <td key={po.id} className={g.cellTd}>
                        <div className={s.cellReadonly}>
                          <LevelMark level={active} max={nbNiveaux} couleurs={couleurs} />
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={po.id} className={g.cellTd}>
                      <button
                        type="button"
                        onClick={() => bump(pers.id, po.id, +1)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          bump(pers.id, po.id, -1);
                        }}
                        title={`${pers.label} - ${po.nom}\nActuel ${lvlTxt(cell.a)} / Cible ${lvlTxt(cell.c)}\nClic +1, clic droit -1 (❌ = restriction)`}
                        className={s.cellBtn}
                      >
                        <LevelMark level={active} max={nbNiveaux} couleurs={couleurs} />
                        {other === RESTRICT ? (
                          <span className={`${s.otherMark} ${s.restrict}`}>✕</span>
                        ) : other > 0 ? (
                          <span className={s.otherMark}>{other}</span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Cale basse : reserve la hauteur des lignes non rendues en dessous. */}
            {virtual && virtual.padBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={allPostes.length + 1} style={{ height: virtual.padBottom, padding: 0, border: 0 }} />
              </tr>
            )}
            {shown.length === 0 && (
              <tr>
                <td colSpan={allPostes.length + 1} className="muted">
                  {personnes.length === 0 ? "Aucune personne active." : "Aucun résultat pour cette recherche."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
