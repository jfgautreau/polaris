"use client";

import { useRef, useState } from "react";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import ToggleSwitch from "@/components/ToggleSwitch";

type Poste = {
  id: string;
  nom: string;
  nom_court: string | null;
  categorie: string;
  effectif_requis: number;
  difficulte_formation: number | null;
  niveau_min_requis: number;
  ordre_affichage: number;
  numero_rotation: string | null;
  remplacable: boolean;
  actif: boolean;
};
type Ligne = { id: string; nom: string; actif: boolean; ordre_affichage: number; poste: Poste[] };
type Atelier = { id: string; nom: string; actif: boolean; ligne: Ligne[] };
type Quart = { code: string; libelle: string };
type Comp = { id: string; nom: string; a_recycler: boolean };

const CATEGORIES: { value: string; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "conducteur", label: "Conducteur" },
  { value: "operateur", label: "Opérateur" },
];

const byNom = <T extends { nom: string }>(a: T, b: T) => a.nom.localeCompare(b.nom);

// Bouton bleu plein « + Ajouter … », pousse a droite du titre de son bloc.
const ADD_BTN: React.CSSProperties = {
  width: "auto",
  margin: 0,
  marginLeft: "auto",
  padding: "5px 14px",
  fontSize: 13,
  fontWeight: 700,
  background: "#1d4ed8",
  color: "#fff",
  border: "1px solid #1d4ed8",
  borderRadius: 8,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// Cellule « Habil. requises » : bouton blanc portant les pastilles des habilitations
// exigees. `color` explicite car le style global des boutons impose du texte blanc.
const REQ_BTN: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  width: "100%",
  // `minWidth: 0` et non une largeur plancher : la colonne est figee par le
  // colgroup, le bouton s'empile sur plusieurs rangees plutot que de l'elargir.
  minWidth: 0,
  margin: 0,
  padding: "3px 6px",
  background: "#fff",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  textAlign: "left",
};
const REQ_TAG: React.CSSProperties = {
  padding: "1px 7px",
  borderRadius: 999,
  background: "#dbeafe",
  color: "#1d4ed8",
  fontWeight: 700,
  fontSize: 11,
  // Un nom d'habilitation trop long se replie au lieu de deborder de la colonne
  // (« PRPO conditionnement ss atm modif » ne tient pas sur une rangee).
  whiteSpace: "normal",
  maxWidth: "100%",
  overflowWrap: "anywhere",
  lineHeight: 1.35,
};

type Titulaire = { id: string; label: string };

export default function ReferentielEditor({
  initial,
  quarts = [],
  pqOff = [],
  comps = [],
  pcr = [],
  persons = [],
  titulaires = {},
  nbNiveaux = 4,
}: {
  initial: Atelier[];
  quarts?: Quart[];
  pqOff?: string[];
  comps?: Comp[];
  pcr?: string[];
  persons?: Titulaire[];
  titulaires?: Record<string, Titulaire[]>;
  nbNiveaux?: number;
}) {
  const [tree, setTree] = useState<Atelier[]>(initial);
  // Titulaire(s) par poste (poste fixe). Modifiable ici comme dans la fiche
  // Personnel — même donnée (personne.poste_fixe_id).
  const [titu, setTitu] = useState<Record<string, Titulaire[]>>(titulaires);
  // Poste dont on édite le titulaire (une seule liste <select> montée à la fois
  // → DOM léger même avec des centaines de personnes).
  const [tituEdit, setTituEdit] = useState<string | null>(null);
  // Desactivations poste x quart (cle `${poste}:${quart}`). Absent = actif.
  const [off, setOff] = useState<Set<string>>(new Set(pqOff));
  // Habilitations requises (cle `${poste}:${competence}`). Presente = exigee.
  const [req, setReq] = useState<Set<string>>(new Set(pcr));
  // Poste dont on edite les habilitations requises (modale).
  const [reqFor, setReqFor] = useState<{ id: string; nom: string } | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function post(op: string, payload: Record<string, unknown>) {
    setSave("saving");
    try {
      const res = await fetch("/api/referentiel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...payload }),
      });
      if (!res.ok) throw new Error();
      const j = await res.json().catch(() => ({}));
      setSave("saved");
      return j as { ok?: boolean; row?: unknown };
    } catch {
      setSave("error");
      return null;
    } finally {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSave("idle"), 1500);
    }
  }
  function schedule(key: string, fn: () => void, delay: number) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, delay);
  }

  // -- mutateurs d'etat immuables --
  const setAtelier = (aid: string, fn: (a: Atelier) => Atelier) =>
    setTree((t) => t.map((a) => (a.id === aid ? fn(a) : a)));
  const setLigne = (aid: string, lid: string, fn: (l: Ligne) => Ligne) =>
    setAtelier(aid, (a) => ({ ...a, ligne: a.ligne.map((l) => (l.id === lid ? fn(l) : l)) }));
  const setPoste = (aid: string, lid: string, pid: string, fn: (p: Poste) => Poste) =>
    setLigne(aid, lid, (l) => ({ ...l, poste: l.poste.map((p) => (p.id === pid ? fn(p) : p)) }));

  // -- Titulaire (poste fixe) --
  function setTitulaire(posteId: string, personneId: string) {
    setTituEdit(null);
    const pers = personneId ? persons.find((p) => p.id === personneId) : null;
    setTitu((t) => {
      const next: Record<string, Titulaire[]> = {};
      // Une personne n'a qu'UN poste fixe : on la retire de tout autre poste.
      for (const [pid, list] of Object.entries(t)) {
        const filtered = personneId ? list.filter((x) => x.id !== personneId) : list;
        if (pid !== posteId && filtered.length) next[pid] = filtered;
      }
      // Ce poste n'a qu'un titulaire depuis cette vue (cf. commentaire de l'op).
      next[posteId] = pers ? [pers] : [];
      return next;
    });
    post("set-titulaire", { poste_id: posteId, personne_id: personneId });
  }

  // -- Atelier --
  function renameAtelier(aid: string, nom: string) {
    setAtelier(aid, (a) => ({ ...a, nom }));
    schedule(`a:${aid}`, () => post("update-atelier", { id: aid, nom }), 500);
  }
  function toggleAtelier(aid: string, actif: boolean) {
    setAtelier(aid, (a) => ({ ...a, actif }));
    post("toggle", { entity: "atelier", id: aid, actif });
  }
  async function addAtelier(nom: string) {
    const j = await post("create-atelier", { nom });
    if (j?.row) setTree((t) => [...t, j.row as Atelier].sort(byNom));
  }

  // -- Ligne --
  function renameLigne(aid: string, lid: string, nom: string) {
    setLigne(aid, lid, (l) => ({ ...l, nom }));
    schedule(`l:${lid}`, () => post("update-ligne", { id: lid, nom }), 500);
  }
  function ligneOrdre(aid: string, lid: string, ordre_affichage: number) {
    setLigne(aid, lid, (l) => ({ ...l, ordre_affichage }));
    schedule(`l:${lid}:ordre`, () => post("update-ligne", { id: lid, ordre_affichage }), 500);
  }
  function toggleLigne(aid: string, lid: string, actif: boolean) {
    setLigne(aid, lid, (l) => ({ ...l, actif }));
    post("toggle", { entity: "ligne", id: lid, actif });
  }
  async function addLigne(aid: string, nom: string) {
    const j = await post("create-ligne", { atelier_id: aid, nom });
    if (j?.row) setAtelier(aid, (a) => ({ ...a, ligne: [...a.ligne, j.row as Ligne].sort(byNom) }));
  }

  // -- Poste --
  function posteField(aid: string, lid: string, pid: string, key: keyof Poste, value: unknown) {
    setPoste(aid, lid, pid, (p) => ({ ...p, [key]: value }));
    const delay = key === "nom" || key === "nom_court" || key === "effectif_requis" || key === "ordre_affichage" ? 500 : 0;
    schedule(`p:${pid}:${key}`, () => post("update-poste", { id: pid, patch: { [key]: value } }), delay);
  }
  function togglePoste(aid: string, lid: string, pid: string, actif: boolean) {
    // ⚠️ Passe par l'op `toggle` (comme atelier/ligne), PAS par `update-poste` :
    // le whitelist `posteValue` de la route ignore la colonne `actif`, donc
    // `posteField(..., "actif", …)` était silencieusement écarté et le poste
    // restait actif en base — il continuait d'apparaître dans la Matrice et
    // partout où l'on filtre `poste.actif`. L'op `toggle` gère déjà l'entité
    // « poste » (et le site_id).
    setPoste(aid, lid, pid, (p) => ({ ...p, actif }));
    post("toggle", { entity: "poste", id: pid, actif });
  }
  // Activation poste x quart (coche = actif). Defaut actif : on ne stocke que les off.
  const quartOn = (pid: string, q: string) => !off.has(`${pid}:${q}`);
  function toggleQuart(pid: string, q: string, on: boolean) {
    setOff((s) => {
      const n = new Set(s);
      const k = `${pid}:${q}`;
      if (on) n.delete(k);
      else n.add(k);
      return n;
    });
    post("poste-quart", { poste_id: pid, quart_code: q, actif: on });
  }
  // Habilitations exigees par un poste. Presente = requise : on insere / supprime.
  const compRequise = (pid: string, cid: string) => req.has(`${pid}:${cid}`);
  function toggleCompRequise(pid: string, cid: string, on: boolean) {
    setReq((s) => {
      const n = new Set(s);
      const k = `${pid}:${cid}`;
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
    post("poste-competence", { poste_id: pid, competence_id: cid, requis: on });
  }
  const compsRequisesDe = (pid: string) => comps.filter((c) => compRequise(pid, c.id));

  async function addPoste(aid: string, lid: string, nom: string) {
    const j = await post("create-poste", { ligne_id: lid, nom });
    if (j?.row) setLigne(aid, lid, (l) => ({ ...l, poste: [...l.poste, j.row as Poste].sort(byNom) }));
  }

  const saveLabel =
    save === "saving" ? "Enregistrement…" : save === "saved" ? "Enregistré ✓" : save === "error" ? "Échec d'enregistrement" : "";
  const saveColor = save === "error" ? "var(--danger)" : save === "saved" ? "var(--ok)" : "var(--muted)";

  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          justifyContent: "flex-end",
          minHeight: 18,
          fontSize: 12,
          fontWeight: 600,
          color: saveColor,
          marginBottom: 6,
        }}
      >
        {saveLabel}
      </div>

      <div style={{ display: "flex", marginBottom: 12 }}>
        <button type="button" style={ADD_BTN} onClick={() => addAtelier("")} title="Ajouter un atelier (à compléter ensuite)">
          ＋ Ajouter un atelier
        </button>
      </div>

      {tree.map((a) => (
        <div key={a.id} className="card section" style={{ opacity: a.actif ? 1 : 0.55 }}>
          {/* Atelier */}
          <div className="toolbar refhead" style={{ alignItems: "center" }}>
            <input
              value={a.nom}
              placeholder="Nom de l'atelier"
              onChange={(e) => renameAtelier(a.id, e.target.value)}
              style={{ fontSize: 16, fontWeight: 700, width: 260 }}
            />
            <ToggleSwitch on={a.actif} onChange={(v) => toggleAtelier(a.id, v)} title="Activer / désactiver l'atelier" />
            <button type="button" style={ADD_BTN} onClick={() => addLigne(a.id, "")} title="Ajouter une ligne (à compléter ensuite)">
              ＋ Ajouter une ligne
            </button>
          </div>

          {/* Lignes */}
          {a.ligne.map((l) => (
            <div key={l.id} className="section" style={{ marginLeft: 16, borderLeft: "2px solid #eee", paddingLeft: 16, opacity: l.actif ? 1 : 0.6 }}>
              <div className="toolbar refhead" style={{ alignItems: "center" }}>
                <input
                  value={l.nom}
                  placeholder="Nom de la ligne"
                  onChange={(e) => renameLigne(a.id, l.id, e.target.value)}
                  style={{ fontWeight: 600, width: 220 }}
                />
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }} title="N° d'affichage de la ligne sur les TV / PDF (croissant)">
                  N° aff.
                  <input
                    type="number"
                    min={0}
                    value={num(l.ordre_affichage)}
                    onChange={(e) => ligneOrdre(a.id, l.id, Number(e.target.value))}
                    style={{ width: 60 }}
                  />
                </label>
                <ToggleSwitch on={l.actif} onChange={(v) => toggleLigne(a.id, l.id, v)} title="Activer / désactiver la ligne" />
                <button type="button" style={ADD_BTN} onClick={() => addPoste(a.id, l.id, "")} title="Ajouter un poste (à compléter ensuite)">
                  ＋ Ajouter un poste
                </button>
              </div>

              {/* Postes.
                  ⚠️ Il y a UN tableau par ligne. En largeur automatique, chacun
                  dimensionne ses colonnes sur son propre contenu : une ligne dont
                  les postes exigent des habilitations elargissait sa colonne et
                  decalait tout, tableau par tableau. `table-layout: fixed` + un
                  colgroup identique partout les remettent d'aplomb, et la cellule
                  des habilitations se replie sur plusieurs rangees. */}
              <table className="rowh refpostes" style={{ width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 190 }} />{/* Poste */}
                  <col style={{ width: 92 }} />{/* Code */}
                  <col style={{ width: 76 }} />{/* Effectif */}
                  <col style={{ width: 118 }} />{/* Categorie */}
                  <col style={{ width: 80 }} />{/* Rempl. (PTR/PTNR) */}
                  <col style={{ width: 62 }} />{/* Diff. */}
                  <col style={{ width: 74 }} />{/* Niv. min */}
                  <col style={{ width: 72 }} />{/* N° aff. */}
                  <col style={{ width: 86 }} />{/* N° Rot */}
                  <col style={{ width: 200 }} />{/* Habil. requises */}
                  <col style={{ width: 150 }} />{/* Titulaire */}
                  {quarts.map((q) => (
                    <col key={q.code} style={{ width: 52 }} />
                  ))}
                  <col style={{ width: 56 }} />{/* Actif */}
                </colgroup>
                <thead>
                  <tr>
                    <th>Poste</th>
                    <th>Code</th>
                    <th>Effectif</th>
                    <th>Catégorie</th>
                    <th title="PTR = remplaçable. PTNR = Position de Travail Non Remplaçable (un seul titulaire par conception). Un PTNR est exclu des rapports de fragilité/relève et isolé dans les compétences critiques.">Rempl.</th>
                    <th>Diff.</th>
                    <th>Niv. min</th>
                    <th title="N° d'affichage du poste sur les TV / PDF (croissant)">N° aff.</th>
                    <th title="N° de rotation, libre. Un poste à plusieurs positions porte plusieurs numéros (ex. « 12, 13 »).">N° Rot</th>
                    <th title="Habilitations exigées pour tenir ce poste">Habil. requises</th>
                    <th title="Titulaire du poste (poste fixe). Même donnée que le sélecteur « Poste fixe » de la fiche Personnel : la personne est pré-remplie sur ce poste dans le planning.">Titulaire</th>
                    {quarts.map((q) => (
                      <th key={q.code} title={`Tourne en ${q.libelle}`} style={{ fontSize: 11 }}>
                        {q.libelle.slice(0, 4)}
                      </th>
                    ))}
                    <th>Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {l.poste.map((p) => (
                    <tr key={p.id} style={{ opacity: p.actif ? 1 : 0.5 }}>
                      <td>
                        {/* minWidth: 0 — la colonne est figee, un plancher la ferait deborder. */}
                        <input value={p.nom} placeholder="Nouveau poste" onChange={(e) => posteField(a.id, l.id, p.id, "nom", e.target.value)} style={{ width: "100%", minWidth: 0 }} />
                      </td>
                      <td>
                        <input
                          value={p.nom_court ?? ""}
                          maxLength={6}
                          onChange={(e) => posteField(a.id, l.id, p.id, "nom_court", e.target.value)}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={num(p.effectif_requis)}
                          onChange={(e) => posteField(a.id, l.id, p.id, "effectif_requis", Number(e.target.value))}
                          style={{ width: 64 }}
                        />
                      </td>
                      <td>
                        <select
                          value={p.categorie ?? "operateur"}
                          onChange={(e) => posteField(a.id, l.id, p.id, "categorie", e.target.value)}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={p.remplacable ? "1" : "0"}
                          onChange={(e) => posteField(a.id, l.id, p.id, "remplacable", e.target.value === "1")}
                          title={p.remplacable ? "Remplaçable (compté dans les rapports de relève)" : "Non remplaçable : exclu des rapports de fragilité, isolé dans les compétences critiques"}
                          style={{ color: p.remplacable ? undefined : "#b45309", fontWeight: p.remplacable ? 400 : 600 }}
                        >
                          <option value="1">PTR</option>
                          <option value="0">PTNR</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={p.difficulte_formation?.toString() ?? ""}
                          onChange={(e) => posteField(a.id, l.id, p.id, "difficulte_formation", e.target.value === "" ? null : Number(e.target.value))}
                        >
                          <option value="">-</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={p.niveau_min_requis.toString()}
                          onChange={(e) => posteField(a.id, l.id, p.id, "niveau_min_requis", Number(e.target.value))}
                        >
                          {Array.from({ length: nbNiveaux + 1 }, (_, n) => n).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={num(p.ordre_affichage)}
                          onChange={(e) => posteField(a.id, l.id, p.id, "ordre_affichage", Number(e.target.value))}
                          style={{ width: 60 }}
                        />
                      </td>
                      <td>
                        <input
                          value={p.numero_rotation ?? ""}
                          placeholder="12, 13"
                          maxLength={20}
                          onChange={(e) => posteField(a.id, l.id, p.id, "numero_rotation", e.target.value)}
                          style={{ width: 72 }}
                          title="Un numéro par position tenue (ex. « 12, 13 » si l'effectif est 2)"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setReqFor({ id: p.id, nom: p.nom })}
                          title="Choisir les habilitations exigées pour ce poste"
                          style={REQ_BTN}
                        >
                          {compsRequisesDe(p.id).length === 0 ? (
                            <span className="muted" style={{ fontWeight: 500 }}>＋ aucune</span>
                          ) : (
                            compsRequisesDe(p.id).map((c) => (
                              <span key={c.id} style={REQ_TAG}>{c.nom}</span>
                            ))
                          )}
                        </button>
                      </td>
                      <td>
                        {tituEdit === p.id ? (
                          <select
                            autoFocus
                            defaultValue={titu[p.id]?.[0]?.id ?? ""}
                            onChange={(e) => setTitulaire(p.id, e.target.value)}
                            onBlur={() => setTituEdit(null)}
                            style={{ width: "100%", minWidth: 0 }}
                          >
                            <option value="">— Aucun</option>
                            {persons.map((pp) => (
                              <option key={pp.id} value={pp.id}>{pp.label}</option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTituEdit(p.id)}
                            title="Définir le titulaire (poste fixe) de ce poste"
                            style={{ ...REQ_BTN, minHeight: 26 }}
                          >
                            {(titu[p.id]?.length ?? 0) === 0 ? (
                              <span className="muted" style={{ fontWeight: 500 }}>＋ définir</span>
                            ) : (
                              titu[p.id].map((t) => (
                                <span key={t.id} style={{ ...REQ_TAG, background: "#ede9fe", color: "#5b21b6" }}>{t.label}</span>
                              ))
                            )}
                          </button>
                        )}
                      </td>
                      {quarts.map((q) => (
                        <td key={q.code} style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={quartOn(p.id, q.code)}
                            onChange={(e) => toggleQuart(p.id, q.code, e.target.checked)}
                            style={{ width: "auto" }}
                            title={`${p.nom} tourne en ${q.libelle}`}
                          />
                        </td>
                      ))}
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={p.actif}
                          onChange={(e) => togglePoste(a.id, l.id, p.id, e.target.checked)}
                          style={{ width: "auto" }}
                        />
                      </td>
                    </tr>
                  ))}
                  {l.poste.length === 0 && (
                    <tr>
                      <td colSpan={12 + quarts.length} className="muted">Aucun poste.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}

      {tree.length === 0 && <p className="muted">Aucun atelier. Ajoutez-en un ci-dessus.</p>}

      {/* Modale : habilitations exigees par un poste (enregistrement immediat) */}
      {reqFor && (
        <ModaleDeplacable onClose={() => setReqFor(null)} largeur={460} zIndex={80}>
              <div className="mdd-drag" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, cursor: "grab" }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Habilitations requises</h2>
                <button type="button" onClick={() => setReqFor(null)} title="Fermer" style={{ width: "auto", margin: 0, padding: "2px 10px", fontSize: 16 }}>
                  ✕
                </button>
              </div>
              <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>
                Poste <strong>{reqFor.nom || "(sans nom)"}</strong>. Placer une personne qui n&apos;a
                pas (ou plus) l&apos;une de ces habilitations demandera une confirmation.
              </p>
              {comps.length === 0 ? (
                <p className="muted">Aucune compétence active.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "50vh", overflow: "auto" }}>
                  {comps.map((c) => (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={compRequise(reqFor.id, c.id)}
                        onChange={(e) => toggleCompRequise(reqFor.id, c.id, e.target.checked)}
                        style={{ width: "auto" }}
                      />
                      <span style={{ flex: 1 }}>{c.nom}</span>
                      {c.a_recycler && (
                        <span className="muted" style={{ fontSize: 11 }} title="Habilitation à recycler : son échéance est contrôlée">
                          à recycler
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
        </ModaleDeplacable>
      )}
    </div>
  );
}
