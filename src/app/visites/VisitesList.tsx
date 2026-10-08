"use client";

import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import AtelierEquipeFiltres from "@/components/AtelierEquipeFiltres";
import CompteurResultats from "@/components/CompteurResultats";
import FicheVisite from "./FicheVisite";
import type { LigneVisite, TypeVisite, UsageAnci } from "@/lib/visites-data";
import {
  COULEUR_STATUT,
  GROUPES_PRO,
  LIBELLE_STATUT,
  delaiTexte,
  fmtFr,
  groupePro,
  libelleProfessionnels,
  libelleRegime,
  type GroupePro,
  type Parametres,
  type RegimeCode,
  type StatutVisite,
} from "@/lib/visites";

const COULEUR_REGIME: Record<RegimeCode, { bg: string; fg: string; bord: string }> = {
  simple: { bg: "#f8fafc", fg: "#475569", bord: "#cbd5e1" },
  adapte: { bg: "#eff6ff", fg: "#1e40af", bord: "#93c5fd" },
  renforce: { bg: "#fff7ed", fg: "#9a3412", bord: "#fdba74" },
};

const ORDRE_STATUTS: StatutVisite[] = ["retard", "reprise", "planifier", "rdv", "ok"];
const REGIMES: RegimeCode[] = ["renforce", "adapte", "simple"];
const SANS_ECHEANCE = "Aucune échéance calculable";
const dueDe = (l: LigneVisite) => l.prochaine?.libelle ?? SANS_ECHEANCE;

// Paramètres d'URL des filtres client (statut, régime, visite due, avec, rapport).
// Ceux de service / équipe passent par le serveur (AtelierEquipeFiltres), qui
// recopie ceux-ci pour ne pas les perdre.
const PARAMS_FILTRES_VISITES = ["search", "statut", "regime", "due", "avec", "rapport"];

function ecrireUrl(patch: Record<string, string>) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

export default function VisitesList(props: {
  lignes: LigneVisite[];
  displayedIds: string[];
  types: TypeVisite[];
  usages: UsageAnci[];
  params: Parametres;
  aujourdhui: string;
  ateliers: { id: string; label: string }[];
  equipes: { id: string; label: string }[];
  quarts: { code: string; libelle: string }[];
  postes: { id: string; nom: string }[];
  atelier: string;
  equipe: string;
  recherche: string;
  filtresUrl: { statut: string; regime: string; due: string; avec: string; rapport: string };
  canEdit: boolean;
  lienParam: boolean;
}) {
  // Filtres portés par l'URL (lien partageable, survivent au rechargement).
  // Lecture validée au montage ; écriture sans aller-retour serveur par
  // history.replaceState (même motif que le Placement).
  const u = props.filtresUrl;
  const [q, setQState] = useState(props.recherche);
  const [statut, setStatutState] = useState<StatutVisite | null>(
    ORDRE_STATUTS.includes(u.statut as StatutVisite) ? (u.statut as StatutVisite) : null,
  );
  const [regime, setRegimeState] = useState<RegimeCode | null>(
    REGIMES.includes(u.regime as RegimeCode) ? (u.regime as RegimeCode) : null,
  );
  const [due, setDueState] = useState<string | null>(u.due || null);
  const [pro, setProState] = useState<GroupePro | null>(
    GROUPES_PRO.some((g) => g.code === u.avec) ? (u.avec as GroupePro) : null,
  );
  const [rapport, setRapportState] = useState(u.rapport === "1");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setQ = (v: string) => {
    setQState(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => ecrireUrl({ search: v.trim() }), 400);
  };
  const setStatut = (v: StatutVisite | null) => {
    setStatutState(v);
    ecrireUrl({ statut: v ?? "" });
  };
  const setRegime = (v: RegimeCode | null) => {
    setRegimeState(v);
    ecrireUrl({ regime: v ?? "" });
  };
  const setDue = (v: string | null) => {
    setDueState(v);
    ecrireUrl({ due: v ?? "" });
  };
  const setPro = (v: GroupePro | null) => {
    setProState(v);
    ecrireUrl({ avec: v ?? "" });
  };
  const setRapport = (v: boolean) => {
    setRapportState(v);
    ecrireUrl({ rapport: v ? "1" : "" });
  };
  const [ouverte, setOuverte] = useState<string | null>(null);

  const affichables = useMemo(() => new Set(props.displayedIds), [props.displayedIds]);
  const terme = q.trim().toLowerCase();

  // La recherche passe OUTRE les filtres service / équipe : taper un nom doit
  // toujours retrouver la personne, où qu'elle travaille (cf. Matrice).
  const lignes = useMemo(() => {
    return props.lignes.filter((l) => {
      if (terme) {
        const cible = `${l.nom} ${l.prenom} ${l.matricule ?? ""}`.toLowerCase();
        if (!cible.includes(terme)) return false;
      } else if (!affichables.has(l.id)) return false;
      if (statut && l.statut !== statut) return false;
      if (regime && l.regime !== regime) return false;
      if (due && dueDe(l) !== due) return false;
      if (pro && groupePro(l.prochainsPros) !== pro) return false;
      return true;
    });
  }, [props.lignes, affichables, terme, statut, regime, due, pro]);

  // Compteurs : calculés sur le sous-ensemble filtré par service / équipe, pas
  // sur le résultat de la recherche — sinon ils bougeraient à chaque frappe.
  const base = useMemo(
    () => props.lignes.filter((l) => affichables.has(l.id)),
    [props.lignes, affichables],
  );
  const compteurs = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of base) c[l.statut] = (c[l.statut] ?? 0) + 1;
    return c;
  }, [base]);
  // Libellés de visite due présents dans l'effectif (filtre « Visite due »).
  const libellesDue = useMemo(() => [...new Set(base.map(dueDe))].sort((a, b) => a.localeCompare(b)), [base]);

  // Rapport : effectifs par régime × visite due × professionnel prévu, sur le
  // statut choisi. Service / équipe s'appliquent ; ni la recherche ni les
  // autres filtres — le tableau sert justement à les choisir.
  const tableau = useMemo((): Tableau => {
    const pop = base.filter((l) => !statut || l.statut === statut);
    const parRegime = REGIMES.map((r) => {
      const duRegime = pop.filter((l) => l.regime === r);
      const dues = [...new Set(duRegime.map(dueDe))].sort((a, b) => a.localeCompare(b));
      return {
        regime: r,
        total: duRegime.length,
        parPro: compterPro(duRegime),
        dues: dues.map((d) => {
          const sous = duRegime.filter((l) => dueDe(l) === d);
          return { due: d, total: sous.length, parPro: compterPro(sous) };
        }),
      };
    }).filter((x) => x.total > 0);
    return { lignes: parRegime, total: pop.length, parPro: compterPro(pop) };
  }, [base, statut]);

  const choisir = (r: RegimeCode | null, d: string | null, p: GroupePro | null) => {
    setRegime(r);
    setDue(d);
    setPro(p);
  };
  const libellePro = pro ? GROUPES_PRO.find((g) => g.code === pro)?.libelle.toLowerCase() : null;
  const filtresTexte = [
    statut ? LIBELLE_STATUT[statut] : "Tous statuts",
    regime ? `Suivi ${libelleRegime(regime).toLowerCase()}` : null,
    due,
    libellePro ? `avec : ${libellePro}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const anciEnRetard = useMemo(() => base.filter((l) => l.anciManquants.length > 0).length, [base]);

  const ligneOuverte = ouverte ? props.lignes.find((l) => l.id === ouverte) ?? null : null;
  const usageLabel = (code: string) => props.usages.find((u) => u.code === code)?.libelle ?? code;

  return (
    <>
      <div className="printonly" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 16 }}>Visites médicales — {filtresTexte}</h1>
        <p style={{ margin: "2px 0 0", fontSize: 11 }}>
          {lignes.length} personne(s) · édité le {fmtFr(props.aujourdhui)}
        </p>
      </div>
      <div className="headband headband-top noprint">
        <div className="hb-l1">
          <h1 style={{ margin: 0, fontSize: 22 }}>Visites médicales</h1>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un nom, un matricule…"
            aria-label="Rechercher une personne"
            style={{ width: 260, fontSize: 13, padding: "5px 8px" }}
          />
          <CompteurResultats affiches={lignes.length} total={base.length} />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className={rapport ? "btn-sm" : "btn-sm btn-ghost"}
            style={{ margin: 0, width: "auto", color: rapport ? undefined : "var(--text)" }}
            aria-pressed={rapport}
            onClick={() => {
              if (!rapport && !statut) setStatut("retard");
              setRapport(!rapport);
            }}
          >
            Rapport
          </button>
          <button
            type="button"
            className="btn-sm btn-ghost"
            style={{ margin: 0, width: "auto", color: "var(--text)" }}
            onClick={() => window.print()}
          >
            PDF
          </button>
          {props.lienParam && (
            <Link href="/admin/visites-param" className="navlink" prefetch={false}>
              Paramètres &rarr;
            </Link>
          )}
        </div>

        <div className="hb-l2">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ORDRE_STATUTS.map((s) => {
              const n = compteurs[s] ?? 0;
              const c = COULEUR_STATUT[s];
              const actif = statut === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatut(actif ? null : s)}
                  aria-pressed={actif}
                  style={{
                    // Tuile : `width: auto` annule le `width: 100%` global des boutons,
                    // qui empilait les cinq compteurs les uns sous les autres.
                    flex: "0 0 auto",
                    width: "auto",
                    minWidth: 118,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    background: actif ? c.bg : "#fff",
                    color: "var(--text)",
                    border: `1px solid ${actif ? c.fg : "var(--border)"}`,
                    borderLeft: `4px solid ${c.fg}`,
                    boxShadow: actif ? `inset 0 0 0 1px ${c.fg}` : "none",
                    borderRadius: 8,
                    padding: "6px 12px",
                    margin: 0,
                    fontSize: 12.5,
                    lineHeight: 1.2,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <b style={{ fontSize: 22, color: c.fg, fontVariantNumeric: "tabular-nums" }}>{n}</b>
                  {LIBELLE_STATUT[s]}
                </button>
              );
            })}
            {anciEnRetard > 0 && (
              <span
                style={{
                  alignSelf: "center",
                  fontSize: 12.5,
                  color: "#9a3412",
                  background: "#fff7ed",
                  border: "1px solid #fdba74",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
              >
                {anciEnRetard} attestation(s) de non contre-indication à renouveler
              </span>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">Régime :</span>
            <div className="segments">
              <button type="button" className={regime === null ? "seg active" : "seg"} onClick={() => setRegime(null)}>
                Tous
              </button>
              {(["simple", "adapte", "renforce"] as RegimeCode[]).map((r) => (
                <button key={r} type="button" className={regime === r ? "seg active" : "seg"} onClick={() => setRegime(r)}>
                  {libelleRegime(r)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">Visite due :</span>
            <select value={due ?? ""} onChange={(e) => setDue(e.target.value || null)} style={{ fontSize: 13, width: "auto" }}>
              <option value="">Toutes</option>
              {libellesDue.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="muted">Avec :</span>
            <select
              value={pro ?? ""}
              onChange={(e) => setPro((e.target.value || null) as GroupePro | null)}
              style={{ fontSize: 13, width: "auto" }}
            >
              <option value="">Tous</option>
              {GROUPES_PRO.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.libelle}
                </option>
              ))}
            </select>
          </div>
          <AtelierEquipeFiltres
            base="/visites"
            ateliers={props.ateliers}
            equipes={props.equipes}
            atelier={props.atelier}
            equipe={props.equipe}
            conserver={PARAMS_FILTRES_VISITES}
          />
        </div>
      </div>

      <div className="gridband scroll print-flow">
        {rapport && (
          <RapportVisites
            tableau={tableau}
            titre={statut ? LIBELLE_STATUT[statut] : "Tous statuts"}
            regime={regime}
            due={due}
            pro={pro}
            choisir={choisir}
          />
        )}
        <table className="pers-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th w={230}>Salarié</Th>
              <Th w={180}>Équipe · Service</Th>
              <Th w={300}>Régime et pourquoi</Th>
              <Th w={190}>Dernière visite</Th>
              <Th w={300}>Prochaine visite due</Th>
              <Th w={150}>Statut</Th>
              <Th w={120}>RDV</Th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const cs = COULEUR_STATUT[l.statut];
              const cr = COULEUR_REGIME[l.regime];
              return (
                <tr
                  key={l.id}
                  onClick={() => setOuverte(l.id)}
                  style={{ cursor: "pointer", borderBottom: "1px solid #eceef1" }}
                  title="Ouvrir la fiche"
                >
                  <td style={{ padding: "4px 10px" }}>
                    <strong>{l.nom} {l.prenom}</strong>
                    <span className="muted" style={{ display: "block", fontSize: 11.5 }}>{l.matricule ?? "—"}</span>
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    {l.equipe}
                    <span className="muted" style={{ display: "block", fontSize: 11.5 }}>{l.atelier}</span>
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "2px 7px",
                        borderRadius: 4,
                        border: `1px solid ${cr.bord}`,
                        background: cr.bg,
                        color: cr.fg,
                        marginRight: 6,
                      }}
                    >
                      {libelleRegime(l.regime)}
                    </span>
                    {l.raisons.map((r, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 10.5,
                          background: "#f1f5f9",
                          color: "#475569",
                          borderRadius: 3,
                          padding: "1px 5px",
                          marginRight: 3,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.texte}
                      </span>
                    ))}
                    {l.anciManquants.map((u) => (
                      <span
                        key={u}
                        style={{
                          fontSize: 10.5,
                          background: "#fff7ed",
                          color: "#9a3412",
                          border: "1px solid #fdba74",
                          borderRadius: 3,
                          padding: "1px 5px",
                          marginRight: 3,
                          whiteSpace: "nowrap",
                        }}
                        title="Attestation de non contre-indication manquante ou périmée"
                      >
                        ⚠ {usageLabel(u)}
                      </span>
                    ))}
                  </td>
                  <td style={{ padding: "4px 10px", fontVariantNumeric: "tabular-nums" }}>
                    {fmtFr(l.derniere?.date ?? null)}
                    <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
                      {l.derniere?.libelle ?? "aucune visite enregistrée"}
                    </span>
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    {l.prochaine?.libelle ?? "—"}
                    <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
                      {l.prochaine?.due
                        ? `${fmtFr(l.prochaine.due)} · ${delaiTexte(l.prochaine.due, props.aujourdhui)} · ${l.prochaine.motif}`
                        : (l.prochaine?.motif ?? "—")}
                    </span>
                    {l.prochainsPros.length > 0 && (
                      <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
                        avec {libelleProfessionnels(l.prochainsPros).toLowerCase()}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: cs.bg,
                        color: cs.fg,
                      }}
                    >
                      {LIBELLE_STATUT[l.statut]}
                    </span>
                  </td>
                  <td style={{ padding: "4px 10px", fontVariantNumeric: "tabular-nums" }}>
                    {l.rdv ? fmtFr(l.rdv) : <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
            {lignes.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 16 }}>
                  Aucune personne pour ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ligneOuverte && (
        <FicheVisite
          ligne={ligneOuverte}
          types={props.types}
          usages={props.usages}
          quarts={props.quarts}
          postes={props.postes}
          aujourdhui={props.aujourdhui}
          canEdit={props.canEdit}
          onClose={() => setOuverte(null)}
        />
      )}
    </>
  );
}

function Th({ children, w }: { children: React.ReactNode; w: number }) {
  return (
    <th
      style={{
        width: w,
        textAlign: "left",
        fontSize: 12,
        fontWeight: 600,
        color: "#374151",
        background: "#f8fafc",
        borderBottom: "1px solid var(--border)",
        padding: "7px 10px",
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      {children}
    </th>
  );
}

function compterPro(lignes: LigneVisite[]): Record<GroupePro, number> {
  const c: Record<GroupePro, number> = { medecin: 0, infirmier: 0, les_deux: 0, aucun: 0 };
  for (const l of lignes) c[groupePro(l.prochainsPros)]++;
  return c;
}

type Tableau = {
  lignes: {
    regime: RegimeCode;
    total: number;
    parPro: Record<GroupePro, number>;
    dues: { due: string; total: number; parPro: Record<GroupePro, number> }[];
  }[];
  total: number;
  parPro: Record<GroupePro, number>;
};

// Tableau croisé du rapport : régime puis visite due en lignes, professionnel
// prévu en colonnes. Chaque nombre filtre la liste en dessous (un second clic
// retire le filtre) ; la case du filtre courant est surlignée.
function RapportVisites({
  tableau,
  titre,
  regime,
  due,
  pro,
  choisir,
}: {
  tableau: Tableau;
  titre: string;
  regime: RegimeCode | null;
  due: string | null;
  pro: GroupePro | null;
  choisir: (r: RegimeCode | null, d: string | null, p: GroupePro | null) => void;
}) {
  const td: React.CSSProperties = {
    padding: "4px 10px",
    borderBottom: "1px solid #eceef1",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  };
  const cellule = (n: number, r: RegimeCode | null, d: string | null, p: GroupePro | null, fort = false) => {
    const actif = regime === r && due === d && pro === p;
    return (
      <td style={{ ...td, background: actif ? "#dbeafe" : undefined }}>
        {n === 0 ? (
          <span className="muted">·</span>
        ) : (
          <button
            type="button"
            onClick={() => (actif ? choisir(null, null, null) : choisir(r, d, p))}
            title="Filtrer la liste"
            style={{
              margin: 0,
              padding: "0 4px",
              width: "auto",
              background: "none",
              border: 0,
              color: "var(--primary)",
              fontWeight: fort ? 700 : 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        )}
      </td>
    );
  };
  return (
    <div className="card" style={{ margin: "0 0 12px", padding: "10px 14px", breakInside: "avoid" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 15 }}>
        Rapport — {titre}
        <span className="muted noprint" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
          par régime, visite due et professionnel prévu · un clic sur un nombre filtre la liste
        </span>
      </h2>
      {tableau.total === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Personne pour ce statut.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 10px", fontSize: 12 }}>Régime · visite due</th>
              {GROUPES_PRO.map((g) => (
                <th key={g.code} style={{ textAlign: "right", padding: "4px 10px", fontSize: 12, width: 140 }}>
                  {g.libelle}
                </th>
              ))}
              <th style={{ textAlign: "right", padding: "4px 10px", fontSize: 12, width: 80 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {tableau.lignes.map((l) => (
              <Fragment key={l.regime}>
                <tr style={{ background: "#f8fafc" }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Suivi {libelleRegime(l.regime).toLowerCase()}</td>
                  {GROUPES_PRO.map((g) => (
                    <Fragment key={g.code}>{cellule(l.parPro[g.code], l.regime, null, g.code, true)}</Fragment>
                  ))}
                  {cellule(l.total, l.regime, null, null, true)}
                </tr>
                {l.dues.map((d) => (
                  <tr key={d.due}>
                    <td style={{ ...td, textAlign: "left", paddingLeft: 26 }}>{d.due}</td>
                    {GROUPES_PRO.map((g) => (
                      <Fragment key={g.code}>{cellule(d.parPro[g.code], l.regime, d.due, g.code)}</Fragment>
                    ))}
                    {cellule(d.total, l.regime, d.due, null)}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr>
              <td style={{ ...td, textAlign: "left", fontWeight: 700, borderTop: "2px solid var(--border)" }}>Total</td>
              {GROUPES_PRO.map((g) => (
                <Fragment key={g.code}>{cellule(tableau.parPro[g.code], null, null, g.code, true)}</Fragment>
              ))}
              {cellule(tableau.total, null, null, null, true)}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
