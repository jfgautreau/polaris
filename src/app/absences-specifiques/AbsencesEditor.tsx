"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import DateRangePicker from "@/components/DateRangePicker";
import { libellePeriode } from "@/lib/absences-periodes";
import { SaveIcon, TrashIcon, EditIcon } from "@/components/icons";

type Personne = { id: string; nom: string; prenom: string; atelier_id: string | null };
type Atelier = { id: string; nom: string };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };

// Période affichée : reconstruite server-side depuis les jours (cf. page.tsx).
// `absence_id` non nul = période déclarée (éditable en place) ; null = jours
// saisis au planning (le crayon la re-déclare, la corbeille les libère).
export type PeriodeVue = {
  key: string;
  personne_id: string;
  label: string;
  atelier_id: string | null;
  motif_absence_id: string;
  debut: string;
  fin: string;
  jours: number;
  absence_id: string | null;
  commentaire: string;
  declaree: boolean;
};

// Etat d'edition d'une ligne — brouillon (« + Declarer ») ou modification (crayon).
type Edition = {
  mode: "new" | "existing";
  absence_id?: string;
  personne_id: string;
  motif_absence_id: string;
  debut: string;
  fin: string;
  commentaire: string;
};

const fmtDate = (d: string) => (d ? d.split("-").reverse().join("/") : "—");
const nbJours = (a: string, b: string) => (a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1) : 0);
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Éditeur unifié « Absences » du menu Planning : même UX que la modale Personnel
// (ligne inline avec palette motif + mini calendrier + commentaire, crayon +
// corbeille sur chaque ligne, vérification de conflit avant enregistrement),
// enrichi de la sélection de la personne et de filtres nom / atelier / période.
//
// La liste vient reconstruite du serveur (`initial`) et on ne fait pas de mise à
// jour optimiste : après chaque écriture on `router.refresh()`, le serveur
// re-regroupe les jours et repasse la liste à jour. Le rendu lit donc `initial`
// directement (pas de copie en état local qui se désynchroniserait).
export default function AbsencesEditor({
  personnes,
  motifs,
  ateliers,
  initial,
  atelierInit = "",
  nomInit = "",
}: {
  personnes: Personne[];
  motifs: Motif[];
  ateliers: Atelier[];
  initial: PeriodeVue[];
  // Valeurs initiales des filtres, transmises par l'URL depuis le Planning
  // (bouton « 🤒 »). Vides = aucun filtre — comportement historique.
  atelierInit?: string;
  nomInit?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [edit, setEdit] = useState<Edition | null>(null);
  const [ouvertPop, setOuvertPop] = useState<null | "motif" | "cal" | "personne">(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [conflit, setConflit] = useState<{ jours: string[]; poursuivre: () => void } | null>(null);
  const [rechPers, setRechPers] = useState("");

  // Filtres nom + atelier : SYNCHRONISÉS À L'URL (?search= / ?atelier=). État
  // local pour la réactivité de la frappe ; à chaque modif, on répercute dans
  // l'URL via `router.replace()` (sans historique). Sans ça, un `router.refresh()`
  // ultérieur (déclenché par une écriture ailleurs, ou par un router.push interne)
  // ré-appelait le server component qui relisait `?search=` inchangé → le nom
  // effacé localement « revenait » à l'écran. Le lien « ← Planning » lit ces
  // mêmes params, donc le retour reste cohérent avec l'état visible.
  const [fNom, _setFNom] = useState(nomInit);
  const [fAtelier, _setFAtelier] = useState(atelierInit);
  const [fDu, setFDu] = useState("");
  const [fAu, setFAu] = useState("");
  const syncUrl = (patch: Partial<{ search: string; atelier: string }>) => {
    const p = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    router.replace(qs ? `/absences-specifiques?${qs}` : "/absences-specifiques", { scroll: false });
  };
  const setFNom = (v: string) => { _setFNom(v); syncUrl({ search: v }); };
  const setFAtelier = (v: string) => { _setFAtelier(v); syncUrl({ atelier: v }); };
  // Lien de retour Planning : lit l'URL LIVE (pas nomInit qui reste figé à
  // l'initialisation) → l'utilisateur revient avec les filtres qu'il vient
  // d'ajuster, pas ceux d'arrivée.
  const retourHref = (() => {
    const p = new URLSearchParams();
    if (fNom) p.set("search", fNom);
    if (fAtelier) p.set("atelier", fAtelier);
    const qs = p.toString();
    return qs ? `/planning?${qs}` : "/planning";
  })();

  const popRef = useRef<HTMLDivElement>(null);
  // Popover ancré au bouton en `position: fixed` : dans une carte `overflow:auto`,
  // un popover `absolute` est ROGNÉ et déclenche un ascenseur (cf. InfoBulle,
  // tasks/lessons.md L9). On mesure le bouton au clic, on place le menu juste
  // dessous, et on borne la gauche pour ne pas déborder de l'écran.
  const [popAnchor, setPopAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const persById = useMemo(() => new Map(personnes.map((p) => [p.id, p])), [personnes]);
  const motifById = useMemo(() => new Map(motifs.map((m) => [m.id, m])), [motifs]);

  const openPop = (type: "personne" | "motif" | "cal", e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
    setOuvertPop((cur) => (cur === type ? null : type));
  };
  const popStyle = (w: number): React.CSSProperties => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const left = popAnchor ? Math.max(8, Math.min(popAnchor.left, vw - w - 8)) : 0;
    return { position: "fixed", top: popAnchor?.top ?? 0, left, width: w, zIndex: 300 };
  };

  useEffect(() => {
    if (!ouvertPop) return;
    function onDoc(e: MouseEvent) {
      if (!popRef.current) return;
      if (!popRef.current.contains(e.target as Node)) setOuvertPop(null);
    }
    // On ferme au scroll EXTÉRIEUR (le popover fixed ne suivrait pas), mais PAS
    // quand on fait défiler la liste elle-même (sinon impossible de dérouler).
    const onScrollResize = (e?: Event) => {
      if (e && e.type === "scroll" && popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      setOuvertPop(null);
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [ouvertPop]);

  function commencerNouveau() {
    setErreur(null);
    setEdit({ mode: "new", personne_id: "", motif_absence_id: "", debut: "", fin: "", commentaire: "" });
  }
  function commencerEdition(p: PeriodeVue) {
    setErreur(null);
    if (p.absence_id) {
      setEdit({ mode: "existing", absence_id: p.absence_id, personne_id: p.personne_id, motif_absence_id: p.motif_absence_id, debut: p.debut, fin: p.fin, commentaire: p.commentaire });
    } else {
      // Période reconstruite depuis des jours saisis au planning : re-déclarée
      // (op save → creer_absence upserte les placements existants).
      setEdit({ mode: "new", personne_id: p.personne_id, motif_absence_id: p.motif_absence_id, debut: p.debut, fin: p.fin, commentaire: "" });
    }
  }
  function annulerEdition() {
    setEdit(null);
    setOuvertPop(null);
    setErreur(null);
  }

  async function verifierEtEnregistrer() {
    if (!edit) return;
    if (!edit.personne_id || !edit.motif_absence_id || !edit.debut || !edit.fin) {
      setErreur("Personne, motif, date de début et date de fin sont requis.");
      return;
    }
    setErreur(null);
    try {
      const res = await fetch("/api/absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "conflits",
          personne_id: edit.personne_id,
          date_debut: edit.debut,
          date_fin: edit.fin,
          exclure_absence_id: edit.mode === "existing" ? edit.absence_id : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Vérification impossible.");
      const jours: string[] = json.jours ?? [];
      if (jours.length > 0) {
        setConflit({ jours, poursuivre: () => { setConflit(null); enregistrer(); } });
        return;
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Vérification impossible.");
      return;
    }
    enregistrer();
  }

  async function enregistrer() {
    if (!edit) return;
    setEnCours(true);
    setErreur(null);
    try {
      const body = edit.mode === "existing"
        ? { op: "update", id: edit.absence_id, motif_absence_id: edit.motif_absence_id, date_debut: edit.debut, date_fin: edit.fin, commentaire: edit.commentaire }
        : { op: "save", personne_id: edit.personne_id, motif_absence_id: edit.motif_absence_id, date_debut: edit.debut, date_fin: edit.fin, commentaire: edit.commentaire };
      const res = await fetch("/api/absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Enregistrement refusé.");
      setEdit(null);
      setOuvertPop(null);
      router.refresh();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement refusé.");
    }
    setEnCours(false);
  }

  async function supprimer(p: PeriodeVue) {
    if (!window.confirm(`Supprimer l'absence de ${p.label} (${fmtDate(p.debut)}${p.debut !== p.fin ? ` → ${fmtDate(p.fin)}` : ""}) ?\nLes jours seront libérés dans le planning.`)) return;
    setErreur(null);
    try {
      const body = p.absence_id
        ? { op: "delete", id: p.absence_id }
        : { op: "delete-jours", personne_id: p.personne_id, date_debut: p.debut, date_fin: p.fin, motif_absence_id: p.motif_absence_id };
      const res = await fetch("/api/absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Suppression refusée.");
      router.refresh();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Suppression refusée.");
    }
  }

  // Filtrage — nom (contient), atelier (via personne.atelier_id), période
  // d'intersection (fDu et/ou fAu ; une absence apparaît dès qu'elle recouvre la
  // fenêtre, même partiellement).
  const filtered = useMemo(() => {
    const q = norm(fNom.trim());
    return initial.filter((a) => {
      if (q && !norm(a.label).includes(q)) return false;
      if (fAtelier && a.atelier_id !== fAtelier) return false;
      if (fDu && a.fin < fDu) return false;
      if (fAu && a.debut > fAu) return false;
      return true;
    });
  }, [initial, fNom, fAtelier, fDu, fAu]);

  const cellStyle: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid #f1f5f9" };

  const persOptions = useMemo(() => {
    const q = norm(rechPers.trim());
    const tri = [...personnes].sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`));
    return q ? tri.filter((p) => norm(`${p.nom} ${p.prenom}`).includes(q)) : tri;
  }, [personnes, rechPers]);

  const MotifChip = ({ id }: { id: string }) => {
    const m = motifById.get(id);
    if (!m) return <span className="muted">—</span>;
    return (
      <span className="sexe-pill" style={{ background: m.couleur || "#e5e7eb", color: "#1f2937", fontWeight: 600 }} title={m.libelle}>
        {m.code_court}
      </span>
    );
  };

  // ⚠️ Rendu inline (`{LigneEdition()}`) et non `<LigneEdition />` : un composant
  // défini dans le parent est recréé à chaque render, React démonte/remonte
  // l'input et le focus saute à chaque touche (cf. CLAUDE.md).
  function LigneEdition() {
    if (!edit) return null;
    const pers = edit.personne_id ? persById.get(edit.personne_id) : null;
    const m = edit.motif_absence_id ? motifById.get(edit.motif_absence_id) : null;
    const periodeTxt = edit.debut && edit.fin
      ? libellePeriode({ motif_absence_id: null, debut: edit.debut, fin: edit.fin, jours: 0, declaree: false, absence_id: null })
      : "—";
    // Popovers en `position: fixed` ancrés au bouton (cf. openPop / popStyle).
    const trig: React.CSSProperties = { width: "100%", margin: 0, padding: "4px 8px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 7, textAlign: "left", cursor: "pointer" };
    return (
      <tr style={{ background: "#fefce8" }}>
        <td style={cellStyle}>
          {edit.mode === "existing" ? (
            <span title="Personne non modifiable après création — supprimer et recréer si besoin.">
              <strong>{pers ? `${pers.nom} ${pers.prenom}` : "?"}</strong>
            </span>
          ) : (
            <>
              <button type="button" onClick={(e) => openPop("personne", e)} onMouseDown={(e) => e.stopPropagation()}
                style={{ ...trig, background: "#fff", color: "#1f2937" }} title="Choisir la personne">
                {pers ? `${pers.nom} ${pers.prenom}` : <span style={{ color: "#94a3b8" }}>Choisir une personne…</span>} ▾
              </button>
              {ouvertPop === "personne" && (
                <div ref={popRef} style={popStyle(280)}>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.18)", padding: 6 }}>
                    <input autoFocus value={rechPers} onChange={(e) => setRechPers(e.target.value)}
                      placeholder="🔍 rechercher un nom" style={{ width: "100%", fontSize: 13, padding: "5px 8px", marginBottom: 6 }} />
                    <div className="picklist" style={{ border: "none" }}>
                      {persOptions.map((p) => (
                        <button key={p.id} type="button" className="picklist-item"
                          onClick={() => { setEdit((s) => s ? { ...s, personne_id: p.id } : s); setOuvertPop(null); setRechPers(""); }}>
                          {p.nom} {p.prenom}
                        </button>
                      ))}
                      {persOptions.length === 0 && <p className="muted" style={{ padding: 8, fontSize: 12, margin: 0 }}>Aucun nom.</p>}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </td>
        <td style={cellStyle}>
          <button type="button" onClick={(e) => openPop("motif", e)} onMouseDown={(e) => e.stopPropagation()}
            style={{ ...trig, background: m?.couleur ?? "#f1f5f9", color: "#1f2937", fontWeight: 600 }} title="Choisir le motif">
            {m ? <><strong>{m.code_court}</strong> · {m.libelle}</> : <span style={{ color: "#94a3b8" }}>Motif…</span>} ▾
          </button>
          {ouvertPop === "motif" && (
            <div ref={popRef} style={popStyle(280)}>
              <div className="picklist" style={{ boxShadow: "0 8px 24px rgba(15,23,42,.18)" }}>
                {motifs.map((mo) => (
                  <button key={mo.id} type="button" className="picklist-item"
                    onClick={() => { setEdit((s) => s ? { ...s, motif_absence_id: mo.id } : s); setOuvertPop(null); }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: mo.couleur || "#cbd5e1", border: "1px solid #cbd5e1", flex: "0 0 auto" }} />
                    <strong style={{ minWidth: 44 }}>{mo.code_court}</strong>
                    <span>{mo.libelle}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </td>
        <td style={cellStyle}>
          <button type="button" onClick={(e) => openPop("cal", e)} onMouseDown={(e) => e.stopPropagation()}
            style={{ ...trig, background: "#fff", color: "#1f2937", whiteSpace: "nowrap" }} title="Choisir la période">
            {edit.debut && edit.fin ? periodeTxt : <span style={{ color: "#94a3b8" }}>Dates…</span>} 📅
          </button>
          {ouvertPop === "cal" && (
            <div ref={popRef} style={{ ...popStyle(544), boxShadow: "0 8px 24px rgba(15,23,42,.18)", borderRadius: 10 }}>
              <DateRangePicker
                mois={2}
                value={{ debut: edit.debut || null, fin: edit.fin || null }}
                onChange={(p) => {
                  setEdit((s) => s ? { ...s, debut: p.debut ?? "", fin: p.fin ?? "" } : s);
                  if (p.debut && p.fin) setOuvertPop(null);
                }}
              />
            </div>
          )}
        </td>
        <td style={{ ...cellStyle, textAlign: "right" }}>
          {edit.debut && edit.fin ? nbJours(edit.debut, edit.fin) : "—"}
        </td>
        <td style={cellStyle}>
          <input
            value={edit.commentaire}
            onChange={(e) => setEdit((s) => s ? { ...s, commentaire: e.target.value } : s)}
            placeholder="Commentaire — pas d'info médicale"
            style={{ width: "100%", fontSize: 13, padding: "2px 6px" }}
          />
        </td>
        <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
          <button type="button" className="iconbtn save" disabled={enCours} onClick={verifierEtEnregistrer} title="Enregistrer">
            {enCours ? "…" : <SaveIcon />}
          </button>
          <button type="button" className="iconbtn ghost" onClick={annulerEdition} title="Annuler">✕</button>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* --- Filtres --- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="toolbar" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div className="field" style={{ flex: "1 1 220px" }}>
            <span>Nom</span>
            <input value={fNom} onChange={(e) => setFNom(e.target.value)} placeholder="🔍 rechercher un nom" />
          </div>
          <div className="field" style={{ flex: "0 0 200px" }}>
            <span>Service</span>
            <select value={fAtelier} onChange={(e) => setFAtelier(e.target.value)}>
              <option value="">Tous services</option>
              {ateliers.map((a) => (<option key={a.id} value={a.id}>{a.nom}</option>))}
            </select>
          </div>
          <div className="field" style={{ flex: "0 0 160px" }}>
            <span>Période — du</span>
            <input type="date" value={fDu} onChange={(e) => setFDu(e.target.value)} />
          </div>
          <div className="field" style={{ flex: "0 0 160px" }}>
            <span>… au</span>
            <input type="date" value={fAu} onChange={(e) => setFAu(e.target.value)} />
          </div>
          {(fNom || fAtelier || fDu || fAu) && (
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto", padding: "6px 12px", marginBottom: 2 }} onClick={() => { setFNom(""); setFAtelier(""); setFDu(""); setFAu(""); }}>
              Réinitialiser
            </button>
          )}
          <span className="muted" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600 }}>
            {filtered.length === initial.length ? `${initial.length} absence${initial.length > 1 ? "s" : ""}` : `${filtered.length} / ${initial.length}`}
          </span>
          {/* Retour Planning avec les filtres LIVE (URL-syncés). Reste dans le
              client component : un lien côté serveur serait figé à l'arrivée. */}
          <Link href={retourHref} className="navlink" style={{ marginLeft: 12 }}>
            &larr; Planning
          </Link>
        </div>
      </div>

      {erreur && (
        <div role="alert" style={{ margin: "0 0 10px", padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontSize: 13, fontWeight: 600 }}>
          {erreur}
          <button type="button" onClick={() => setErreur(null)} style={{ float: "right", background: "transparent", border: "none", color: "#991b1b", cursor: "pointer", width: "auto", margin: 0, padding: 0, fontSize: 14 }}>✕</button>
        </div>
      )}

      {!edit && (
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="btn-sm" onClick={commencerNouveau} style={{ width: "auto" }}>
            + Déclarer une absence
          </button>
        </div>
      )}

      {/* --- Table --- */}
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px" }}>Personne</th>
              <th style={{ textAlign: "left", padding: "6px" }}>Motif</th>
              <th style={{ textAlign: "left", padding: "6px" }}>Période</th>
              <th style={{ textAlign: "right", padding: "6px", width: 60 }}>Jours</th>
              <th style={{ textAlign: "left", padding: "6px" }}>Commentaire</th>
              <th style={{ padding: "6px", width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {edit && edit.mode === "new" && LigneEdition()}
            {filtered.map((a) => {
              const enEdition = edit?.mode === "existing" && edit.absence_id === a.absence_id && a.absence_id != null;
              if (enEdition) return <React.Fragment key={`edit-${a.key}`}>{LigneEdition()}</React.Fragment>;
              return (
                <tr key={a.key}>
                  <td style={cellStyle}>{a.label}</td>
                  <td style={cellStyle}><MotifChip id={a.motif_absence_id} /></td>
                  <td style={{ ...cellStyle, whiteSpace: "nowrap" }} title={a.declaree ? "Période déclarée" : "Saisie au planning, jour par jour"}>
                    {a.debut === a.fin ? fmtDate(a.debut) : `${fmtDate(a.debut)} → ${fmtDate(a.fin)}`}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>{a.jours}</td>
                  <td style={cellStyle} className={a.commentaire ? undefined : "muted"} title={a.commentaire || undefined}>
                    {a.commentaire || (a.declaree ? "—" : "")}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="iconbtn edit" onClick={() => commencerEdition(a)} title={a.absence_id ? "Modifier" : "Modifier (re-déclare la période)"}><EditIcon /></button>
                    <button type="button" className="iconbtn del" onClick={() => supprimer(a)} title="Supprimer"><TrashIcon /></button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && !edit && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 10 }}>
                  {initial.length === 0 ? "Aucune absence enregistrée." : "Aucun résultat pour ces filtres."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- Conflit --- */}
      {conflit && (
        <ModaleDeplacable onClose={() => setConflit(null)} largeur={440} zIndex={200}>
            <h3 className="mdd-drag" style={{ margin: "0 0 8px", color: "#b91c1c", cursor: "grab" }}>⚠ Affectations existantes</h3>
            <p style={{ marginTop: 0, fontSize: 13 }}>
              La personne a déjà des affectations sur poste pour{" "}
              <strong>{conflit.jours.length} jour{conflit.jours.length > 1 ? "s" : ""}</strong>{" "}
              de la période :
            </p>
            <div style={{ maxHeight: 140, overflow: "auto", fontSize: 12, padding: 8, background: "#f8fafc", borderRadius: 6, marginBottom: 12 }}>
              {conflit.jours.map((j) => (<div key={j}>{fmtDate(j)}</div>))}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Écraser remplace les affectations par l&apos;absence. Annuler ne change rien.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setConflit(null)} style={{ width: "auto" }}>Annuler</button>
              <button type="button" className="btn-sm" onClick={conflit.poursuivre} style={{ width: "auto", background: "#dc2626", border: "1px solid #dc2626" }}>Écraser</button>
            </div>
        </ModaleDeplacable>
      )}
    </div>
  );
}
