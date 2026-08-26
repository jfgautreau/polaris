"use client";

import { useMemo, useRef, useState } from "react";
import { joursRestants, habStatut, addMonthsIso, fmtDateFr, HAB_COLOR, type HabStatut } from "@/lib/habilitations";
import { usePersonGrid } from "@/components/usePersonGrid";
import { INTERIM_BG } from "@/lib/interim";
import g from "@/components/persongrid.module.css";
import HabMark from "./HabMark";
import HabLegendeModal from "./HabLegendeModal";
import HabMajModal from "./HabMajModal";
import AutorisationMark from "./AutorisationMark";
import PageTitle from "@/components/PageTitle";
import SlideSwitch from "@/components/SlideSwitch";
import AtelierEquipeFiltres from "@/components/AtelierEquipeFiltres";
import Link from "next/link";

type Row = {
  id: string;
  personne_id: string;
  competence_id: string;
  date_obtention: string | null;
  date_expiration: string | null;
  date_autorisation_conduite: string | null;
  commentaire: string | null;
  personne: { nom: string; prenom: string } | null;
  competence: { nom: string; a_recycler: boolean; a_autorisation_conduite: boolean } | null;
};
type Personne = { id: string; nom: string; prenom: string; type_contrat?: string };
type Comp = { id: string; nom: string; duree_validite_mois: number | null; categorie: string | null; groupe: string | null; ordre: number; a_autorisation_conduite: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmtDate = fmtDateFr; // JJ-MM-AAAA
const CAT_LABEL: Record<string, string> = { reglementaire: "Formations règlementaires", interne: "Formations internes" };
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const CAT_ORDER = ["reglementaire", "interne"];
const catOf = (c: string | null) => (c === "interne" ? "interne" : "reglementaire");

// Echeance effective : date stockee, sinon recalculee (obtention + duree de validite).
const effExp = (rec: Row, comp?: Comp) => rec.date_expiration ?? addMonthsIso(rec.date_obtention, comp?.duree_validite_mois);

// Case a cocher « autorisation remise », editable en direct (auto-save immediat).
// La date d'autorisation vaut date d'obtention de l'habilitation ; le back-end
// s'en charge. Ici on ne manipule qu'un booleen.
function AutorisationCell({ id, initial }: { id: string; initial: boolean }) {
  const [val, setVal] = useState<boolean>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function onChange(v: boolean) {
    setVal(v);
    setState("saving");
    try {
      const res = await fetch("/api/habilitations/autorisation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, remise: v }),
      });
      setState(res.ok ? "saved" : "error");
      if (!res.ok) setVal(!v); // rollback visuel
    } catch {
      setState("error");
      setVal(!v);
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={val}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: "auto", margin: 0 }}
      />
      <span style={{ fontSize: 12, width: 14, color: state === "error" ? "var(--danger)" : "var(--ok)" }}>
        {state === "saving" ? "…" : state === "saved" ? "✓" : state === "error" ? "!" : ""}
      </span>
    </label>
  );
}

// Cellule commentaire de la vue liste : input auto-sauvegarde.
function CommentaireCell({ id, initial }: { id: string; initial: string | null }) {
  const [val, setVal] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(v: string) {
    setVal(v);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/habilitations/commentaire", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, commentaire: v }),
        });
        setState(res.ok ? "saved" : "error");
      } catch {
        setState("error");
      }
      setTimeout(() => setState("idle"), 1500);
    }, 500);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}>
      <input
        type="text"
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        style={{ width: "100%", fontSize: 12, padding: "2px 4px" }}
      />
      <span style={{ fontSize: 12, width: 14, color: state === "error" ? "var(--danger)" : "var(--ok)", flexShrink: 0 }}>
        {state === "saving" ? "…" : state === "saved" ? "✓" : state === "error" ? "!" : ""}
      </span>
    </span>
  );
}

// Compteur du bilan, loge dans la cellule d'angle : compact, car elle ne fait
// qu'environ 150 px de large pour 140 px de haut.
function Kpi({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div
      title={label}
      style={{
        display: "flex",
        alignItems: "baseline",
        // Chiffre et libelle centres ensemble dans la tuile.
        justifyContent: "center",
        gap: 7,
        minWidth: 0,
        padding: "6px 10px",
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "#fff",
      }}
    >
      <span style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.1, color }}>{n}</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export default function HabilitationsList({
  rows,
  personnes,
  comps,
  canEdit = false,
  ateliers = [],
  equipes = [],
  atelier = "",
  equipe = "",
  lienParam = false,
}: {
  rows: Row[];
  personnes: Personne[];
  comps: Comp[];
  canEdit?: boolean;
  ateliers?: { id: string; label: string }[];
  equipes?: { id: string; label: string }[];
  atelier?: string;
  equipe?: string;
  lienParam?: boolean; // droit de lecture sur « Param. Habilitation »
}) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grille" | "liste">("grille"); // grille par défaut
  // Saisie ouverte au clic sur une pastille, pre-remplie avec cette case.
  const [maj, setMaj] = useState<{ personneId: string; competenceId: string; dateObtention: string | null; autorisationRemise: boolean; commentaire: string | null } | null>(null);
  const [showLegende, setShowLegende] = useState(false);
  const [showBilan, setShowBilan] = useState(false);

  const compById = useMemo(() => new Map(comps.map((c) => [c.id, c])), [comps]);

  const q = search.trim();
  // Recherche multi-critères : nom de personne, mais aussi formation / groupe / catégorie.
  const personMatch = (p: { nom: string; prenom: string }) => norm(`${p.nom} ${p.prenom}`).includes(norm(q));
  const compMatch = (c: Comp) => norm(`${c.nom} ${c.groupe ?? ""} ${CAT_LABEL[catOf(c.categorie)]}`).includes(norm(q));

  // Enregistrement par (personne, formation).
  const recMap = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) m.set(`${r.personne_id}:${r.competence_id}`, r);
    return m;
  }, [rows]);

  // Bilan (global + par formation), independant de la recherche. Base sur recMap
  // (etat courant : une entree par personne x formation, comme la grille) pour ne
  // pas compter deux fois un recyclage. Restreint aux personnes actives.
  const bilan = useMemo(() => {
    const actifs = new Set(personnes.map((p) => p.id));
    const formeesSet = new Set<string>();
    let valables = 0;
    let expirees = 0;
    let autorNonDelivrees = 0; // formation soumise a autorisation, case non cochee
    const parComp = new Map<string, { formees: number; valables: number; expirees: number; autorNonDelivrees: number }>();
    for (const c of comps) parComp.set(c.id, { formees: 0, valables: 0, expirees: 0, autorNonDelivrees: 0 });
    for (const rec of recMap.values()) {
      if (!actifs.has(rec.personne_id)) continue;
      const comp = compById.get(rec.competence_id);
      const st = parComp.get(rec.competence_id);
      if (!st) continue; // formation inactive / non listee
      formeesSet.add(rec.personne_id);
      st.formees++;
      const j = joursRestants(effExp(rec, comp));
      if (j !== null && j < 0) {
        expirees++;
        st.expirees++;
      } else {
        valables++;
        st.valables++;
      }
      if (comp?.a_autorisation_conduite && !rec.date_autorisation_conduite) {
        autorNonDelivrees++;
        st.autorNonDelivrees++;
      }
    }
    return { global: { formees: formeesSet.size, valables, expirees, autorNonDelivrees }, parComp };
  }, [recMap, personnes, comps, compById]);

  // Colonnes ordonnées.
  const ordered = useMemo(
    () =>
      [...comps].sort(
        (a, b) => CAT_ORDER.indexOf(catOf(a.categorie)) - CAT_ORDER.indexOf(catOf(b.categorie)) || a.ordre - b.ordre || a.nom.localeCompare(b.nom)
      ),
    [comps]
  );

  // Filtrage : si la recherche touche des personnes on filtre les lignes ; si elle
  // touche des formations on filtre les colonnes ; sinon on garde tout (ou rien si
  // la recherche ne correspond à rien).
  const hasPersonHit = q ? personnes.some(personMatch) : false;
  const hasCompHit = q ? ordered.some(compMatch) : false;
  const noHit = !!q && !hasPersonHit && !hasCompHit;
  const shownPersonnes = !q ? personnes : noHit ? [] : hasPersonHit ? personnes.filter(personMatch) : personnes;
  const shownOrdered = !q ? ordered : noHit ? [] : hasCompHit ? ordered.filter(compMatch) : ordered;
  const shownRows = !q
    ? rows
    : rows.filter((r) => {
        const p = r.personne ? personMatch(r.personne) : false;
        const c = compById.get(r.competence_id);
        return p || (c ? compMatch(c) : r.competence ? norm(r.competence.nom).includes(norm(q)) : false);
      });

  // Virtualisation des lignes de la grille (cf. usePersonGrid) : seules les
  // personnes visibles sont rendues. `rowCount` suit le filtre de recherche.
  const { headCardRef, headTableRef, rowsTableRef, rowsCardProps, virtual } = usePersonGrid(g.colHover, 3, {
    rowCount: shownPersonnes.length,
  });
  const rowsShownPersonnes = virtual ? shownPersonnes.slice(virtual.start, virtual.end) : shownPersonnes;

  // Bandeaux d'en-tete : categories puis groupes. `debutGroupe` marque la premiere
  // colonne de chaque groupe (separateur plus marque, comme la matrice).
  const catSpans: { key: string; label: string; span: number }[] = [];
  const grpSpans: { key: string; label: string; span: number }[] = [];
  const debutGroupe = new Set<string>();
  for (const c of shownOrdered) {
    const ck = catOf(c.categorie);
    if (!catSpans.length || catSpans[catSpans.length - 1].key !== ck) catSpans.push({ key: ck, label: CAT_LABEL[ck], span: 1 });
    else catSpans[catSpans.length - 1].span++;
    const gk = `${ck}|${c.groupe ?? "—"}`;
    if (!grpSpans.length || grpSpans[grpSpans.length - 1].key !== gk) {
      grpSpans.push({ key: gk, label: c.groupe ?? "—", span: 1 });
      debutGroupe.add(c.id);
    } else grpSpans[grpSpans.length - 1].span++;
  }

  // Colonne noms adaptative, partagee par les 2 tables -> colonnes alignees.
  // Plancher a 230 px : la cellule d'angle loge les tuiles de compteur, dont le
  // libelle le plus long (« Autor. a remettre », 13 px) serait rogne en dessous.
  const nameW = Math.min(320, Math.max(230, personnes.reduce((m, p) => Math.max(m, `${p.nom} ${p.prenom}`.length), 0) * 7.2 + 30));
  const cols = useMemo(
    () => (
      <colgroup>
        <col style={{ width: nameW }} />
        {shownOrdered.map((c) => (
          <col key={c.id} />
        ))}
      </colgroup>
    ),
    [nameW, shownOrdered]
  );

  // Statut + infobulle d'une case.
  function cellOf(personId: string, c: Comp): { statut: HabStatut | "aucun"; title: string } {
    const rec = recMap.get(`${personId}:${c.id}`);
    if (!rec) return { statut: "aucun", title: `${c.nom} — non habilité` };
    // Autorisation : « remise » (case cochee, date = date d'obtention) ou « à remettre ».
    // Le champ date_autorisation_conduite tient lieu de booleen (non-null = remise).
    const auTxt = c.a_autorisation_conduite
      ? rec.date_autorisation_conduite
        ? " · autorisation remise"
        : " · autorisation à remettre"
      : "";
    const commTxt = rec.commentaire ? `\n« ${rec.commentaire} »` : "";
    const exp = effExp(rec, c);
    if (!exp) return { statut: "vert", title: `${c.nom} — valable (pas de date de validité)${auTxt}${commTxt}` };
    const j = joursRestants(exp);
    const st = habStatut(j) ?? "vert";
    return { statut: st, title: `${c.nom} — ${j !== null && j < 0 ? `expirée (${-j} j)` : `${j} j`} (éch. ${fmtDate(exp)})${auTxt}${commTxt}` };
  }

  const anyAutor = rows.some((r) => r.competence?.a_autorisation_conduite);

  return (
    <>
      {/* En-tete en deux lignes, commun a Personnel / Matrice / Habilitations.
          Ligne 1 : titre · recherche · legende et lien de parametrage.
          Ligne 2 : bascule Grille / Liste a gauche · filtres a droite.
          Il est rendu ICI et non dans la page : la recherche est un etat client,
          elle doit vivre dans le meme composant que le champ. */}
      <div className="headband headband-top">
        <div className="hb-l1">
          <PageTitle module="habilitations">Habilitations</PageTitle>
          <span className="hb-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Rechercher (nom, formation, groupe…)"
            />
            {search && (
              <button type="button" className="clear" onClick={() => setSearch("")} title="Effacer la recherche">
                ✕
              </button>
            )}
          </span>
          <span className="hb-fin">
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto", margin: 0 }} onClick={() => setShowLegende(true)}>
              📖 Légende
            </button>
            {lienParam && (
              <Link href="/admin/habilitations-param" className="navlink" prefetch={false} title="Définir les formations et leurs durées de validité">
                📜 Paramétrer les formations &rarr;
              </Link>
            )}
          </span>
        </div>

        <div className="hb-l2">
          <SlideSwitch
            on={view === "liste"}
            onChange={(v) => setView(v ? "liste" : "grille")}
            offLabel="Grille"
            onLabel="Liste"
            offColor="#4f46e5"
            onColor="#4f46e5"
            width={156}
            title="Basculer entre la grille et la liste par échéance"
          />
          <span className="hb-fin">
            <AtelierEquipeFiltres base="/habilitations" ateliers={ateliers} equipes={equipes} atelier={atelier} equipe={equipe} />
          </span>
        </div>
      </div>

      <div className="gridband">
        {view === "grille" ? (
          <div
            className={g.grid}
            style={{
              "--name-w": `${nameW}px`,
              "--n-cols": shownOrdered.length,
              "--sub-top": "22px",
              "--col-top": "44px",
              // En-tetes bleus + traits verticaux identiques a la matrice (mode Actuel).
              "--accent": "#1d4ed8",
              "--accent-bg": "#dbeafe",
              "--accent-soft": "#1d4ed855",
            } as React.CSSProperties}
          >
            {/* Tableau 1 : en-tetes figes (categorie / groupe / formation) */}
            <div className={`card ${g.headCard}`} ref={headCardRef}>
              <table className={`matrix ${g.table}`} ref={headTableRef}>
                {cols}
                <thead>
                  <tr>
                    {/* Cellule d'angle : les compteurs globaux, puis le bouton Bilan
                        juste en dessous. Ils occupent une place autrement perdue et
                        restent visibles au defilement (l'angle est fige). */}
                    <th rowSpan={3} className={g.cornerHead}>
                      <div className={g.cornerKpis}>
                        <Kpi n={bilan.global.formees} label="Formées" color="#1d4ed8" />
                        <Kpi n={bilan.global.valables} label="Valables" color="#16a34a" />
                        <Kpi n={bilan.global.expirees} label="Expirées" color="#dc2626" />
                        <Kpi n={bilan.global.autorNonDelivrees} label="Autor. à remettre" color="#b45309" />
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowBilan((b) => !b)}
                        title={showBilan ? "Masquer le bilan" : "Afficher le bilan par formation"}
                        className={g.bilanToggle}
                      >
                        {showBilan ? "− Bilan" : "+ Bilan"}
                      </button>
                    </th>
                    {catSpans.map((c) => (
                      <th key={c.key} colSpan={c.span} className={g.groupHead} title={c.label}>
                        <div className={g.groupLabel}>{c.label}</div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {grpSpans.map((gr) => (
                      <th key={gr.key} colSpan={gr.span} className={g.subHead} title={gr.label}>
                        <div className={g.groupLabel}>{gr.label}</div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {shownOrdered.map((c) => (
                      <th
                        key={c.id}
                        title={c.a_autorisation_conduite ? `${c.nom}\nSoumise à autorisation` : c.nom}
                        className={debutGroupe.has(c.id) ? `${g.colHead} ${g.groupStart}` : g.colHead}
                      >
                        <div className={g.colLabel}>
                          {c.a_autorisation_conduite && (
                            <span className={g.colMark}>
                              <AutorisationMark />
                            </span>
                          )}
                          {c.nom}
                        </div>
                      </th>
                    ))}
                    {shownOrdered.length === 0 && <th className="muted">Aucune formation</th>}
                  </tr>
                </thead>
                {showBilan && (
                  <tbody>
                    {([
                      ["Personnes formées", "#1d4ed8", "formees"],
                      ["Habilitations valables", "#16a34a", "valables"],
                      ["Habilitations expirées", "#dc2626", "expirees"],
                      // Colonnes sans autorisation : la case reste vide (le compteur
                      // n'a pas de sens hors formations « a autorisation »).
                      ["Autorisations non remises", "#b45309", "autorNonDelivrees"],
                    ] as const).map(([label, color, field]) => (
                      <tr key={field} className={g.bilanRow}>
                        <td className={g.bilanLabel} style={{ color }}>{label}</td>
                        {shownOrdered.map((c) => {
                          // « Autor. non remises » : afficher — sur les formations
                          // sans autorisation, sinon on ne comprend pas pourquoi la
                          // colonne reste toujours a 0.
                          if (field === "autorNonDelivrees" && !c.a_autorisation_conduite) {
                            return <td key={c.id} className={g.bilanCell} style={{ color: "#cbd5e1" }}>—</td>;
                          }
                          const n = bilan.parComp.get(c.id)?.[field] ?? 0;
                          return (
                            <td key={c.id} className={g.bilanCell} style={{ color: n > 0 ? color : "#cbd5e1" }}>
                              {n || ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                )}
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
                      <td colSpan={shownOrdered.length + 1} style={{ height: virtual.padTop, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {rowsShownPersonnes.map((p) => (
                    <tr key={p.id}>
                      <td className={g.nameCell}>
                        <span style={p.type_contrat === "INTERIM" ? { background: INTERIM_BG, borderRadius: 3, padding: "0 4px" } : undefined}>{p.nom} {p.prenom}</span>
                      </td>
                      {shownOrdered.map((c) => {
                        const { statut, title } = cellOf(p.id, c);
                        const rec = recMap.get(`${p.id}:${c.id}`);
                        const hint = canEdit ? `\n(cliquer pour ${rec ? "recycler" : "enregistrer"})` : "";
                        return (
                          <td key={c.id} className={g.cellTd}>
                            <span
                              className={g.cellMark}
                              title={`${p.nom} ${p.prenom}\n${title}${hint}`}
                              onClick={
                                canEdit
                                  ? () =>
                                      setMaj({
                                        personneId: p.id,
                                        competenceId: c.id,
                                        dateObtention: rec?.date_obtention ?? null,
                                        autorisationRemise: !!rec?.date_autorisation_conduite,
                                        commentaire: rec?.commentaire ?? null,
                                      })
                                  : undefined
                              }
                              style={canEdit ? { cursor: "pointer" } : undefined}
                            >
                              <HabMark statut={statut} />
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Cale basse : reserve la hauteur des lignes non rendues en dessous. */}
                  {virtual && virtual.padBottom > 0 && (
                    <tr aria-hidden>
                      <td colSpan={shownOrdered.length + 1} style={{ height: virtual.padBottom, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {shownPersonnes.length === 0 && (
                    <tr>
                      <td colSpan={shownOrdered.length + 1} className="muted" style={{ padding: 10 }}>
                        Aucun résultat.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <>
            <div className="card grow" style={{ overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Personne</th>
                    <th>Formation</th>
                    <th>Passage</th>
                    <th>Échéance</th>
                    {anyAutor && <th style={{ width: 110, textAlign: "center" }}>Autorisation</th>}
                    <th>Statut</th>
                    <th>Commentaire</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => {
                    const exp = effExp(r, compById.get(r.competence_id));
                    const j = joursRestants(exp);
                    const st = exp ? habStatut(j) : "vert";
                    return (
                      <tr key={r.id}>
                        <td>{r.personne ? `${r.personne.nom} ${r.personne.prenom}` : "?"}</td>
                        <td>{r.competence?.nom ?? "?"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date_obtention)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{exp ? fmtDate(exp) : <span className="muted">-</span>}</td>
                        {anyAutor && (
                          <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                            {r.competence?.a_autorisation_conduite ? (
                              canEdit ? (
                                <AutorisationCell id={r.id} initial={!!r.date_autorisation_conduite} />
                              ) : (
                                r.date_autorisation_conduite ? "✓" : <span className="muted">—</span>
                              )
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        )}
                        <td>
                          {st && (
                            <span className="tag" style={{ background: HAB_COLOR[st], color: "#fff" }}>
                              {!exp ? "valide" : j !== null && j < 0 ? `expirée (${-j} j)` : `${j} j`}
                            </span>
                          )}
                        </td>
                        <td>
                          {canEdit ? (
                            <CommentaireCell id={r.id} initial={r.commentaire} />
                          ) : (
                            r.commentaire ? r.commentaire : <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {shownRows.length === 0 && (
                    <tr>
                      <td colSpan={anyAutor ? 7 : 6} className="muted">
                        {rows.length === 0 ? "Aucune habilitation enregistrée." : "Aucun résultat pour cette recherche."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showLegende && <HabLegendeModal onClose={() => setShowLegende(false)} />}

      {/* Saisie / recyclage, ouverte au clic sur une pastille de la grille */}
      {maj && (
        <HabMajModal
          personnes={personnes}
          comps={comps}
          initial={maj}
          dateJour={todayIso()}
          onClose={() => setMaj(null)}
        />
      )}
    </>
  );
}
