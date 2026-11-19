import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import ReportEquipeFilter from "@/app/bilans/ReportEquipeFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { getLignesPostesC, getMotifsC, getTypesAgenceC } from "@/lib/refdata";
import { styleInterim } from "@/lib/interim";
import { chargerCampagne, chargerFormations } from "@/lib/campagne-formation-data";
import { LIBELLE_ETAT, MARGE_RECYCLAGE_J, lireInterim, lireSession, type Campagne, type EtatForme, type PersonneC } from "@/lib/campagne-formation";
import type { CelluleXlsx, FeuilleXlsx } from "@/lib/xlsx";
import CampagneFiltres from "./CampagneFiltres";
import ExportCampagne from "./ExportCampagne";

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const COULEUR: Record<EtatForme, string> = { expiree: "danger", a_recycler: "warn", valide: "ok", permanente: "ok" };

function libelleJours(j: number | null): string {
  if (j === null) return "n'expire pas";
  if (j < 0) return `échue ${-j} j avant`;
  if (j === 0) return "échue le jour même";
  return `${j} j après`;
}

export default async function CampagneFormationReport({
  searchParams,
}: {
  searchParams: Promise<{ formation?: string; session?: string; interim?: string; atelier?: string; equipe?: string }>;
}) {
  const { profile } = await requireRapportBilan("campagne-formation");
  const sp = await searchParams;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const session = lireSession(sp.session, aujourdhui);
  const avecInterim = lireInterim(sp.interim);
  const atelier = sp.atelier ?? "";
  const equipe = sp.equipe ?? "";

  const supabase = await getServerClient();
  const [{ data: atD }, { data: eqD }, typesAgence, motifs, lignesPostes, formations] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("ordre_affichage").order("nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("equipe").select("id, nom, couleur").eq("actif", true).order("nom").returns<{ id: string; nom: string; couleur: string | null }[]>(),
    getTypesAgenceC(),
    getMotifsC(),
    getLignesPostesC(),
    chargerFormations(supabase),
  ]);
  const formation = formations.find((f) => f.id === sp.formation) ?? null;

  const ateliers = atD ?? [];
  const atelierNom = new Map(ateliers.map((a) => [a.id, a.nom]));
  const atelierRang = new Map(ateliers.map((a, i) => [a.id, String(i).padStart(4, "0")]));
  const equipeNom = new Map((eqD ?? []).map((e) => [e.id, e.nom]));
  const posteNom = new Map(lignesPostes.flatMap((l) => l.poste.map((p) => [p.id, p.nom] as const)));
  const agenceSet = new Set(typesAgence);
  const service = (p: PersonneC) => (p.atelier_id ? atelierNom.get(p.atelier_id) ?? "" : "");
  const equipeDe = (p: PersonneC) => (p.equipe_id ? equipeNom.get(p.equipe_id) ?? "" : "");
  const posteFixe = (p: PersonneC) => (p.poste_fixe_id ? posteNom.get(p.poste_fixe_id) ?? "" : "");

  const c: Campagne = formation
    ? await chargerCampagne(supabase, formation, {
        session,
        atelier,
        equipe,
        avecInterim,
        typesAgence: agenceSet,
        motifs: new Map(motifs.map((m) => [m.id, m.libelle])),
        cleService: (p) => (p.atelier_id ? atelierRang.get(p.atelier_id) ?? "9999" : "9999"),
      })
    : { formes: [], nonFormes: [] };

  const nbExpirees = c.formes.filter((l) => l.etat === "expiree").length;
  const nbPreference = c.formes.filter((l) => l.etat === "a_recycler").length;
  const nbValides = c.formes.length - nbExpirees - nbPreference;
  const nbDispo = c.nonFormes.filter((l) => l.indispo.length === 0).length;
  const nbAnciens = c.nonFormes.filter((l) => l.ancienne).length;

  const obsForme = (l: Campagne["formes"][number]) =>
    [l.departAvant ? `Fin de contrat le ${fmtDate(l.departAvant)}` : "", agenceSet.has(l.personne.type_contrat) ? "Intérim" : ""]
      .filter(Boolean)
      .join(" · ");
  const ancienneTxt = (l: Campagne["nonFormes"][number]) =>
    l.ancienne
      ? `Retirée le ${fmtDate(l.ancienne.supprimeeLe)}${l.ancienne.obtention ? ` (obtenue le ${fmtDate(l.ancienne.obtention)})` : ""}`
      : "";

  const titres = formation
    ? [`Campagne de formation — ${formation.nom}`, `Session du ${fmtDate(session)} · extrait le ${fmtDate(aujourdhui)}${avecInterim ? "" : " · hors intérimaires"}`]
    : [];
  const feuilles: FeuilleXlsx[] = formation
    ? [
        {
          nom: "Formés",
          titres,
          colonnes: [
            { titre: "Nom", largeur: 20 },
            { titre: "Prénom", largeur: 16 },
            { titre: "Service", largeur: 18 },
            { titre: "Équipe", largeur: 12 },
            { titre: "Poste fixe", largeur: 22 },
            { titre: "Contrat", largeur: 12 },
            { titre: "Obtention", largeur: 13 },
            { titre: "Échéance", largeur: 13 },
            { titre: "Jours après la session", largeur: 14 },
            { titre: "État", largeur: 22 },
            { titre: "Observation", largeur: 28 },
          ],
          lignes: c.formes.map((l): CelluleXlsx[] => [
            l.personne.nom,
            l.personne.prenom,
            service(l.personne),
            equipeDe(l.personne),
            posteFixe(l.personne),
            l.personne.type_contrat,
            l.obtention ? { date: l.obtention } : null,
            l.expiration ? { date: l.expiration } : null,
            l.joursASession,
            LIBELLE_ETAT[l.etat],
            obsForme(l),
          ]),
        },
        {
          nom: "Non formés",
          titres,
          colonnes: [
            { titre: "Nom", largeur: 20 },
            { titre: "Prénom", largeur: 16 },
            { titre: "Service", largeur: 18 },
            { titre: "Équipe", largeur: 12 },
            { titre: "Poste fixe", largeur: 22 },
            { titre: "Contrat", largeur: 12 },
            { titre: "Déjà formé autrefois", largeur: 34 },
            { titre: "Disponibilité", largeur: 40 },
          ],
          lignes: c.nonFormes.map((l): CelluleXlsx[] => [
            l.personne.nom,
            l.personne.prenom,
            service(l.personne),
            equipeDe(l.personne),
            posteFixe(l.personne),
            l.personne.type_contrat,
            ancienneTxt(l),
            l.indispo.length ? l.indispo.join(" · ") : "Disponible",
          ]),
        },
      ]
    : [];
  const slug = formation ? formation.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() : "";

  const nomCell = (p: PersonneC) => <span style={{ ...styleInterim(p.type_contrat, agenceSet), fontWeight: 600 }}>{p.nom}</span>;

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Campagne de formation</PageTitle>
            <div className="sub">
              {formation ? (
                <>
                  <strong>{formation.nom}</strong> · session du <strong>{fmtDate(session)}</strong> · {c.formes.length} formé{c.formes.length > 1 ? "s" : ""} ·{" "}
                  {c.nonFormes.length} non formé{c.nonFormes.length > 1 ? "s" : ""}
                  {avecInterim ? "" : " · hors intérimaires"}
                </>
              ) : (
                "Personnes formées et non formées pour une formation, à la date d'une session"
              )}
            </div>
          </div>
          <ReportActions>
            {formation && <ExportCampagne feuilles={feuilles} nomFichier={`campagne-${slug}-${session}.xlsx`} />}
            <Link href="/habilitations" className="navlink" prefetch={false}>Habilitations</Link>
          </ReportActions>
        </div>

        <CampagneFiltres
          formation={formation?.id ?? ""}
          session={session}
          interim={avecInterim}
          formations={formations.map((f) => ({ id: f.id, nom: f.nom, groupe: f.groupe }))}
        />
        <ReportAtelierFilter ateliers={ateliers} atelier={atelier} />
        <ReportEquipeFilter equipes={eqD ?? []} equipe={equipe} />

        {!formation ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>Choisir une formation pour afficher les personnes formées et le vivier des non formées.</p>
          </div>
        ) : (
          <>
            <div className="kpi-grid">
              <div className={`kpi ${nbExpirees > 0 ? "danger" : "ok"}`}><div className="v">{nbExpirees}</div><div className="l">À recycler</div><div className="s">échue à la date de session</div></div>
              <div className={`kpi ${nbPreference > 0 ? "warn" : "ok"}`}><div className="v">{nbPreference}</div><div className="l">À recycler de préférence</div><div className="s">échéance dans les {MARGE_RECYCLAGE_J} j suivants</div></div>
              <div className="kpi ok"><div className="v">{nbValides}</div><div className="l">Valides</div><div className="s">au-delà de {MARGE_RECYCLAGE_J} j ou sans échéance</div></div>
              <div className="kpi accent"><div className="v">{nbDispo}</div><div className="l">Vivier disponible</div><div className="s">non formés · dont {nbAnciens} déjà formé{nbAnciens > 1 ? "s" : ""} autrefois</div></div>
            </div>

            <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Formés ({c.formes.length})</h3>
              {c.formes.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Personne ne détient cette formation dans la sélection.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Prénom</th>
                      <th>Service</th>
                      <th>Équipe</th>
                      <th>Poste fixe</th>
                      <th style={{ textAlign: "center" }}>Obtention</th>
                      <th style={{ textAlign: "center" }}>Échéance</th>
                      <th style={{ textAlign: "center" }}>Par rapport à la session</th>
                      <th style={{ textAlign: "center" }}>État</th>
                      <th>Observation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.formes.map((l) => (
                      <tr key={l.personne.id}>
                        <td>{nomCell(l.personne)}</td>
                        <td>{l.personne.prenom}</td>
                        <td className="muted">{service(l.personne) || "—"}</td>
                        <td className="muted">{equipeDe(l.personne) || "—"}</td>
                        <td className="muted">{posteFixe(l.personne) || "—"}</td>
                        <td style={{ textAlign: "center" }}>{fmtDate(l.obtention)}</td>
                        <td style={{ textAlign: "center", fontWeight: 600 }}>{fmtDate(l.expiration)}</td>
                        <td style={{ textAlign: "center" }} className="muted">{libelleJours(l.joursASession)}</td>
                        <td style={{ textAlign: "center" }}><span className={`rbadge ${COULEUR[l.etat]}`}>{LIBELLE_ETAT[l.etat]}</span></td>
                        <td style={{ fontSize: 12 }} className={l.departAvant ? undefined : "muted"}>{obsForme(l) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Non formés — vivier ({c.nonFormes.length})</h3>
              {c.nonFormes.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Tout le monde détient cette formation dans la sélection.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Prénom</th>
                      <th>Service</th>
                      <th>Équipe</th>
                      <th>Poste fixe</th>
                      <th>Déjà formé autrefois</th>
                      <th>Disponibilité le {fmtDate(session)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.nonFormes.map((l) => {
                      const indispo = l.indispo.length > 0;
                      return (
                        <tr key={l.personne.id} style={indispo ? { opacity: 0.55 } : undefined}>
                          <td>{nomCell(l.personne)}</td>
                          <td>{l.personne.prenom}</td>
                          <td className="muted">{service(l.personne) || "—"}</td>
                          <td className="muted">{equipeDe(l.personne) || "—"}</td>
                          <td className="muted">{posteFixe(l.personne) || "—"}</td>
                          <td style={{ fontSize: 12 }}>{l.ancienne ? <span className="rbadge warn">{ancienneTxt(l)}</span> : <span className="muted">—</span>}</td>
                          <td style={{ fontSize: 12 }}>{indispo ? l.indispo.join(" · ") : <span className="rbadge ok">Disponible</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                L&apos;état d&apos;une habilitation est jugé à la <strong>date de la session</strong> : échue ce jour-là = à recycler ;
                échéance dans les {MARGE_RECYCLAGE_J} jours suivants = à recycler de préférence.
                {" "}<strong>Déjà formé autrefois</strong> = habilitation retirée, retrouvée dans l&apos;historique des habilitations.
                {" "}<strong>Disponibilité</strong> : absence ou temps partiel saisis au Planning pour le jour de la session, contrat terminé avant.
                {" "}Personnes actives seulement ; les intérimaires sont surlignés en jaune.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
