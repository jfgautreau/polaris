"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { dowMon } from "@/lib/week";
import { habValable } from "@/lib/habilitations";
import { INTERIM_BG } from "@/lib/interim";
import ModaleDeplacable from "@/components/ModaleDeplacable";

type Jour = { iso: string; nom: string; num: string; firstOfWeek: boolean };
type WeekBlock = { num: number; span: number; year: number; isCurrent: boolean };
type Poste = { id: string; nom: string; niveauMin: number; effectif: number; categorie?: string };

const CAT_BILANS: { key: string; label: string }[] = [
  { key: "manager", label: "Managers" },
  { key: "conducteur", label: "Conducteurs" },
  { key: "operateur", label: "Opérateurs" },
];
type Group = { ligneNom: string; ligneId: string; atelierNom?: string; postes: Poste[] };

// Le poste exige des habilitations que la personne n'a pas (ou plus). L'API repond
// 428 en les nommant : on remonte la liste pour demander confirmation, au lieu de
// faire revenir la case en silence. Definie au niveau du module — dans le corps du
// composant, la classe serait recreee a chaque rendu et `instanceof` deviendrait
// dependant du moment ou l'erreur a ete levee.
class HabManquanteError extends Error {
  manquantes: string[];
  constructor(manquantes: string[]) {
    super("Habilitation manquante");
    this.manquantes = manquantes;
  }
}
type Motif = { id: string; code: string; couleur: string };
type Personne = { id: string; label: string; equipe_id: string | null; editable: boolean; color?: string; interim?: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function PlanningGrid({
  days,
  weekBlocks = [],
  todayIso = "",
  personnes = [],
  displayedIds = null,
  statIds = [],
  groups = [],
  openByIso = {},
  motifs = [],
  besoin = [],
  initial = {},
  matrice = {},
  habPoste = {},
  habComp = {},
  habPers = {},
  quart = "",
  otherByCell = {},
  otherPosteByCell = {},
  tpBlocked = {},
  horsEffectif = {},
  quartLabel = {},
  posteLabelAll = {},
  exceptions = {},
  horaireStd = {},
  formationMotifId = null,
  weekNav = null,
  initialSearch,
}: {
  days: Jour[];
  weekBlocks?: WeekBlock[];
  todayIso?: string;
  personnes?: Personne[];
  // Sous-ensemble affiche par defaut (filtre equipe/atelier serveur). `null` =
  // toutes les personnes. La recherche par nom (client) filtre dans le TOTAL,
  // ce qui permet de retrouver quelqu'un hors filtre courant.
  displayedIds?: string[] | null;
  statIds?: string[];
  groups?: Group[];
  openByIso?: Record<string, string[]>;
  motifs?: Motif[];
  besoin?: number[];
  initial?: Record<string, string>;
  matrice?: Record<string, number>;
  habPoste?: Record<string, string[]>; // poste -> habilitations exigees
  habComp?: Record<string, string>; // habilitation -> nom
  habPers?: Record<string, string>; // `${personne}:${habilitation}` -> echeance ("" = sans echeance)
  quart?: string;
  otherByCell?: Record<string, string>;
  otherPosteByCell?: Record<string, string>; // nom complet du poste occupe sur cet autre quart
  tpBlocked?: Record<string, boolean>;
  // Case ou la personne n'est pas dans l'effectif ce jour-la (avant arrivee,
  // apres depart, trou entre deux contrats — cf. cycle de vie 0049/0050).
  // Meme desactivation que tpBlocked, mais rendu vide (pas de « TP »).
  horsEffectif?: Record<string, boolean>;
  quartLabel?: Record<string, string>;
  posteLabelAll?: Record<string, string>;
  exceptions?: Record<string, { debut: string; fin: string; motif: string }>;
  horaireStd?: Record<string, { debut: string; fin: string }>; // `${poste}:${dow}` -> horaire par defaut
  formationMotifId?: string | null; // motif "Formation" -> pendule active (horaires + sujet)
  weekNav?: React.ReactNode;
  /** Recherche initiale (portee par l'URL, pour survivre a la navigation). */
  initialSearch?: string;
}) {
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Surlignage d'un type d'anomalie pour un jour donne (clic sur une puce d'en-tete).
  const [highlight, setHighlight] = useState<{ iso: string; type: "hc" | "over" } | null>(null);
  const toggleHi = (iso: string, type: "hc" | "over") =>
    setHighlight((h) => (h && h.iso === iso && h.type === type ? null : { iso, type }));

  // Horaires specifiques (exceptions) : etat local + popover d'edition par case.
  // Affichage du bilan : persiste dans localStorage car la grille est remontee
  // (prop `key`) a chaque changement de filtre -> sinon l'etat serait reinitialise.
  // Le bilan est REPLIE au chargement : c'est une synthese que l'on consulte au
  // besoin, pas la raison d'ouvrir le planning — deplie, il mange la hauteur utile
  // de la grille. Qui le deplie le retrouve deplie (localStorage), mais un nouvel
  // arrivant part replie.
  const [showInd, setShowInd] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("planning.showBilan") === "1") setShowInd(true);
  }, []);
  const toggleInd = () =>
    setShowInd((s) => {
      const next = !s;
      if (typeof window !== "undefined") window.localStorage.setItem("planning.showBilan", next ? "1" : "0");
      return next;
    });
  // Panneau d'affectation : par defaut, on ne propose que les postes ou la
  // personne est competente (niveau >= min, hors restriction). Bascule via un
  // bouton dans l'entete du panneau, memorisee en localStorage. Repli
  // automatique : si aucun poste ne passe le filtre, on affiche tout avec un
  // bandeau explicite plutot que d'ouvrir un panneau vide.
  const [showAllPostes, setShowAllPostes] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("planning.pickShowAll") === "1") setShowAllPostes(true);
  }, []);
  const togglePostes = () =>
    setShowAllPostes((s) => {
      const next = !s;
      if (typeof window !== "undefined") window.localStorage.setItem("planning.pickShowAll", next ? "1" : "0");
      return next;
    });
  // Selection d'une case (contour) pour la touche Suppr, et panneau d'affectation.
  const [selected, setSelected] = useState<string | null>(null);
  const [pick, setPick] = useState<{ pid: string; iso: string; eq: string | null; left: number; right: number; top: number; bottom: number } | null>(null);
  // Demande de forcage en attente : le poste vise exige une habilitation absente.
  const [askHab, setAskHab] = useState<{ pid: string; iso: string; eq: string | null; value: string; manquantes: string[] } | null>(null);
  // Recherche par nom : filtre uniquement les lignes affichees (indicateurs inchanges).
  // Cas particulier : la recherche IGNORE les filtres equipe/atelier (elle balaie
  // l'effectif complet passe en prop) pour toujours retrouver quelqu'un ; hors
  // recherche, on se limite au sous-ensemble `displayedIds` calcule par le serveur.
  const [search, setSearchRaw] = useState(initialSearch ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();

  // Synchronise la recherche vers l'URL (debounce 400 ms) pour qu'elle survive
  // a la navigation (changement de semaine / mois). On remplace l'URL sans
  // navigation — pas de push, pas de revalidation serveur.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearch = useCallback((v: string) => {
    setSearchRaw(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const p = new URLSearchParams(urlParams.toString());
      if (v.trim()) p.set("search", v.trim());
      else p.delete("search");
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 400);
  }, [router, pathname, urlParams]);

  // Restauration du scroll vertical : sauvegardé dans sessionStorage avant
  // chaque navigation, restauré après le montage.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const SCROLL_KEY = "planning.scrollTop";
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = Number(saved);
      sessionStorage.removeItem(SCROLL_KEY);
    }
  }, []);
  // Sauvegarde continue du scroll pour que la prochaine navigation la retrouve.
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const handler = () => sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop));
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  const displayedSet = useMemo(
    () => (displayedIds ? new Set(displayedIds) : null),
    [displayedIds],
  );
  const shown = useMemo(() => {
    if (search.trim()) return personnes.filter((p) => norm(p.label).includes(norm(search)));
    if (!displayedSet) return personnes;
    return personnes.filter((p) => displayedSet.has(p.id));
  }, [personnes, search, displayedSet]);
  const [exc, setExc] = useState(exceptions);
  const [excAt, setExcAt] = useState<string | null>(null); // cle "pid:iso"
  const [draft, setDraft] = useState<{ debut: string; fin: string; motif: string }>({ debut: "", fin: "", motif: "" });
  const excKey = (pid: string, iso: string) => `${pid}:${iso}`;
  function openExc(pid: string, iso: string) {
    const e = exc[excKey(pid, iso)] ?? { debut: "", fin: "", motif: "" };
    setDraft({ debut: e.debut, fin: e.fin, motif: e.motif });
    setExcAt(excKey(pid, iso));
  }
  async function saveExc(pid: string, iso: string) {
    const k = excKey(pid, iso);
    const res = await fetch("/api/horaire-exception", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "save", personne_id: pid, jour: iso, ...draft }),
    });
    if (res.ok) {
      setExc((s) => {
        const n = { ...s };
        if (!draft.debut && !draft.fin && !draft.motif) delete n[k];
        else n[k] = { ...draft };
        return n;
      });
      setExcAt(null);
    }
  }
  async function clearExc(pid: string, iso: string) {
    const res = await fetch("/api/horaire-exception", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "delete", personne_id: pid, jour: iso }),
    });
    if (res.ok) {
      setExc((s) => {
        const n = { ...s };
        delete n[excKey(pid, iso)];
        return n;
      });
      setExcAt(null);
    }
  }
  const excLabel = (e: { debut: string; fin: string }) => `${e.debut || "?"}-${e.fin || "?"}`;

  const key = (pid: string, iso: string) => `${pid}:${iso}`;
  const isPoste = (v: string) => v !== "" && v !== "X" && !v.startsWith("m:");
  // Motif "Formation" : la pendule reste active pour saisir horaires / sujet (commentaire).
  const isFormation = (v: string) => !!formationMotifId && v === `m:${formationMotifId}`;
  const motifColor = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of motifs) m[`m:${x.id}`] = x.couleur;
    return m;
  }, [motifs]);

  // Index de semaine par colonne (pour le remplissage de semaine)
  const weekIdx = useMemo(() => {
    const arr: number[] = [];
    let w = -1;
    days.forEach((d, i) => {
      if (d.firstOfWeek) w++;
      arr[i] = w;
    });
    return arr;
  }, [days]);

  const { niveauMin, effectif } = useMemo(() => {
    const nm: Record<string, number> = {};
    const ef: Record<string, number> = {};
    for (const g of groups)
      for (const p of g.postes) {
        nm[p.id] = p.niveauMin;
        ef[p.id] = p.effectif;
      }
    return { niveauMin: nm, effectif: ef };
  }, [groups]);

  const { posteLigne, posteLabel, posteCat, allLigneIds } = useMemo(() => {
    const pl: Record<string, string> = {};
    const lab: Record<string, string> = {};
    const cat: Record<string, string> = {};
    const ids: string[] = [];
    for (const g of groups) {
      ids.push(g.ligneId);
      for (const p of g.postes) {
        pl[p.id] = g.ligneId;
        lab[p.id] = p.nom;
        cat[p.id] = p.categorie ?? "operateur";
      }
    }
    return { posteLigne: pl, posteLabel: lab, posteCat: cat, allLigneIds: ids };
  }, [groups]);

  const horsComp = (pid: string, v: string) =>
    isPoste(v) && (matrice[`${pid}:${v}`] ?? 0) < (niveauMin[v] ?? 0);

  // Habilitations exigees par le poste occupe que la personne n'a pas (ou plus).
  // Recalcule a l'affichage, comme au Placement : le rouge s'efface de lui-meme
  // des la regularisation, et revient si l'habilitation expire.
  const habDetenue = (pid: string, cid: string) => {
    const e = habPers[`${pid}:${cid}`];
    return e === undefined ? null : { expiration: e === "" ? null : e };
  };
  // Aide a la competence dans le panneau d'affectation, calquee sur le Placement :
  // vert = competent, rouge = restriction medicale, estompe = niveau insuffisant.
  const compState = (pid: string, posteId: string): "ok" | "restrict" | "low" => {
    const n = matrice[`${pid}:${posteId}`] ?? 0;
    if (n === -1) return "restrict";
    return n >= (niveauMin[posteId] ?? 0) ? "ok" : "low";
  };

  const habManque = (pid: string, v: string): string[] =>
    !isPoste(v)
      ? []
      : (habPoste[v] ?? [])
          .filter((cid) => !habValable(habDetenue(pid, cid)))
          .map((cid) => habComp[cid] ?? "habilitation");

  // Libelle compact de la valeur d'une case (poste / motif / NT / vide).
  const persById = useMemo(() => new Map(personnes.map((p) => [p.id, p])), [personnes]);
  const valueLabel = (v: string) =>
    v === "" ? "—"
    : v === "X" ? "NT"
    : v.startsWith("m:") ? (motifs.find((mo) => `m:${mo.id}` === v)?.code ?? "?")
    : (posteLabel[v] ?? posteLabelAll[v] ?? "?");

  // Clavier : Suppr/Retour efface la case selectionnee ; Echap ferme.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { setPick(null); setSelected(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        const [pid, iso] = selected.split(":");
        const p = persById.get(pid);
        if (p && p.editable) {
          e.preventDefault();
          change(pid, iso, p.equipe_id, "");
        }
        setPick(null); // referme le panneau d'affectation des l'appui sur Suppr
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, persById]);

  // Fermer le panneau au clic en dehors.
  useEffect(() => {
    if (!pick) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".cellpick") || t.closest(".cellbtn")) return;
      setPick(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pick]);

  // Indicateurs comptes sur TOUTES les personnes du quart (statIds), pas seulement
  // l'equipe affichee : le besoin et le present concernent l'ensemble du quart.
  const indicIds = statIds.length ? statIds : personnes.map((p) => p.id);
  const perDay = days.map((d) => {
    const counts: Record<string, number> = {};
    const catPresent: Record<string, number> = { manager: 0, conducteur: 0, operateur: 0 };
    let present = 0;
    let alerts = 0;
    for (const pid of indicIds) {
      const v = vals[key(pid, d.iso)] ?? "";
      // On ne compte que les placements sur un poste affiche (cadre l'atelier filtre).
      if (isPoste(v) && posteLigne[v] !== undefined) {
        present++;
        counts[v] = (counts[v] ?? 0) + 1;
        const c = posteCat[v];
        if (c && c in catPresent) catPresent[c]++;
        if (horsComp(pid, v)) alerts++;
      }
    }
    let overCount = 0;
    for (const [pid, c] of Object.entries(counts)) if (c > (effectif[pid] ?? 0)) overCount++;
    // Besoin par categorie = effectifs requis des postes sur les lignes ouvertes ce jour.
    const openLines = new Set(openByIso[d.iso] ?? allLigneIds);
    const catRequis: Record<string, number> = { manager: 0, conducteur: 0, operateur: 0 };
    for (const g of groups)
      if (openLines.has(g.ligneId))
        for (const p of g.postes) {
          const c = p.categorie ?? "operateur";
          if (c in catRequis) catRequis[c] += p.effectif ?? 0;
        }
    return { counts, present, alerts, overCount, catPresent, catRequis };
  });

  // ⚠️ Ne jamais ajouter `numero` ici : son ABSENCE indique a l'API que l'appel
  // vient du Planning, qui n'a pas de cases numerotees, et qu'elle doit prendre
  // la premiere place libre (cf. /api/placement/cell).
  async function postCell(pid: string, iso: string, equipe_id: string | null, value: string, forcer = false) {
    const res = await fetch("/api/placement/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personne_id: pid, jour: iso, equipe_id, value, quart, ...(forcer ? { forcer: true } : {}) }),
    });
    if (res.ok) return;
    if (res.status === 428) {
      const j = (await res.json().catch(() => ({}))) as { manquantes?: string[] };
      throw new HabManquanteError(Array.isArray(j.manquantes) ? j.manquantes : []);
    }
    throw new Error();
  }

  async function change(pid: string, iso: string, equipe_id: string | null, value: string, forcer = false) {
    const k = key(pid, iso);
    const prev = vals[k] ?? "";
    setVals((s) => ({ ...s, [k]: value }));
    setSaving("saving");
    try {
      await postCell(pid, iso, equipe_id, value, forcer);
      setSaving("saved");
    } catch (e) {
      setVals((s) => ({ ...s, [k]: prev })); // refus serveur : on annule le changement
      if (e instanceof HabManquanteError) {
        // Meme comportement qu'au Placement : on propose de forcer, en nommant
        // ce qui manque. Sans cette fenetre, le Planning refusait sans rien dire.
        setSaving("idle");
        setAskHab({ pid, iso, eq: equipe_id, value, manquantes: e.manquantes });
        return;
      }
      setSaving("error");
    }
    setTimeout(() => setSaving("idle"), 1200);
  }

  // Recopie la valeur d'une case selon le jour de la semaine :
  //  - du lundi au jeudi : sur le reste de la semaine en cours (jours affiches) ;
  //  - a partir du vendredi : sur les jours affiches de la semaine SUIVANTE (une
  //    seule semaine ; le week-end en cours n'est pas touche, les jours non
  //    affiches ne sont pas remplis).
  // On ne touche jamais aux jours ou la personne est deja placee sur un autre quart.
  async function fillWeek(pers: Personne, dayIndex: number) {
    const value = vals[key(pers.id, days[dayIndex].iso)] ?? "";
    const wk = weekIdx[dayIndex];
    const avantVendredi = dowMon(days[dayIndex].iso) < 4; // 0 = lundi .. 4 = vendredi
    const targets = days
      .filter((_, j) => (avantVendredi ? j > dayIndex && weekIdx[j] === wk : weekIdx[j] === wk + 1))
      .filter((t) => !otherByCell[key(pers.id, t.iso)]);
    if (targets.length === 0) return; // rien a recopier (fin de semaine / plus de semaine affichee)
    const hasExisting = targets.some((t) => (vals[key(pers.id, t.iso)] ?? "") !== "");
    if (
      hasExisting &&
      !window.confirm(
        avantVendredi
          ? "Des affectations existent déjà sur la fin de cette semaine. Les écraser ?"
          : "Des affectations existent déjà sur la semaine suivante. Les écraser ?"
      )
    ) {
      return;
    }
    setVals((s) => {
      const next = { ...s };
      for (const t of targets) next[key(pers.id, t.iso)] = value;
      return next;
    });
    setSaving("saving");
    try {
      // `forcer` : la recopie duplique une affectation DEJA a l'ecran, donc deja
      // acceptee (au besoin en la forcant). Redemander confirmation pour chaque
      // jour recopie n'apprendrait rien. Chaque ligne reste tracee, et le rouge
      // se recalcule a l'affichage.
      await Promise.all(targets.map((t) => postCell(pers.id, t.iso, pers.equipe_id, value, true)));
      setSaving("saved");
    } catch {
      setSaving("error");
    }
    setTimeout(() => setSaving("idle"), 1200);
  }

  const deltaColor = (d: number) => (d < 0 ? "var(--danger)" : d > 0 ? "#9a3412" : "var(--ok)");
  const sep = (d: Jour): React.CSSProperties => (d.firstOfWeek ? { borderLeft: "3px solid #94a3b8" } : {});
  const isToday = (d: Jour) => d.iso === todayIso;
  // En-tetes figes : les lignes d'indicateurs (Besoin..Alertes) restent collees sous
  // les en-tetes de jours quand on descend. Offsets cumulables (a recalibrer si besoin).
  const HEAD_H = 60; // hauteur des 2 lignes d'en-tete (semaine + jours)
  const IND_H = 21; // hauteur d'une ligne d'indicateur
  const STICK_TOP = (rowIdx: number) => HEAD_H + rowIdx * IND_H;
  const indCellStyle = (rowIdx: number, bg: string): React.CSSProperties => ({
    position: "sticky",
    top: STICK_TOP(rowIdx),
    zIndex: 14,
    background: bg,
  });
  const indLeftStyle = (rowIdx: number, bg: string): React.CSSProperties => ({
    position: "sticky",
    left: 0,
    top: STICK_TOP(rowIdx),
    zIndex: 16,
    background: bg,
    fontWeight: 600,
    padding: "1px 8px",
  });

  // Colonne noms adaptative (px), partagee par les 2 tables -> colonnes alignees.
  // Largeur calee sur le nom le plus long (noms complets, jamais tronques).
  const nameW = Math.min(480, Math.max(160, personnes.reduce((m, p) => Math.max(m, p.label.length), 0) * 8 + 46));
  const Cols = () => (
    <colgroup>
      <col style={{ width: nameW }} />
      {days.map((d) => <col key={d.iso} />)}
    </colgroup>
  );
  const tStyle: React.CSSProperties = { borderCollapse: "collapse", width: "100%", tableLayout: "fixed" };

  return (
    <>
      {/* Recherche par nom (entre les filtres et la grille) */}
      <div style={{ margin: "2px 0 6px", display: "flex", justifyContent: "center" }}>
        <span style={{ position: "relative", display: "inline-block", width: "100%", maxWidth: 320 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Rechercher un nom…"
            style={{ width: "100%", padding: "6px 26px 6px 12px", borderRadius: 999, border: "1px solid var(--border)", fontSize: 13 }}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} title="Effacer" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: "auto", margin: 0, padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>✕</button>
          )}
        </span>
      </div>

      {/* Tableau 1 : en-tetes (dates) + bilan/alertes retractable (fixe) */}
      <div className="card" style={{ overflowX: "hidden", overflowY: "auto", scrollbarGutter: "stable", position: "relative", padding: "6px 12px" }}>
        <div style={{ position: "absolute", top: 8, right: 12, fontSize: 12, fontWeight: 600, color: saving === "error" ? "var(--danger)" : saving === "saved" ? "var(--ok)" : "var(--muted)" }}>
          {saving === "saving" ? "Enregistrement..." : saving === "saved" ? "Enregistré" : saving === "error" ? "Échec" : ""}
        </div>

      <table className="matrix" style={tStyle}>
        <Cols />
        <thead>
          <tr>
            <th rowSpan={2} style={{ position: "sticky", left: 0, top: 0, zIndex: 25, background: "#fff", textAlign: "center", padding: "2px 6px" }}>
              {weekNav}
              <button
                type="button"
                onClick={toggleInd}
                title={showInd ? "Masquer le bilan & alertes" : "Afficher le bilan & alertes"}
                style={{ width: "auto", margin: 0, padding: "5px 14px", fontSize: 14, fontWeight: 700, lineHeight: 1.4, border: "1px solid #e11d48", borderRadius: 6, background: "#e11d48", color: "#fff", cursor: "pointer" }}
              >
                {showInd ? "− Bilan" : "+ Bilan"}
              </button>
            </th>
            {weekBlocks.map((w, i) => (
              <th
                key={i}
                colSpan={w.span}
                style={{
                  textAlign: "center",
                  padding: "2px 8px",
                  position: "sticky",
                  top: 0,
                  zIndex: 20,
                  borderLeft: "3px solid #94a3b8",
                  background: w.isCurrent ? "#dbeafe" : "#f8fafc",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: w.isCurrent ? 700 : undefined }}>
                  {w.year} · Semaine {w.num}
                  {w.isCurrent && <span className="muted" style={{ fontWeight: 400 }}>(en cours)</span>}
                </span>
              </th>
            ))}
          </tr>
          <tr>
            {days.map((d) => (
              <th key={d.iso} style={{ textAlign: "center", padding: "2px 2px", position: "sticky", top: 26, zIndex: 20, ...sep(d), borderBottom: "2px solid #94a3b8", background: isToday(d) ? "#dbeafe" : "#fff" }}>
                {d.nom.slice(0, 2)}
                <br />
                <span className="muted" style={{ fontWeight: 400 }}>{d.num}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showInd && (
          <>
          {(
            [
              ["Besoin", (i: number) => `${besoin[i] ?? 0}`, () => "var(--muted)"],
              ["Présent", (i: number) => `${perDay[i].present}`, () => "var(--text)"],
              [
                "Delta",
                (i: number) => {
                  const d = perDay[i].present - (besoin[i] ?? 0);
                  return d > 0 ? `+${d}` : `${d}`;
                },
                (i: number) => deltaColor(perDay[i].present - (besoin[i] ?? 0)),
              ],
            ] as [string, (i: number) => string, (i: number) => string][]
          ).map(([label, get, color], rowIdx) => (
            <tr key={label}>
              <td style={indLeftStyle(rowIdx, "#f8fafc")}>{label}</td>
              {days.map((d, i) => (
                <td key={d.iso} style={{ ...indCellStyle(rowIdx, isToday(d) ? "#eef2ff" : "#f8fafc"), textAlign: "center", fontWeight: 700, padding: "1px 4px", color: color(i), ...sep(d) }}>
                  {get(i)}
                </td>
              ))}
            </tr>
          ))}

          {/* Bilans par categorie : presents / requis par jour (quart affiche) */}
          {CAT_BILANS.map((cat, j) => {
            const rowIdx = 3 + j;
            return (
              <tr key={cat.key}>
                <td style={{ ...indLeftStyle(rowIdx, "#f8fafc"), whiteSpace: "nowrap", fontWeight: 400 }}>{cat.label}</td>
                {days.map((d, i) => {
                  const pres = perDay[i].catPresent[cat.key] ?? 0;
                  const req = perDay[i].catRequis[cat.key] ?? 0;
                  const manque = req > 0 && pres < req;
                  const bg = manque ? "#fee2e2" : isToday(d) ? "#eef2ff" : "#f8fafc";
                  return (
                    <td
                      key={d.iso}
                      style={{ ...indCellStyle(rowIdx, bg), textAlign: "center", fontWeight: 700, padding: "1px 4px", color: manque ? "#7f1d1d" : "var(--text)", ...sep(d) }}
                      title={`${cat.label} : ${pres} présents / ${req} requis`}
                    >
                      {pres}
                      <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.7 }}>/{req}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* Ligne d'alertes : puces cliquables (hors-competence / sur-effectif) */}
          <tr>
            <td style={indLeftStyle(6, "#f8fafc")}>Alertes</td>
            {days.map((d, i) => {
              const hc = perDay[i].alerts;
              const ov = perDay[i].overCount;
              const hcOn = highlight?.iso === d.iso && highlight.type === "hc";
              const ovOn = highlight?.iso === d.iso && highlight.type === "over";
              return (
                <td key={d.iso} style={{ ...indCellStyle(6, isToday(d) ? "#eef2ff" : "#f8fafc"), textAlign: "center", padding: "2px 2px", ...sep(d) }}>
                  {hc > 0 && (
                    <button
                      type="button"
                      className={`alert-pill hc${hcOn ? " active" : ""}`}
                      onClick={() => toggleHi(d.iso, "hc")}
                      title="Hors compétence — cliquer pour surligner"
                    >
                      {hc}
                    </button>
                  )}
                  {ov > 0 && (
                    <button
                      type="button"
                      className={`alert-pill over${ovOn ? " active" : ""}`}
                      onClick={() => toggleHi(d.iso, "over")}
                      title="Postes en sur-effectif — cliquer pour surligner"
                    >
                      {ov}
                    </button>
                  )}
                  {hc === 0 && ov === 0 && <span className="muted">·</span>}
                </td>
              );
            })}
          </tr>
          </>
          )}
        </tbody>
      </table>
      </div>

      {/* Tableau 2 : noms (defile, remplit le reste de la fenetre) */}
      <div ref={gridScrollRef} className="card" style={{ marginTop: 8, overflowX: "hidden", overflowY: "auto", scrollbarGutter: "stable", flex: 1, minHeight: 0, padding: "0 12px" }}>
      <table className="matrix" style={tStyle}>
        <Cols />
        <tbody>
          {shown.map((pers) => (
            <tr key={pers.id}>
              <td style={{ background: "#fff", whiteSpace: "nowrap" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: pers.color ?? "#fff",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                    marginRight: 7,
                    verticalAlign: "middle",
                  }}
                />
                <span style={pers.interim ? { background: INTERIM_BG, borderRadius: 3, padding: "0 4px" } : undefined}>{pers.label}</span>
                {!pers.editable && <span className="muted"> (lecture)</span>}
              </td>
              {days.map((d, i) => {
                const v = vals[key(pers.id, d.iso)] ?? "";
                const alert = horsComp(pers.id, v);
                // Placement force : habilitation exigee manquante ou perimee.
                const manque = habManque(pers.id, v);
                const over = isPoste(v) && (perDay[i].counts[v] ?? 0) > (effectif[v] ?? 0);
                // Restriction (medicale/physique) : niveau -1 dans la matrice pour ce poste.
                const restricted = isPoste(v) && matrice[key(pers.id, v)] === -1;
                // Bouton de recopie aussi sur une case vide : permet de propager le
                // « non-affecte » sur la semaine. Masque seulement si placee sur un autre quart.
                const tpb = !!tpBlocked[key(pers.id, d.iso)];
                const hors = !!horsEffectif[key(pers.id, d.iso)];
                // Case bloquee : soit temps partiel (sans motif d'absence), soit
                // hors effectif ce jour-la. Quand le TP coexiste avec un motif
                // d'absence, le motif prime : la case reste modifiable et affiche
                // la couleur du motif au lieu de « TP ».
                const tpAbsence = tpb && !!motifColor[v];
                const bloque = (tpb && !tpAbsence) || hors;
                const showFill = pers.editable && !otherByCell[key(pers.id, d.iso)] && !bloque;
                const other = v === "" ? otherByCell[key(pers.id, d.iso)] : undefined;
                // Surlignage : cette case correspond-elle au type d'anomalie selectionne ce jour-la ?
                const hiActive = highlight?.iso === d.iso;
                const matchHi = !!hiActive && ((highlight!.type === "hc" && alert) || (highlight!.type === "over" && over));
                const dimHi = !!hiActive && !matchHi;
                return (
                  <td
                    key={d.iso}
                    className={`pcell${alert ? " hc" : ""}${over ? " over" : ""}${manque.length ? " forced" : ""}${matchHi ? " hi" : ""}${dimHi ? " dim" : ""}`}
                    style={{
                      textAlign: "center",
                      // Priorite des fonds, alignee sur le Placement :
                      // hors effectif > temps partiel > motif d'absence >
                      // rouge (competence ou habilitation) > jaune (sureffectif)
                      // > aujourd'hui.
                      background: hors
                        ? "#f1f5f9"
                        : tpb && !tpAbsence
                        ? "#e0e7ff"
                        : motifColor[v]
                        ? motifColor[v]
                        : alert || manque.length
                        ? "#fef2f2"
                        : over
                        ? "#fffbeb"
                        : isToday(d)
                        ? "#eff6ff"
                        : undefined,
                      padding: 0,
                      position: "relative",
                      ...sep(d),
                    }}
                    title={[
                      hors ? "Hors effectif ce jour-là (avant arrivée, après départ ou entre deux contrats)" : "",
                      restricted ? "⛔ Restriction médicale/physique sur ce poste" : alert ? "Hors compétence" : "",
                      manque.length ? `⚠ Placement forcé — habilitation manquante : ${manque.join(", ")}` : "",
                      over ? `Sur-effectif (${perDay[i].counts[v]}/${effectif[v] ?? 0})` : "",
                    ].filter(Boolean).join(" · ") || undefined}
                  >
                    {hors ? (
                      // Case grisee, aucun label : la personne n'est pas dans
                      // l'effectif ce jour-la. Distincte du TP (fond violet).
                      <div className="cell-other" style={{ color: "#94a3b8" }} aria-hidden="true">·</div>
                    ) : tpb && !tpAbsence ? (
                      <div className="cell-other" style={{ color: "#3730a3" }} title="Temps partiel — journée entière non travaillée">TP</div>
                    ) : other ? (
                      <div
                        className="cell-other"
                        title={
                          `Déjà placé sur le quart ${quartLabel[other] ?? other} ce jour-là` +
                          (otherPosteByCell[key(pers.id, d.iso)]
                            ? `\nPoste : ${otherPosteByCell[key(pers.id, d.iso)]}`
                            : "")
                        }
                      >
                        &rarr; {quartLabel[other] ?? other}
                      </div>
                    ) : (
                    <button
                      type="button"
                      className={`cellbtn${isPoste(v) ? " poste" : ""}${selected === key(pers.id, d.iso) ? " sel" : ""}`}
                      disabled={!pers.editable}
                      title="Cliquer pour affecter · Suppr pour effacer"
                      onClick={(e) => {
                        const k = key(pers.id, d.iso);
                        setSelected(k);
                        if (pick && pick.pid === pers.id && pick.iso === d.iso) { setPick(null); return; }
                        const r = e.currentTarget.getBoundingClientRect();
                        setPick({ pid: pers.id, iso: d.iso, eq: pers.equipe_id, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
                      }}
                    >
                      {valueLabel(v)}
                    </button>
                    )}
                    {showFill && (
                      <button
                        type="button"
                        className="fillw"
                        title={dowMon(d.iso) < 4 ? "Recopier jusqu'à la fin de cette semaine" : "Recopier sur la semaine suivante"}
                        onClick={() => fillWeek(pers, i)}
                      >
                        &raquo;
                      </button>
                    )}
                    {restricted && (
                      <span
                        title="Restriction médicale/physique sur ce poste"
                        style={{ position: "absolute", left: 1, top: 0, fontSize: 11, fontWeight: 800, color: "#dc2626", lineHeight: 1, pointerEvents: "none" }}
                      >
                        ✕
                      </span>
                    )}
                    {(() => {
                      const ek = excKey(pers.id, d.iso);
                      const e = exc[ek];
                      // Editable si la case est affectee, ou si une exception subsiste (pour
                      // pouvoir la modifier / l'effacer meme apres suppression de l'affectation).
                      const canEditExc = pers.editable && (isPoste(v) || isFormation(v) || !!e);
                      if (!e && !canEditExc) return null;
                      // Horaire par defaut (standard du poste pour ce quart / jour de semaine).
                      const std = isPoste(v) ? horaireStd[`${v}:${dowMon(d.iso)}`] : undefined;
                      const stdTxt = std && (std.debut || std.fin) ? `${std.debut || "?"}-${std.fin || "?"}` : "";
                      return (
                        <>
                          {canEditExc ? (
                            <button
                              type="button"
                              className={`horx${e ? " has" : ""}`}
                              title={e ? ([(e.debut || e.fin) ? `Horaire : ${excLabel(e)}` : "", e.motif ? `Commentaire : ${e.motif}` : ""].filter(Boolean).join(" · ") || "Horaire spécifique") : stdTxt ? `Horaire par défaut : ${stdTxt} · Définir un horaire spécifique` : "Définir un horaire spécifique"}
                              onClick={() => openExc(pers.id, d.iso)}
                            >
                              🕐
                            </button>
                          ) : (
                            e && <span className="horx has" title={`Horaire spécifique : ${excLabel(e)}`}>🕐</span>
                          )}
                          {excAt === ek && (
                            <div className="exc-pop" onClick={(ev) => ev.stopPropagation()}>
                              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Horaire spécifique</div>
                              {stdTxt && (
                                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Par défaut : {stdTxt}</div>
                              )}
                              {/* Deux colonnes étiquetées : à 168 px, les deux
                                  champs `time` se chevauchaient et le champ Fin,
                                  rogné, restait souvent incomplet (heure sans
                                  minutes) — donc vide, donc non enregistré. */}
                              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--muted)" }}>
                                  Début
                                  <input type="time" value={draft.debut} onChange={(ev) => setDraft((s) => ({ ...s, debut: ev.target.value }))} style={{ fontSize: 12, padding: "2px 3px", width: "100%" }} />
                                </label>
                                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--muted)" }}>
                                  Fin
                                  <input type="time" value={draft.fin} onChange={(ev) => setDraft((s) => ({ ...s, fin: ev.target.value }))} style={{ fontSize: 12, padding: "2px 3px", width: "100%" }} />
                                </label>
                              </div>
                              <input
                                placeholder="commentaire (affiché à la TV)"
                                value={draft.motif}
                                onChange={(ev) => setDraft((s) => ({ ...s, motif: ev.target.value }))}
                                style={{ width: "100%", fontSize: 12, padding: "2px 3px", marginBottom: 6 }}
                              />
                              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                                <button type="button" className="btn-sm" style={{ padding: "2px 8px" }} onClick={() => saveExc(pers.id, d.iso)}>OK</button>
                                {e && (
                                  <button type="button" className="btn-sm btn-ghost" style={{ padding: "2px 8px" }} onClick={() => clearExc(pers.id, d.iso)}>Effacer</button>
                                )}
                                <button type="button" className="btn-sm btn-ghost" style={{ padding: "2px 8px" }} onClick={() => setExcAt(null)}>×</button>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </td>
                );
              })}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={days.length + 1} className="muted">
                {personnes.length === 0
                  ? "Aucune personne."
                  : search.trim()
                    ? "Aucun résultat pour cette recherche."
                    : "Aucune personne dans le filtre courant (bascule sur « Toutes » ou une autre équipe, ou tape un nom)."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      <p className="muted" style={{ margin: "6px 12px 0", fontSize: 11 }}>
        Survolez une case et cliquez sur &raquo; pour recopier sa valeur (y compris « non-affecté ») :
        du lundi au jeudi sur la fin de la semaine en cours, à partir du vendredi sur la semaine suivante.{" "}
        <span style={{ display: "inline-block", width: 12, height: 12, verticalAlign: "-2px", background: "#fef2f2", border: "1px solid #fca5a5" }} />{" "}
        fond rouge = hors compétence ·{" "}
        <span style={{ display: "inline-block", width: 12, height: 12, verticalAlign: "-2px", background: "#fffbeb", border: "1px solid #f59e0b" }} />{" "}
        fond jaune = sur-effectif ·{" "}
        <span style={{ display: "inline-block", width: 12, height: 12, verticalAlign: "-2px", background: "#fef2f2", outline: "2px solid #dc2626", outlineOffset: -2 }} />{" "}
        encadré rouge = forçage, habilitation manquante ·
        cliquez une pastille de la ligne « Alertes » pour surligner les cases concernées ·{" "}
        <span style={{ background: "#1d4ed8", color: "#fff", borderRadius: 3, padding: "0 3px", fontSize: 10 }}>🕐</span>{" "}
        horaire spécifique (survolez une case placée) · jours sans ligne ouverte masqués ·{" "}
        cliquez une case puis <kbd>Suppr</kbd> pour l&apos;effacer.
      </p>

      {/* Habilitation manquante : confirmer ou renoncer. Meme geste qu'au Placement —
          sans cette fenetre, le Planning refusait le placement sans rien expliquer. */}
      {askHab && (
        <ModaleDeplacable onClose={() => setAskHab(null)} largeur={440} zIndex={90}>
            <h2 className="mdd-drag" style={{ margin: "0 0 8px", fontSize: 18, color: "#b91c1c", cursor: "grab" }}>⚠ Habilitation manquante</h2>
            <p style={{ margin: "0 0 6px", fontSize: 14 }}>
              <strong>{persById.get(askHab.pid)?.label ?? ""}</strong> n&apos;est pas habilité(e) pour le
              poste <strong>{posteLabel[askHab.value] ?? posteLabelAll[askHab.value] ?? "?"}</strong>.
            </p>
            {askHab.manquantes.length > 0 && (
              <p style={{ margin: "0 0 14px", fontSize: 14 }}>
                Manque : <strong style={{ color: "#b91c1c" }}>{askHab.manquantes.join(", ")}</strong>
              </p>
            )}
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
              Un placement forcé est tracé (auteur et date) et s&apos;affiche en rouge tant que
              l&apos;habilitation n&apos;est pas régularisée.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setAskHab(null)}>
                Non
              </button>
              <button
                type="button"
                className="btn-sm"
                style={{ background: "#dc2626", color: "#fff", border: "1px solid #dc2626", fontWeight: 700 }}
                onClick={() => {
                  const a = askHab;
                  setAskHab(null);
                  change(a.pid, a.iso, a.eq, a.value, true);
                }}
              >
                Oui, je force
              </button>
            </div>
        </ModaleDeplacable>
      )}

      {/* Panneau d'affectation (rendu une seule fois, position fixe -> pas de clipping). */}
      {pick && (() => {
        const cur = vals[key(pick.pid, pick.iso)] ?? "";
        const oset = new Set(openByIso[pick.iso] ?? allLigneIds);
        const og = groups.filter((g) => oset.has(g.ligneId));
        // Comptage global (postes competents / total) pour afficher la bascule.
        // On garde toujours le poste actuellement occupe visible, meme s'il ne
        // passe pas le filtre : sinon on ne pourrait plus le distinguer.
        const totalPostes = og.reduce((n, g) => n + g.postes.length, 0);
        const totalOK = og.reduce(
          (n, g) => n + g.postes.filter((po) => compState(pick.pid, po.id) === "ok").length,
          0,
        );
        const forceAll = !showAllPostes && totalPostes > 0 && totalOK === 0;
        const effShowAll = showAllPostes || forceAll;
        const ogVisible: Group[] = og
          .map((g) => ({
            ...g,
            postes: g.postes.filter(
              (po) => effShowAll || cur === po.id || compState(pick.pid, po.id) === "ok",
            ),
          }))
          .filter((g) => g.postes.length > 0);
        const ats: { nom: string; gs: Group[] }[] = [];
        for (const g of ogVisible) {
          const nom = g.atelierNom ?? "";
          let a = ats.find((x) => x.nom === nom);
          if (!a) { a = { nom, gs: [] }; ats.push(a); }
          a.gs.push(g);
        }
        const editable = !!persById.get(pick.pid)?.editable;
        const choose = (value: string) => {
          const pid = pick.pid, iso = pick.iso;
          if (editable) change(pid, iso, pick.eq, value);
          setPick(null);
          // Formation : ouvrir la pendule pour saisir le sujet (commentaire) / les horaires.
          if (editable && isFormation(value)) openExc(pid, iso);
        };
        const curClosed = isPoste(cur) && !oset.has(posteLigne[cur] ?? "");
        const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        // Le panneau s'ancre sur la case, mais il doit tenir EN ENTIER dans la
        // fenetre. Sans filtre atelier il est large (tous les ateliers cote a
        // cote) : ancre sur une case du milieu, il n'avait qu'une demi-fenetre et
        // debordait. On mesure la place de chaque cote et, si aucun n'est assez
        // large, on l'etale sur toute la fenetre plutot que de le rogner.
        const MARGE = 8;
        const LARGE = 720; // largeur en dessous de laquelle le panneau est a l'etroit
        const dispoDroite = vw - pick.left - MARGE;
        const dispoGauche = pick.right - MARGE;
        const hstyle: React.CSSProperties =
          dispoDroite >= LARGE
            ? { left: Math.max(MARGE, pick.left), maxWidth: dispoDroite }
            : dispoGauche >= LARGE
            ? { right: Math.max(MARGE, vw - pick.right), maxWidth: dispoGauche }
            : { left: MARGE, right: MARGE };

        const spaceBelow = vh - pick.bottom;
        // Ouvre vers le haut si peu de place dessous (case en bas de l'ecran).
        const openUp = spaceBelow < 280 && pick.top > spaceBelow;
        // Hauteur bornee a la place disponible + defilement interne : un panneau
        // plus haut que la fenetre etait tronque, sans moyen d'atteindre le bas.
        const vstyle: React.CSSProperties = openUp
          ? { bottom: vh - pick.top + 2, maxHeight: pick.top - 2 - MARGE, overflowY: "auto" }
          : { top: pick.bottom + 2, maxHeight: spaceBelow - 2 - MARGE, overflowY: "auto" };
        return (
          <div
            className="cellpick"
            style={{ ...hstyle, ...vstyle }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="cellpick-head">
              {totalPostes > 0 && totalOK > 0 && (
                <button
                  type="button"
                  className="cellpick-filter"
                  onClick={togglePostes}
                  title={
                    effShowAll
                      ? "Masquer les postes hors compétence"
                      : "Afficher aussi les postes hors compétence (pour un forçage)"
                  }
                >
                  {effShowAll ? `Voir compétents (${totalOK})` : `Voir tous (${totalPostes})`}
                </button>
              )}
              {forceAll && (
                <span className="cellpick-forced" title="Aucun poste compétent pour cette personne sur les lignes ouvertes ce jour">
                  ⚠ Aucun poste compétent — tous affichés
                </span>
              )}
              <button type="button" className="cellpick-clear" onClick={() => choose("")}>✕ Effacer</button>
            </div>
            <div className="cellpick-body">
              {curClosed && (
                <div className="cellpick-at-block">
                  <div className="cellpick-at">Actuel</div>
                  <span className="pick-chips"><button type="button" className="pick-chip on" onClick={() => setPick(null)}>{posteLabel[cur] ?? posteLabelAll[cur] ?? "?"}</button></span>
                </div>
              )}
              {ats.map((a) => {
                // Ateliers longs (ex. CONDI, ~13 lignes) répartis sur plusieurs colonnes
                // (jusqu'à 3) pour éviter un panneau trop haut / un ascenseur.
                const cols = Math.min(3, Math.max(1, Math.ceil(a.gs.length / 6)));
                return (
                  <div key={a.nom || "—"} className="cellpick-at-block" style={cols > 1 ? { width: cols * 150 + (cols - 1) * 14 } : undefined}>
                    {a.nom && <div className="cellpick-at">{a.nom}</div>}
                    <div className="cellpick-at-lignes" style={{ columnCount: cols }}>
                      {a.gs.map((g) => (
                        <div key={g.ligneId} className="cellpick-ligne">
                          <span className="cellpick-lg" title={g.ligneNom}>{g.ligneNom}</span>
                          <span className="pick-chips">
                            {g.postes.map((po) => {
                              const cs = compState(pick.pid, po.id);
                              const niv = matrice[`${pick.pid}:${po.id}`] ?? 0;
                              return (
                                <button
                                  key={po.id}
                                  type="button"
                                  className={`pick-chip comp-${cs}${cur === po.id ? " on" : ""}`}
                                  title={`${po.nom} — ${cs === "ok" ? "Compétent" : cs === "restrict" ? "Restriction !" : "Compétence insuffisante"} · niv. ${niv} / min ${po.niveauMin}`}
                                  onClick={() => choose(po.id)}
                                >
                                  {po.nom}
                                </button>
                              );
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {og.length === 0 && <div className="muted" style={{ padding: "2px 0" }}>Aucune ligne ouverte ce jour.</div>}
              {motifs.length > 0 && (
                <div className="cellpick-abs">
                  <div className="cellpick-at">Absences</div>
                  <span className="pick-chips">
                    {motifs.map((mo) => {
                      const on = cur === `m:${mo.id}`;
                      return (
                        <button
                          key={mo.id}
                          type="button"
                          className={`pick-chip${on ? " on" : ""}`}
                          style={{ borderColor: mo.couleur, background: on ? mo.couleur : undefined, color: on ? "#fff" : undefined }}
                          onClick={() => choose(`m:${mo.id}`)}
                        >
                          {mo.code}
                        </button>
                      );
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
