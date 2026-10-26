import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import ReportEquipeFilter from "@/app/bilans/ReportEquipeFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { getTypesAgenceC } from "@/lib/refdata";
import { styleInterim } from "@/lib/interim";
import { chargerRecyclages } from "@/lib/recyclages-data";
import { HORIZONS, libelleJours, libelleType, lireHorizon, lireType, urgence, type LigneRecyclage } from "@/lib/recyclages";
import type { CelluleXlsx } from "@/lib/xlsx";
import RecyclagesFiltres from "./RecyclagesFiltres";
import ExportRecyclages from "./ExportRecyclages";

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const COULEUR = { rouge: "danger", orange: "warn", vert: "ok" } as const;

// Colonnes de l'extraction Excel (même ordre que l'écran).
const COLONNES_XLSX = [
  { titre: "Formation", largeur: 34 },
  { titre: "Type", largeur: 14 },
  { titre: "Nom", largeur: 20 },
  { titre: "Prénom", largeur: 16 },
  { titre: "Service", largeur: 18 },
  { titre: "Équipe", largeur: 12 },
  { titre: "Contrat", largeur: 12 },
  { titre: "Dernier passage", largeur: 15 },
  { titre: "Date d'expiration", largeur: 16 },
  { titre: "Jours restants", largeur: 13 },
  { titre: "Observation", largeur: 30 },
];

export default async function RecyclagesReport({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; horizon?: string; formation?: string; atelier?: string; equipe?: string }>;
}) {
  const { profile } = await requireRapportBilan("recyclages");
  const sp = await searchParams;
  const type = lireType(sp.type);
  const horizon = lireHorizon(sp.horizon);
  const formation = sp.formation ?? "";
  const atelier = sp.atelier ?? "";
  const equipe = sp.equipe ?? "";

  const supabase = await getServerClient();
  const [{ data: atD }, { data: eqD }, typesAgence, r] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("ordre_affichage").order("nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("equipe").select("id, nom, couleur").eq("actif", true).order("nom").returns<{ id: string; nom: string; couleur: string | null }[]>(),
    getTypesAgenceC(),
    chargerRecyclages(supabase, { type, horizon, formation, atelier, equipe }),
  ]);
  const atelierNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));
  const equipeNom = new Map((eqD ?? []).map((e) => [e.id, e.nom]));
  const agenceSet = new Set(typesAgence);
  const service = (l: LigneRecyclage) => (l.atelierId ? atelierNom.get(l.atelierId) ?? "" : "");
  const equipeDe = (l: LigneRecyclage) => (l.equipeId ? equipeNom.get(l.equipeId) ?? "" : "");
  const observation = (l: LigneRecyclage) =>
    [l.departAvant ? `Fin de contrat le ${fmtDate(l.departAvant)}, avant l'échéance` : "", agenceSet.has(l.typeContrat) ? "Intérim" : ""]
      .filter(Boolean)
      .join(" · ");

  const lignes = r.lignes;
  const nbExpirees = lignes.filter((l) => l.jours < 0).length;
  const nb30 = lignes.filter((l) => l.jours >= 0 && l.jours < 30).length;
  const nb90 = lignes.filter((l) => l.jours >= 30 && l.jours <= 90).length;
  const nbPersonnes = new Set(lignes.map((l) => l.personneId)).size;
  // Taille de chaque groupe « formation » (cellule fusionnée de la 1re colonne).
  const tailleGroupe = new Map<string, number>();
  for (const l of lignes) tailleGroupe.set(l.formationId, (tailleGroupe.get(l.formationId) ?? 0) + 1);

  const exportLignes: CelluleXlsx[][] = lignes.map((l) => [
    l.formation,
    libelleType(l.type),
    l.nom,
    l.prenom,
    service(l),
    equipeDe(l),
    l.typeContrat,
    l.dernierPassage ? { date: l.dernierPassage } : null,
    { date: l.expiration },
    l.jours,
    observation(l),
  ]);
  const horizonTxt = HORIZONS.find((h) => h.v === horizon)?.t ?? "";
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Recyclages à prévoir</PageTitle>
            <div className="sub">
              Formations à recycler détenues par les personnes actives · échéance <strong>{horizonTxt.toLowerCase()}</strong>
              {type ? <> · formations <strong>{libelleType(type).toLowerCase()}s</strong></> : null}
              {" "}· {lignes.length} recyclage{lignes.length > 1 ? "s" : ""} · {nbPersonnes} personne{nbPersonnes > 1 ? "s" : ""}
            </div>
          </div>
          <ReportActions>
            <ExportRecyclages colonnes={COLONNES_XLSX} lignes={exportLignes} nomFichier={`recyclages-${aujourdhui}.xlsx`} />
            <Link href="/habilitations" className="navlink" prefetch={false}>Habilitations</Link>
          </ReportActions>
        </div>

        <RecyclagesFiltres
          type={type}
          horizon={horizon}
          formation={formation}
          formations={r.formations.map((f) => ({ id: f.id, nom: f.nom }))}
          avecNonClassees={r.existeNonClassees}
        />
        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />
        <ReportEquipeFilter equipes={eqD ?? []} equipe={equipe} />

        <div className="kpi-grid">
          <div className={`kpi ${nbExpirees > 0 ? "danger" : "ok"}`}><div className="v">{nbExpirees}</div><div className="l">Expirées</div><div className="s">à recycler sans attendre</div></div>
          <div className={`kpi ${nb30 > 0 ? "danger" : "ok"}`}><div className="v">{nb30}</div><div className="l">Sous 30 jours</div><div className="s">session à caler</div></div>
          <div className={`kpi ${nb90 > 0 ? "warn" : "ok"}`}><div className="v">{nb90}</div><div className="l">De 30 à 90 jours</div><div className="s">à anticiper</div></div>
          <div className="kpi accent"><div className="v">{nbPersonnes}</div><div className="l">Personnes concernées</div><div className="s">{tailleGroupe.size} formation{tailleGroupe.size > 1 ? "s" : ""}</div></div>
        </div>

        {r.sansEcheance.length > 0 && (
          <div className="card noprint" style={{ background: "#fffbeb", borderColor: "#fde68a", fontSize: 13, color: "#78350f" }}>
            <strong>{r.sansEcheance.length} formation{r.sansEcheance.length > 1 ? "s" : ""} sans durée de validité</strong> : elle{r.sansEcheance.length > 1 ? "s" : ""} n&apos;expire{r.sansEcheance.length > 1 ? "nt" : ""}{" "}jamais{" "}
            et n&apos;apparai{r.sansEcheance.length > 1 ? "ssent" : "t"} donc pas ici — {r.sansEcheance.map((f) => f.nom).join(", ")}.
            {" "}Si un recyclage est attendu, renseigner la durée dans le paramétrage des habilitations.
          </div>
        )}

        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          {lignes.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Aucun recyclage dans cette échéance.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Formation</th>
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Service</th>
                  <th>Équipe</th>
                  <th style={{ textAlign: "center" }}>Dernier passage</th>
                  <th style={{ textAlign: "center" }}>Date d&apos;expiration</th>
                  <th style={{ textAlign: "center" }}>Échéance</th>
                  <th>Observation</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => {
                  const premier = i === 0 || lignes[i - 1].formationId !== l.formationId;
                  const obs = observation(l);
                  return (
                    <tr key={`${l.formationId}:${l.personneId}`} style={premier && i > 0 ? { borderTop: "2px solid var(--border)" } : undefined}>
                      {premier && (
                        <td rowSpan={tailleGroupe.get(l.formationId)} style={{ verticalAlign: "top", minWidth: 200 }}>
                          <strong>{l.formation}</strong>
                          <br />
                          <span className="muted" style={{ fontSize: 11 }}>
                            {libelleType(l.type)} · {tailleGroupe.get(l.formationId)} personne{(tailleGroupe.get(l.formationId) ?? 0) > 1 ? "s" : ""}
                          </span>
                        </td>
                      )}
                      <td><span style={{ ...styleInterim(l.typeContrat, agenceSet), fontWeight: 600 }}>{l.nom}</span></td>
                      <td>{l.prenom}</td>
                      <td className="muted">{service(l) || "—"}</td>
                      <td className="muted">{equipeDe(l) || "—"}</td>
                      <td style={{ textAlign: "center" }}>{fmtDate(l.dernierPassage)}</td>
                      <td style={{ textAlign: "center", fontWeight: 600 }}>{fmtDate(l.expiration)}</td>
                      <td style={{ textAlign: "center" }}><span className={`rbadge ${COULEUR[urgence(l.jours)]}`}>{libelleJours(l.jours)}</span></td>
                      <td style={{ fontSize: 12 }} className={l.departAvant ? undefined : "muted"}>{obs || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            <strong>Dernier passage</strong> = date d&apos;obtention saisie dans Habilitations.
            {" "}<strong>Date d&apos;expiration</strong> = date saisie, à défaut dernier passage + durée de validité de la formation.
            {" "}Rouge : expirée ou sous 30 j · orange : 30 à 90 j · vert : au-delà.
            {" "}Une <strong>fin de contrat avant l&apos;échéance</strong> est signalée : le recyclage n&apos;est peut-être pas utile.
          </p>
        </div>
      </div>
    </>
  );
}
