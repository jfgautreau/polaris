"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AtelierEquipeFiltres from "@/components/AtelierEquipeFiltres";
import CompteurResultats from "@/components/CompteurResultats";
import FicheVisite from "./FicheVisite";
import type { LigneVisite, TypeVisite, UsageAnci } from "@/lib/visites-data";
import {
  COULEUR_STATUT,
  LIBELLE_STATUT,
  delaiTexte,
  fmtFr,
  libelleProfessionnel,
  libelleRegime,
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
  canEdit: boolean;
  lienParam: boolean;
}) {
  const [q, setQ] = useState(props.recherche);
  const [statut, setStatut] = useState<StatutVisite | null>(null);
  const [regime, setRegime] = useState<RegimeCode | null>(null);
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
      return true;
    });
  }, [props.lignes, affichables, terme, statut, regime]);

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
  const anciEnRetard = useMemo(() => base.filter((l) => l.anciManquants.length > 0).length, [base]);

  const ligneOuverte = ouverte ? props.lignes.find((l) => l.id === ouverte) ?? null : null;
  const usageLabel = (code: string) => props.usages.find((u) => u.code === code)?.libelle ?? code;

  return (
    <>
      <div className="headband headband-top">
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
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    background: "#fff",
                    color: "var(--text)",
                    border: `1px solid ${actif ? "var(--primary)" : "var(--border)"}`,
                    boxShadow: actif ? "inset 0 0 0 1px var(--primary)" : "none",
                    borderRadius: 8,
                    padding: "6px 12px",
                    margin: 0,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <b style={{ fontSize: 19, color: c.fg, fontVariantNumeric: "tabular-nums" }}>{n}</b>
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
          <AtelierEquipeFiltres
            base="/visites"
            ateliers={props.ateliers}
            equipes={props.equipes}
            atelier={props.atelier}
            equipe={props.equipe}
          />
        </div>
      </div>

      <div className="gridband scroll">
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
                    {l.prochainPro && (
                      <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
                        avec {libelleProfessionnel(l.prochainPro).toLowerCase()}
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
