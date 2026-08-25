"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import ConfirmForm from "@/components/ConfirmForm";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import TempsPartielModal from "./TempsPartielModal";
import CycleDeVieModal from "./CycleDeVieModal";
import { anonymiserPersonne, supprimerPersonne } from "./actions";
import BandeauErreur from "@/components/BandeauErreur";
import { normaliseNom, normalisePrenom } from "@/lib/noms";
import AbsencesModal from "./AbsencesModal";
import { AbsenceIcon, InfoIcon, GearIcon } from "@/components/icons";
import { etatDepart } from "@/lib/absences-periodes";
import { statutALaDate, libelleStatut, couleurStatut, type StatutPersonne } from "@/lib/personne-statut";

type HMap = Record<string, { debut: string; fin: string }>;
type TpConfig = { demi?: { mode: string; source: string; matin?: HMap; aprem?: HMap }; off?: Record<string, string[]>; horaires?: HMap };
type Row = {
  id: string;
  matricule: string | null;
  nom: string;
  prenom: string;
  equipe_id: string | null;
  atelier_id: string | null;
  sexe: string | null;
  numero_badge: string | null;
  date_livret_accueil: string | null;
  type_contrat: string;
  date_arrivee: string | null;
  date_debut: string | null;
  date_fin: string | null;
  contrat_debut: string | null;
  hasContrat: boolean;
  pointure: string | null;
  commentaire: string | null;
  statut: string;
  temps_partiel: boolean;
  tp_type: string | null;
  tp_config: TpConfig | null;
  date_depart_prevu: string | null;
  motif_depart: string | null;
  poste_fixe_id: string | null;
};
type Equipe = { id: string; nom: string; couleur?: string | null; quart_fixe?: string | null };
type Atelier = { id: string; nom: string };
type PosteOpt = { id: string; nom: string; atelierNom: string };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };

type TypeContrat = { code: string; libelle: string };
const CONTRATS_FALLBACK: TypeContrat[] = [
  { code: "CDI", libelle: "CDI" },
  { code: "CDD", libelle: "CDD" },
  { code: "INTERIM", libelle: "Intérim" },
];
const sortRows = (a: Row, b: Row) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom);
// Normalisation pour comparer des noms : sans accents/casse/ponctuation.
const normName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthsBetween = (a: string, b: string) => {
  const d1 = new Date(a + "T00:00"), d2 = new Date(b + "T00:00");
  let m = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
  if (d2.getDate() < d1.getDate()) m--;
  return m;
};

const sexeBg = (x: string | null) => (x === "H" ? "#dbeafe" : x === "F" ? "#fce7f3" : undefined);
const sexeFg = (x: string | null) => (x === "H" ? "#1d4ed8" : x === "F" ? "#db2777" : undefined);
function SexePill({ sexe }: { sexe: string | null }) {
  if (sexe === "H") return <span className="sexe-pill h">H</span>;
  if (sexe === "F") return <span className="sexe-pill f">F</span>;
  return <span className="muted">—</span>;
}

type ColKey =
  | "type_contrat" | "matricule" | "numero_badge" | "nom" | "prenom" | "sexe"
  | "equipe" | "atelier" | "date_livret_accueil" | "absences" | "alerte" | "pointure" | "tp" | "statut" | "commentaire";
// ⚠️ Largeurs (%) resserrees pour loger la colonne Commentaire : tout est reduit
// SAUF Nom/Prenom. `table-layout: fixed` normalise les % a la largeur du tableau,
// c'est donc le rapport entre colonnes qui compte. Libelles longs raccourcis pour
// ne pas deborder d'une colonne etroite (en-tetes en `nowrap`).
const COLS: { key: ColKey; label: string; w: number; search?: boolean }[] = [
  { key: "type_contrat", label: "Contrat", w: 5, search: true },
  { key: "matricule", label: "Matr.", w: 5.5, search: true },
  { key: "numero_badge", label: "Badge", w: 5, search: true },
  { key: "nom", label: "Nom", w: 11, search: true },
  { key: "prenom", label: "Prénom", w: 10, search: true },
  { key: "sexe", label: "H/F", w: 3.5, search: true },
  { key: "equipe", label: "Équipe", w: 5, search: true },
  { key: "atelier", label: "Atelier", w: 5, search: true },
  { key: "date_livret_accueil", label: "Livret", w: 6 },
  { key: "absences", label: "Abs.", w: 4.5 },
  { key: "alerte", label: "⚠ 18m", w: 5.5 },
  { key: "pointure", label: "Point.", w: 4, search: true },
  { key: "tp", label: "TP", w: 3.5 },
  { key: "statut", label: "Statut", w: 5.5, search: true },
  { key: "commentaire", label: "Commentaire", w: 15, search: true },
];
// Colonnes dont le contenu est centre (Commentaire reste aligne a gauche).
const CENTER = new Set<ColKey>(["type_contrat", "matricule", "numero_badge", "sexe", "equipe", "atelier", "tp", "pointure", "absences"]);

// Bouton « Absences » de la ligne : ouvre l'historique et la déclaration.
// Le calendrier barré dit « jours non travaillés » ; une pastille signale le
// départ prévu, orange à venir, rouge une fois la date dépassée.
function BoutonAbsences({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const etat = etatDepart(row.date_depart_prevu, new Date().toISOString().slice(0, 10));
  const titre =
    etat === "aucun"
      ? "Absences : historique et déclaration"
      : `Absences — départ prévu le ${fmtDate(row.date_depart_prevu)}${row.motif_depart ? ` (${row.motif_depart})` : ""}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={titre}
      style={{
        width: "auto",
        margin: 0,
        padding: "2px 7px",
        background: "#fff",
        color: etat === "depasse" ? "#b91c1c" : etat === "a_venir" ? "#b45309" : "#4f46e5",
        border: `1px solid ${etat === "depasse" ? "#fca5a5" : etat === "a_venir" ? "#fcd34d" : "var(--border)"}`,
        borderRadius: 7,
        cursor: "pointer",
        fontSize: 15,
        lineHeight: 1.1,
        position: "relative",
      }}
    >
      {/* Calendrier + pastille × : l'absence (icône partagée, variante B). */}
      <AbsenceIcon />
      {etat !== "aucun" && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 8,
            height: 8,
            borderRadius: 999,
            background: etat === "depasse" ? "var(--danger)" : "#f59e0b",
          }}
        />
      )}
    </button>
  );
}

export default function PersonnelEditor({
  initial,
  equipes,
  ateliers,
  postes = [],
  canEdit,
  canRgpd,
  quarts = [],
  rotationRefs = [],
  motifs = [],
  types = CONTRATS_FALLBACK,
  erreur,
}: {
  initial: Row[];
  equipes: Equipe[];
  ateliers: Atelier[];
  postes?: PosteOpt[];
  canEdit: boolean;
  // Droit RGPD (write) : gouverne le bouton roue crantée (export / anonymiser /
  // supprimer), indépendamment de canEdit. Une opération RGPD est bien plus
  // sensible qu'une simple édition de fiche — elle a son propre droit.
  canRgpd: boolean;
  quarts?: { code: string; libelle: string; creneau?: string | null }[];
  rotationRefs?: { semaine: string; equipe_id: string; quart_code: string }[];
  motifs?: Motif[];
  types?: TypeContrat[];
  // Message des server actions RGPD, repasse par l URL (cf. BandeauErreur).
  erreur?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [gq, setGq] = useState("");
  const [dup, setDup] = useState<Row[] | null>(null);
  const [contratFilter, setContratFilter] = useState("");
  const [tpFor, setTpFor] = useState<Row | null>(null);
  // Modale « Cycle de vie » : rassemble Arrivee + Contrats + Depart. Ouverte
  // au clic sur la colonne Contrat OU sur la colonne Statut d'une ligne. Les
  // deux colonnes deviennent des resultantes non editables directement.
  const [cycleFor, setCycleFor] = useState<Row | null>(null);
  const [absFor, setAbsFor] = useState<Row | null>(null);
  const [infoFor, setInfoFor] = useState<Row | null>(null);
  const [rgpdFor, setRgpdFor] = useState<Row | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [merge, setMerge] = useState<{ a: Row; b: Row } | null>(null);
  const [keepId, setKeepId] = useState("");
  const [merging, setMerging] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showCreate, setShowCreate] = useState(false);
  // Defaut ACTIF a l'ouverture : la liste montre l'effectif au travail au lieu
  // de tout melanger. Un clic sur « Tous », « A venir » ou « Parti » reste
  // possible, sans persister d'une visite a l'autre.
  const [statutFilter, setStatutFilter] = useState<"" | "A_VENIR" | "ACTIF" | "PARTI">("ACTIF");
  // Filtre secondaire : ne montrer que les fiches a completer (champs manquants).
  // Utile pour une session de menage RH. Off par defaut.
  const [incompletFilter, setIncompletFilter] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = todayStr();

  // Ligne d'insertion
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [sexe, setSexe] = useState("");
  const [matricule, setMatricule] = useState("");
  const [badge, setBadge] = useState("");
  const [eq, setEq] = useState("");
  const [at, setAt] = useState("");
  // Defaut du menu Contrat de la creation. ⚠️ Ne JAMAIS coder un code de contrat
  // en dur ici : selon le site, le code « Interim » varie (« INTERIM » a Lebignon,
  // « INTÉRIM » accentue a LVC apres duplication des referentiels). Un defaut absent
  // des options laisse le <select> AFFICHER sa 1re option (« CDI ») tout en gardant
  // l'ancienne valeur dans l'etat -> on enregistrait « INTERIM » alors que l'ecran
  // montrait « CDI ». On derive donc un code qui existe reellement dans `types` :
  // Interim s'il est present (intention metier : embauche interim par defaut),
  // sinon le 1er type disponible.
  const normCode = (c: string) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const codeDefautContrat = types.find((t) => normCode(t.code) === "INTERIM")?.code ?? types[0]?.code ?? "";
  const [contrat, setContrat] = useState(codeDefautContrat);
  const [livret, setLivret] = useState("");
  const [pointure, setPointure] = useState("");
  // Date d'arrivee saisie a la creation. Defaut = aujourd'hui, editable pour
  // anticiper une embauche (la personne restera A_VENIR jusqu'au jour J).
  const [dateArrivee, setDateArrivee] = useState(todayStr());

  const equipeNom = (id: string | null) => (id ? equipes.find((e) => e.id === id)?.nom ?? "" : "");
  const atelierNom = (id: string | null) => (id ? ateliers.find((a) => a.id === id)?.nom ?? "" : "");
  const eqStyle = (id: string | null): React.CSSProperties => {
    const c = id ? equipes.find((e) => e.id === id)?.couleur : null;
    return c ? { background: c, color: "#1e293b", fontWeight: 600 } : {};
  };

  // Colonne « 18 mois » : borne legale de l'interim. On affiche la date de fin
  // (livret + 18 mois) pour tous les INTERIMAIRES ACTIFS, teintee selon l'echeance :
  //   - 3-4 mois d'anciennete du livret : jaune (pre-alerte)
  //   - 17-18 mois : orange (imminent)
  //   - > 18 mois  : rouge (deja depasse)
  //   - reste      : date affichee sans code couleur.
  // Sans livret renseigne, la date ne peut pas etre calculee -> rien.
  const jauneBg = "#fef08a"; // yellow-200
  const jauneFg = "#854d0e"; // yellow-900
  const orangeBg = "#fed7aa"; // orange-200
  const orangeFg = "#7c2d12"; // orange-900
  const rougeBg = "#fecaca"; // red-200
  const rougeFg = "#7f1d1d"; // red-900

  type Alerte18 = { dateFin: string; anciennete: number; bg: string; fg: string; titre: string } | null;
  const alerte18 = (r: Row): Alerte18 => {
    if (r.type_contrat !== "INTERIM") return null;
    if (statutALaDate(r, today) !== "ACTIF") return null;
    if (!r.date_livret_accueil) return null;
    const anciennete = monthsBetween(r.date_livret_accueil, today);
    // Date de fin des 18 mois = livret + 18 mois (annee/mois, garde le jour).
    const [y, mo, d] = r.date_livret_accueil.split("-").map(Number);
    const dt = new Date(y, mo - 1 + 18, d);
    const dateFin = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

    let bg = "transparent";
    let fg = "inherit";
    if (anciennete > 18) { bg = rougeBg; fg = rougeFg; }
    else if (anciennete >= 17) { bg = orangeBg; fg = orangeFg; }
    else if (anciennete >= 3 && anciennete < 5) { bg = jauneBg; fg = jauneFg; }

    const titre =
      anciennete > 18 ? `Dépassé de ${anciennete - 18} mois`
      : anciennete >= 17 ? `Échéance dans ${18 - anciennete} mois`
      : anciennete >= 3 && anciennete < 5 ? `Pré-alerte (${anciennete} mois d'ancienneté)`
      : `${anciennete} mois d'ancienneté depuis le livret`;
    return { dateFin, anciennete, bg, fg, titre };
  };

  async function post(op: string, payload: Record<string, unknown>) {
    setSave("saving");
    setSaveMsg(null);
    try {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...payload }),
      });
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      setSave("saved");
      return j as { ok?: boolean; row?: Row };
    } catch (e) {
      setSave("error");
      setSaveMsg(e instanceof Error ? e.message : "Échec.");
      return null;
    } finally {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => { setSave("idle"); setSaveMsg(null); }, 4000);
    }
  }
  function schedule(key: string, fn: () => void, delay: number) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, delay);
  }
  const setRow = (id: string, fn: (r: Row) => Row) => setRows((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  function field(id: string, key: keyof Row, value: string, instant = false) {
    setRow(id, (r) => ({ ...r, [key]: value }));
    schedule(`${id}:${key}`, () => post("update", { id, patch: { [key]: value } }), instant ? 0 : 500);
  }
  // Rafraichissement initial du cache statut : rattrape les bascules
  // automatiques du jour (A_VENIR -> ACTIF a l'arrivee, ACTIF -> PARTI le
  // lendemain du depart). Idempotent, no-op si tout est deja a jour.
  useEffect(() => {
    fetch("/api/personnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "refresh-statuts" }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if ((j as { changes?: number })?.changes) router.refresh();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fusion de doublons : selection de 2 lignes max.
  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < 2) n.add(id); return n; });
  }
  function openMerge() {
    const ids = [...sel];
    const a = rows.find((r) => r.id === ids[0]);
    const b = rows.find((r) => r.id === ids[1]);
    if (a && b) { setMerge({ a, b }); setKeepId(a.id); }
  }
  async function doMerge() {
    if (!merge) return;
    const keep_id = keepId;
    const dup_id = keepId === merge.a.id ? merge.b.id : merge.a.id;
    setMerging(true);
    try {
      const res = await fetch("/api/personnel/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep_id, dup_id }) });
      if (res.ok) { window.location.reload(); return; }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(j.error || "Échec de la fusion.");
    } catch { window.alert("Échec de la fusion."); }
    setMerging(false);
  }

  async function doCreate() {
    setDup(null);
    // La 1re periode de contrat prend la date d'arrivee comme date_debut, pour
    // que l'historique de contrats et la vraie date d'entree partent du meme point.
    const dateDebutContrat = dateArrivee || today;
    const j = await post("create", {
      nom: nom.trim(), prenom: prenom.trim(), sexe, matricule, numero_badge: badge,
      equipe_id: eq, atelier_id: at, type_contrat: contrat,
      date_arrivee: dateArrivee || today,
      date_debut: dateDebutContrat,
      date_livret_accueil: livret, pointure,
    });
    if (j?.row) {
      const created: Row = {
        ...(j.row as Row), atelier_id: at || null, sexe: sexe || null, numero_badge: badge || null,
        date_livret_accueil: livret || null,
        date_arrivee: dateArrivee || today,
        date_debut: dateDebutContrat, contrat_debut: dateDebutContrat,
      };
      setRows((rs) => [...rs, created].sort(sortRows));
      setNom(""); setPrenom(""); setSexe(""); setMatricule(""); setBadge("");
      setEq(""); setAt(""); setContrat(codeDefautContrat); setLivret(""); setPointure(""); setDateArrivee(todayStr());
      setShowCreate(false);
      // Purge du cache RSC : sans ca, une navigation puis un retour sur
      // /personnel repartait des donnees serveur mises en cache et le nouveau
      // profil n'apparaissait qu'apres un F5 explicite.
      router.refresh();
    }
  }

  function add() {
    if (!nom.trim() || !prenom.trim()) return;
    const key = normName(`${nom} ${prenom}`);
    const matches = rows.filter((r) => normName(`${r.nom} ${r.prenom}`) === key);
    if (matches.length) { setDup(matches); return; } // doublon -> on demande confirmation
    doCreate();
  }

  const cellText = (r: Row, key: ColKey): string => {
    switch (key) {
      case "type_contrat": return (r.type_contrat === "INTERIM" ? "intérim interim" : r.type_contrat).toLowerCase();
      case "matricule": return (r.matricule ?? "").toLowerCase();
      case "numero_badge": return (r.numero_badge ?? "").toLowerCase();
      case "nom": return r.nom.toLowerCase();
      case "prenom": return r.prenom.toLowerCase();
      case "sexe": return (r.sexe ?? "").toLowerCase();
      case "equipe": return equipeNom(r.equipe_id).toLowerCase();
      case "atelier": return atelierNom(r.atelier_id).toLowerCase();
      case "pointure": return (r.pointure ?? "").toLowerCase();
      case "commentaire": return (r.commentaire ?? "").toLowerCase();
      case "statut": {
        const s = statutALaDate(r, today);
        return s === "ACTIF" ? "actif" : s === "A_VENIR" ? "a venir" : "parti";
      }
      default: return "";
    }
  };
  const searchCols = COLS.filter((c) => c.search);
  const gTerms = gq.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Fiche incomplete : aucune periode de contrat dans Cycle de vie (derive serveur).
  // ⚠️ DOIT etre declare AVANT `filtered` : le callback de `rows.filter` ci-dessous
  // l'appelle (branche `incompletFilter`). Une fonction flechee `const` n'est pas
  // hoistee — la definir plus bas jetait un ReferenceError (TDZ) des qu'on activait
  // le filtre « Incompletes », plantant tout l'ecran.
  const ficheIncomplete = (r: Row): boolean => !r.hasContrat;
  const filtered = rows.filter((r) => {
    // On compare au statut CALCULE (source de verite), pas au cache : evite
    // toute divergence quand la bascule quotidienne n'a pas encore ete faite.
    if (statutFilter && statutALaDate(r, today) !== statutFilter) return false;
    if (contratFilter && r.type_contrat !== contratFilter) return false;
    if (incompletFilter && !ficheIncomplete(r)) return false;
    // Recherche globale : tous les mots doivent apparaitre dans une colonne cherchable.
    if (gTerms.length) {
      const hay = searchCols.map((c) => cellText(r, c.key)).join(" ");
      if (!gTerms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const saveLabel =
    save === "saving" ? "Enregistrement…" : save === "saved" ? "Enregistré ✓" : save === "error" ? (saveMsg ?? "Échec d'enregistrement") : "";
  const saveColor = save === "error" ? "var(--danger)" : save === "saved" ? "var(--ok)" : "var(--muted)";
  const inp: React.CSSProperties = { width: "100%", fontSize: 13, padding: "3px 4px" };
  const C = (k: ColKey): React.CSSProperties => (CENTER.has(k) ? { textAlign: "center", textAlignLast: "center" } : {});
  const interimStyle = (t: string) => (t === "INTERIM" ? { background: "#fde68a", color: "#92400e", fontWeight: 600 } : {});

  const Cols = () => (
    <colgroup>
      {COLS.map((c) => <col key={c.key} style={{ width: `${c.w}%` }} />)}
      {(canEdit || canRgpd) && <col style={{ width: "5.5%" }} />}
    </colgroup>
  );
  const tableStyle: React.CSSProperties = { width: "100%", tableLayout: "fixed", margin: 0, borderCollapse: "collapse" };

  // Libelle FR d'un code de contrat (respecte le parametrage Param. RH).
  const typeLabel = (code: string): string =>
    types.find((t) => t.code === code)?.libelle ?? (code === "INTERIM" ? "Intérim" : code);

  const champId = (id: string, key: string) => `pers-${id}-${key}`;
  // Colonnes Contrat + Statut : chips cliquables qui ouvrent la modale Cycle
  // de vie. Plus de select / toggle direct — les valeurs sont des resultantes.
  const chipBase: React.CSSProperties = {
    display: "inline-block",
    width: "auto",
    margin: 0,
    padding: "3px 10px",
    border: "1px solid transparent",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    cursor: canEdit ? "pointer" : "default",
    lineHeight: 1.5,
    whiteSpace: "nowrap",
  };
  const contratChip = (r: Row) => {
    const bg = r.type_contrat === "INTERIM" ? "#fde68a" : "#e0e7ff";
    const fg = r.type_contrat === "INTERIM" ? "#92400e" : "#3730a3";
    return (
      <button
        type="button"
        onClick={() => canEdit && setCycleFor(r)}
        style={{ ...chipBase, background: bg, color: fg, borderColor: bg }}
        title={canEdit ? "Ouvrir le cycle de vie (contrats, arrivée, départ)" : typeLabel(r.type_contrat)}
      >
        {typeLabel(r.type_contrat)}
      </button>
    );
  };
  const statutChip = (r: Row) => {
    const s = statutALaDate(r, today) as StatutPersonne;
    const c = couleurStatut(s);
    return (
      <button
        type="button"
        onClick={() => canEdit && setCycleFor(r)}
        style={{ ...chipBase, background: c.bg, color: c.fg, borderColor: c.bg }}
        title={canEdit ? "Ouvrir le cycle de vie (contrats, arrivée, départ)" : libelleStatut(s)}
      >
        {libelleStatut(s)}
      </button>
    );
  };
  // Pastille « fiche incomplete » : petit rond orange devant le nom quand
  // aucun contrat n'existe. Clic ouvre la modale Cycle de vie pour en saisir un.
  const pastilleIncomplet = (r: Row) => {
    if (!ficheIncomplete(r)) return null;
    return (
      <button
        type="button"
        onClick={canEdit ? () => setCycleFor(r) : undefined}
        title={`Pas de contrat dans Cycle de vie${canEdit ? " — cliquer pour en ajouter un" : ""}`}
        aria-label="Pas de contrat"
        style={{
          width: 16,
          height: 16,
          margin: "0 6px 0 0",
          padding: 0,
          borderRadius: 999,
          background: "#f59e0b",
          color: "#fff",
          border: "none",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          cursor: canEdit ? "pointer" : "help",
          verticalAlign: "middle",
        }}
      >
        !
      </button>
    );
  };
  // Nombre de fiches incompletes parmi les ACTIVES (les A_VENIR peuvent
  // legitimement etre incompletes, on ne les compte pas ici).
  const nbIncompletActifs = rows.filter(
    (r) => statutALaDate(r, today) === "ACTIF" && ficheIncomplete(r),
  ).length;

  return (
    <>
      {erreur && (
        <div className="headband" style={{ paddingTop: 12, paddingBottom: 0 }}>
          <BandeauErreur message={erreur} />
        </div>
      )}
      {/* En-tete en deux lignes, commun a Personnel / Matrice / Habilitations.
          Ligne 1 : titre · recherche · nombre de personnes.
          Ligne 2 : actions a gauche · filtres Statut et Contrat a droite. */}
      <div className="headband headband-top">
        <div className="hb-l1">
          <PageTitle module="personnel">Personnel</PageTitle>
          <span className="hb-search">
            <input
              value={gq}
              onChange={(e) => setGq(e.target.value)}
              placeholder="🔍 Rechercher : nom, matricule, badge, équipe…"
            />
            {gq !== "" && (
              <button type="button" className="clear" onClick={() => setGq("")} title="Effacer la recherche">✕</button>
            )}
          </span>
          <span className="hb-fin">
            {nbIncompletActifs > 0 && !incompletFilter && (
              <button
                type="button"
                onClick={() => setIncompletFilter(true)}
                title="Voir les fiches actives à compléter"
                style={{
                  width: "auto",
                  margin: 0,
                  padding: "3px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#78350f",
                  background: "#fef3c7",
                  border: "1px solid #fcd34d",
                  borderRadius: 999,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                ⚠ {nbIncompletActifs} à compléter
              </button>
            )}
            <span className="muted" style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
              {filtered.length === rows.length ? `${rows.length} personnes` : `${filtered.length} / ${rows.length}`}
            </span>
            <span style={{ minWidth: 92, textAlign: "right", fontSize: 12, fontWeight: 600, color: saveColor }}>{saveLabel}</span>
          </span>
        </div>

        <div className="hb-l2">
          {canEdit && (
            <button type="button" className="btn-sm" style={{ width: "auto", margin: 0, whiteSpace: "nowrap" }} onClick={() => setShowCreate(true)} title="Ajouter une personne">
              ＋ Ajouter
            </button>
          )}
          {canEdit && sel.size === 2 && (
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto", margin: 0, whiteSpace: "nowrap" }} onClick={openMerge} title="Fusionner les 2 personnes sélectionnées">
              🔗 Fusionner
            </button>
          )}
          <span className="hb-fin">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>Statut</span>
              <div className="segments">
                <button type="button" className={statutFilter === "" ? "seg active" : "seg"} onClick={() => setStatutFilter("")}>Tous</button>
                <button type="button" className={statutFilter === "A_VENIR" ? "seg active" : "seg"} onClick={() => setStatutFilter("A_VENIR")}>À venir</button>
                <button type="button" className={statutFilter === "ACTIF" ? "seg active" : "seg"} onClick={() => setStatutFilter("ACTIF")}>Actif</button>
                <button type="button" className={statutFilter === "PARTI" ? "seg active" : "seg"} onClick={() => setStatutFilter("PARTI")}>Parti</button>
              </div>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>Fiche</span>
              <div className="segments">
                <button type="button" className={!incompletFilter ? "seg active" : "seg"} onClick={() => setIncompletFilter(false)}>Toutes</button>
                <button
                  type="button"
                  className={incompletFilter ? "seg active" : "seg"}
                  onClick={() => setIncompletFilter(true)}
                  title="Fiches sans contrat dans Cycle de vie"
                >
                  ⚠ Incomplètes
                </button>
              </div>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>Contrat</span>
              <div className="segments">
                <button type="button" className={contratFilter === "" ? "seg active" : "seg"} onClick={() => setContratFilter("")}>Tous</button>
                {types.map((c) => (
                  <button key={c.code} type="button" className={contratFilter === c.code ? "seg active" : "seg"} onClick={() => setContratFilter(c.code)}>
                    {c.libelle}
                  </button>
                ))}
              </div>
            </span>
          </span>
        </div>
      </div>

      {/* La grille occupe toute la largeur de la fenêtre. */}
      <div className="gridband">
      {/* Tableau 1 (fixe) : entetes + recherche + creation */}
      <div className="card" style={{ padding: "6px 10px", overflowY: "auto", scrollbarGutter: "stable" }}>
        <table className="pers-table" style={tableStyle}>
          <Cols />
          <thead>
            <tr>
              {COLS.map((c) => <th key={c.key} style={{ whiteSpace: "nowrap" }}>{c.label}</th>)}
              {(canEdit || canRgpd) && <th />}
            </tr>
          </thead>
        </table>
      </div>

      {/* Tableau 2 (scrollable) : liste des personnes */}
      <div className="card grow" style={{ marginTop: 8, padding: "0 10px", overflowY: "auto", scrollbarGutter: "stable" }}>
        <table className="pers-table" style={tableStyle}>
          <Cols />
          <tbody>
            {filtered.map((r) => {
              const a18 = alerte18(r);
              return (
                <tr key={r.id} style={{ opacity: statutALaDate(r, today) === "ACTIF" ? 1 : 0.55 }}>
                  {canEdit ? (
                    <>
                      <td style={{ textAlign: "center" }}>{contratChip(r)}</td>
                      <td><input value={r.matricule ?? ""} onChange={(e) => field(r.id, "matricule", e.target.value)} style={{ ...inp, ...C("matricule") }} /></td>
                      <td><input value={r.numero_badge ?? ""} onChange={(e) => field(r.id, "numero_badge", e.target.value)} style={{ ...inp, ...C("numero_badge") }} /></td>
                      <td style={{ position: "relative" }}>
                        {pastilleIncomplet(r)}
                        <input value={r.nom} onChange={(e) => field(r.id, "nom", e.target.value)} style={{ ...inp, width: `calc(100% - ${ficheIncomplete(r) ? 22 : 0}px)` }} />
                      </td>
                      <td><input value={r.prenom} onChange={(e) => field(r.id, "prenom", e.target.value)} style={inp} /></td>
                      <td><select id={champId(r.id, "sexe")} value={r.sexe ?? ""} onChange={(e) => field(r.id, "sexe", e.target.value, true)} style={{ ...inp, ...C("sexe"), background: sexeBg(r.sexe), color: sexeFg(r.sexe), fontWeight: 600 }}><option value="">-</option><option value="H">H</option><option value="F">F</option></select></td>
                      <td><select id={champId(r.id, "equipe_id")} value={r.equipe_id ?? ""} onChange={(e) => field(r.id, "equipe_id", e.target.value, true)} style={{ ...inp, ...C("equipe"), ...eqStyle(r.equipe_id) }}><option value="">-</option>{equipes.map((x) => (<option key={x.id} value={x.id}>{x.nom}</option>))}</select></td>
                      <td><select id={champId(r.id, "atelier_id")} value={r.atelier_id ?? ""} onChange={(e) => field(r.id, "atelier_id", e.target.value, true)} style={{ ...inp, ...C("atelier") }}><option value="">-</option>{ateliers.map((x) => (<option key={x.id} value={x.id}>{x.nom}</option>))}</select></td>
                      <td><input id={champId(r.id, "date_livret_accueil")} type="date" value={r.date_livret_accueil ?? ""} onChange={(e) => field(r.id, "date_livret_accueil", e.target.value, true)} style={inp} /></td>
                      <td style={{ textAlign: "center" }}><BoutonAbsences row={r} onOpen={() => setAbsFor(r)} /></td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                        {a18 && (
                          <span
                            title={a18.titre}
                            style={{
                              display: "inline-block",
                              padding: "1px 6px",
                              borderRadius: 4,
                              background: a18.bg,
                              color: a18.fg,
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {fmtDate(a18.dateFin)}
                          </span>
                        )}
                      </td>
                      <td><input value={r.pointure ?? ""} maxLength={5} onChange={(e) => field(r.id, "pointure", e.target.value)} style={{ ...inp, ...C("pointure") }} /></td>
                      <td style={{ textAlign: "center" }}>
                        {r.temps_partiel ? (
                          <span className="sexe-pill" style={{ background: "#e0e7ff", color: "#3730a3", cursor: "pointer" }} onClick={() => setTpFor(r)} title="Configurer le temps partiel">TP</span>
                        ) : (
                          <button type="button" className="btn-sm btn-ghost" onClick={() => setTpFor(r)} style={{ padding: "2px 6px" }} title="Activer le temps partiel">TP…</button>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>{statutChip(r)}</td>
                      <td>
                        <input
                          value={r.commentaire ?? ""}
                          onChange={(e) => field(r.id, "commentaire", e.target.value)}
                          title={r.commentaire || "Commentaire"}
                          placeholder="—"
                          style={{ ...inp, textOverflow: "ellipsis" }}
                        />
                      </td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                        <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} disabled={!sel.has(r.id) && sel.size >= 2} title="Sélectionner pour fusionner (2 max)" style={{ width: "auto", marginRight: 6, verticalAlign: "middle" }} />
                        <button type="button" className="iconbtn" title={`Informations (commentaire, poste fixe)${r.poste_fixe_id ? " · poste fixe défini 📌" : ""}`} onClick={() => setInfoFor(r)} style={r.poste_fixe_id ? { boxShadow: "inset 0 0 0 2px #6366f1" } : undefined}><InfoIcon /></button>
                        {canRgpd && <button type="button" className="iconbtn" title="RGPD (export / anonymiser / supprimer)" onClick={() => setRgpdFor(r)}><GearIcon /></button>}
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ textAlign: "center" }}>{contratChip(r)}</td>
                      <td style={{ textAlign: "center" }}>{r.matricule || "-"}</td>
                      <td style={{ textAlign: "center" }}>{r.numero_badge || "-"}</td>
                      <td>{pastilleIncomplet(r)}{r.nom}</td>
                      <td>{r.prenom}</td>
                      <td style={{ textAlign: "center" }}><SexePill sexe={r.sexe} /></td>
                      <td style={{ textAlign: "center" }}>{equipeNom(r.equipe_id) || "-"}</td>
                      <td style={{ textAlign: "center" }}>{atelierNom(r.atelier_id) || "-"}</td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{fmtDate(r.date_livret_accueil)}</td>
                      <td style={{ textAlign: "center" }}><BoutonAbsences row={r} onOpen={() => setAbsFor(r)} /></td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                        {a18 && (
                          <span
                            title={a18.titre}
                            style={{
                              display: "inline-block",
                              padding: "1px 6px",
                              borderRadius: 4,
                              background: a18.bg,
                              color: a18.fg,
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {fmtDate(a18.dateFin)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>{r.pointure || "-"}</td>
                      <td style={{ textAlign: "center" }}>{r.temps_partiel ? <span className="sexe-pill" style={{ background: "#e0e7ff", color: "#3730a3" }}>TP</span> : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "center" }}>{statutChip(r)}</td>
                      <td title={r.commentaire || ""} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 0 }}>
                        {r.commentaire ? r.commentaire : <span className="muted">—</span>}
                      </td>
                      {/* Vue lecture seule mais droit RGPD : seule action offerte, la roue crantée. */}
                      {canRgpd && (
                        <td style={{ textAlign: "center" }}>
                          <button type="button" className="iconbtn" title="RGPD (export / anonymiser / supprimer)" onClick={() => setRgpdFor(r)}><GearIcon /></button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={(canEdit || canRgpd) ? COLS.length + 1 : COLS.length} className="muted" style={{ padding: 10 }}>Aucun résultat.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {tpFor && (
        <TempsPartielModal
          personne={{ id: tpFor.id, label: `${tpFor.nom} ${tpFor.prenom}`, temps_partiel: tpFor.temps_partiel, tp_type: tpFor.tp_type, tp_config: tpFor.tp_config }}
          equipe={equipes.find((e) => e.id === tpFor.equipe_id) ?? null}
          quarts={quarts}
          rotationRefs={rotationRefs}
          onClose={() => setTpFor(null)}
          onSaved={(u) => { setRow(tpFor.id, (r) => ({ ...r, ...u })); setTpFor(null); }}
        />
      )}
      {absFor && (
        <AbsencesModal
          personne={{ id: absFor.id, label: `${absFor.nom} ${absFor.prenom}` }}
          motifs={motifs}
          canEdit={canEdit}
          onClose={() => setAbsFor(null)}
        />
      )}

      {cycleFor && (
        <CycleDeVieModal
          personne={{
            id: cycleFor.id,
            label: `${cycleFor.nom} ${cycleFor.prenom}`,
            date_arrivee: cycleFor.date_arrivee,
            date_depart_prevu: cycleFor.date_depart_prevu,
            motif_depart: cycleFor.motif_depart,
            statut: cycleFor.statut,
          }}
          canEdit={canEdit}
          onClose={() => setCycleFor(null)}
          onSync={(u) =>
            setRows((rs) =>
              rs.map((r) =>
                r.id === cycleFor.id
                  ? {
                      ...r,
                      ...(u.date_arrivee !== undefined ? { date_arrivee: u.date_arrivee } : {}),
                      ...(u.date_depart_prevu !== undefined ? { date_depart_prevu: u.date_depart_prevu } : {}),
                      ...(u.motif_depart !== undefined ? { motif_depart: u.motif_depart } : {}),
                      ...(u.statut !== undefined ? { statut: u.statut } : {}),
                      ...(u.type_contrat !== undefined ? { type_contrat: u.type_contrat } : {}),
                      ...(u.date_fin !== undefined ? { date_fin: u.date_fin } : {}),
                      ...(u.contrat_debut !== undefined ? { contrat_debut: u.contrat_debut } : {}),
                      hasContrat: true, // un onSync = un contrat existe
                    }
                  : r,
              ),
            )
          }
        />
      )}

      {/* Modale Informations : commentaire (enregistrement auto, reflété sur la ligne). */}
      {infoFor && (
        <ModaleDeplacable onClose={() => setInfoFor(null)} largeur={720}>
            <div className="mdd-drag" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, cursor: "grab" }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>Informations — {infoFor.nom} {infoFor.prenom}</h2>
              <button type="button" onClick={() => setInfoFor(null)} title="Fermer" style={{ width: "auto", margin: 0, padding: "2px 10px", fontSize: 16 }}>✕</button>
            </div>
            <label htmlFor="pers-poste-fixe" style={{ fontWeight: 600 }}>Poste fixe</label>
            <select
              id="pers-poste-fixe"
              value={rows.find((r) => r.id === infoFor.id)?.poste_fixe_id ?? ""}
              onChange={(e) => field(infoFor.id, "poste_fixe_id", e.target.value, true)}
              disabled={!canEdit}
              style={{ width: "100%", fontSize: 13, padding: "6px 8px", marginTop: 4 }}
            >
              <option value="">— Aucun (pas de poste fixe)</option>
              {postes.map((p) => (
                <option key={p.id} value={p.id}>{p.nom} · {p.atelierNom}</option>
              ))}
            </select>
            <p className="muted" style={{ marginTop: 6, marginBottom: 14, fontSize: 12 }}>
              Si renseigné, la personne est placée par défaut sur ce poste via le bouton
              « Pré-remplir postes fixes » du planning (sauf absence).
            </p>

            <label htmlFor="pers-commentaire" style={{ fontWeight: 600 }}>Commentaire</label>
            <textarea
              id="pers-commentaire"
              value={rows.find((r) => r.id === infoFor.id)?.commentaire ?? ""}
              onChange={(e) => field(infoFor.id, "commentaire", e.target.value)}
              rows={4}
              style={{ width: "100%", fontSize: 13, padding: "6px 8px", marginTop: 4 }}
            />
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Ne pas saisir d&apos;information médicale. Enregistrement automatique.
            </p>
        </ModaleDeplacable>
      )}

      {/* Modale RGPD : export / anonymiser / supprimer (admin). */}
      {rgpdFor && (
        <ModaleDeplacable onClose={() => setRgpdFor(null)} largeur={560}>
            <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
              <h2 style={{ margin: 0 }}>RGPD — {rgpdFor.nom} {rgpdFor.prenom}</h2>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setRgpdFor(null)} style={{ width: "auto" }}>✕</button>
            </div>
            <div className="toolbar" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <a href={`/api/personnel/${rgpdFor.id}/export`} className="btn-sm btn-ghost" style={{ textDecoration: "none" }}>
                Exporter les données (JSON)
              </a>
              <ConfirmForm
                action={anonymiserPersonne}
                hidden={{ id: rgpdFor.id }}
                label="Anonymiser"
                confirm="Anonymiser cette personne ? Le nom est remplacé, l'historique de placement est conservé."
              />
              <ConfirmForm
                action={supprimerPersonne}
                hidden={{ id: rgpdFor.id }}
                label="Supprimer (droit à l'oubli)"
                className="btn-sm"
                confirm="Supprimer DÉFINITIVEMENT cette personne et tout son historique ? Action irréversible."
              />
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Anonymiser conserve l&apos;historique (bilans) en retirant l&apos;identité. Supprimer efface définitivement la personne et ses données liées.
            </p>
        </ModaleDeplacable>
      )}

      {/* Modale de fusion de deux personnes. */}
      {merge && (
        <ModaleDeplacable onClose={() => { if (!merging) setMerge(null); }} largeur={560}>
            <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
              <h2 style={{ margin: 0 }}>Fusionner deux personnes</h2>
              <button type="button" className="btn-sm btn-ghost" disabled={merging} onClick={() => setMerge(null)} style={{ width: "auto" }}>✕</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Choisis la fiche à <strong>conserver</strong>. L&apos;autre sera supprimée après transfert de tous
              ses rattachements (planning, matrice, habilitations, contrats, absences, horaires).
            </p>
            {[merge.a, merge.b].map((r) => (
              <label key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 6, cursor: "pointer", background: keepId === r.id ? "#eff6ff" : undefined }}>
                <input type="radio" name="keep" checked={keepId === r.id} onChange={() => setKeepId(r.id)} style={{ width: "auto" }} />
                <span>
                  <strong>{r.nom} {r.prenom}</strong> — {r.type_contrat === "INTERIM" ? "Intérim" : r.type_contrat} · {r.statut === "ACTIF" ? "Actif" : "Parti"}
                  {r.matricule ? <span className="muted"> · mat. {r.matricule}</span> : null}
                  {r.numero_badge ? <span className="muted"> · badge {r.numero_badge}</span> : null}
                </span>
              </label>
            ))}
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#78350f" }}>
              Fusion <strong>irréversible</strong>. En cas de doublon d&apos;affectation (même jour/poste/formation), la valeur
              de la fiche conservée est gardée ; ses champs vides sont complétés par l&apos;autre.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn-sm btn-ghost" disabled={merging} onClick={() => setMerge(null)} style={{ width: "auto" }}>Annuler</button>
              <button type="button" className="btn-sm" disabled={merging} onClick={doMerge} style={{ width: "auto" }}>{merging ? "Fusion…" : "Fusionner"}</button>
            </div>
        </ModaleDeplacable>
      )}

      {/* Modale de création d'une nouvelle personne (centrée). */}
      {canEdit && showCreate && (
        <ModaleDeplacable onClose={() => setShowCreate(false)} largeur={640}>
            <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8, cursor: "grab" }}>
              <h2 style={{ margin: 0 }}>Nouvelle personne</h2>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setShowCreate(false)} style={{ width: "auto" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <div className="field">
                <span>Contrat</span>
                <select value={contrat} onChange={(e) => setContrat(e.target.value)} style={interimStyle(contrat)}>
                  {types.map((c) => (<option key={c.code} value={c.code}>{c.libelle}</option>))}
                </select>
              </div>
              <div className="field">
                <span>Matricule</span>
                <input value={matricule} onChange={(e) => setMatricule(e.target.value)} placeholder="auto (intérim)" />
              </div>
              <div className="field">
                <span>Badge</span>
                <input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="badge" />
              </div>
              {/* Casse normalisee des la sortie du champ (« GAUTREAU Jean-François »).
                  L'API la reapplique de toute facon : ici c'est pour que la saisie
                  montre tout de suite ce qui sera enregistre. */}
              <div className="field">
                <span>Nom *</span>
                <input value={nom} onChange={(e) => setNom(e.target.value)} onBlur={() => setNom(normaliseNom)} placeholder="Nom" />
              </div>
              <div className="field">
                <span>Prénom *</span>
                <input value={prenom} onChange={(e) => setPrenom(e.target.value)} onBlur={() => setPrenom(normalisePrenom)} placeholder="Prénom" />
              </div>
              <div className="field">
                <span>H/F</span>
                <select value={sexe} onChange={(e) => setSexe(e.target.value)} style={{ background: sexeBg(sexe || null), color: sexeFg(sexe || null), fontWeight: 600 }}>
                  <option value="">-</option><option value="H">H</option><option value="F">F</option>
                </select>
              </div>
              <div className="field">
                <span>Équipe</span>
                <select value={eq} onChange={(e) => setEq(e.target.value)} style={eqStyle(eq || null)}>
                  <option value="">-</option>{equipes.map((x) => (<option key={x.id} value={x.id}>{x.nom}</option>))}
                </select>
              </div>
              <div className="field">
                <span>Atelier</span>
                <select value={at} onChange={(e) => setAt(e.target.value)}>
                  <option value="">-</option>{ateliers.map((x) => (<option key={x.id} value={x.id}>{x.nom}</option>))}
                </select>
              </div>
              <div className="field">
                <span>Date d&apos;arrivée</span>
                <input type="date" value={dateArrivee} onChange={(e) => setDateArrivee(e.target.value)} title="Date d'entrée dans l'effectif. Peut être dans le futur (À venir jusqu'au jour J)." />
              </div>
              <div className="field">
                <span>Livret accueil</span>
                <input type="date" value={livret} onChange={(e) => setLivret(e.target.value)} />
              </div>
              <div className="field">
                <span>Pointure</span>
                <input value={pointure} maxLength={5} onChange={(e) => setPointure(e.target.value)} placeholder="42" />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setShowCreate(false)} style={{ width: "auto" }}>Annuler</button>
              <button type="button" onClick={add} disabled={!nom.trim() || !prenom.trim()} className="btn-sm" style={{ width: "auto" }} title="Créer la personne">＋ Créer</button>
            </div>
        </ModaleDeplacable>
      )}

      {dup && (
        <ModaleDeplacable onClose={() => setDup(null)} largeur={540}>
            <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
              <h2 style={{ margin: 0, color: "#92400e" }}>⚠ Doublon possible</h2>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setDup(null)} style={{ width: "auto" }}>✕</button>
            </div>
            <p style={{ marginTop: 0 }}>
              Une personne nommée <strong>{nom.trim()} {prenom.trim()}</strong> existe déjà&nbsp;:
            </p>
            <ul style={{ margin: "4px 0 10px", paddingLeft: 18 }}>
              {dup.map((m) => (
                <li key={m.id} style={{ marginBottom: 4 }}>
                  <Link href={`/personnel/${m.id}`} prefetch={false}>{m.nom} {m.prenom}</Link>
                  {" — "}{m.type_contrat === "INTERIM" ? "Intérim" : m.type_contrat}
                  {" — "}<span className={m.statut === "ACTIF" ? "tag" : "tag tag-off"}>{m.statut === "ACTIF" ? "Actif" : "Parti"}</span>
                  {m.matricule ? <span className="muted" style={{ fontSize: 12 }}> · mat. {m.matricule}</span> : null}
                </li>
              ))}
            </ul>
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#78350f" }}>
              <strong>Règle&nbsp;:</strong>{" "}
              on réactive l&apos;ancien profil (bouton <em>Actif/Parti</em>{" "}
              sur sa ligne) plutôt que de créer deux fois la même personne. Cela évite les
              doublons et conserve l&apos;historique, la matrice de polyvalence et le planning.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn-sm" onClick={() => setDup(null)} style={{ width: "auto" }}>Annuler (recommandé)</button>
              <button type="button" className="btn-sm btn-ghost" onClick={doCreate} style={{ width: "auto" }}>Créer quand même</button>
            </div>
        </ModaleDeplacable>
      )}
    </>
  );
}
