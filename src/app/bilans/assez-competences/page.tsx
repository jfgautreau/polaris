import { Fragment } from "react";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import CouvertureSemaineNav from "./CouvertureSemaineNav";
import { requireRapportBilan } from "@/lib/permissions";
import { isoDate, parseMonday, isoWeekNumber } from "@/lib/week";
import { chargerCouvertureConges, type ServiceJour, type PosteJourCase } from "@/lib/assez-competences-data";

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fmtJour = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MOIS[m - 1]}`; };
const catLabel = (c: string) => (c === "conducteur" ? "Cond." : c === "manager" ? "Mgr" : "Opér.");

// Cellule agrégée d'un service selon son solde du jour.
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

  const semA = cols[0]?.semaine ?? isoWeekNumber(new Date());
  const semB = cols[cols.length - 1]?.semaine ?? semA;
  const navLabel = `S${semA} → S${semB} · ${fmtJour(cols[0]?.iso ?? lundiDepart)} – ${fmtJour(cols[cols.length - 1]?.iso ?? lundiDepart)}`;

  const sep = (ci: number): React.CSSProperties => (ci > 0 && cols[ci].premierDeSemaine ? { borderLeft: "2px solid #cbd5e1" } : {});

  // Cellule d'un poste un jour : une puce par créneau ouvert.
  const celluleposte = (c: PosteJourCase) => {
    if (!c.ouvert || c.quarts.length === 0) return <span style={{ color: "#e2e8f0" }}>·</span>;
    return (
      <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
        {c.quarts.map((q) => {
          const manque = q.deficit > 0;
          return (
            <span key={q.quart} title={`${q.label} : ${q.couvrable}/${q.besoin} tenable${q.besoin > 1 ? "s" : ""}`}
              style={{ fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", padding: "2px 5px", borderRadius: 5,
                background: manque ? "#fee2e2" : "#e7f4ec", color: manque ? "#7f1d1d" : "#15803d", whiteSpace: "nowrap" }}>
              {q.label} {manque ? `${q.couvrable}/${q.besoin}` : q.besoin}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Assez de compétences&nbsp;?</PageTitle>
            <div className="sub">
              Aide à la validation des congés, <strong>avant</strong> toute affectation de planning · quinzaine · besoin <strong>par créneau</strong> ·
              une personne polyvalente ne tient qu&apos;<strong>une place à la fois</strong> (affectation optimale, jamais comptée deux fois)
            </div>
          </div>
          <ReportActions />
        </div>

        <div className="noprint" style={{ margin: "2px 0 12px" }}>
          <CouvertureSemaineNav lundiDepart={lundiDepart} label={navLabel} />
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
                <div className="s">au moins un créneau non tenu</div>
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
              <h2>Couverture par service et par créneau</h2>
              <div className="card" style={{ overflowX: "auto" }}>
                <table className="matrix" style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 2, minWidth: 210 }} />
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
                      <th style={{ background: "#f8fafc", fontSize: 11, minWidth: 46 }}>Cat.</th>
                      <th style={{ background: "#f8fafc", fontSize: 11, minWidth: 78 }}>Besoin</th>
                      {cols.map((c, ci) => (
                        <th key={c.iso} style={{ textAlign: "center", minWidth: 62, fontSize: 12, background: "#f8fafc", ...sep(ci) }}>
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
                          <td />
                          {s.jours.map((j, ci) => {
                            const c = celluleService(j);
                            return (
                              <td key={ci} style={{ textAlign: "center", padding: 3, ...sep(ci) }}>
                                <div style={{ background: c.bg, color: c.color, fontWeight: c.poids, borderRadius: 7, padding: "6px 0", fontVariantNumeric: "tabular-nums" }} title="Solde du service (tous créneaux) : +réserve / 0 juste / −manque">{c.txt}</div>
                              </td>
                            );
                          })}
                        </tr>
                        {s.postes.map((p) => (
                          <tr key={p.id} style={{ opacity: p.enTension ? 1 : 0.82 }}>
                            <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, paddingLeft: 28, fontSize: 12.5 }}>{p.nom}</td>
                            <td style={{ textAlign: "center" }}>
                              <span className="rbadge" style={{ background: p.categorie === "conducteur" ? "#eceafe" : p.categorie === "manager" ? "#f3e8ff" : "#e2f2f6", color: p.categorie === "conducteur" ? "#4338ca" : p.categorie === "manager" ? "#9333ea" : "#0e7490", fontSize: 10 }}>{catLabel(p.categorie)}</span>
                            </td>
                            <td style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{p.besoinResume.map((b) => `${b.label} ${b.besoin}`).join(" · ")}</td>
                            {p.jours.map((c, ci) => (
                              <td key={ci} style={{ textAlign: "center", padding: 3, ...sep(ci) }}>{celluleposte(c)}</td>
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
                  et créneaux par les personnes présentes et compétentes — chacune affectée à <strong>une seule</strong> place, pour tout le site.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={pastille("#e7f4ec", "#15803d")}>M 3</span> Créneau couvert (matin, 3 places tenues)</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={pastille("#fee2e2", "#7f1d1d")}>A 1/3</span> Créneau en manque (après-midi, 1 tenable sur 3)</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={pastille("#e7f4ec", "#15803d")}>+2</span> / <span style={pastille("#fef3c7", "#92400e")}>0</span> / <span style={pastille("#fee2e2", "#7f1d1d")}>−1</span> Solde agrégé du service (réserve / juste / manque)</div>
                </div>
                <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                  Un service peut sembler couvert poste par poste et rester en rouge&nbsp;: les mêmes polyvalents ne
                  peuvent pas tenir deux places en même temps. La <strong>réserve</strong> (vert) est une borne haute.
                </p>
              </div>
              <div className="card">
                <h2 style={{ marginTop: 0, fontSize: 15 }}>Périmètre du calcul</h2>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                  <li><strong>Besoin par créneau</strong> = effectif requis du poste, <strong>sur chaque quart posté</strong> où il tourne (matin, après-midi, nuit). Un poste matin + après-midi pèse 2× son effectif. La <strong>journée</strong> (régulière) n&apos;est comptée que pour un poste en journée seule — elle ne s&apos;ajoute jamais à matin/après-midi. Semaine initialisée par l&apos;ordonnancement → on prend ses quarts et lignes ouverts.</li>
                  <li><strong>Compétent</strong> = niveau ≥ niveau minimum du poste <em>et</em> habilitations valides ce jour-là.</li>
                  <li><strong>Présent</strong> = hors congé et absence, hors temps partiel indisponible, dans l&apos;effectif ce jour.</li>
                  <li>Postes à titulaire unique (PTNR) exclus. Affectation calculée <strong>globalement</strong> chaque jour.</li>
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
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 30, height: 22, padding: "0 6px", borderRadius: 6, background: bg, color, fontWeight: 700, fontSize: 11, flex: "0 0 auto", fontVariantNumeric: "tabular-nums" };
}
