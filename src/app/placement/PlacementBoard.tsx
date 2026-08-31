"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { isoDate, addDays } from "@/lib/week";
import { habValable, habManqueTxt } from "@/lib/habilitations";
import { parseNumeros } from "@/lib/numeros-rotation";
import { styleInterim, estInterim } from "@/lib/interim";
import SlideSwitch from "@/components/SlideSwitch";
import { PrintIcon } from "@/components/icons";
import s from "./placement.module.css";

type Atelier = { id: string; nom: string };
type Equipe = { id: string; nom: string; couleur: string | null };
type Quart = { code: string; libelle: string };
type Poste = { id: string; nom: string; nomCourt: string | null; effectifRequis: number; niveauMin: number; numeroRotation: string | null };
type Group = { ligneId: string; ligneNom: string; postes: Poste[] };
type Personne = { id: string; nom: string; prenom: string; equipe_id: string | null; atelier_id: string | null; type_contrat: string; couleur: string | null; editable: boolean };
type Motif = { id: string; code: string; libelle: string; couleur: string };

// Pseudo-atelier de la vue Absences (valeur du parametre ?atelier=).
const VUE_ABSENCES = "absences";

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Affichage compact : NOM P.
const label = (p: { nom: string; prenom: string }) => (p.prenom ? `${p.nom} ${p.prenom.charAt(0).toUpperCase()}.` : p.nom);
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const jourLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${JOURS[(dt.getDay() + 6) % 7]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
};

export default function PlacementBoard({
  title,
  jour,
  quart,
  atelierId,
  ateliers,
  equipes,
  quarts,
  quartLib,
  groups,
  personnes,
  placeInit,
  autreQuart: autreQuartInit,
  matrice,
  motifs,
  equipesParQuart = {},
  habPoste = {},
  habComp = {},
  habPers = {},
  vueAbsences = false,
  numeroInit = {},
  quartOuvert = true,
  siteNom = "",
  tpIds = [],
}: {
  title?: ReactNode;
  jour: string;
  quart: string;
  atelierId: string;
  ateliers: Atelier[];
  equipes: Equipe[];
  quarts: Quart[];
  quartLib: Record<string, string>;
  groups: Group[];
  personnes: Personne[];
  placeInit: Record<string, string>;
  autreQuart: Record<string, string>;
  matrice: Record<string, number>;
  motifs: Motif[];
  // Équipes travaillant chaque quart ce jour-là (quart fixe + rotation datée).
  equipesParQuart?: Record<string, string[]>;
  habPoste?: Record<string, string[]>; // poste -> habilitations exigees
  habComp?: Record<string, string>; // habilitation -> nom
  habPers?: Record<string, string>; // `${personne}:${habilitation}` -> echeance ("" = sans echeance)
  vueAbsences?: boolean; // pseudo-atelier « Absences » : photo transverse, pas de plan
  numeroInit?: Record<string, string>; // personne -> numero de rotation occupe
  quartOuvert?: boolean; // le quart est-il ouvert ce jour-la (Ordonnancement) ?
  siteNom?: string; // multi-tenant : nom d'usine dans le pied de page du PDF
  tpIds?: string[]; // personnes en temps partiel (indisponibles) ce jour-la
}) {
  const router = useRouter();
  const [place, setPlace] = useState<Record<string, string>>(placeInit);
  // Numero de rotation occupe par chaque personne (cle absente = poste sans numero).
  const [numero, setNumero] = useState<Record<string, string>>(numeroInit);
  const [autreQuart, setAutreQuart] = useState<Record<string, string>>(autreQuartInit);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Pre-filtre des noms. Deux formes de valeur :
  //   ""            -> tout le monde
  //   "q:<code>"    -> les equipes qui travaillent ce quart ce jour (fixe + rotation)
  //   "<equipe_id>" -> une equipe precise
  // Par defaut : le quart affiche, donc « Fixe matin + A » plutot qu'une seule
  // des deux equipes comme auparavant.
  const [fEquipe, setFEquipe] = useState(`q:${quart}`);
  // Pre-filtre atelier : celui du plan affiche (elargissable pour aller chercher un renfort).
  const [fAtelier, setFAtelier] = useState(atelierId);
  const [hidePlaced, setHidePlaced] = useState(true);
  // Filtre visuel : quand une personne est active (glissee/selectionnee),
  // n'afficher que les postes ou elle est competente (niveau >= min, hors
  // restriction). On garde toujours visibles les postes deja occupes pour
  // permettre de deposer/retirer sans changer de mode. Persistance en
  // localStorage, comme la bascule equivalente du Planning.
  const [hideIncomp, setHideIncomp] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("placement.hideIncomp") === "1") setHideIncomp(true);
  }, []);
  const toggleHideIncomp = (v: boolean) => {
    setHideIncomp(v);
    if (typeof window !== "undefined") window.localStorage.setItem("placement.hideIncomp", v ? "1" : "0");
  };
  const [copying, setCopying] = useState(false);
  // Modale de copie : jour source -> jour destination (meme quart).
  const [showCopy, setShowCopy] = useState(false);
  const [copySrc, setCopySrc] = useState("");
  const [copyDst, setCopyDst] = useState("");
  const [drag, setDrag] = useState<string | null>(null); // personne en cours de glissement
  const [sel, setSel] = useState<string | null>(null); // mode clic : personne selectionnee
  const [over, setOver] = useState<string | null>(null); // cible de depot survolee
  // Demande de forcage en attente : habilitation manquante sur le poste vise.
  const [ask, setAsk] = useState<{ persId: string; posteId: string; manque: string[]; numero: string | null } | null>(null);

  const printRef = useRef<HTMLDivElement>(null);
  // La feuille n'est montee QU'AU moment d'imprimer : la garder en permanence
  // doublerait le cout de rendu du plan, deja l'ecran le plus lourd.
  const [prepImpression, setPrepImpression] = useState(false);

  const persById = useMemo(() => new Map(personnes.map((p) => [p.id, p])), [personnes]);
  const posteNom = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const po of g.postes) m.set(po.id, po.nom);
    return m;
  }, [groups]);
  const motifById = useMemo(() => new Map(motifs.map((mo) => [mo.id, mo])), [motifs]);

  // `vue` porte la bascule Plan / Absences : l'atelier reste selectionne dans les
  // deux cas, c'est lui qui filtre les absences affichees.
  const go = (patch: Partial<{ atelier: string; date: string; quart: string; vue: string }>) => {
    const params = new URLSearchParams({
      atelier: patch.atelier ?? atelierId,
      date: patch.date ?? jour,
      quart: patch.quart ?? quart,
    });
    const vue = patch.vue !== undefined ? patch.vue : vueAbsences ? VUE_ABSENCES : "";
    if (vue) params.set("vue", vue);
    router.push(`/placement?${params.toString()}`);
  };

  // Personne "active" (glissee ou selectionnee) -> aide a la competence sur les postes.
  const active = drag ?? sel;
  const niveau = (persId: string, posteId: string) => matrice[`${persId}:${posteId}`] ?? 0;
  const compState = (persId: string, po: Poste): "ok" | "restrict" | "low" => {
    const n = niveau(persId, po.id);
    if (n === -1) return "restrict";
    return n >= po.niveauMin ? "ok" : "low";
  };

  const occupants = (posteId: string) => personnes.filter((p) => place[p.id] === posteId);
  // Occupants d'un numero precis / du poste hors numero.
  const occupantsNum = (posteId: string, num: string) => occupants(posteId).filter((p) => numero[p.id] === num);
  const occupantsSansNum = (posteId: string) => occupants(posteId).filter((p) => !numero[p.id]);

  // Numeros du poste (« 12, 15-17 » -> 4 cases). Memorise : parse a chaque cellule
  // serait du gaspillage sur un plan de 80 postes.
  const numerosParPoste = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of groups) for (const po of g.postes) m.set(po.id, parseNumeros(po.numeroRotation));
    return m;
  }, [groups]);
  const numerosDe = (po: Poste) => numerosParPoste.get(po.id) ?? [];
  // Places de l'effectif non couvertes par un numero (0 si le poste est assez numerote).
  const placesSansNum = (po: Poste) => Math.max(0, po.effectifRequis - numerosDe(po).length);

  // Pastille d'une personne posee sur un poste. Deux alertes cumulables :
  //   • competence insuffisante (niveau < minimum du poste, restriction incluse)
  //     -> fond rouge ;
  //   • habilitation manquante ou perimee -> fond rouge ET encadre rouge, pour
  //     rester distinguable du simple manque de niveau.
  const chip = (p: Personne, po: Poste) => {
    const mq = habManque(p.id, po.id);
    const cs = compState(p.id, po);
    const sousNiveau = cs !== "ok";
    const alerte = mq.length > 0 || sousNiveau;
    const raisons = [
      cs === "restrict" ? "restriction sur ce poste" : cs === "low" ? `niveau ${niveau(p.id, po.id)} < ${po.niveauMin} requis` : "",
      mq.length ? `manque : ${mq.join(", ")}` : "",
    ].filter(Boolean);
    return (
      <span
        key={p.id}
        className={`${s.chip} ${alerte ? s.alerte : ""} ${mq.length ? s.forced : ""}`}
        draggable={p.editable}
        onDragStart={onDragStartName(p.id)}
        onDragEnd={() => setDrag(null)}
        onClick={(e) => { e.stopPropagation(); clickName(p.id); }}
        style={{ borderColor: mq.length ? "#dc2626" : alerte ? "#fca5a5" : p.couleur ?? "#cbd5e1", outline: sel === p.id ? "2px solid #4f46e5" : undefined }}
        title={raisons.length ? `${p.nom} ${p.prenom}\n⚠ ${raisons.join("\n⚠ ")}` : `${p.nom} ${p.prenom}`}
      >
        <span className={s.dot} style={{ background: p.couleur ?? "#e5e7eb" }} />
        <span style={{ ...styleInterim(p.type_contrat), padding: estInterim(p.type_contrat) ? "0 3px" : 0 }}>{label(p)}</span>
      </span>
    );
  };

  // Habilitations exigees par le poste que la personne n'a pas (ou plus). Recalcule
  // a chaque rendu : un placement force redevient normal des la regularisation.
  const habManque = (persId: string, posteId: string): string[] =>
    (habPoste[posteId] ?? [])
      .filter((cid) => !habValable(habDetenue(persId, cid)))
      .map((cid) => habManqueTxt(habComp[cid] ?? "habilitation", habDetenue(persId, cid)));
  function habDetenue(persId: string, compId: string) {
    const e = habPers[`${persId}:${compId}`];
    return e === undefined ? null : { expiration: e === "" ? null : e };
  }

  async function post(persId: string, value: string, forcer = false, num: string | null = null) {
    const p = persById.get(persId);
    const res = await fetch("/api/placement/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personne_id: persId, jour, equipe_id: p?.equipe_id ?? null, value, quart, forcer, numero: num }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? "Échec de l'enregistrement.");
    }
  }

  const flash = (m: string) => {
    setMsg(m);
    setSaving("error");
    setTimeout(() => {
      setMsg(null);
      setSaving("idle");
    }, 3000);
  };

  async function assign(persId: string, value: string, forcer = false, num: string | null = null) {
    const p = persById.get(persId);
    if (!p?.editable) {
      flash("Vous ne pouvez pas modifier cette personne (hors de votre équipe).");
      return;
    }
    const isPoste = value !== "" && value !== "X" && !value.startsWith("m:");
    // Habilitation manquante : on demande confirmation avant d'ecrire quoi que ce soit.
    if (isPoste && !forcer) {
      const manque = habManque(persId, value);
      if (manque.length) {
        setAsk({ persId, posteId: value, manque, numero: num });
        return;
      }
    }
    const prev = place[persId] ?? "";
    const prevNum = numero[persId];
    const prevAutre = autreQuart[persId];
    setPlace((s2) => ({ ...s2, [persId]: value }));
    setNumero((n) => {
      const c = { ...n };
      if (isPoste && num) c[persId] = num;
      else delete c[persId];
      return c;
    });
    setSaving("saving");
    setMsg(null);
    try {
      // Deja sur un autre quart : on la libere d'abord avant de la poser sur ce quart.
      if (prevAutre && isPoste) await post(persId, "");
      await post(persId, value, forcer, num);
      setAutreQuart((a) => {
        const n2 = { ...a };
        delete n2[persId];
        return n2;
      });
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 1000);
    } catch (e) {
      setPlace((s2) => ({ ...s2, [persId]: prev })); // rollback
      setNumero((n) => {
        const c = { ...n };
        if (prevNum) c[persId] = prevNum;
        else delete c[persId];
        return c;
      });
      setSaving("error");
      setMsg(e instanceof Error ? e.message : "Échec.");
      setTimeout(() => {
        setSaving("idle");
        setMsg(null);
      }, 3500);
    }
  }

  // Copier les affectations poste d'un jour vers un autre (meme quart). La destination
  // n'est pas forcement le jour affiche : dans ce cas on y navigue pour montrer le resultat.
  // Impression : la feuille doit tenir sur UNE page A4 paysage (1123 x 794 px a
  // 96 dpi, moins les marges de 8 mm du @page). Aucune regle CSS ne sait « faire
  // rentrer » un contenu : on mesure, puis on met a l'echelle.
  //
  // `transform: scale()` et non `zoom` : zoom refait la mise en page, si bien que
  // la hauteur ne diminue pas proportionnellement — mesure faite, un plan de
  // 96 postes reduit a 53 % occupait encore 802 px de haut, soit toujours deux
  // pages. Une transformation, elle, reduit exactement ce qu'on a mesure.
  //
  // On essaie plusieurs largeurs de feuille : une feuille plus large range les
  // postes sur moins de rangees et autorise une echelle plus grande (sur un plan
  // de 96 postes, 1600 px a 66 % au lieu de 1060 px a 53 %) ; une feuille plus
  // etroite qu'une page permet a l'inverse d'AGRANDIR un petit plan pour qu'il
  // remplisse la feuille au lieu de se tasser dans le coin superieur gauche.
  const LARGEURS_ESSAI = [700, 820, 940, 1060, 1300, 1600, 1900, 2200];
  const PAGE_L = 1060;
  const PAGE_H = 730;
  // Borne haute de l'agrandissement : au-dela, un plan de deux lignes donne des
  // pavés demesurés pour rien.
  const ECHELLE_MAX = 1.6;

  function ajusterFeuille() {
    const el = printRef.current;
    if (!el) return;
    el.style.transform = "none";
    let meilleur = { f: 0, w: PAGE_L };
    for (const w of LARGEURS_ESSAI) {
      el.style.width = `${w}px`;
      const f = Math.min(ECHELLE_MAX, PAGE_L / w, PAGE_H / el.scrollHeight);
      if (f > meilleur.f) meilleur = { f, w };
    }
    el.style.width = `${meilleur.w}px`;
    el.style.transform = `scale(${meilleur.f})`;
  }

  // La feuille doit etre montee (donc mesurable) avant d'ouvrir la boite d'impression.
  useEffect(() => {
    if (!prepImpression) return;
    ajusterFeuille();
    window.print();
    setPrepImpression(false);
  });

  const imprimer = () => setPrepImpression(true);

  const copyImpossible = copying || !copySrc || !copyDst || copySrc === copyDst;

  async function copyDates(src: string, dst: string, mode: "ecraser" | "completer") {
    if (!src || !dst || src === dst) {
      flash("Choisissez deux dates différentes.");
      return;
    }
    setCopying(true);
    setSaving("saving");
    setMsg(null);
    try {
      const res = await fetch("/api/placement/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src, cible: dst, quart, mode }),
      });
      const j = (await res.json().catch(() => ({}))) as { rows?: { personne_id: string; poste_id: string }[]; copied?: number; ignores?: number; error?: string };
      if (!res.ok) throw new Error(j.error ?? "Échec de la copie.");
      setShowCopy(false);
      if (dst !== jour) {
        go({ date: dst });
        return;
      }
      setPlace((p) => {
        const n = { ...p };
        for (const r of j.rows ?? []) n[r.personne_id] = r.poste_id;
        return n;
      });
      setAutreQuart((a) => {
        const n = { ...a };
        for (const r of j.rows ?? []) delete n[r.personne_id];
        return n;
      });
      setSaving("saved");
      setMsg(`${j.copied ?? 0} affectation(s) copiée(s).${mode === "completer" && j.ignores ? ` ${j.ignores} déjà saisie(s) conservée(s).` : ""}`);
      setTimeout(() => {
        setSaving("idle");
        setMsg(null);
      }, 2500);
    } catch (e) {
      setSaving("error");
      setMsg(e instanceof Error ? e.message : "Échec.");
      setTimeout(() => {
        setSaving("idle");
        setMsg(null);
      }, 3000);
    } finally {
      setCopying(false);
    }
  }

  // Couverture : positions pourvues / requises (un poste en surnombre ne compte pas double).
  const coverage = useMemo(() => {
    let req = 0;
    let cov = 0;
    for (const g of groups)
      for (const po of g.postes) {
        req += po.effectifRequis;
        const n = personnes.filter((p) => place[p.id] === po.id).length;
        cov += Math.min(n, po.effectifRequis);
      }
    return { req, cov };
  }, [groups, personnes, place]);

  // Clic (secours tactile / accessibilite) : selectionner un nom puis cliquer une cible.
  function clickName(persId: string) {
    const p = persById.get(persId);
    if (!p?.editable) return;
    setSel((c) => (c === persId ? null : persId));
  }
  function clickTarget(value: string, num: string | null = null) {
    if (!sel) return;
    assign(sel, value, false, num);
    setSel(null);
  }

  // --- Drag & drop natif ---
  const onDragStartName = (persId: string) => (e: React.DragEvent) => {
    const p = persById.get(persId);
    if (!p?.editable) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", persId);
    e.dataTransfer.effectAllowed = "move";
    setDrag(persId);
  };
  const onDrop = (value: string, num: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // une case numerotee est imbriquee dans la tuile du poste
    const persId = e.dataTransfer.getData("text/plain") || drag;
    setOver(null);
    setDrag(null);
    if (persId) assign(persId, value, false, num);
  };
  const overProps = (key: string, value: string, num: string | null = null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: onDrop(value, num),
  });

  const isAbsent = (persId: string) => {
    const v = place[persId];
    return v === "X" || (!!v && v.startsWith("m:"));
  };
  // Une personne SANS ÉQUIPE est toujours retenue : intérimaires, renforts et
  // nouveaux arrivants n'ont pas de rattachement, et les filtrer par équipe les
  // faisait disparaître de l'écran alors qu'ils sont précisément ceux qu'on
  // cherche à placer.
  const equipeOk = (p: Personne) => {
    if (!p.equipe_id) return true;
    if (!fEquipe) return true;
    if (fEquipe.startsWith("q:")) return (equipesParQuart[fEquipe.slice(2)] ?? []).includes(p.equipe_id);
    return p.equipe_id === fEquipe;
  };

  // Même règle que la liste : le filtre équipe est court-circuité pour les
  // sans-équipe (equipeOk le fait), mais le filtre atelier porte sur le
  // rattachement RÉEL (atelier_id). Ainsi un intérimaire rattaché à aucun
  // atelier reste visible partout, mais un sans-équipe affecté à un AUTRE
  // atelier ne pollue plus la vue de l'atelier courant.
  const inScope = (p: Personne) =>
    equipeOk(p) && (!p.atelier_id || !fAtelier || p.atelier_id === fAtelier);

  // Liste des noms filtree + regroupee : a placer -> absents -> sur poste -> autre quart.
  // Une recherche cherche dans TOUT l'effectif : les pre-filtres equipe/atelier ne sont
  // qu'un confort de depart, ils ne doivent pas cacher le nom qu'on tape.
  const shown = useMemo(() => {
    const q = norm(search.trim());
    const list = personnes.filter((p) => {
      if (q) {
        if (!norm(`${p.nom} ${p.prenom}`).includes(q)) return false;
      } else {
        if (!equipeOk(p)) return false;
        if (p.atelier_id && fAtelier && p.atelier_id !== fAtelier) return false;
      }
      if (hidePlaced && (place[p.id] || autreQuart[p.id])) return false;
      return true;
    });
    const rank = (p: Personne) => {
      const v = place[p.id];
      if (v && v !== "X" && !v.startsWith("m:")) return 2; // sur poste
      if (v === "X" || v?.startsWith("m:")) return 1; // absent
      if (autreQuart[p.id]) return 3; // autre quart
      return 0; // a placer
    };
    return [...list].sort((a, b) => rank(a) - rank(b) || `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`));
  }, [personnes, search, fEquipe, fAtelier, place, autreQuart, hidePlaced]);

  // Vue Absences : une carte par motif d'absence, plus « Non travaillé ».
  // Restreinte a l'atelier affiche. Les personnes dont l'atelier n'est pas
  // renseigne sont TOUJOURS montrees : une absence ne doit pas disparaitre du
  // point du matin a cause d'une fiche incomplete.
  // Absents de l'atelier pour la FEUILLE IMPRIMEE : calcules quelle que soit la vue
  // a l'ecran (on imprime aussi bien depuis le plan), et motifs vides ecartes pour
  // ne pas gaspiller la colonne.
  const tpSet = useMemo(() => new Set(tpIds), [tpIds]);
  const absPrint = useMemo(() => {
    const tri = (a: Personne, b: Personne) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`);
    const dansAtelier = (p: Personne) => !atelierId || !p.atelier_id || p.atelier_id === atelierId;
    const gensDe = (v: string) => personnes.filter((p) => place[p.id] === v && dansAtelier(p)).sort(tri);
    // Temps partiel : personnes indisponibles ce jour-là NON déjà placées ou
    // marquées absentes (celles-ci figurent déjà dans le plan ou sous leur motif).
    const gensTp = personnes.filter((p) => tpSet.has(p.id) && dansAtelier(p) && !place[p.id]).sort(tri);
    return [
      ...motifs.map((mo) => ({ key: mo.id, titre: mo.libelle, gens: gensDe(`m:${mo.id}`) })),
      { key: "X", titre: "Non travaillé", gens: gensDe("X") },
      { key: "TP", titre: "Temps partiel", gens: gensTp },
    ].filter((c) => c.gens.length > 0);
  }, [motifs, personnes, place, atelierId, tpSet]);

  const absCartes = useMemo(() => {
    if (!vueAbsences) return [];
    const tri = (a: Personne, b: Personne) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`);
    const dansAtelier = (p: Personne) => !atelierId || !p.atelier_id || p.atelier_id === atelierId;
    const gensDe = (v: string) => personnes.filter((p) => place[p.id] === v && dansAtelier(p)).sort(tri);
    const cartes: { key: string; titre: string; couleur: string; gens: Personne[]; drop?: string }[] = motifs.map((mo) => ({
      key: mo.id,
      titre: mo.libelle,
      couleur: mo.couleur,
      drop: `m:${mo.id}`,
      gens: gensDe(`m:${mo.id}`),
    }));
    cartes.push({ key: "X", titre: "Non travaillé", couleur: "#6b7280", drop: "X", gens: gensDe("X") });
    return cartes;
  }, [vueAbsences, motifs, personnes, place, atelierId]);

  const searching = !!search.trim();
  const nbAplacer = personnes.filter((p) => inScope(p) && !place[p.id] && !autreQuart[p.id]).length;
  const nbAbsents = personnes.filter((p) => inScope(p) && isAbsent(p.id)).length;

  const statutOf = (p: Personne): { txt: string; color: string } => {
    const v = place[p.id];
    if (v && v !== "X" && !v.startsWith("m:")) return { txt: `→ ${posteNom.get(v) ?? "poste"}`, color: "#0d9488" };
    if (v?.startsWith("m:")) return { txt: motifById.get(v.slice(2))?.code ?? "absent", color: "#b45309" };
    if (v === "X") return { txt: "Non travaillé", color: "#6b7280" };
    if (autreQuart[p.id]) return { txt: `sur ${quartLib[autreQuart[p.id]] ?? autreQuart[p.id]}`, color: "#9ca3af" };
    return { txt: "à placer", color: "#dc2626" };
  };

  const saveTxt = saving === "saving" ? "Enregistrement…" : saving === "saved" ? "Enregistré ✓" : saving === "error" ? "Échec" : "";
  const saveColor = saving === "error" ? "var(--danger)" : saving === "saved" ? "var(--ok)" : "var(--muted)";

  // Filtre visuel du plan quand une personne est active + case cochee. On garde
  // toujours visibles les postes deja occupes (par n'importe qui) pour ne pas
  // masquer les erreurs d'affectation existantes.
  const groupsAffiches: Group[] =
    active && hideIncomp
      ? groups
          .map((g) => ({
            ...g,
            postes: g.postes.filter(
              (po) => compState(active, po) === "ok" || occupants(po.id).length > 0,
            ),
          }))
          .filter((g) => g.postes.length > 0)
      : groups;
  const filtreVide = active && hideIncomp && groups.length > 0 && groupsAffiches.length === 0;

  return (
    <div className={s.board}>
      {/* Filtres */}
      <div className={s.filters}>
        {title && <div style={{ alignSelf: "center", marginRight: 4 }}>{title}</div>}
        <div className={s.fitem}>
          <span>Atelier</span>
          <div className="segments">
            {ateliers.map((a) => (
              <button key={a.id} type="button" className={atelierId === a.id ? "seg active" : "seg"} onClick={() => go({ atelier: a.id })}>
                {a.nom}
              </button>
            ))}
          </div>
        </div>
        <div className={s.fitem}>
          <span>Quart</span>
          <div className="segments">
            {quarts.map((qq) => (
              <button key={qq.code} type="button" className={quart === qq.code ? "seg active" : "seg"} onClick={() => go({ quart: qq.code })}>
                {qq.libelle}
              </button>
            ))}
          </div>
        </div>
        <div className={s.fitem}>
          <span>Jour</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" className={s.navbtn} onClick={() => go({ date: isoDate(addDays(new Date(jour + "T00:00"), -1)) })}>◀</button>
            <input type="date" value={jour} onChange={(e) => e.target.value && go({ date: e.target.value })} />
            <button type="button" className={s.navbtn} onClick={() => go({ date: isoDate(addDays(new Date(jour + "T00:00"), 1)) })}>▶</button>
          </div>
        </div>
        <div className={s.fitem}>
          <span>Affichage</span>
          <SlideSwitch
            on={vueAbsences}
            onChange={(v) => go({ vue: v ? VUE_ABSENCES : "" })}
            offLabel="Plan"
            onLabel="Absences"
            offColor="#4f46e5"
            onColor="#b45309"
            width={168}
            title={vueAbsences ? "Revenir au plan de l'atelier" : "Voir les absences de cet atelier"}
          />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span title="Positions pourvues / requises sur les postes affichés" style={{ fontSize: 13 }}>
            <strong style={{ color: coverage.cov >= coverage.req ? "var(--ok)" : "#b91c1c" }}>{coverage.cov}/{coverage.req}</strong>
          </span>
          <button
            type="button"
            className={s.navbtn}
            disabled={copying}
            onClick={() => { setCopySrc(isoDate(addDays(new Date(jour + "T00:00"), -1))); setCopyDst(jour); setShowCopy(true); }}
            title="Copier les affectations d'un jour vers un autre (même quart)"
          >
            Copier…
          </button>
          <button
            type="button"
            className={s.navbtn}
            onClick={imprimer}
            title="Imprimer le plan de cet atelier (1 page A4 paysage)"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <PrintIcon size={15} /> PDF
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={hidePlaced} onChange={(e) => setHidePlaced(e.target.checked)} style={{ width: "auto" }} />
            Masquer les placés
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              opacity: active ? 1 : 0.55,
            }}
            title={
              active
                ? "N'afficher que les postes où la personne active est compétente"
                : "Sélectionnez ou glissez une personne pour activer ce filtre"
            }
          >
            <input
              type="checkbox"
              checked={hideIncomp}
              onChange={(e) => toggleHideIncomp(e.target.checked)}
              style={{ width: "auto" }}
            />
            Masquer non-compétents
          </label>
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 90, textAlign: "right", color: saveColor }}>{msg ?? saveTxt}</span>
        </div>
      </div>

      {/* Corps : plan (gauche) + noms (droite) */}
      <div className={s.body}>
        <div className={s.plan}>
          {vueAbsences ? (
            <div className={s.absGrid}>
              {absCartes.map((c) => (
                <div
                  key={c.key}
                  className={`${s.absCard} ${c.drop && over === `abs:${c.key}` ? s.over : ""}`}
                  style={{ borderTopColor: c.couleur }}
                  {...(c.drop ? overProps(`abs:${c.key}`, c.drop) : {})}
                  onClick={c.drop ? () => clickTarget(c.drop!) : undefined}
                >
                  <div className={s.absHead}>
                    <span className={s.absTitre}>
                      <span className={s.dot} style={{ background: c.couleur }} />
                      {c.titre}
                    </span>
                    <span className={s.absNb} style={{ color: c.couleur }}>{c.gens.length}</span>
                  </div>
                  <div className={s.absList}>
                    {c.gens.map((p) => (
                      <div
                        key={p.id}
                        className={`${s.absItem} ${!p.editable ? s.locked : ""} ${sel === p.id ? s.selName : ""}`}
                        draggable={p.editable}
                        onDragStart={onDragStartName(p.id)}
                        onDragEnd={() => setDrag(null)}
                        onClick={(e) => { e.stopPropagation(); clickName(p.id); }}
                        title={`${p.nom} ${p.prenom}`}
                      >
                        <span className={s.dot} style={{ background: p.couleur ?? "#e5e7eb" }} />
                        <span className={s.absNom} style={{ ...styleInterim(p.type_contrat), padding: estInterim(p.type_contrat) ? "0 4px" : 0 }}>{p.nom} {p.prenom}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 12 }}>
              {!quartOuvert ? (
                <>
                  <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
                    Aucune ligne ouverte sur le quart {quartLib[quart] ?? quart} ce jour-là.
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Les lignes s&apos;ouvrent dans <strong>Ordonnancement</strong> : tant que la semaine
                    n&apos;y a pas été initialisée, aucun poste n&apos;est à pourvoir.
                  </p>
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Aucun poste ouvert pour ce quart dans cet atelier (lignes fermées dans
                  l&apos;Ordonnancement, ou postes désactivés sur ce quart).
                </p>
              )}
            </div>
          ) : filtreVide ? (
            <div style={{ padding: 12 }}>
              <p style={{ margin: 0, fontWeight: 600, color: "#b45309" }}>
                ⚠ Aucun poste compétent pour cette personne ici.
              </p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Décochez « Masquer non-compétents » pour forcer un placement hors compétence.
              </p>
            </div>
          ) : (
            groupsAffiches.map((g) => (
              <div key={g.ligneId} className={s.ligne}>
                <div className={s.ligneNom}>{g.ligneNom}</div>
                <div className={s.postes}>
                  {g.postes.map((po) => {
                    const occ = occupants(po.id);
                    const complet = occ.length >= po.effectifRequis && po.effectifRequis > 0;
                    const manque = occ.length < po.effectifRequis;
                    // Sureffectif : plus de monde que l'abaque ne demande (3/2).
                    const surEffectif = po.effectifRequis > 0 && occ.length > po.effectifRequis;
                    const cs = active ? compState(active, po) : null;
                    const isOver = over === `po:${po.id}`;
                    return (
                      <div
                        key={po.id}
                        className={`${s.poste} ${surEffectif ? s.surEffectif : ""} ${cs ? s[cs] : ""} ${isOver ? s.over : ""}`}
                        {...overProps(`po:${po.id}`, po.id)}
                        onClick={() => clickTarget(po.id)}
                        title={active ? `${cs === "ok" ? "Compétent" : cs === "restrict" ? "Restriction !" : "Compétence insuffisante"} · niv. ${niveau(active, po.id)} / min ${po.niveauMin}` : po.nom}
                      >
                        <div className={s.posteHead}>
                          <span className={s.posteNom}>{po.nom}</span>
                          <span
                            className={s.eff}
                            style={{ color: surEffectif ? "#b45309" : complet ? "var(--ok)" : manque ? "#b91c1c" : "var(--muted)" }}
                            title={surEffectif ? `Sureffectif : ${occ.length} personnes pour ${po.effectifRequis} place(s)` : undefined}
                          >
                            {occ.length}/{po.effectifRequis}
                          </span>
                        </div>
                        {/* Une case par numero de rotation, puis les places restantes
                            de l'effectif, puis le surnombre eventuel. */}
                        <div className={s.slots}>
                          {numerosDe(po).map((n) => (
                            <div
                              key={n}
                              className={`${s.slot} ${over === `po:${po.id}#${n}` ? s.over : ""}`}
                              {...overProps(`po:${po.id}#${n}`, po.id, n)}
                              onClick={(e) => { e.stopPropagation(); clickTarget(po.id, n); }}
                              title={`N° ${n} — ${po.nom}`}
                            >
                              <span className={s.slotNum}>{n}</span>
                              <span className={s.slotBody}>
                                {occupantsNum(po.id, n).map((p) => chip(p, po))}
                                {occupantsNum(po.id, n).length === 0 && <span className={s.emptyHint}>libre</span>}
                              </span>
                            </div>
                          ))}
                          {/* Places sans numero : le reste de l'effectif, ou tout le poste
                              s'il n'est pas numerote. */}
                          {(placesSansNum(po) > 0 || occupantsSansNum(po.id).length > 0) && (
                            <div
                              className={`${s.slot} ${s.slotLibre} ${over === `po:${po.id}` ? s.over : ""}`}
                              {...overProps(`po:${po.id}`, po.id, null)}
                              onClick={(e) => { e.stopPropagation(); clickTarget(po.id, null); }}
                              title={numerosDe(po).length ? `${po.nom} — sans numéro` : po.nom}
                            >
                              {numerosDe(po).length > 0 && <span className={s.slotNum} style={{ opacity: 0.5 }}>—</span>}
                              <span className={s.slotBody}>
                                {occupantsSansNum(po.id).map((p) => chip(p, po))}
                                {occupantsSansNum(po.id).length === 0 && <span className={s.emptyHint}>déposer ici</span>}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Colonne des noms (drop = retirer du poste) */}
        <div className={s.names} {...overProps("names", "")}>
          <div className={s.namesHead}>
            <span className={s.searchWrap}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Rechercher un nom" className={s.search} />
              {search && (
                <button type="button" className={s.searchClear} title="Effacer la recherche" onClick={() => setSearch("")}>
                  ✕
                </button>
              )}
            </span>
            {/* Pendant une recherche les filtres sont ignores : on grise pour le dire. */}
            <div className={s.namesFilters} style={searching ? { opacity: 0.45 } : undefined} title={searching ? "Ignorés pendant une recherche" : undefined}>
              <select
                value={fEquipe}
                onChange={(e) => setFEquipe(e.target.value)}
                title="Les personnes sans équipe restent toujours affichées."
              >
                <option value="">Toutes équipes</option>
                <optgroup label="Par quart (rotation du jour)">
                  {quarts.map((qq) => {
                    const ids = equipesParQuart[qq.code] ?? [];
                    const noms = ids.map((id) => equipes.find((e) => e.id === id)?.nom).filter(Boolean);
                    return (
                      <option key={qq.code} value={`q:${qq.code}`}>
                        {qq.libelle}
                        {noms.length ? ` — ${noms.join(" + ")}` : " — aucune équipe"}
                      </option>
                    );
                  })}
                </optgroup>
                <optgroup label="Une équipe précise">
                  {equipes.map((e) => (
                    <option key={e.id} value={e.id}>{e.nom}</option>
                  ))}
                </optgroup>
              </select>
              <select value={fAtelier} onChange={(e) => setFAtelier(e.target.value)}>
                <option value="">Tous ateliers</option>
                {ateliers.map((a) => (
                  <option key={a.id} value={a.id}>{a.nom}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {searching ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: "#4f46e5" }}>
                  Recherche dans tout l&apos;effectif — {shown.length} résultat{shown.length > 1 ? "s" : ""}
                </span>
              ) : (
                <>
                  <span className={s.aPlacer}>{nbAplacer} à placer</span>
                  {nbAbsents > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>{nbAbsents} absent(s)</span>}
                </>
              )}
            </div>
          </div>
          <div className={s.namesList}>
            {shown.map((p) => {
              const st = statutOf(p);
              const placed = !!place[p.id] || !!autreQuart[p.id];
              return (
                <div
                  key={p.id}
                  className={`${s.nameItem} ${!p.editable ? s.locked : ""} ${placed ? s.placed : ""} ${sel === p.id ? s.selName : ""}`}
                  draggable={p.editable}
                  onDragStart={onDragStartName(p.id)}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => clickName(p.id)}
                >
                  <span className={s.dot} style={{ background: p.couleur ?? "#e5e7eb" }} />
                  <span
                    className={s.nm}
                    title={`${p.nom} ${p.prenom}`}
                    style={{ ...styleInterim(p.type_contrat), padding: estInterim(p.type_contrat) ? "0 4px" : 0 }}
                  >
                    {p.nom} {p.prenom}
                  </span>
                  <span className={s.stat} style={{ color: st.color }}>{st.txt}</span>
                  {p.editable && place[p.id] && (
                    <button
                      type="button"
                      className={s.unassign}
                      title="Désaffecter (retirer du poste / de l'absence)"
                      onClick={(e) => { e.stopPropagation(); assign(p.id, ""); }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p className="muted" style={{ padding: 10 }}>Aucun nom.</p>}
          </div>
        </div>
      </div>

      {/* Bas : absences + non travaille (zones de depot) */}
      <div className={s.bottom}>
        <span className={s.bottomLabel}>Glisser vers :</span>
        {motifs.map((mo) => {
          const isOver = over === `m:${mo.id}`;
          return (
            <button
              key={mo.id}
              type="button"
              className={`${s.motif} ${isOver ? s.over : ""}`}
              style={{ borderColor: mo.couleur }}
              {...overProps(`m:${mo.id}`, `m:${mo.id}`)}
              onClick={() => clickTarget(`m:${mo.id}`)}
              title={mo.libelle}
            >
              <span className={s.dot} style={{ background: mo.couleur }} />
              {mo.code}
            </button>
          );
        })}
        {/* Plus de bouton « Non travaillé » en dur : il doublonnait le motif JNT
            paramétré dans Param. RH. Seuls les motifs de la table sont proposés. */}
        {sel && (
          <span className={s.selHint}>
            {(() => { const p = persById.get(sel); return p ? label(p) : ""; })()} sélectionné — cliquez un poste ou une absence
            <button type="button" className={s.cancelSel} onClick={() => setSel(null)}>annuler</button>
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------
          Feuille imprimable : rendue hors ecran, seule visible a l'impression.
          Montee uniquement pendant l'impression (cf. `prepImpression`), mais bien
          MONTEE : `ajusterFeuille()` doit pouvoir la mesurer avant window.print().
          Plan a gauche, absents du jour a droite ; tous les postes y figurent,
          meme non pourvus.
          ------------------------------------------------------------------ */}
      {prepImpression && (
      <div className={s.printSheet} aria-hidden="true">
      {/* Cadre exterieur = une page exactement ; ce bloc interieur porte le
          contenu et la mise a l'echelle (cf. placement.module.css). */}
      <div className={s.printInner} ref={printRef}>
        <div className={s.printHead}>
          <strong className={s.printTitre}>{ateliers.find((a) => a.id === atelierId)?.nom ?? "Atelier"}</strong>
          <span>{quartLib[quart] ?? quart}</span>
          <span>{jourLabel(jour)}</span>
          <span className={s.printCouv}>
            Couverture {coverage.cov}/{coverage.req}
          </span>
        </div>

        <div className={s.printBody}>
          <div className={s.printPlan}>
            {groups.map((g) => (
              <div key={g.ligneId} className={s.printLigne}>
                <div className={s.printLigneNom}>{g.ligneNom}</div>
                <div className={s.printPostes}>
                  {g.postes.map((po) => {
                    const occ = occupants(po.id);
                    const sur = po.effectifRequis > 0 && occ.length > po.effectifRequis;
                    const trou = occ.length < po.effectifRequis;
                    return (
                      <div key={po.id} className={`${s.printPoste} ${sur ? s.printSur : ""}`}>
                        <div className={s.printPosteHead}>
                          <span className={s.printPosteNom}>{po.nom}</span>
                          <span className={trou ? s.printTrou : sur ? s.printSurNb : s.printOk}>
                            {occ.length}/{po.effectifRequis}
                          </span>
                        </div>
                        {occ.length === 0 ? (
                          <div className={s.printVide}>—</div>
                        ) : (
                          occ.map((p) => {
                            const mq = habManque(p.id, po.id);
                            const cs = compState(p.id, po);
                            return (
                              <div key={p.id} className={`${s.printNom} ${mq.length || cs !== "ok" ? s.printAlerte : ""}`}>
                                {numero[p.id] && <span className={s.printNum}>{numero[p.id]}</span>}
                                {p.nom} {p.prenom.charAt(0).toUpperCase()}.
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {groups.length === 0 && <p className={s.printVide}>Aucune ligne ouverte ce jour-là sur ce quart.</p>}
          </div>

          <div className={s.printAbs}>
            <div className={s.printAbsTitre}>Absents / TP du jour</div>
            {absPrint.map((c) => (
              <div key={c.key} className={s.printAbsBloc}>
                <div className={s.printAbsMotif}>
                  {c.titre} <span className={s.printAbsNb}>({c.gens.length})</span>
                </div>
                {c.gens.map((p) => (
                  <div key={p.id} className={s.printAbsNom}>
                    {p.nom} {p.prenom.charAt(0).toUpperCase()}.
                  </div>
                ))}
              </div>
            ))}
            {absPrint.length === 0 && <div className={s.printVide}>Aucun absent ni TP.</div>}
          </div>
        </div>
      </div>
      {siteNom && (
        // Multi-tenant : le nom d'usine paraît en pied de page pour qu'une
        // feuille imprimée d'un site ne puisse pas être confondue avec celle
        // d'un autre. Positionné en ABSOLU dans .printSheet (le cadre A4),
        // hors de printInner qui est mesuré par ajusterFeuille — sinon un
        // atelier dense (Condi 50 postes) fait déborder le contenu et rogne
        // ce pied.
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 10,
            fontSize: 10,
            color: "#6b7280",
            pointerEvents: "none",
          }}
        >
          {siteNom}
        </div>
      )}
      </div>
      )}

      {/* Copie des affectations d'un jour vers un autre (meme quart) */}
      {showCopy && (
        <div className={s.overlay} onClick={() => setShowCopy(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ margin: 0, width: "100%", maxWidth: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Copier des affectations</h2>
              <button type="button" onClick={() => setShowCopy(false)} title="Fermer" style={{ width: "auto", margin: 0, padding: "2px 10px", fontSize: 16 }}>
                ✕
              </button>
            </div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
              Recopie les affectations sur poste du quart <strong>{quartLib[quart] ?? quart}</strong>.
              Les absences ne sont pas copiées.
            </p>
            <div className="field">
              <span>Jour à copier</span>
              <input type="date" value={copySrc} onChange={(e) => setCopySrc(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 6, margin: "6px 0 10px" }}>
              {([["Veille", -1], ["Semaine passée", -7]] as const).map(([lbl, d]) => (
                <button
                  key={lbl}
                  type="button"
                  className={s.navbtn}
                  style={{ fontSize: 12 }}
                  onClick={() => setCopySrc(isoDate(addDays(new Date(copyDst + "T00:00"), d)))}
                  title={`Choisir ${lbl.toLowerCase()} de la destination`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="field">
              <span>Vers le jour</span>
              <input type="date" value={copyDst} onChange={(e) => setCopyDst(e.target.value)} />
            </div>
            <p style={{ fontSize: 13, margin: "12px 0" }}>
              {copySrc && copyDst && copySrc !== copyDst ? (
                <>
                  <strong>{jourLabel(copySrc)}</strong> → <strong>{jourLabel(copyDst)}</strong>
                </>
              ) : (
                <span className="muted">Choisissez deux dates différentes.</span>
              )}
            </p>
            {/* Deux facons de copier : l'une refait la journee, l'autre ne fait que
                la completer. Chacune son bouton, pour qu'on lise ce qu'on declenche. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                disabled={copyImpossible}
                style={{ width: "100%", margin: 0, padding: "9px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: "pointer", textAlign: "left" }}
                onClick={() => copyDates(copySrc, copyDst, "completer")}
              >
                {copying ? "Copie…" : "Compléter sans rien écraser"}
                <span style={{ display: "block", fontWeight: 500, fontSize: 11.5, opacity: 0.85 }}>
                  Ne touche à aucune personne déjà saisie ce jour-là, poste comme absence.
                </span>
              </button>
              <button
                type="button"
                disabled={copyImpossible}
                style={{ width: "100%", margin: 0, padding: "9px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: "pointer", textAlign: "left", background: "#b45309", border: "1px solid #b45309" }}
                onClick={() => copyDates(copySrc, copyDst, "ecraser")}
              >
                {copying ? "Copie…" : "Écraser toute la journée"}
                <span style={{ display: "block", fontWeight: 500, fontSize: 11.5, opacity: 0.9 }}>
                  Les affectations du jour source remplacent celles déjà en place.
                </span>
              </button>
              <button type="button" className={s.cancelSel} style={{ padding: "7px 16px", fontSize: 13, alignSelf: "flex-end" }} onClick={() => setShowCopy(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Habilitation manquante : confirmer ou renoncer au placement */}
      {ask && (
        <div className={s.overlay} onClick={() => setAsk(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ margin: 0, width: "100%", maxWidth: 440 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#b91c1c" }}>⚠ Habilitation manquante</h2>
            <p style={{ margin: "0 0 6px", fontSize: 14 }}>
              <strong>{(() => { const p = persById.get(ask.persId); return p ? `${p.nom} ${p.prenom}` : ""; })()}</strong>{" "}
              n&apos;est pas habilitée pour le poste <strong>{posteNom.get(ask.posteId) ?? "?"}</strong>.
            </p>
            <p style={{ margin: "0 0 14px", fontSize: 14 }}>
              Manque : <strong style={{ color: "#b91c1c" }}>{ask.manque.join(", ")}</strong>
            </p>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
              Un placement forcé est tracé (auteur et date) et s&apos;affiche en rouge tant que
              l&apos;habilitation n&apos;est pas régularisée.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className={s.cancelSel} style={{ padding: "7px 16px", fontSize: 13 }} onClick={() => setAsk(null)}>
                Non
              </button>
              <button
                type="button"
                style={{ width: "auto", margin: 0, padding: "7px 16px", fontSize: 13, fontWeight: 700, background: "#dc2626", border: "1px solid #dc2626", borderRadius: 8, cursor: "pointer" }}
                onClick={() => {
                  const a = ask;
                  setAsk(null);
                  setSel(null);
                  assign(a.persId, a.posteId, true, a.numero);
                }}
              >
                Oui, je force
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
