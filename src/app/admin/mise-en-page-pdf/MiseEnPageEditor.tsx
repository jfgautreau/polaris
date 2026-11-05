"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GRILLE,
  PDFS,
  PDF_LIBELLES,
  dispositionDepart,
  feuille,
  ordonnerPostes,
  type Bloc,
  type MiseEnPage,
  type PdfPlacement,
} from "@/lib/mise-en-page-pdf";

// Éditeur de la mise en page des PDF du Placement (0094) : on choisit le
// service, le PDF, le format et l'orientation, puis on pose les blocs sur une
// grille de 12 × 12 cases. Un bloc se déplace par son bandeau et s'agrandit par
// son coin bas-droit ; dans une ligne, les postes se réordonnent au
// glisser-déposer (ils ne quittent jamais leur ligne). Enregistrement explicite.

export type LigneEd = { id: string; nom: string; couleur: string; postes: { id: string; nom: string }[] };
export type ServiceEd = { id: string; nom: string; lignes: LigneEd[] };

const FIXES: { type: "entete" | "legende" | "absents"; nom: string; couleur: string }[] = [
  { type: "entete", nom: "En-tête (service · quart · date)", couleur: "#111827" },
  { type: "legende", nom: "Légende", couleur: "#64748b" },
  { type: "absents", nom: "Absents du jour / TP", couleur: "#b91c1c" },
];
const cleBloc = (b: { type: string; ligne_id?: string }) => (b.type === "ligne" ? `ligne:${b.ligne_id}` : b.type);

type Glisse =
  | { mode: "deplacer" | "redim"; cle: string; x0: number; y0: number; orig: Bloc }
  | { mode: "palette"; bloc: Omit<Bloc, "x" | "y">; nom: string }
  | { mode: "poste"; cle: string; de: number; vers: number };

// Appels réseau hors du composant : ne lèvent jamais.
async function envoyer(methode: "POST" | "DELETE", corps: unknown): Promise<string | null> {
  const res = await fetch("/api/placement-mise-en-page", {
    method: methode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  }).catch(() => null);
  if (!res) return "Serveur injoignable.";
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? "Enregistrement refusé.";
}

export default function MiseEnPageEditor({
  services,
  initial,
  canEdit,
}: {
  services: ServiceEd[];
  initial: Record<string, MiseEnPage>; // clé `${atelier}:${pdf}`
  canEdit: boolean;
}) {
  const [enregistrees, setEnregistrees] = useState<Record<string, MiseEnPage>>(initial);
  const [atelierId, setAtelierId] = useState(services[0]?.id ?? "");
  const [pdf, setPdf] = useState<PdfPlacement>("affich");
  const service = services.find((s) => s.id === atelierId) ?? services[0];
  const cle = `${atelierId}:${pdf}`;
  const depart = (s: ServiceEd | undefined, p: PdfPlacement): MiseEnPage => ({
    format: p === "manager" ? "A4" : "A3",
    orientation: "paysage",
    blocs: dispositionDepart((s?.lignes ?? []).map((l) => l.id)),
  });
  const [brouillon, setBrouillon] = useState<MiseEnPage>(() => initial[cle] ?? depart(service, pdf));
  const [modifie, setModifie] = useState(false);
  const [etat, setEtat] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [glisse, setGlisse] = useState<Glisse | null>(null);
  const [fantome, setFantome] = useState<{ x: number; y: number } | null>(null);
  const feuilleRef = useRef<HTMLDivElement>(null);

  const f = feuille(brouillon.format, brouillon.orientation);
  const largeurEcran = 880;
  const hauteurEcran = Math.round((largeurEcran * f.utileH) / f.l);
  const cw = largeurEcran / GRILLE;
  const ch = hauteurEcran / GRILLE;

  const lignesParId = useMemo(() => new Map((service?.lignes ?? []).map((l) => [l.id, l])), [service]);
  const places = new Set(brouillon.blocs.map(cleBloc));
  const aPlacer = [
    ...FIXES.filter((x) => !places.has(x.type)).map((x) => ({ bloc: { type: x.type, w: x.type === "absents" ? 3 : 4, h: x.type === "absents" ? 4 : 1 } as Omit<Bloc, "x" | "y">, nom: x.nom, couleur: x.couleur })),
    ...(service?.lignes ?? [])
      .filter((l) => !places.has(`ligne:${l.id}`))
      .map((l) => ({ bloc: { type: "ligne", ligne_id: l.id, w: 4, h: 3 } as Omit<Bloc, "x" | "y">, nom: l.nom, couleur: l.couleur })),
  ];

  function changerBlocs(fn: (b: Bloc[]) => Bloc[]) {
    setBrouillon((m) => ({ ...m, blocs: fn(m.blocs) }));
    setModifie(true);
    setEtat(null);
  }

  function choisir(a: string, p: PdfPlacement) {
    if (modifie && !window.confirm("Les modifications de cette mise en page ne sont pas enregistrées. Les abandonner ?")) return;
    const s = services.find((x) => x.id === a);
    setAtelierId(a);
    setPdf(p);
    setBrouillon(enregistrees[`${a}:${p}`] ?? depart(s, p));
    setModifie(false);
    setEtat(null);
  }

  // Glisser-déposer : écoute globale le temps du geste.
  useEffect(() => {
    if (!glisse) return;
    const cellule = (e: PointerEvent) => {
      const r = feuilleRef.current?.getBoundingClientRect();
      if (!r) return null;
      return { cx: Math.floor((e.clientX - r.left) / cw), cy: Math.floor((e.clientY - r.top) / ch), dedans: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
    };
    const bouge = (e: PointerEvent) => {
      if (glisse.mode === "palette") {
        setFantome({ x: e.clientX, y: e.clientY });
      } else if (glisse.mode === "poste") {
        const sous = document.elementFromPoint(e.clientX, e.clientY);
        const t = sous instanceof Element ? sous.closest<HTMLElement>("[data-poste-pos]") : null;
        if (t && t.dataset.bloc === glisse.cle) {
          const vers = Number(t.dataset.postePos);
          if (vers !== glisse.vers) setGlisse({ ...glisse, vers });
        }
      } else {
        const dx = Math.round((e.clientX - glisse.x0) / cw);
        const dy = Math.round((e.clientY - glisse.y0) / ch);
        const o = glisse.orig;
        changerBlocs((bs) =>
          bs.map((b) => {
            if (cleBloc(b) !== glisse.cle) return b;
            if (glisse.mode === "deplacer") {
              return { ...b, x: Math.max(0, Math.min(GRILLE - o.w, o.x + dx)), y: Math.max(0, Math.min(GRILLE - o.h, o.y + dy)) };
            }
            return { ...b, w: Math.max(1, Math.min(GRILLE - o.x, o.w + dx)), h: Math.max(1, Math.min(GRILLE - o.y, o.h + dy)) };
          }),
        );
      }
    };
    const fin = (e: PointerEvent) => {
      if (glisse.mode === "palette") {
        const c = cellule(e);
        if (c?.dedans) {
          const b = glisse.bloc;
          const x = Math.max(0, Math.min(GRILLE - b.w, c.cx));
          const y = Math.max(0, Math.min(GRILLE - b.h, c.cy));
          changerBlocs((bs) => [...bs, { ...b, x, y }]);
        }
        setFantome(null);
      } else if (glisse.mode === "poste" && glisse.vers !== glisse.de) {
        const g = glisse;
        changerBlocs((bs) =>
          bs.map((b) => {
            if (cleBloc(b) !== g.cle) return b;
            const ids = ordonnerPostes(lignesParId.get(b.ligne_id ?? "")?.postes ?? [], b.postes).map((p) => p.id);
            const [id] = ids.splice(g.de, 1);
            ids.splice(g.vers, 0, id);
            return { ...b, postes: ids };
          }),
        );
      }
      setGlisse(null);
    };
    window.addEventListener("pointermove", bouge);
    window.addEventListener("pointerup", fin);
    return () => {
      window.removeEventListener("pointermove", bouge);
      window.removeEventListener("pointerup", fin);
    };
  });

  async function enregistrer() {
    setEtat(null);
    const err = await envoyer("POST", { atelier_id: atelierId, pdf, ...brouillon });
    if (err) {
      setEtat({ type: "err", msg: err });
      return;
    }
    setEnregistrees((m) => ({ ...m, [cle]: brouillon }));
    setModifie(false);
    setEtat({ type: "ok", msg: "Mise en page enregistrée : elle sert dès la prochaine impression." });
  }

  async function revenirAuto() {
    if (!window.confirm(`Supprimer la mise en page « ${PDF_LIBELLES[pdf]} » de ${service?.nom ?? "ce service"} ? Le PDF reprendra sa disposition automatique.`)) return;
    const err = await envoyer("DELETE", { atelier_id: atelierId, pdf });
    if (err) {
      setEtat({ type: "err", msg: err });
      return;
    }
    setEnregistrees((m) => {
      const n = { ...m };
      delete n[cle];
      return n;
    });
    setBrouillon(depart(service, pdf));
    setModifie(false);
    setEtat({ type: "ok", msg: "Mise en page supprimée : le PDF reprend sa disposition automatique." });
  }

  const autresPdf = PDFS.filter((p) => p !== pdf && enregistrees[`${atelierId}:${p}`]);
  const seg = (actif: boolean): React.CSSProperties => ({
    margin: 0,
    border: "none",
    padding: "5px 12px",
    cursor: "pointer",
    background: actif ? "#1d4ed8" : "#fff",
    color: actif ? "#fff" : "#1f2937",
    fontWeight: actif ? 700 : 500,
    fontSize: 13,
  });
  const btn: React.CSSProperties = { margin: 0, width: "auto", padding: "5px 12px", fontSize: 13, background: "#fff", color: "#1f2937", border: "1px solid var(--border)", borderRadius: 8 };

  if (!service) return <p className="muted">Aucun service actif.</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", margin: 0, padding: "10px 14px" }}>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          Service
          <select id="mep-service" value={atelierId} onChange={(e) => choisir(e.target.value, pdf)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.nom}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          PDF
          <select id="mep-pdf" value={pdf} onChange={(e) => choisir(atelierId, e.target.value as PdfPlacement)}>
            {PDFS.map((p) => (
              <option key={p} value={p}>
                {PDF_LIBELLES[p]}
                {enregistrees[`${atelierId}:${p}`] ? " ✓" : ""}
              </option>
            ))}
          </select>
        </label>
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }} role="group" aria-label="Format">
          {(["A4", "A3"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={brouillon.format === x} disabled={!canEdit} style={seg(brouillon.format === x)} onClick={() => { setBrouillon((m) => ({ ...m, format: x })); setModifie(true); }}>{x}</button>
          ))}
        </span>
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }} role="group" aria-label="Orientation">
          {(["paysage", "portrait"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={brouillon.orientation === x} disabled={!canEdit} style={seg(brouillon.orientation === x)} onClick={() => { setBrouillon((m) => ({ ...m, orientation: x })); setModifie(true); }}>{x === "paysage" ? "Paysage" : "Portrait"}</button>
          ))}
        </span>
        <button type="button" style={btn} disabled={!canEdit} onClick={() => changerBlocs(() => [])} title="Retirer tous les blocs de la feuille">Grille vierge</button>
        <button type="button" style={btn} disabled={!canEdit} onClick={() => changerBlocs(() => dispositionDepart(service.lignes.map((l) => l.id)))} title="Reposer tous les blocs automatiquement">Disposition de départ</button>
        {autresPdf.length > 0 && (
          <select
            id="mep-copier"
            value=""
            disabled={!canEdit}
            onChange={(e) => {
              const src = enregistrees[`${atelierId}:${e.target.value}`];
              if (src) { setBrouillon(src); setModifie(true); }
            }}
            title="Reprendre la mise en page d'un autre PDF de ce service"
          >
            <option value="">Copier depuis…</option>
            {autresPdf.map((p) => (
              <option key={p} value={p}>{PDF_LIBELLES[p]}</option>
            ))}
          </select>
        )}
        <span style={{ flex: 1 }} />
        {enregistrees[cle] && (
          <button type="button" style={{ ...btn, color: "#b91c1c" }} onClick={() => void revenirAuto()} disabled={!canEdit}>Revenir à l&apos;automatique</button>
        )}
        <button type="button" onClick={() => void enregistrer()} disabled={!canEdit || !modifie} style={{ ...btn, background: "#1d4ed8", color: "#fff", border: "1px solid #1d4ed8", fontWeight: 700, opacity: !canEdit || !modifie ? 0.5 : 1 }}>
          Enregistrer
        </button>
      </div>

      <div style={{ fontSize: 13, color: etat?.type === "err" ? "#991b1b" : etat ? "#166534" : "var(--muted)", fontWeight: etat ? 600 : 400, minHeight: 18 }} role="status">
        {etat?.msg ?? (enregistrees[cle] ? (modifie ? "Modifications non enregistrées." : "Mise en page enregistrée.") : "Pas encore de mise en page : le PDF utilise sa disposition automatique.")}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px auto", gap: 14, alignItems: "start" }}>
        <div className="card" style={{ margin: 0, padding: 10, display: "grid", gap: 6 }}>
          <strong style={{ fontSize: 13 }}>Blocs à placer</strong>
          {aPlacer.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Tous les blocs sont sur la feuille.</span>}
          {aPlacer.map((it) => (
            <div
              key={cleBloc(it.bloc)}
              onPointerDown={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setGlisse({ mode: "palette", bloc: it.bloc, nom: it.nom });
                setFantome({ x: e.clientX, y: e.clientY });
              }}
              title="Glisser sur la feuille"
              style={{ border: "1px dashed #94a3b8", borderRadius: 8, padding: "6px 8px", background: "#f8fafc", cursor: canEdit ? "grab" : "default", fontSize: 13, display: "flex", gap: 6, alignItems: "center", userSelect: "none", touchAction: "none" }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: it.couleur, flex: "0 0 auto" }} />
              {it.nom}
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
            Une ligne laissée ici n&apos;est pas placée : si elle tourne ce jour-là, elle s&apos;imprime sous la grille. Le jour J, si un bloc
            reçoit plus de noms que sa place, toute la page rétrécit.
          </p>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            {PDF_LIBELLES[pdf]} · {service.nom} · {brouillon.format} {brouillon.orientation} · grille {GRILLE} × {GRILLE}
          </div>
          <div
            ref={feuilleRef}
            style={{
              position: "relative",
              width: largeurEcran,
              height: hauteurEcran,
              background: "#fff",
              boxShadow: "0 8px 28px rgba(15,23,42,.16)",
              backgroundImage: "linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
              backgroundSize: `${cw}px ${ch}px`,
            }}
          >
            {brouillon.blocs.map((b) => (
              <BlocEd
                key={cleBloc(b)}
                bloc={b}
                ligne={b.type === "ligne" ? lignesParId.get(b.ligne_id ?? "") : undefined}
                cw={cw}
                ch={ch}
                canEdit={canEdit}
                glissePoste={glisse?.mode === "poste" && glisse.cle === cleBloc(b) ? glisse : null}
                onGeste={(mode, e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGlisse({ mode, cle: cleBloc(b), x0: e.clientX, y0: e.clientY, orig: b });
                }}
                onPoste={(pos) => setGlisse({ mode: "poste", cle: cleBloc(b), de: pos, vers: pos })}
                onRetirer={() => changerBlocs((bs) => bs.filter((x) => cleBloc(x) !== cleBloc(b)))}
              />
            ))}
          </div>
        </div>
      </div>

      {glisse?.mode === "palette" && fantome && (
        <div style={{ position: "fixed", left: fantome.x + 8, top: fantome.y + 8, zIndex: 300, pointerEvents: "none", background: "#fff", border: "1px solid #94a3b8", borderRadius: 8, padding: "4px 8px", fontSize: 13, boxShadow: "0 6px 18px rgba(0,0,0,.15)" }}>
          {glisse.nom}
        </div>
      )}
    </div>
  );
}

// Un bloc posé sur la feuille (composant de premier niveau : cf. pièges React).
function BlocEd({
  bloc,
  ligne,
  cw,
  ch,
  canEdit,
  glissePoste,
  onGeste,
  onPoste,
  onRetirer,
}: {
  bloc: Bloc;
  ligne: LigneEd | undefined;
  cw: number;
  ch: number;
  canEdit: boolean;
  glissePoste: { de: number; vers: number } | null;
  onGeste: (mode: "deplacer" | "redim", e: React.PointerEvent) => void;
  onPoste: (pos: number) => void;
  onRetirer: () => void;
}) {
  const fixe = FIXES.find((x) => x.type === bloc.type);
  const couleur = ligne?.couleur ?? fixe?.couleur ?? "#334155";
  const titre = ligne?.nom ?? fixe?.nom ?? "Ligne supprimée";
  const postes = ligne ? ordonnerPostes(ligne.postes, bloc.postes) : [];
  const cle = bloc.type === "ligne" ? `ligne:${bloc.ligne_id}` : bloc.type;
  const colonnes = Math.max(1, Math.min(postes.length || 1, Math.floor((bloc.w * cw) / 110)));
  return (
    <div
      style={{
        position: "absolute",
        left: bloc.x * cw + 2,
        top: bloc.y * ch + 2,
        width: bloc.w * cw - 4,
        height: bloc.h * ch - 4,
        border: `1.5px solid ${couleur}`,
        borderRadius: 6,
        background: "#fff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        touchAction: "none",
      }}
    >
      <div
        onPointerDown={(e) => canEdit && onGeste("deplacer", e)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", background: couleur, color: "#fff", fontSize: 12, fontWeight: 700, cursor: canEdit ? "move" : "default", userSelect: "none" }}
        title={canEdit ? "Glisser pour déplacer" : undefined}
      >
        <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{titre}</span>
        {canEdit && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRetirer}
            title="Retirer de la feuille"
            aria-label={`Retirer ${titre} de la feuille`}
            style={{ boxSizing: "border-box", margin: 0, padding: 0, width: 18, height: 18, lineHeight: 1, border: "none", borderRadius: 4, background: "rgba(255,255,255,.25)", color: "#fff", fontSize: 12, cursor: "pointer" }}
          >
            ×
          </button>
        )}
      </div>
      <div style={{ flex: 1, padding: 4, overflow: "hidden", fontSize: 11 }}>
        {bloc.type === "ligne" ? (
          <div style={{ display: "grid", gap: 4, gridTemplateColumns: `repeat(${colonnes}, 1fr)` }}>
            {postes.map((p, pos) => (
              <div
                key={p.id}
                data-poste-pos={pos}
                data-bloc={cle}
                onPointerDown={(e) => {
                  if (!canEdit) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onPoste(pos);
                }}
                title={canEdit ? "Glisser pour changer l'ordre des postes" : undefined}
                style={{
                  border: `1px solid ${glissePoste && glissePoste.vers === pos && glissePoste.de !== pos ? "#1d4ed8" : "#cbd5e1"}`,
                  outline: glissePoste && glissePoste.vers === pos && glissePoste.de !== pos ? "2px dashed #1d4ed8" : "none",
                  borderRadius: 5,
                  padding: "2px 4px",
                  background: glissePoste?.de === pos ? "#e0e7ff" : "#f8fafc",
                  cursor: canEdit ? "grab" : "default",
                  userSelect: "none",
                  fontWeight: 600,
                  overflowWrap: "anywhere",
                }}
              >
                {p.nom}
              </div>
            ))}
          </div>
        ) : bloc.type === "legende" ? (
          <span className="muted">Compteurs placés / requis, surnombre, hors compétence, places libres.</span>
        ) : bloc.type === "absents" ? (
          <span className="muted">Absents du jour par motif (et temps partiel sur le PDF Manager).</span>
        ) : (
          <span className="muted">Service · quart · date</span>
        )}
      </div>
      {canEdit && (
        <div
          onPointerDown={(e) => onGeste("redim", e)}
          title="Agrandir / réduire"
          style={{ position: "absolute", right: 0, bottom: 0, width: 14, height: 14, cursor: "nwse-resize", background: `linear-gradient(135deg, transparent 50%, ${couleur} 50%)` }}
        />
      )}
    </div>
  );
}
