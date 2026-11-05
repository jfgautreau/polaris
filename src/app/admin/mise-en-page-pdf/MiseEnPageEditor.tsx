"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GRILLE,
  PDFS,
  PDF_LIBELLES,
  caseLibre,
  dispositionDepart,
  feuille,
  placerPostes,
  type Bloc,
  type MiseEnPage,
  type PdfPlacement,
  type Place,
} from "@/lib/mise-en-page-pdf";

// Éditeur de la mise en page des PDF du Placement (0094) : on choisit le
// service, le PDF, le format et l'orientation, puis on pose les blocs sur une
// grille de 15 × 15 cases (feuille à la largeur de l'écran). Une ligne est un
// CADRE : ses postes y occupent des cases de la même grille (1 case par défaut,
// agrandissables par leur coin), déplaçables case par case, cases vides
// permises ; un poste ne sort jamais du cadre de sa ligne. Enregistrement explicite.

export type LigneEd = { id: string; nom: string; couleur: string; postes: { id: string; nom: string }[] };
export type ServiceEd = { id: string; nom: string; lignes: LigneEd[] };

const FIXES: { type: "entete" | "legende" | "absents"; nom: string; couleur: string }[] = [
  { type: "entete", nom: "En-tête (service · quart · date)", couleur: "#111827" },
  { type: "legende", nom: "Légende", couleur: "#64748b" },
  { type: "absents", nom: "Absents du jour / TP", couleur: "#b91c1c" },
];
const cleBloc = (b: { type: string; ligne_id?: string }) => (b.type === "ligne" ? `ligne:${b.ligne_id}` : b.type);

type Rect = { x: number; y: number; w: number; h: number };
type Glisse =
  | { mode: "deplacer" | "redim"; cle: string; x0: number; y0: number; orig: Bloc }
  | { mode: "posteDeplacer" | "posteRedim"; cle: string; posteId: string; x0: number; y0: number; orig: Place }
  | { mode: "palette"; bloc: Omit<Bloc, "x" | "y">; nom: string }
  | { mode: "palettePoste"; cle: string; posteId: string; nom: string };

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

const depart = (s: ServiceEd | undefined, p: PdfPlacement): MiseEnPage => ({
  format: p === "manager" ? "A4" : "A3",
  orientation: "paysage",
  blocs: dispositionDepart((s?.lignes ?? []).map((l) => ({ id: l.id, postes: l.postes.map((x) => x.id) }))),
});

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
  const [brouillon, setBrouillon] = useState<MiseEnPage>(() => initial[cle] ?? depart(service, pdf));
  const [modifie, setModifie] = useState(false);
  const [etat, setEtat] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [glisse, setGlisse] = useState<Glisse | null>(null);
  const [fantome, setFantome] = useState<{ x: number; y: number } | null>(null);
  const feuilleRef = useRef<HTMLDivElement>(null);
  // Feuille aussi grande que la place disponible : largeur de sa colonne, et
  // hauteur bornée à la fenêtre (un portrait reste visible en entier).
  const zoneRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ l: 1100, h: 800 });
  useEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    const mesurer = () => setPlace({ l: Math.max(600, el.clientWidth - 4), h: Math.max(480, window.innerHeight - 190) });
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    window.addEventListener("resize", mesurer);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", mesurer);
    };
  }, []);

  const f = feuille(brouillon.format, brouillon.orientation);
  const largeurEcran = Math.round(Math.min(place.l, (place.h * f.l) / f.utileH));
  const hauteurEcran = Math.round((largeurEcran * f.utileH) / f.l);
  const cw = largeurEcran / GRILLE;
  const ch = hauteurEcran / GRILLE;

  const lignesParId = useMemo(() => new Map((service?.lignes ?? []).map((l) => [l.id, l])), [service]);
  const places = new Set(brouillon.blocs.map(cleBloc));
  const aPlacer = [
    ...FIXES.filter((x) => !places.has(x.type)).map((x) => ({ bloc: { type: x.type, w: x.type === "absents" ? 4 : 5, h: x.type === "absents" ? 5 : 1 } as Omit<Bloc, "x" | "y">, nom: x.nom, couleur: x.couleur })),
    ...(service?.lignes ?? [])
      .filter((l) => !places.has(`ligne:${l.id}`))
      .map((l) => ({ bloc: { type: "ligne", ligne_id: l.id, w: 5, h: 2 } as Omit<Bloc, "x" | "y">, nom: l.nom, couleur: l.couleur })),
  ];
  // Postes d'une ligne posée qui n'ont pas de case (créés depuis, ou retirés).
  const postesAPlacer = brouillon.blocs
    .filter((b) => b.type === "ligne")
    .flatMap((b) => {
      const l = lignesParId.get(b.ligne_id ?? "");
      if (!l) return [];
      const pris = new Set((b.places ?? []).map((p) => p.poste_id));
      return l.postes.filter((p) => !pris.has(p.id)).map((p) => ({ cle: cleBloc(b), posteId: p.id, nom: p.nom, ligne: l.nom, couleur: l.couleur }));
    });

  function changerBlocs(fn: (b: Bloc[]) => Bloc[]) {
    setBrouillon((m) => ({ ...m, blocs: fn(m.blocs) }));
    setModifie(true);
    setEtat(null);
  }
  const changerPlaces = (cleCadre: string, fn: (p: Place[], b: Bloc) => Place[]) =>
    changerBlocs((bs) => bs.map((b) => (cleBloc(b) === cleCadre ? { ...b, places: fn(b.places ?? [], b) } : b)));

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
    const celluleFeuille = (e: PointerEvent) => {
      const r = feuilleRef.current?.getBoundingClientRect();
      if (!r) return null;
      return { cx: Math.floor((e.clientX - r.left) / cw), cy: Math.floor((e.clientY - r.top) / ch), dedans: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
    };
    const bouge = (e: PointerEvent) => {
      if (glisse.mode === "palette" || glisse.mode === "palettePoste") {
        setFantome({ x: e.clientX, y: e.clientY });
        return;
      }
      const dx = Math.round((e.clientX - glisse.x0) / cw);
      const dy = Math.round((e.clientY - glisse.y0) / ch);
      if (glisse.mode === "posteDeplacer" || glisse.mode === "posteRedim") {
        const g = glisse;
        changerPlaces(g.cle, (ps, b) =>
          ps.map((p) => {
            if (p.poste_id !== g.posteId) return p;
            const o = g.orig;
            const c: Rect = g.mode === "posteDeplacer" ? { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h } : { x: o.x, y: o.y, w: Math.max(1, o.w + dx), h: Math.max(1, o.h + dy) };
            // Case occupée ou hors du cadre : le poste reste où il était.
            return caseLibre(ps, b, c, g.posteId) ? { ...p, ...c } : p;
          }),
        );
        return;
      }
      const o = glisse.orig;
      const g = glisse;
      changerBlocs((bs) =>
        bs.map((b) => {
          if (cleBloc(b) !== g.cle) return b;
          if (g.mode === "deplacer") {
            return { ...b, x: Math.max(0, Math.min(GRILLE - o.w, o.x + dx)), y: Math.max(0, Math.min(GRILLE - o.h, o.y + dy)) };
          }
          // Un cadre ne se réduit pas sous les postes qu'il contient.
          const minW = Math.max(1, ...(b.places ?? []).map((p) => p.x + p.w));
          const minH = Math.max(1, ...(b.places ?? []).map((p) => p.y + p.h));
          return { ...b, w: Math.max(minW, Math.min(GRILLE - o.x, o.w + dx)), h: Math.max(minH, Math.min(GRILLE - o.y, o.h + dy)) };
        }),
      );
    };
    const fin = (e: PointerEvent) => {
      if (glisse.mode === "palette") {
        const c = celluleFeuille(e);
        if (c?.dedans) {
          const b = glisse.bloc;
          const x = Math.max(0, Math.min(GRILLE - b.w, c.cx));
          const y = Math.max(0, Math.min(GRILLE - b.h, c.cy));
          const ligne = b.type === "ligne" ? lignesParId.get(b.ligne_id ?? "") : undefined;
          const nouveau: Bloc = { ...b, x, y };
          if (ligne) nouveau.places = placerPostes(nouveau, ligne.postes.map((p) => p.id)).places;
          changerBlocs((bs) => [...bs, nouveau]);
        }
      } else if (glisse.mode === "palettePoste") {
        const g = glisse;
        const c = celluleFeuille(e);
        if (c?.dedans) {
          changerPlaces(g.cle, (ps, b) => {
            const lx = c.cx - b.x;
            const ly = c.cy - b.y;
            // Lâché sur une case libre de son cadre : il s'y pose ; sinon 1re case libre.
            if (caseLibre(ps, b, { x: lx, y: ly, w: 1, h: 1 })) return [...ps, { poste_id: g.posteId, x: lx, y: ly, w: 1, h: 1 }];
            return placerPostes({ ...b, places: ps }, [...ps.map((p) => p.poste_id), g.posteId]).places;
          });
        }
      }
      setFantome(null);
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
  const itemPalette: React.CSSProperties = { border: "1px dashed #94a3b8", borderRadius: 8, padding: "5px 8px", background: "#f8fafc", cursor: canEdit ? "grab" : "default", fontSize: 12, display: "flex", gap: 6, alignItems: "center", userSelect: "none", touchAction: "none" };

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
        <button type="button" style={btn} disabled={!canEdit} onClick={() => changerBlocs(() => depart(service, pdf).blocs)} title="Reposer tous les blocs automatiquement">Disposition de départ</button>
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

      <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
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
              style={itemPalette}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: it.couleur, flex: "0 0 auto" }} />
              {it.nom}
            </div>
          ))}
          {postesAPlacer.length > 0 && (
            <>
              <strong style={{ fontSize: 13, marginTop: 6 }}>Postes à placer</strong>
              {postesAPlacer.map((p) => (
                <div
                  key={`${p.cle}:${p.posteId}`}
                  onPointerDown={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    setGlisse({ mode: "palettePoste", cle: p.cle, posteId: p.posteId, nom: p.nom });
                    setFantome({ x: e.clientX, y: e.clientY });
                  }}
                  title={`Glisser dans le cadre de la ligne ${p.ligne}`}
                  style={itemPalette}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: p.couleur, flex: "0 0 auto" }} />
                  <span>
                    {p.nom} <span className="muted">· {p.ligne}</span>
                  </span>
                </div>
              ))}
            </>
          )}
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
            Un poste sans case prend, à l&apos;impression, la première case libre de sa ligne. Une ligne laissée ici s&apos;imprime sous
            la grille si elle tourne. Le jour J, un poste chargé s&apos;étire sur les cases vides sous lui ; s&apos;il ne tient pas, toute
            la page rétrécit.
          </p>
        </div>

        <div ref={zoneRef} style={{ overflowX: "auto", minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
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
                onGeste={(mode, e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGlisse({ mode, cle: cleBloc(b), x0: e.clientX, y0: e.clientY, orig: b });
                }}
                onPoste={(mode, p, e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGlisse({ mode, cle: cleBloc(b), posteId: p.poste_id, x0: e.clientX, y0: e.clientY, orig: p });
                }}
                onRetirerPoste={(posteId) => changerPlaces(cleBloc(b), (ps) => ps.filter((p) => p.poste_id !== posteId))}
                onRetirer={() => changerBlocs((bs) => bs.filter((x) => cleBloc(x) !== cleBloc(b)))}
              />
            ))}
          </div>
        </div>
      </div>

      {(glisse?.mode === "palette" || glisse?.mode === "palettePoste") && fantome && (
        <div style={{ position: "fixed", left: fantome.x + 8, top: fantome.y + 8, zIndex: 300, pointerEvents: "none", background: "#fff", border: "1px solid #94a3b8", borderRadius: 8, padding: "4px 8px", fontSize: 12, boxShadow: "0 6px 18px rgba(0,0,0,.15)" }}>
          {glisse.nom}
        </div>
      )}
    </div>
  );
}

// Un bloc posé sur la feuille (composant de premier niveau : cf. pièges React).
// Bloc fixe : bandeau de déplacement en tête. Ligne : cadre à sa couleur,
// étiquette du nom sur le bord haut (poignée de déplacement), postes en cases.
function BlocEd({
  bloc,
  ligne,
  cw,
  ch,
  canEdit,
  onGeste,
  onPoste,
  onRetirerPoste,
  onRetirer,
}: {
  bloc: Bloc;
  ligne: LigneEd | undefined;
  cw: number;
  ch: number;
  canEdit: boolean;
  onGeste: (mode: "deplacer" | "redim", e: React.PointerEvent) => void;
  onPoste: (mode: "posteDeplacer" | "posteRedim", p: Place, e: React.PointerEvent) => void;
  onRetirerPoste: (posteId: string) => void;
  onRetirer: () => void;
}) {
  const fixe = FIXES.find((x) => x.type === bloc.type);
  const couleur = ligne?.couleur ?? fixe?.couleur ?? "#334155";
  const titre = ligne?.nom ?? fixe?.nom ?? "Ligne supprimée";
  const nomPoste = new Map((ligne?.postes ?? []).map((p) => [p.id, p.nom]));
  const croix = (onClick: () => void, libelle: string, taille: number) => (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      title={libelle}
      aria-label={libelle}
      style={{ boxSizing: "border-box", margin: 0, padding: 0, width: taille, height: taille, lineHeight: 1, border: "none", borderRadius: 3, background: "rgba(255,255,255,.3)", color: "inherit", fontSize: taille - 4, cursor: "pointer", flex: "0 0 auto" }}
    >
      ×
    </button>
  );
  const poignee = (onDown: (e: React.PointerEvent) => void, c: string, taille = 12) => (
    <div
      onPointerDown={onDown}
      title="Agrandir / réduire"
      style={{ position: "absolute", right: 0, bottom: 0, width: taille, height: taille, cursor: "nwse-resize", background: `linear-gradient(135deg, transparent 50%, ${c} 50%)` }}
    />
  );

  if (bloc.type === "ligne") {
    return (
      <div
        style={{
          position: "absolute",
          left: bloc.x * cw,
          top: bloc.y * ch,
          width: bloc.w * cw,
          height: bloc.h * ch,
          boxSizing: "border-box",
          border: `2px solid ${couleur}`,
          borderRadius: 6,
          background: `${couleur}0d`,
          touchAction: "none",
        }}
      >
        {/* Étiquette du nom, à cheval sur le bord haut : poignée de déplacement du cadre. */}
        <div
          onPointerDown={(e) => canEdit && onGeste("deplacer", e)}
          title={canEdit ? "Glisser pour déplacer la ligne" : undefined}
          style={{ position: "absolute", left: 6, top: -9, zIndex: 3, display: "flex", alignItems: "center", gap: 3, maxWidth: "calc(100% - 12px)", padding: "0 4px", height: 16, background: couleur, color: "#fff", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: canEdit ? "move" : "default", userSelect: "none" }}
        >
          <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{titre}</span>
          {canEdit && croix(onRetirer, `Retirer la ligne ${titre} de la feuille`, 13)}
        </div>
        {(bloc.places ?? []).map((p) => (
          <div
            key={p.poste_id}
            onPointerDown={(e) => canEdit && onPoste("posteDeplacer", p, e)}
            title={canEdit ? "Glisser pour déplacer le poste (case par case, dans sa ligne)" : undefined}
            style={{
              position: "absolute",
              left: p.x * cw + 2,
              top: p.y * ch + 2,
              width: p.w * cw - 4,
              height: p.h * ch - 4,
              boxSizing: "border-box",
              border: `1px solid ${couleur}`,
              borderRadius: 4,
              background: "#fff",
              padding: "8px 3px 2px",
              fontSize: 9,
              lineHeight: 1.15,
              fontWeight: 600,
              overflow: "hidden",
              overflowWrap: "anywhere",
              cursor: canEdit ? "grab" : "default",
              userSelect: "none",
            }}
          >
            {canEdit && <span style={{ position: "absolute", right: 1, top: 1, color: couleur }}>{croix(() => onRetirerPoste(p.poste_id), "Retirer ce poste de sa case", 11)}</span>}
            {nomPoste.get(p.poste_id) ?? "Poste retiré"}
            {canEdit && poignee((e) => onPoste("posteRedim", p, e), couleur, 9)}
          </div>
        ))}
        {canEdit && poignee((e) => onGeste("redim", e), couleur, 12)}
      </div>
    );
  }

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
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 4px", background: couleur, color: "#fff", fontSize: 10, fontWeight: 700, cursor: canEdit ? "move" : "default", userSelect: "none" }}
        title={canEdit ? "Glisser pour déplacer" : undefined}
      >
        <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{titre}</span>
        {canEdit && croix(onRetirer, `Retirer ${titre} de la feuille`, 14)}
      </div>
      <div style={{ flex: 1, padding: 3, overflow: "hidden", fontSize: 9, lineHeight: 1.2 }} className="muted">
        {bloc.type === "legende"
          ? "Compteurs placés / requis, surnombre, hors compétence, places libres."
          : bloc.type === "absents"
            ? "Absents du jour par motif (et temps partiel sur le PDF Manager)."
            : "Service · quart · date"}
      </div>
      {canEdit && poignee((e) => onGeste("redim", e), couleur, 12)}
    </div>
  );
}
