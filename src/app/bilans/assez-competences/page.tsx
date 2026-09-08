import { Fragment } from "react";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import CouvertureSemaineNav from "./CouvertureSemaineNav";
import { requireRapportBilan } from "@/lib/permissions";
import { isoDate, parseMonday, isoWeekNumber } from "@/lib/week";
import { chargerCouvertureConges, type ServiceJour } from "@/lib/assez-competences-data";

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fmtJour = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MOIS[m - 1]}`; };
const catLabel = (c: string) => (c === "conducteur" ? "Cond." : c === "manager" ? "Mgr" : "Opér.");

// Style d'une case service selon son solde du jour.
function celluleService(j: ServiceJour): { txt: string; bg?: string; color: string; poids: number } {
  if (j.besoin === 0) return { txt: "—", color: "#cbd5e1", poids: 400 };
  if (j.deficit > 0) return { txt: `−${j.deficit}`, bg: "#fee2e2", color: "#7f1d1d", poids: 700 };
  if (j.reserve === 0) return { txt: "0", bg: "#fef3c7", color: "#92400e", poids: 700 };
  return { txt: `+${j.reserve}`, bg: "#e7f4ec", color: "#15803d", poids: 700 };
}

export default async function AssezCompetencesPage({ searchParams }: { searchParams: Promise<{ debut?: string; atelier?: string }> }) {
  const { profile } = await requireRapportBilan("assez-competences");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const lundiDepart = isoDate(parseMonday(sp.debut));

  const supabase = await getServerClient();
  const [{ data: atD }, res] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    chargerCouvertureConges(supabase, { lundiDepart, nbSemaines: 2 }),
  ]);
  const { cols, services, nbServices, nbEnTension, pireJour, nbAbsents, joursSansTension } = res;

  const shown = atelier ? services.filter((s) => s.atelierId === atelier) : services;

  // Libellé de la quinzaine pour la navigation.
  const semA = cols[0]?.semaine ?? isoWeekNumber(new Date());
  const semB = cols[cols.length - 1]?.semaine ?? semA;
  const navLabel = `S${semA} → S${semB} · ${fmtJour(cols[0]?.iso ?? lundiDepart)} – ${fmtJour(cols[cols.length - 1]?.iso ?? lundiDepart)}`;

  // Bordure de césure entre les deux semaines (avant chaque lundi sauf le 1er).
  const sep = (ci: number): React.CSSProperties => (ci > 0 && cols[ci].premierDeSemaine ? { borderLeft: "2px solid #cbd5e1" } : {});

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Assez de compétences&nbsp;?</PageTitle>
            <div className="sub">
              Aide à la validation des congés, <strong>avant</strong> toute affectation de planning · quinzaine ·
              une personne polyvalente ne tient qu&apos;<strong>une place à la fois</strong> (affectation optimale, jamais comptée deux fois)
            </div>
          </div>
          <ReportActions>
            <CouvertureSemaineNav lundiDepart={lundiDepart} label={navLabel} />
          </ReportActions>
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />

        {nbServices === 0 ? (
          <div className="card"><p className="muted">Aucun poste à tenir dans le référentiel (effectif requis non défini, ou uniquement des postes à titulaire unique). Renseignez l&apos;effectif requis des postes dans le Référentiel.</p></div>
        ) : (
          <>
            <div className="kpi-grid">
              <div className={`kpi ${nbEnTension > 0 ? "danger" : "ok"}`}>
                <div className="v">{nbEnTension}<small> / {nbServices}</small></div>
                <div className="l">Services en tension</div>
                <div className="s">au moins un jour non tenu</div>
              </div>
              <div className={`kpi ${pireJour.places > 0 ? "danger" : "ok"}`}>
                <div className="v">{pireJour.places}</div>
                <div className="l">Places non couvertes (pire jour)</div>
                <div className="s">{pireJour.iso ? fmtJour(pireJour.iso) : "aucune"}</div>
              </div>
              <div className="kpi">
                <div className="v">{nbAbsents}</div>
                <div className="l">Personnes en congé / absence</div>
                <div className="s">sur la quinzaine</div>
              </div>
              <div className={`kpi ${joursSansTension === cols.length ? "ok" : joursSansTension >= cols.length - 2 ? "warn" : "danger"}`}>
                <div className="v">{joursSansTension}<small> / {cols.length}</small></div>
                <div className="l">Jours entièrement tenus</div>
                <div className="s">tous services couverts</div>
              </div>
            </div>

            <div className="report-section">
              <h2>Couverture par service</h2>
              <div className="card" style={{ overflowX: "auto" }}>
                <table className="matrix" style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 2, minWidth: 220 }} />
                      <th style={{ background: "#f8fafc" }} />
                      <th style={{ background: "#f8fafc" }} />
                      {[0, 1].map((w) => {
                        const first = cols[w * 5];
                        return (
                          <th key={w} colSpan={5} style={{ textAlign: "center", fontSize: 12, background: "#f8fafc", ...sep(w * 5) }}>
                            S{first?.semaine} <span className="muted" style={{ fontWeight: 400 }}>· sem. du {first ? fmtJour(first.iso) : ""}</span>
                          </th>
                        );
                      })}
                    </tr>
                    <tr>
                      <th style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", zIndex: 2, paddingLeft: 12 }}>Service / poste</th>
                      <th style={{ background: "#f8fafc", fontSize: 11, minWidth: 52 }}>Cat.</th>
                      <th style={{ background: "#f8fafc", fontSize: 11, minWidth: 52 }}>Besoin</th>
                      {cols.map((c, ci) => (
                        <th key={c.iso} style={{ textAlign: "center", minWidth: 46, fontSize: 12, background: "#f8fafc", ...sep(ci) }}>
                          {c.jourCourt}<br /><span className="muted" style={{ fontWeight: 400, fontSize: 9 }}>{c.num}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <Fragment key={s.atelierId}>
                        <tr style={{ borderTop: "2px solid #e2e8f0" }}>
                          <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, fontWeight: 700, fontSize: 14, paddingLeft: 12 }}>
                            {s.atelierNom}
                            <span className="muted" style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{s.nbPostes} poste{s.nbPostes > 1 ? "s" : ""}</span>
                          </td>
                          <td />
                          <td style={{ textAlign: "center", color: "var(--muted)", fontWeight: 700 }}>{s.besoinJour}<span style={{ fontWeight: 400, fontSize: 10 }}>/j</span></td>
                          {s.jours.map((j, ci) => {
                            const c = celluleService(j);
                            return (
                              <td key={ci} style={{ textAlign: "center", padding: 3, ...sep(ci) }}>
                                <div style={{ background: c.bg, color: c.color, fontWeight: c.poids, borderRadius: 7, padding: "6px 0", fontVariantNumeric: "tabular-nums" }}>{c.txt}</div>
                              </td>
                            );
                          })}
                        </tr>
                        {s.postesQuiCoincent.map((p) => (
                          <tr key={p.id}>
                            <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, paddingLeft: 28, fontSize: 12.5 }}>{p.nom}</td>
                            <td style={{ textAlign: "center" }}>
                              <span className="rbadge" style={{ background: p.categorie === "conducteur" ? "#eceafe" : "#e2f2f6", color: p.categorie === "conducteur" ? "#4338ca" : "#0e7490", fontSize: 10.5 }}>{catLabel(p.categorie)}</span>
                            </td>
                            <td style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{p.besoin}</td>
                            {p.deficit.map((d, ci) => (
                              <td key={ci} style={{ textAlign: "center", padding: 3, ...sep(ci) }}>
                                {d > 0
                                  ? <div style={{ background: "#fee2e2", color: "#7f1d1d", fontWeight: 700, borderRadius: 7, padding: "5px 0", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>−{d}</div>
                                  : <span style={{ color: "#e2e8f0" }}>·</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="report-grid2">
              <div className="card">
                <h2 style={{ marginTop: 0, fontSize: 15 }}>Comment se lit le manque</h2>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Le solde d&apos;un service, chaque jour, est le <strong>meilleur remplissage possible</strong> de ses postes
                  par les personnes présentes et compétentes — chacune affectée à <strong>un seul</strong> poste, pour tout le site.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={pastille("#e7f4ec", "#15803d")}>+2</span> Réserve — des personnes qualifiées en plus du besoin</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={pastille("#fef3c7", "#92400e")}>0</span> Juste couvert — un congé de plus casse la couverture</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={pastille("#fee2e2", "#7f1d1d")}>−1</span> Place non tenue — compétence manquante ce jour</div>
                </div>
                <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                  Un service peut sembler couvert poste par poste et rester en rouge&nbsp;: les mêmes polyvalents
                  ne peuvent pas tenir deux postes en même temps. Le détail montre les postes qui coincent.
                  La <strong>réserve</strong> (vert) est une borne haute&nbsp;: elle ignore le fait qu&apos;une personne
                  puisse être requise ailleurs le même jour.
                </p>
              </div>
              <div className="card">
                <h2 style={{ marginTop: 0, fontSize: 15 }}>Périmètre du calcul</h2>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                  <li><strong>Besoin</strong> = effectif requis de chaque poste au Référentiel, chaque jour ouvré. Postes à titulaire unique (PTNR) exclus.</li>
                  <li><strong>Compétent</strong> = niveau ≥ niveau minimum du poste <em>et</em> habilitations valides ce jour-là.</li>
                  <li><strong>Présent</strong> = hors congé et absence déclarée, hors temps partiel indisponible, dans l&apos;effectif ce jour (contrats).</li>
                  <li>Affectation calculée <strong>globalement</strong> chaque jour&nbsp;: le filtre Service masque des lignes, il n&apos;assouplit jamais la contrainte «&nbsp;une personne = une place&nbsp;».</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function pastille(bg: string, color: string): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 22, borderRadius: 6, background: bg, color, fontWeight: 700, fontSize: 12, flex: "0 0 auto", fontVariantNumeric: "tabular-nums" };
}
