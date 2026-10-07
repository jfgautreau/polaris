"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import { habValable } from "@/lib/habilitations";
import { INTERIM_BG } from "@/lib/interim";
import {
  attribuerRangees,
  classerCandidat,
  GROUPES_CANDIDATS,
  type GroupeCandidat,
  type Occupant,
  type Rangee,
} from "@/lib/planning-par-poste";
import s from "./parposte.module.css";

// Vue « Par poste » du Planning (?par=poste) — cahier des charges :
// tasks/planning-par-poste.md. Postes en lignes, une rangée par place à tenir,
// les 3 semaines en colonnes. Mêmes données que la vue Par nom, pivotées ici.
//
// Écritures : UNIQUEMENT /api/placement/cell, avec `proteger` — une absence, un
// NT ou un TP n'est jamais remplacé depuis cette vue (la case de la personne n'y
// est pas visible), et un retrait ne supprime que le placement sur ce poste.

type Jour = { iso: string; nom: string; num: string; firstOfWeek: boolean; closed?: boolean; wi: number; quart: string };
type WeekBlock = { num: number; span: number; year: number; isCurrent: boolean; monday: string };
type PostePP = {
  id: string;
  nom: string;
  court: string;
  categorie: string;
  effectif: number;
  niveauMin: number;
  numeros: string[];
  attente: boolean;
  titulaires: string[];
};
type LignePP = { ligneId: string; ligneNom: string; atelierId: string; atelierNom: string; postes: PostePP[] };
type PersonnePP = { id: string; label: string; court: string; equipe_id: string | null; interim: boolean; editable: boolean };

// ─── Réseau (niveau module : le React Compiler ne traite pas try/catch) ───────
type Refus = { manquantes: string[]; alertes: string[] };
type Resultat = { ok: true } | { ok: false; statut: number; message: string; refus: Refus | null };
async function envoyer(body: Record<string, unknown>): Promise<Resultat> {
  try {
    const res = await fetch("/api/placement/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { error?: string; manquantes?: string[]; alertesRh?: string[] };
    const refus =
      res.status === 428
        ? { manquantes: Array.isArray(j.manquantes) ? j.manquantes : [], alertes: Array.isArray(j.alertesRh) ? j.alertesRh : [] }
        : null;
    const message = typeof j.error === "string" && j.error ? j.error : "Enregistrement refusé.";
    return { ok: false, statut: res.status, message, refus };
  } catch {
    return { ok: false, statut: 0, message: "Connexion impossible : rien n'a été enregistré.", refus: null };
  }
}

const isPoste = (v: string | undefined) => !!v && v !== "X" && v !== "TP" && !v.startsWith("m:");
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cle = (pid: string, iso: string) => `${pid}:${iso}`;

type Choix = { posteId: string; ri: number | "nouvelle"; d: number; numero: string | null; remplace: string | null };
type Menu = { posteId: string; ri: number; d: number; pid: string; x: number; y: number };
type Confirmation = { titre: string; lignes: string[]; bouton: string; alerte: boolean; action: () => void };
type Segment = { d: number; span: number; type: "pers" | "vide" | "fermeOrdo" | "jourFerme" | "blanc"; pid: string | null };

export default function PlanningParPoste({
  days,
  weekBlocks,
  todayIso,
  quart,
  quartLibelle,
  semaine,
  atelier,
  initialSearch,
  lignes,
  personnes,
  equipesQuart,
  vals: valsInitiales,
  numeros: numerosInitiaux,
  otherByCell,
  tpBlocked,
  horsEffectif,
  motifs,
  matrice,
  habPoste,
  habComp,
  habPers,
  openByIso,
  horsPlan,
  nomsPostes,
  postesAttente,
  weekNav,
  actions,
  gauche,
  quartBandeau,
}: {
  days: Jour[];
  weekBlocks: WeekBlock[];
  todayIso: string;
  quart: string;
  quartLibelle: Record<string, string>;
  semaine: string;
  atelier: string;
  initialSearch: string;
  lignes: LignePP[];
  personnes: PersonnePP[];
  /** Équipes de service sur ce quart, par semaine affichée (index `Jour.wi`). */
  equipesQuart: string[][];
  /** `${personne}:${jour}` -> poste (sur ce quart), "X", "TP" ou "m:<motif>". */
  vals: Record<string, string>;
  /** `${personne}:${jour}` -> numéro de rotation de la place occupée. */
  numeros: Record<string, string>;
  otherByCell: Record<string, string>;
  tpBlocked: Record<string, boolean>;
  horsEffectif: Record<string, boolean>;
  motifs: { id: string; code: string }[];
  matrice: Record<string, number>;
  habPoste: Record<string, string[]>;
  habComp: Record<string, string>;
  habPers: Record<string, string>;
  /** Jour -> lignes ouvertes (besoin compté). Une ligne absente un jour ouvert = fermée par l'ordo. */
  openByIso: Record<string, string[]>;
  horsPlan: { pid: string; poste: string; jours: string[] }[];
  /** Nom de tous les postes du site (pour « sur X » quand le poste est hors filtre). */
  nomsPostes: Record<string, string>;
  /** Postes « zone d'attente » de tout le site (0077). */
  postesAttente: string[];
  weekNav?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendu à gauche de la recherche : bascule Par nom / Par poste. */
  gauche?: React.ReactNode;
  quartBandeau?: React.ReactNode;
}) {
  "use memo"; // React Compiler (mode opt-in, cf. next.config.ts)
  const [vals, setVals] = useState(valsInitiales);
  const [nums, setNums] = useState(numerosInitiaux);
  const [ouverts, setOuverts] = useState<string[]>([]);
  const [search, setSearchRaw] = useState(initialSearch);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [filtreCand, setFiltreCand] = useState("");
  const [voirExclus, setVoirExclus] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();

  // Recherche « Repérer » : surligne, ne filtre pas. Portée par l'URL (debounce),
  // comme la vue Par nom, pour survivre à un changement de semaine.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearch = (v: string) => {
    setSearchRaw(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const p = new URLSearchParams(urlParams.toString());
      if (v.trim()) p.set("search", v.trim());
      else p.delete("search");
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 400);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // Menu : fermeture au clic extérieur et à Échap.
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-menu-pp]")) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  // ─── Données dérivées ───────────────────────────────────────────────────────
  const persById = useMemo(() => new Map(personnes.map((p) => [p.id, p])), [personnes]);
  const posteInfo = useMemo(() => {
    const m = new Map<string, { poste: PostePP; ligneId: string }>();
    for (const l of lignes) for (const p of l.postes) m.set(p.id, { poste: p, ligneId: l.ligneId });
    return m;
  }, [lignes]);
  const attenteSet = useMemo(() => new Set(postesAttente), [postesAttente]);
  const motifCode = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of motifs) m[`m:${x.id}`] = x.code;
    return m;
  }, [motifs]);
  const equipesQuartSets = useMemo(() => equipesQuart.map((e) => new Set(e)), [equipesQuart]);
  // Dernier jour affiché de chaque semaine : borne de la flèche » et des retraits.
  const finSemaine = useMemo(() => {
    const f: number[] = [];
    for (let i = 0; i < days.length; i += 1) f[days[i].wi] = i;
    return f;
  }, [days]);

  // Rangées de chaque poste (attribution stable, src/lib/planning-par-poste.ts).
  const rangees = useMemo(() => {
    const occ = new Map<string, Occupant[][]>();
    for (const { poste } of posteInfo.values()) occ.set(poste.id, days.map(() => []));
    for (const pers of personnes)
      for (let d = 0; d < days.length; d += 1) {
        const k = cle(pers.id, days[d].iso);
        const v = vals[k];
        const jour = v ? occ.get(v)?.[d] : undefined;
        if (jour) jour.push({ pid: pers.id, numero: nums[k] ?? null });
      }
    const r = new Map<string, Rangee[]>();
    for (const [pid, o] of occ) {
      const po = posteInfo.get(pid)!.poste;
      r.set(pid, attribuerRangees({ effectif: po.effectif, numeros: po.numeros, attente: po.attente }, o, days.length));
    }
    return r;
  }, [posteInfo, personnes, days, vals, nums]);

  // Services : postes « zone d'attente » repliés en tête, puis les lignes.
  const services = useMemo(() => {
    const out: { atelierId: string; atelierNom: string; attente: PostePP[]; lignes: LignePP[] }[] = [];
    for (const l of lignes) {
      let g = out[out.length - 1];
      if (!g || g.atelierId !== l.atelierId) {
        g = { atelierId: l.atelierId, atelierNom: l.atelierNom, attente: [], lignes: [] };
        out.push(g);
      }
      for (const p of l.postes) if (p.attente) g.attente.push(p);
      const normaux = l.postes.filter((p) => !p.attente);
      if (normaux.length) g.lignes.push({ ...l, postes: normaux });
    }
    return out;
  }, [lignes]);

  const nomPoste = (id: string) => posteInfo.get(id)?.poste.nom ?? nomsPostes[id] ?? "un autre poste";
  const estAttente = (id: string) => attenteSet.has(id);
  const court = (pid: string) => persById.get(pid)?.court ?? "?";
  const jourTxt = (d: number) => `${days[d].nom.slice(0, 3).toLowerCase()} ${days[d].num}`;
  const ligneOuverte = (ligneId: string, d: number) => !days[d].closed && (openByIso[days[d].iso] ?? []).includes(ligneId);

  // Raison pour laquelle une personne ne peut pas être placée ce jour-là, ou null.
  const indispo = (pid: string, d: number): string | null => {
    const k = cle(pid, days[d].iso);
    if (horsEffectif[k]) return "hors effectif";
    const v = vals[k] ?? "";
    if (v === "X") return "non travaillé";
    if (v === "TP") return "temps partiel";
    if (v.startsWith("m:")) return `absent (${motifCode[v] ?? "?"})`;
    if (!v && tpBlocked[k]) return "temps partiel";
    const autre = otherByCell[k];
    if (!v && autre) return `déjà en ${quartLibelle[autre] ?? autre}`;
    return null;
  };
  // Habilitations exigées par le poste que la personne n'a pas (ou plus).
  const habManquantes = (pid: string, posteId: string): string[] =>
    (habPoste[posteId] ?? [])
      .filter((cid) => {
        const e = habPers[`${pid}:${cid}`];
        return !habValable(e === undefined ? null : { expiration: e === "" ? null : e });
      })
      .map((cid) => habComp[cid] ?? "habilitation");

  // ─── Écritures ──────────────────────────────────────────────────────────────
  const appliquerPlace = (pid: string, posteId: string, iso: string, numero: string | null) => {
    const k = cle(pid, iso);
    setVals((v) => ({ ...v, [k]: posteId }));
    setNums((n) => {
      const c = { ...n };
      if (numero) c[k] = numero;
      else delete c[k];
      return c;
    });
  };
  const appliquerRetrait = (pid: string, iso: string) => {
    const k = cle(pid, iso);
    setVals((v) => {
      const c = { ...v };
      delete c[k];
      return c;
    });
    setNums((n) => {
      const c = { ...n };
      delete c[k];
      return c;
    });
  };
  const envoyerRetrait = (pid: string, posteId: string, iso: string) =>
    envoyer({ personne_id: pid, jour: iso, value: "", quart, proteger: true, poste_attendu: posteId });

  async function retirer(pid: string, posteId: string, d: number, annonce: boolean): Promise<boolean> {
    const iso = days[d].iso;
    const r = await envoyerRetrait(pid, posteId, iso);
    if (!r.ok) {
      setToast(r.message);
      return false;
    }
    appliquerRetrait(pid, iso);
    if (annonce) setToast(`${court(pid)} retiré(e) de ${nomPoste(posteId)} le ${jourTxt(d)}.`);
    return true;
  }

  async function placer(op: { pid: string; posteId: string; d: number; numero: string | null; remplace: string | null }, forcer: boolean) {
    const iso = days[op.d].iso;
    setOccupe(true);
    const r = await envoyer({
      personne_id: op.pid,
      jour: iso,
      equipe_id: persById.get(op.pid)?.equipe_id ?? null,
      value: op.posteId,
      quart,
      numero: op.numero,
      proteger: true,
      ...(forcer ? { forcer: true } : {}),
    });
    if (!r.ok) {
      setOccupe(false);
      if (r.refus) {
        const lignesMsg = [
          ...(r.refus.manquantes.length ? [`${court(op.pid)} n'a pas d'habilitation valide : ${r.refus.manquantes.join(", ")}. Le placement forcé sera tracé.`] : []),
          ...r.refus.alertes,
        ];
        setConfirm({
          titre: "Confirmer le placement",
          lignes: lignesMsg,
          bouton: "Placer quand même",
          alerte: true,
          action: () => {
            setConfirm(null);
            void placer(op, true);
          },
        });
      } else setToast(r.message);
      return;
    }
    appliquerPlace(op.pid, op.posteId, iso, op.numero);
    let msg = `${court(op.pid)} placé(e) sur ${nomPoste(op.posteId)} le ${jourTxt(op.d)}.`;
    if (op.remplace) {
      const r2 = await envoyerRetrait(op.remplace, op.posteId, iso);
      if (r2.ok) {
        appliquerRetrait(op.remplace, iso);
        msg += ` ${court(op.remplace)} passe dans les non placés.`;
      } else msg += ` ${court(op.remplace)} n'a pas pu être retiré(e) : ${r2.message}`;
    }
    setOccupe(false);
    setToast(msg);
  }

  // Choix d'un candidat dans le panneau. Déjà sur un autre poste du quart :
  // confirmation (le trou laissé s'affichera), sauf depuis une zone d'attente.
  function choisir(pid: string) {
    if (!choix) return;
    const op = { pid, posteId: choix.posteId, d: choix.d, numero: choix.numero, remplace: choix.remplace };
    setChoix(null);
    const v = vals[cle(pid, days[op.d].iso)];
    if (isPoste(v) && v && !estAttente(v)) {
      setConfirm({
        titre: "Déplacer cette personne ?",
        lignes: [
          `${court(pid)} est sur ${nomPoste(v)} le ${jourTxt(op.d)}.`,
          `Elle en sera retirée pour être placée sur ${nomPoste(op.posteId)} ; sa place sur ${nomPoste(v)} deviendra « à pourvoir ».`,
        ],
        bouton: "Déplacer",
        alerte: false,
        action: () => {
          setConfirm(null);
          void placer(op, false);
        },
      });
      return;
    }
    void placer(op, false);
  }

  // » : prolonge jusqu'à la fin de la semaine, jour par jour. Ne force JAMAIS :
  // un jour impossible est sauté et figure dans le compte rendu.
  async function prolonger(pid: string, posteId: string, ri: number, dFin: number) {
    const info = posteInfo.get(posteId);
    const rg = rangees.get(posteId) ?? [];
    if (!info) return;
    const faits: string[] = [];
    const sautes: string[] = [];
    setOccupe(true);
    for (let d = dFin + 1; d <= finSemaine[days[dFin].wi]; d += 1) {
      const j = jourTxt(d);
      if (days[d].closed) {
        sautes.push(`${j} : jour sans production`);
        continue;
      }
      if (!ligneOuverte(info.ligneId, d)) {
        sautes.push(`${j} : ligne fermée`);
        continue;
      }
      const ind = indispo(pid, d);
      if (ind) {
        sautes.push(`${j} : ${ind}`);
        continue;
      }
      const v = vals[cle(pid, days[d].iso)];
      if (v === posteId) continue;
      if (isPoste(v) && v && !estAttente(v)) {
        sautes.push(`${j} : déjà sur ${nomPoste(v)}`);
        continue;
      }
      if (habManquantes(pid, posteId).length) {
        sautes.push(`${j} : habilitation`);
        continue;
      }
      const place = rg[ri] && !rg[ri].jours[d] ? rg[ri] : rg.find((x) => !x.sur && !x.jours[d]);
      if (!place) {
        sautes.push(`${j} : poste complet`);
        continue;
      }
      const r = await envoyer({
        personne_id: pid,
        jour: days[d].iso,
        equipe_id: persById.get(pid)?.equipe_id ?? null,
        value: posteId,
        quart,
        numero: place.numero,
        proteger: true,
      });
      if (r.ok) {
        appliquerPlace(pid, posteId, days[d].iso, place.numero);
        faits.push(j);
      } else sautes.push(`${j} : ${r.statut === 428 ? "à confirmer (habilitation ou RH)" : r.message}`);
    }
    setOccupe(false);
    const n = faits.length;
    setToast(
      `${court(pid)} : ${n} jour${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} sur ${nomPoste(posteId)}.` +
        (sautes.length ? ` Non placé — ${sautes.join(" · ")}` : ""),
    );
  }

  async function retirerJusquaFin(pid: string, posteId: string, d0: number) {
    setOccupe(true);
    let n = 0;
    let echec = "";
    for (let d = d0; d <= finSemaine[days[d0].wi]; d += 1) {
      if (vals[cle(pid, days[d].iso)] !== posteId) continue;
      const r = await envoyerRetrait(pid, posteId, days[d].iso);
      if (r.ok) {
        appliquerRetrait(pid, days[d].iso);
        n += 1;
      } else echec = r.message;
    }
    setOccupe(false);
    setToast(`${court(pid)} retiré(e) de ${nomPoste(posteId)} sur ${n} jour${n > 1 ? "s" : ""}.${echec ? ` ${echec}` : ""}`);
  }

  // ─── Ouvertures (panneau, menu) ─────────────────────────────────────────────
  function ouvrirChoix(posteId: string, ri: number | "nouvelle", d: number, remplace: string | null) {
    const rg = rangees.get(posteId) ?? [];
    const numero = ri === "nouvelle" ? null : rg[ri]?.numero ?? null;
    setMenu(null);
    setFiltreCand("");
    setVoirExclus(false);
    setChoix({ posteId, ri, d, numero, remplace });
  }
  // Jour visé dans une barre fusionnée : d'après la position du clic.
  function clicBarre(e: React.MouseEvent<HTMLElement>, posteId: string, ri: number, seg: Segment) {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.min(seg.span - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * seg.span)));
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = r.bottom + 230 > window.innerHeight ? r.top - 214 : r.bottom + 4;
    setMenu({ posteId, ri, d: seg.d + k, pid: seg.pid ?? "", x, y });
  }

  // ─── Candidats du panneau ───────────────────────────────────────────────────
  const candidats = (() => {
    if (!choix) return [] as { cle: GroupeCandidat; libelle: string; items: { pid: string; label: string; raison: string; interim: boolean }[] }[];
    const po = posteInfo.get(choix.posteId)?.poste;
    const wi = days[choix.d].wi;
    const items = personnes.map((p) => {
      const v = vals[cle(p.id, days[choix.d].iso)];
      const occupePoste = isPoste(v) && v ? v : null;
      const c = classerCandidat(choix.posteId, {
        editable: p.editable,
        indispo: indispo(p.id, choix.d),
        posteOccupe: occupePoste,
        posteOccupeAttente: !!occupePoste && attenteSet.has(occupePoste),
        posteOccupeNom: occupePoste ? nomPoste(occupePoste) : "",
        niveau: matrice[`${p.id}:${choix.posteId}`] ?? 0,
        niveauMin: po?.niveauMin ?? 0,
        habManquantes: habManquantes(p.id, choix.posteId),
      });
      const duQuart = !!p.equipe_id && (equipesQuartSets[wi]?.has(p.equipe_id) ?? false);
      const raison = c.groupe !== "exclu" && !duQuart ? [c.raison, "autre équipe"].filter(Boolean).join(" · ") : c.raison;
      return { pid: p.id, label: p.label, raison, interim: p.interim, groupe: c.groupe, duQuart };
    });
    const f = norm(filtreCand.trim());
    return GROUPES_CANDIDATS.map((g) => ({
      cle: g.cle,
      libelle: g.libelle,
      items: items
        .filter((x) => x.groupe === g.cle && (!f || norm(x.label).includes(f)))
        .sort((a, b) => Number(b.duQuart) - Number(a.duQuart) || a.label.localeCompare(b.label)),
    }));
  })();

  // ─── Segments d'une rangée (fusion des jours consécutifs) ───────────────────
  const segmentsDe = (rg: Rangee, ligneId: string): Segment[] => {
    const out: Segment[] = [];
    let d = 0;
    while (d < days.length) {
      if (days[d].closed) {
        out.push({ d, span: 1, type: "jourFerme", pid: null });
        d += 1;
        continue;
      }
      const pid = rg.jours[d];
      let e = d;
      if (pid) {
        while (e + 1 < days.length && days[e + 1].wi === days[d].wi && !days[e + 1].closed && rg.jours[e + 1] === pid) e += 1;
        out.push({ d, span: e - d + 1, type: "pers", pid });
      } else if (rg.sur) {
        out.push({ d, span: 1, type: "blanc", pid: null });
      } else if (!ligneOuverte(ligneId, d)) {
        while (e + 1 < days.length && days[e + 1].wi === days[d].wi && !days[e + 1].closed && !rg.jours[e + 1] && !ligneOuverte(ligneId, e + 1)) e += 1;
        out.push({ d, span: e - d + 1, type: "fermeOrdo", pid: null });
      } else {
        out.push({ d, span: 1, type: "vide", pid: null });
      }
      d = e + 1;
    }
    return out;
  };

  const recherche = norm(search.trim());
  const peutEcrire = personnes.some((p) => p.editable);

  // ─── Rendu d'une barre (personne placée) ────────────────────────────────────
  const barre = (po: PostePP, ri: number, rg: Rangee, seg: Segment) => {
    const pid = seg.pid ?? "";
    const pers = persById.get(pid);
    const manque = !po.attente && habManquantes(pid, po.id).length > 0;
    const repere = recherche !== "" && !!pers && norm(pers.label).includes(recherche);
    const fin = seg.d + seg.span - 1;
    const avecFleche = peutEcrire && !!pers?.editable && !po.attente && fin < finSemaine[days[seg.d].wi];
    const classes = [
      s.barre,
      po.titulaires.includes(pid) ? s.titulaire : "",
      rg.sur && !po.attente ? s.surnombre : "",
      po.attente ? s.attente : "",
      manque ? s.habManque : "",
      repere ? s.reperee : "",
      recherche !== "" && !repere ? s.estompee : "",
    ]
      .filter(Boolean)
      .join(" ");
    const titre = `${pers?.label ?? "?"}${po.titulaires.includes(pid) ? " · titulaire" : ""}${manque ? ` · sans ${habManquantes(pid, po.id).join(", ")}` : ""}`;
    return (
      <div
        role="button"
        tabIndex={0}
        className={classes}
        title={titre}
        style={pers?.interim && !po.attente ? { background: INTERIM_BG, color: "#1c1f23" } : undefined}
        onClick={(e) => clicBarre(e, po.id, ri, seg)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setMenu({ posteId: po.id, ri, d: seg.d, pid, x: 200, y: 200 });
        }}
      >
        <span className={s.nom}>{pers?.court ?? "?"}</span>
        {manque && <span className={s.drapeau}>hab.</span>}
        {avecFleche && (
          <button
            type="button"
            className={s.prolonger}
            title={`Prolonger jusqu'à ${days[finSemaine[days[seg.d].wi]].nom.toLowerCase()}`}
            aria-label="Prolonger jusqu'à la fin de la semaine"
            onClick={(e) => {
              e.stopPropagation();
              void prolonger(pid, po.id, ri, fin);
            }}
          >
            »
          </button>
        )}
      </div>
    );
  };

  // Cellules d'une rangée d'un poste ordinaire.
  const cellules = (po: PostePP, ligneId: string, ri: number, rg: Rangee, premiereVide: number[]) =>
    segmentsDe(rg, ligneId).map((seg) => {
      const sep = days[seg.d].firstOfWeek ? ` ${s.sep}` : "";
      if (seg.type === "jourFerme") return <td key={seg.d} className={`${s.jourFermeCase}${sep}`} />;
      if (seg.type === "blanc") return <td key={seg.d} className={`${s.case}${sep}`} />;
      if (seg.type === "pers")
        return (
          <td key={seg.d} colSpan={seg.span} className={`${s.case}${sep}`}>
            {barre(po, ri, rg, seg)}
          </td>
        );
      if (seg.type === "fermeOrdo")
        return (
          <td
            key={seg.d}
            colSpan={seg.span}
            className={`${s.fermeeOrdo}${sep}`}
            title="Ligne fermée par l'ordo ce jour-là : besoin 0, la place reste plaçable"
            onClick={peutEcrire ? () => ouvrirChoix(po.id, ri, seg.d, null) : undefined}
          >
            fermée ordo
          </td>
        );
      const titAbs =
        premiereVide[seg.d] === ri &&
        po.titulaires.some((t) => indispo(t, seg.d) !== null && vals[cle(t, days[seg.d].iso)] !== po.id);
      return (
        <td key={seg.d} className={`${s.case}${sep}`}>
          <button
            type="button"
            className={`${s.barre} ${s.vide}${peutEcrire ? "" : ` ${s.figee}`}`}
            title={titAbs ? "Place à pourvoir : le titulaire est indisponible ce jour-là" : "Place à pourvoir"}
            onClick={peutEcrire ? () => ouvrirChoix(po.id, ri, seg.d, null) : undefined}
          >
            à pourvoir{titAbs && <small>· tit. abs.</small>}
          </button>
        </td>
      );
    });

  const enteteJours = (
    <>
      <tr>
        <th className={`${s.hSemaine} ${s.coin} ${s.poste}`} rowSpan={2}>
          {weekNav}
        </th>
        {weekBlocks.map((w) => (
          <th key={w.monday} colSpan={w.span} className={`${s.hSemaine} ${s.sep}${w.isCurrent ? ` ${s.courante}` : ""}`} style={{ height: 26 }}>
            {w.year} · Semaine {w.num}
            {w.isCurrent && <span className="muted" style={{ fontWeight: 400 }}> (en cours)</span>}
          </th>
        ))}
      </tr>
      <tr>
        {days.map((d) => (
          <th
            key={d.iso}
            className={`${s.hJour}${d.firstOfWeek ? ` ${s.sep}` : ""}${d.closed ? ` ${s.jourFerme}` : d.iso === todayIso ? ` ${s.jourAuj}` : ""}`}
            title={d.closed ? "Jour sans production sur ce quart" : undefined}
          >
            {d.nom.slice(0, 2)} <span className="muted" style={{ fontWeight: 400 }}>{d.num}</span>
          </th>
        ))}
      </tr>
    </>
  );

  // ─── Pied : couverture, à répartir, non placés ──────────────────────────────
  const pied = (() => {
    const couv = days.map(() => ({ places: 0, besoin: 0, attente: 0, nonPlaces: 0 }));
    for (const l of lignes)
      for (const p of l.postes) {
        const rg = rangees.get(p.id) ?? [];
        for (let d = 0; d < days.length; d += 1) {
          const n = rg.filter((r) => r.jours[d]).length;
          if (p.attente) couv[d].attente += n;
          else {
            couv[d].places += n;
            if (!days[d].closed && (openByIso[days[d].iso] ?? []).includes(l.ligneId)) couv[d].besoin += p.effectif;
          }
        }
      }
    for (let d = 0; d < days.length; d += 1) {
      const eqs = equipesQuartSets[days[d].wi];
      couv[d].nonPlaces = personnes.filter(
        (p) => !!p.equipe_id && !!eqs?.has(p.equipe_id) && indispo(p.id, d) === null && !isPoste(vals[cle(p.id, days[d].iso)]),
      ).length;
    }
    return couv;
  })();
  const aAttente = services.some((g) => g.attente.length > 0);

  const lienPlanning = (pid: string) => {
    const p = new URLSearchParams();
    p.set("semaine", semaine);
    p.set("quart", quart);
    if (atelier) p.set("atelier", atelier);
    p.set("search", persById.get(pid)?.label ?? "");
    return `/planning?${p.toString()}`;
  };

  const posteMenu = menu ? posteInfo.get(menu.posteId)?.poste : undefined;
  const persMenu = menu ? persById.get(menu.pid) : undefined;
  const posteChoix = choix ? posteInfo.get(choix.posteId)?.poste : undefined;
  const nbColonnes = days.length + 1;

  return (
    <>
      <div className={s.barreHaut}>
        {gauche && <div className={s.gauche}>{gauche}</div>}
        <input
          className={s.recherche}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Repérer une personne…"
          title="Surligne les places tenues par cette personne"
        />
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {quartBandeau}

      <div className={`card ${s.carte}${occupe ? ` ${s.occupe}` : ""}`} onScroll={() => setMenu(null)}>
        <table className={s.grille}>
          <colgroup>
            <col style={{ width: 210 }} />
            {days.map((d) => (
              <col key={d.iso} />
            ))}
          </colgroup>
          <thead>{enteteJours}</thead>
          <tbody>
            {services.map((g) => (
              <Fragment key={g.atelierId || "sans"}>
                <tr className={s.service}>
                  <td colSpan={nbColonnes}>{g.atelierNom || "Sans service"}</td>
                </tr>
                {g.attente.map((po) => {
                  const rg = rangees.get(po.id) ?? [];
                  const ouvert = ouverts.includes(po.id);
                  const basculer = () => setOuverts((o) => (o.includes(po.id) ? o.filter((x) => x !== po.id) : [...o, po.id]));
                  return (
                    <Fragment key={po.id}>
                      <tr className={ouvert ? undefined : s.finPoste}>
                        <td className={s.poste} rowSpan={ouvert ? rg.length + 1 : 1}>
                          <div className={s.posteNom}>
                            {po.court} <span className={`${s.puce} ${s.puceAttente}`}>zone d&apos;attente</span>
                          </div>
                          <div className={s.posteMeta}>
                            <span>{po.nom}</span>
                            <button type="button" className={s.lienPlier} onClick={basculer}>
                              {ouvert ? "replier" : "déplier"}
                            </button>
                          </div>
                        </td>
                        {days.map((d, i) => {
                          const n = rg.filter((r) => r.jours[i]).length;
                          return (
                            <td key={d.iso} className={`${d.closed ? s.jourFermeCase : s.case}${d.firstOfWeek ? ` ${s.sep}` : ""}`}>
                              {!d.closed && n > 0 && (
                                <button type="button" className={s.compteAttente} onClick={basculer} title={ouvert ? "Replier" : "Voir les personnes à répartir"}>
                                  {n} à répartir
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {ouvert &&
                        rg.map((r, ri) => (
                          <tr key={ri} className={ri === rg.length - 1 ? s.finPoste : undefined}>
                            {segmentsDe(r, "").map((seg) => {
                              const sep = days[seg.d].firstOfWeek ? ` ${s.sep}` : "";
                              if (seg.type === "pers")
                                return (
                                  <td key={seg.d} colSpan={seg.span} className={`${s.case}${sep}`}>
                                    {barre(po, ri, r, seg)}
                                  </td>
                                );
                              return <td key={seg.d} className={`${seg.type === "jourFerme" ? s.jourFermeCase : s.case}${sep}`} />;
                            })}
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
                {g.lignes.map((l) => (
                  <Fragment key={l.ligneId}>
                    <tr className={s.ligne}>
                      <td>
                        {l.ligneNom} <span className={s.besoin}>· besoin {l.postes.reduce((n, p) => n + p.effectif, 0)}</span>
                      </td>
                      <td colSpan={days.length} />
                    </tr>
                    {l.postes.map((po) => {
                      const rg = rangees.get(po.id) ?? [];
                      // Première place requise vide de chaque jour (porte « tit. abs. »).
                      const premiereVide = days.map((_, d) => rg.findIndex((r) => !r.sur && !r.jours[d]));
                      const habs = (habPoste[po.id] ?? []).map((c) => habComp[c] ?? "habilitation");
                      return (
                        <Fragment key={po.id}>
                          {rg.map((r, ri) => (
                            <tr key={ri}>
                              {ri === 0 && (
                                <td className={s.poste} rowSpan={rg.length + 1}>
                                  <div className={s.posteNom} title={po.nom}>
                                    {po.court}
                                  </div>
                                  <div className={s.posteMeta}>
                                    <span>effectif {po.effectif}</span>
                                    {habs.map((h) => (
                                      <span key={h} className={`${s.puce} ${s.puceHab}`}>
                                        {h}
                                      </span>
                                    ))}
                                    {po.titulaires.length > 0 && (
                                      <span title="Titulaire(s) du poste">tit. {po.titulaires.map((t) => court(t)).join(", ")}</span>
                                    )}
                                  </div>
                                </td>
                              )}
                              {cellules(po, l.ligneId, ri, r, premiereVide)}
                            </tr>
                          ))}
                          <tr className={s.ajout}>
                            {rg.length === 0 && (
                              <td className={s.poste}>
                                <div className={s.posteNom}>{po.court}</div>
                              </td>
                            )}
                            {days.map((d, i) => (
                              <td key={d.iso} className={`${d.closed ? s.jourFermeCase : ""}${d.firstOfWeek ? ` ${s.sep}` : ""}`}>
                                {!d.closed && peutEcrire && (
                                  <button type="button" className={s.ajouter} title="Placer une personne en surnombre" onClick={() => ouvrirChoix(po.id, "nouvelle", i, null)}>
                                    + ajouter
                                  </button>
                                )}
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={nbColonnes} className="muted" style={{ padding: 16, textAlign: "center" }}>
                  Aucun poste ne tourne sur ce quart pour ce service.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className={s.pied}>
              <td className={s.poste} style={{ bottom: aAttente ? 64 : 32 }}>Couverture</td>
              {days.map((d, i) => (
                <td key={d.iso} className={d.firstOfWeek ? s.sep : undefined} style={{ bottom: aAttente ? 64 : 32 }}>
                  {d.closed ? (
                    "—"
                  ) : (
                    <span className={`${s.couv} ${pied[i].places >= pied[i].besoin ? s.couvOk : s.couvKo}`}>
                      {pied[i].places}/{pied[i].besoin}
                    </span>
                  )}
                </td>
              ))}
            </tr>
            {aAttente && (
              <tr className={s.pied}>
                <td className={s.poste} style={{ bottom: 32 }}>À répartir</td>
                {days.map((d, i) => (
                  <td key={d.iso} className={d.firstOfWeek ? s.sep : undefined} style={{ bottom: 32 }}>
                    {d.closed ? "—" : pied[i].attente ? <span className={`${s.couv} ${s.couvAttente}`}>{pied[i].attente}</span> : "0"}
                  </td>
                ))}
              </tr>
            )}
            <tr className={s.pied}>
              <td className={s.poste} style={{ bottom: 0 }} title="Personnes des équipes de ce quart, disponibles et sans poste ce jour-là">
                Non placés
              </td>
              {days.map((d, i) => (
                <td key={d.iso} className={d.firstOfWeek ? s.sep : undefined} style={{ bottom: 0 }}>
                  {d.closed ? "—" : pied[i].nonPlaces}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {horsPlan.length > 0 && (
        <div className={`card ${s.horsPlan}`}>
          <strong>
            ⚠ {horsPlan.length} placement{horsPlan.length > 1 ? "s" : ""} hors plan sur ce quart
          </strong>{" "}
          <span className="muted">— poste qui ne tourne pas sur ce quart, désactivé ou fermé : à corriger dans la vue Par nom.</span>
          <ul>
            {horsPlan.map((h) => (
              <li key={`${h.pid}:${h.poste}`}>
                <Link href={lienPlanning(h.pid)} prefetch={false}>
                  {court(h.pid)}
                </Link>{" "}
                — {h.poste} — {h.jours.map((iso) => days.find((d) => d.iso === iso)?.num ?? iso).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {menu && posteMenu && (
        <div className={s.menu} data-menu-pp style={{ left: menu.x, top: menu.y }}>
          <div className={s.menuTitre}>
            <strong>{persMenu?.court ?? "?"}</strong>
            <span>
              {posteMenu.nom} · {jourTxt(menu.d)}
            </span>
          </div>
          {persMenu?.editable && !posteMenu.attente && (
            <button type="button" onClick={() => ouvrirChoix(menu.posteId, menu.ri, menu.d, menu.pid)}>
              Remplacer par…
            </button>
          )}
          {persMenu?.editable && (
            <button
              type="button"
              onClick={() => {
                const m = menu;
                setMenu(null);
                void retirer(m.pid, m.posteId, m.d, true);
              }}
            >
              Retirer ce jour
            </button>
          )}
          {persMenu?.editable && (
            <button
              type="button"
              onClick={() => {
                const m = menu;
                setMenu(null);
                void retirerJusquaFin(m.pid, m.posteId, m.d);
              }}
            >
              Retirer jusqu&apos;à {days[finSemaine[days[menu.d].wi]].nom.toLowerCase()}
            </button>
          )}
          {!persMenu?.editable && (
            <div className="muted" style={{ padding: "6px 12px", fontSize: 12 }}>
              Hors de vos équipes : lecture seule.
            </div>
          )}
          <Link href={lienPlanning(menu.pid)} prefetch={false}>
            Voir au Planning
          </Link>
        </div>
      )}

      {choix && posteChoix && (
        <ModaleDeplacable onClose={() => setChoix(null)} largeur={440}>
          <div className={`${s.panneauTete} mdd-drag`}>
            <strong>
              {posteChoix.nom} · {days[choix.d].nom} {days[choix.d].num}
            </strong>
            <span>
              {quartLibelle[quart] ?? quart} ·{" "}
              {choix.ri === "nouvelle" ? "en surnombre" : choix.numero ? `place n° ${choix.numero}` : `place ${choix.ri + 1}`}
              {choix.remplace ? ` · remplace ${court(choix.remplace)}` : ""}
            </span>
          </div>
          <input
            className={s.filtre}
            autoFocus
            value={filtreCand}
            onChange={(e) => setFiltreCand(e.target.value)}
            placeholder="Filtrer par nom…"
          />
          <div style={{ paddingBottom: 8 }}>
            {candidats.map((g) =>
              g.items.length === 0 ? null : (
                <div key={g.cle}>
                  <div className={s.groupe}>
                    {g.libelle} ({g.items.length})
                    {g.cle === "exclu" && (
                      <button type="button" className={s.lienPlier} style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0 }} onClick={() => setVoirExclus((v) => !v)}>
                        {voirExclus ? "masquer" : "afficher"}
                      </button>
                    )}
                  </div>
                  {(g.cle !== "exclu" || voirExclus) &&
                    g.items.map((c) => (
                      <button key={c.pid} type="button" className={s.candidat} disabled={g.cle === "exclu"} onClick={() => choisir(c.pid)}>
                        <span className={s.pastille} style={{ background: c.interim ? "#d97706" : "#1e3a8a" }} />
                        {c.label}
                        <span
                          className={`${s.raison}${g.cle === "habilitation" || g.cle === "deplacer" ? ` ${s.raisonAlerte}` : g.cle === "attente" ? ` ${s.raisonAttente}` : ""}`}
                        >
                          {c.raison}
                        </span>
                      </button>
                    ))}
                </div>
              ),
            )}
          </div>
        </ModaleDeplacable>
      )}

      {confirm && (
        <ModaleDeplacable onClose={() => setConfirm(null)} largeur={480}>
          <div className={`${s.panneauTete} mdd-drag`}>
            <strong>{confirm.titre}</strong>
          </div>
          <div className={s.confirmer}>
            {confirm.lignes.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
            <div className={s.confirmerActions}>
              <button type="button" className={s.bouton2} onClick={() => setConfirm(null)}>
                Annuler
              </button>
              <button type="button" onClick={confirm.action} style={confirm.alerte ? { background: "#c2410c", borderColor: "#c2410c" } : undefined}>
                {confirm.bouton}
              </button>
            </div>
          </div>
        </ModaleDeplacable>
      )}

      {toast && (
        <div className={s.toast} role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </>
  );
}
