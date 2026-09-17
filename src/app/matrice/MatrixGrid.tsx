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

type Poste = { id: string; nom: string; objectifActuel?: number; objectifCible?: number; niveauMin?: number };
type Group = { ligneId: string; ligneNom: string; postes: Poste[] };
type Personne = { id: string; label: string; editable: boolean; interim?: boolean; avenir?: boolean; sansCompetence?: boolean };
type Cell = { a: number; c: number };
// Agregat par poste, calcule en une seule passe sur toutes les personnes.
type Stat = { lvl: number[]; restrict: number; geA: number; geC: number };

const emptyStat = (nb: number): Stat => ({ lvl: Array(nb + 1).fill(0), restrict: 0, geA: 0, geC: 0 });

export default function MatrixGrid({
  groups = [],
  personnes = [],
  displayedIds = null,
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
  // Sous-ensemble affiché par défaut (filtres équipe/atelier serveur). `null` =
  // tout l'effectif. La recherche par nom passe outre et balaie `personnes`.
  displayedIds?: string[] | null;
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
  // Cellule d'objectif en cours d'edition (`${champ}:${posteId}`). Un seul
  // `<input>` est monte a la fois : sinon le bilan pose un champ de saisie natif
  // par poste, et le repeint de toute cette rangee (en-tete jamais virtualise)
  // sature le moteur de rendu de l'onglet au redimensionnement (crash « This
  // page couldn't load », vecu sur un service a nombreux postes). Ailleurs, un
  // simple nombre cliquable — leger a peindre.
  const [editObj, setEditObj] = useState<string | null>(null);
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
  // Message circonstancié du serveur sur refus (RLS / périmètre d'équipe). Sans
  // lui, un refus affichait « Échec » sans dire pourquoi, et la cellule RESTAIT
  // sur la valeur refusée (faux succès visuel). On l'affiche et on revient à la
  // valeur d'avant.
  const [saveMsg, setSaveMsg] = useState<string>("");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const objTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allPostes = useMemo(() => groups.flatMap((gr) => gr.postes), [groups]);
  const displayedSet = useMemo(() => (displayedIds ? new Set(displayedIds) : null), [displayedIds]);
  // Sous-ensemble affiché par défaut (filtres équipe/atelier). Le bilan est
  // calculé sur CE sous-ensemble (population de l'atelier filtré), pas sur tout.
  const bilanPersonnes = useMemo(
    () => (displayedSet ? personnes.filter((p) => displayedSet.has(p.id)) : personnes),
    [personnes, displayedSet],
  );
  // Recherche sur le nom (accents ignorés) : balaie TOUT l'effectif, ce qui
  // permet de faire apparaître quelqu'un hors du filtre atelier/équipe courant.
  // Hors recherche, on se limite au sous-ensemble affiché par défaut.
  const shown = search.trim()
    ? personnes.filter((p) => norm(p.label).includes(norm(search)))
    : bilanPersonnes;
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
  // Seuil « compétent » PAR POSTE : le niveau attendu du poste au référentiel
  // (`poste.niveau_min_requis`), avec repli sur le seuil global du site quand le
  // poste n'a pas de niveau requis défini (0). Les lignes « Compétences » du
  // bilan comptent donc, colonne par colonne, les personnes atteignant le niveau
  // exigé par CE poste (au lieu d'un seuil unique ≥2).
  const seuilDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allPostes) m.set(p.id, p.niveauMin && p.niveauMin > 0 ? p.niveauMin : seuilCompetent);
    return m;
  }, [allPostes, seuilCompetent]);

  const stats = useMemo(() => {
    const m = new Map<string, Stat>();
    for (const p of allPostes) m.set(p.id, emptyStat(nbNiveaux));
    const useActuel = mode === "actuel";
    for (const pe of bilanPersonnes) {
      for (const p of allPostes) {
        const st = m.get(p.id)!;
        const seuil = seuilDe.get(p.id) ?? seuilCompetent;
        const cell = cells[key(pe.id, p.id)];
        const a = cell?.a ?? 0;
        const c = cell?.c ?? 0;
        const affiche = useActuel ? a : c;
        if (affiche === RESTRICT) st.restrict++;
        else if (affiche >= 0 && affiche <= nbNiveaux) st.lvl[affiche]++;
        if (a >= seuil) st.geA++;
        if (c >= seuil) st.geC++;
      }
    }
    return m;
  }, [allPostes, bilanPersonnes, cells, mode, nbNiveaux, seuilCompetent, seuilDe]);

  const statOf = (poid: string): Stat => stats.get(poid) ?? EMPTY_STAT;

  // Fin d'un échec d'écriture : message serveur affiché, revert appliqué par
  // l'appelant, indicateur gardé plus longtemps (le message doit se lire).
  async function echec(res: Response | null, revert: () => void) {
    let msg = "Enregistrement impossible (réseau).";
    if (res) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      msg = typeof j.error === "string" && j.error ? j.error : "Modification refusée.";
    }
    revert();
    setSaveState("error");
    setSaveMsg(msg);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 4000);
  }

  function saveObjectif(poid: string, champ: "actuel" | "cible", value: number) {
    const prev = champ === "actuel" ? objActuel[poid] ?? 0 : objCible[poid] ?? 0;
    if (champ === "actuel") setObjActuel((o) => ({ ...o, [poid]: value }));
    else setObjCible((o) => ({ ...o, [poid]: value }));
    setSaveState("saving");
    setSaveMsg("");
    const tk = `${poid}:${champ}`;
    if (objTimers.current[tk]) clearTimeout(objTimers.current[tk]);
    objTimers.current[tk] = setTimeout(async () => {
      const revert = () =>
        champ === "actuel"
          ? setObjActuel((o) => ({ ...o, [poid]: prev }))
          : setObjCible((o) => ({ ...o, [poid]: prev }));
      try {
        const res = await fetch("/api/poste/objectif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poste_id: poid, champ, objectif: value }),
        });
        if (!res.ok) return echec(res, revert);
        setSaveState("saved");
      } catch {
        return echec(null, revert);
      }
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }, 500);
  }

  function save(k: string, cell: Cell, pid: string, poid: string, prev: Cell) {
    setSaveState("saving");
    setSaveMsg("");
    if (timers.current[k]) clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(async () => {
      const revert = () => setCells((c) => ({ ...c, [k]: prev }));
      try {
        const res = await fetch("/api/matrice/cell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personne_id: pid, poste_id: poid, niveau_actuel: cell.a, niveau_cible: cell.c }),
        });
        if (!res.ok) return echec(res, revert);
        setSaveState("saved");
      } catch {
        return echec(null, revert);
      }
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }, 450);
  }

  function bump(pid: string, poid: string, delta: number) {
    const k = key(pid, poid);
    setCells((prev) => {
      const cur = prev[k] ?? { a: 0, c: 0 };
      let next: Cell;
      if (mode === "actuel") {
        const idx = CYCLE.indexOf(cur.a);
        const nextA = CYCLE[(((idx < 0 ? 0 : idx) + delta) % CYCLE.length + CYCLE.length) % CYCLE.length];
        // Symétrie CONDITIONNELLE de la cible (2026-09-09) :
        //  - Si la cible « collait » à l'actuel AVANT la modif (cur.c === cur.a),
        //    on la fait suivre dans les deux sens (montée ET descente). Corrige
        //    le bug historique : monter puis redescendre laissait la cible en
        //    l'air.
        //  - Sinon, la cible a été saisie plus haut volontairement → on la
        //    préserve, mais on garantit toujours cible ≥ actuel (remontée forcée
        //    si l'actuel dépasse la cible).
        //  - La restriction ❌ reste hors échelle, exclue de la comparaison.
        let nextC = cur.c;
        if (nextA !== RESTRICT && nextC !== RESTRICT) {
          const cibleCollait = cur.a !== RESTRICT && cur.c === cur.a;
          if (cibleCollait) nextC = nextA;
          else if (nextC < nextA) nextC = nextA;
        }
        next = { a: nextA, c: nextC };
      } else {
        // Mode cible : le cycle des valeurs autorisées démarre au niveau actuel
        // (on ne vise pas plus bas que le niveau déjà tenu). La restriction ❌
        // de l'actuel étant hors échelle, elle ne borne rien.
        const min = cur.a !== RESTRICT && cur.a > 0 ? cur.a : 0;
        const cycle = [...Array.from({ length: nbNiveaux - min + 1 }, (_, i) => i + min), RESTRICT];
        const idx = cycle.indexOf(cur.c);
        const nextC = cycle[(((idx < 0 ? 0 : idx) + delta) % cycle.length + cycle.length) % cycle.length];
        next = { a: cur.a, c: nextC };
      }
      save(k, next, pid, poid, cur);
      return { ...prev, [k]: next };
    });
  }

  const saveLabel =
    saveState === "saving" ? "Enregistrement..." : saveState === "saved" ? "Enregistré" : saveState === "error" ? (saveMsg || "Échec d'enregistrement") : "";

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
                      {allPostes.map((po) => {
                        const val = objMap[po.id] ?? 0;
                        const cellKey = `${champ}:${po.id}`;
                        // Champ de saisie monte UNIQUEMENT sur la cellule editee.
                        if (canEditObjectif && editObj === cellKey) {
                          return (
                            <td key={po.id} className={s.bilanTd}>
                              <input
                                type="number"
                                min={0}
                                value={val}
                                autoFocus
                                onChange={(e) => saveObjectif(po.id, champ, Math.max(0, Number(e.target.value) || 0))}
                                // La case contient toujours un nombre (0 par defaut) : au focus,
                                // on le selectionne pour que la frappe le REMPLACE.
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => setEditObj(null)}
                                className={s.objInput}
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={po.id} className={s.bilanTd}>
                            {canEditObjectif ? (
                              // Vue legere : au clic/focus, la cellule passe en edition.
                              <span
                                tabIndex={0}
                                role="button"
                                className={s.objView}
                                title="Cliquer pour modifier l'objectif"
                                onClick={() => setEditObj(cellKey)}
                                onFocus={() => setEditObj(cellKey)}
                              >
                                {val}
                              </span>
                            ) : (
                              val
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className={s.rowCouverture}>
                      <td className={s.bilanLabel} title="Personnes atteignant le niveau requis de chaque poste (référentiel), avec repli sur le seuil du site si le poste n'a pas de niveau requis">Compétences {champ} (niv. requis)</td>
                      {allPostes.map((po) => {
                        const c = statOf(po.id)[field];
                        const obj = objMap[po.id] ?? 0;
                        const seuil = seuilDe.get(po.id) ?? seuilCompetent;
                        const manque = c < obj; // sous l'objectif -> rouge sur fond rouge
                        return (
                          <td
                            key={po.id}
                            className={s.bilanTd}
                            data-manque={manque ? "1" : "0"}
                            title={`Niveau requis ≥ ${seuil} — ${c} personne(s) / objectif ${obj}${manque ? ` — manque ${obj - c}` : ""}`}
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
                      title="Aucune compétence sur aucun poste (tous services confondus)"
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
                  {personnes.length === 0
                    ? "Aucune personne active."
                    : search.trim()
                      ? "Aucun résultat pour cette recherche."
                      : "Aucune personne dans ce filtre (tapez un nom pour chercher dans tout l'effectif)."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
