import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import { requireRapportBilan } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { parseMonday, weekDays, isoWeekNumber, isoDate } from "@/lib/week";
import { chargerAbsences4Semaines, chargerHorairesInterim, type Absences4 } from "@/lib/synthese-data";
import { INTERIM_BG } from "@/lib/interim";
import SyntheseFilters from "./SyntheseFilters";
import AgencePrintButton from "./AgencePrintButton";

export const dynamic = "force-dynamic";

const NB_SEMAINES = 4;
const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];

export default async function SynthesesPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; sem?: string; atelier?: string; motif?: string }>;
}) {
  const { profile } = await requireRapportBilan("syntheses");
  const sp = await searchParams;
  const vue: "absences" | "interim" = sp.vue === "interim" ? "interim" : "absences";
  const atelier = sp.atelier ?? "";
  const motif = sp.motif ?? "";

  const monday = parseMonday(sp.sem);
  const mondayIso = isoDate(monday);

  // Semaine unique (vue Intérim).
  const joursSem = weekDays(monday);
  const weekIsos = joursSem.map((j) => j.iso);
  const semaineLabel = `S${isoWeekNumber(monday)} · ${joursSem[0].num} → ${joursSem[6].num}`;

  // Fenetre de 4 semaines (vue Absences) : lundi -> vendredi de chaque semaine.
  const semaines = Array.from({ length: NB_SEMAINES }, (_, k) => {
    const m = new Date(monday);
    m.setDate(monday.getDate() + k * 7);
    const jrs = weekDays(m).slice(0, 5); // Lun -> Ven
    return { weekNo: isoWeekNumber(m), jours: jrs };
  });
  const colonnes = semaines.flatMap((s, si) => s.jours.map((j, ji) => ({ ...j, si, premierDeSemaine: ji === 0 })));
  const workdayIsos = colonnes.map((c) => c.iso);
  const rangeLabel = `S${semaines[0].weekNo} → S${semaines[NB_SEMAINES - 1].weekNo}`;

  const supabase = await getServerClient();
  const quarts = await getQuartsC();

  // Listes pour les filtres (vue Absences).
  const [{ data: atD }, { data: motifD }] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("motif_absence").select("id, libelle").eq("actif", true).order("libelle").returns<{ id: string; libelle: string }[]>(),
  ]);

  let abs: Absences4 = { lignes: [], recap: [] };
  let groupes: Awaited<ReturnType<typeof chargerHorairesInterim>> = [];
  if (vue === "absences") {
    abs = await chargerAbsences4Semaines(supabase, workdayIsos, atelier || undefined, motif || undefined);
  } else {
    groupes = await chargerHorairesInterim(supabase, weekIsos, quarts);
  }

  const nbPlaces = groupes.reduce((s, g) => s + g.lignes.length, 0);
  const nbSansBesoin = groupes.reduce((s, g) => s + g.sansBesoin.length, 0);

  const sepStyle = { borderLeft: "2px solid var(--border)" } as const;

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Synthèses hebdomadaires</PageTitle>
            <div className="sub">
              {vue === "absences"
                ? "Absences à venir sur 4 semaines (hors intérim) — vue calendaire."
                : "Planning prévisionnel des intérimaires, par agence — export PDF."}
            </div>
          </div>
          <ReportActions />
        </div>

        <SyntheseFilters
          vue={vue}
          semaineIso={mondayIso}
          semaineLabel={vue === "absences" ? rangeLabel : semaineLabel}
          ateliers={atD ?? []}
          motifs={(motifD ?? []).map((m) => ({ id: m.id, nom: m.libelle }))}
          atelier={atelier}
          motif={motif}
        />

        {/* -------------------------------------------------- Vue ABSENCES */}
        {vue === "absences" && (
          <>
            {abs.lignes.length === 0 ? (
              <div className="card"><p className="muted">Aucune absence prévue sur les 4 semaines {rangeLabel}{atelier || motif ? " (avec ces filtres)" : ""}.</p></div>
            ) : (
              <>
                <div className="report-section print-flow">
                  <div className="card" style={{ overflowX: "auto" }}>
                    <table className="matrix" style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        {/* Ligne 1 : bandeau des semaines. */}
                        <tr>
                          <th rowSpan={2} style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", minWidth: 200, zIndex: 2 }}>Personne</th>
                          {semaines.map((s, si) => (
                            <th key={si} colSpan={5} style={{ textAlign: "center", fontSize: 12, ...(si > 0 ? sepStyle : {}) }}>
                              S{s.weekNo}
                              <br />
                              <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>{s.jours[0].num} → {s.jours[4].num}</span>
                            </th>
                          ))}
                          <th rowSpan={2} style={{ textAlign: "center", minWidth: 44, ...sepStyle }}>Tot.</th>
                        </tr>
                        {/* Ligne 2 : jours. */}
                        <tr>
                          {colonnes.map((c, ci) => (
                            <th key={c.iso} style={{ textAlign: "center", minWidth: 30, fontSize: 10, padding: "2px 0", ...(c.premierDeSemaine && ci > 0 ? sepStyle : {}) }}>
                              <span className="muted" style={{ fontWeight: 600 }}>{JOURS_COURTS[ci % 5]}</span>
                              <br />
                              <span className="muted" style={{ fontWeight: 400, fontSize: 9 }}>{c.num.slice(0, 5).split("/")[0]}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {abs.lignes.map((l) => (
                          <tr key={l.personneId}>
                            <td style={{ position: "sticky", left: 0, background: "#fff", whiteSpace: "nowrap", zIndex: 1 }}>
                              <div style={{ fontWeight: 600 }}>{l.nom} {l.prenom}</div>
                              <div className="muted" style={{ fontSize: 11 }}>{l.atelierNom}{l.equipeNom !== "—" ? ` · ${l.equipeNom}` : ""}</div>
                            </td>
                            {colonnes.map((c, ci) => {
                              const cell = l.jours[c.iso];
                              return (
                                <td
                                  key={c.iso}
                                  title={cell ? `${cell.libelle} — ${c.iso.split("-").reverse().join("/")}` : undefined}
                                  style={{
                                    textAlign: "center",
                                    padding: 0,
                                    height: 34,
                                    background: cell ? cell.couleur ?? "#94a3b8" : undefined,
                                    ...(c.premierDeSemaine && ci > 0 ? sepStyle : {}),
                                  }}
                                >
                                  {cell && (
                                    <span style={{ color: "#fff", fontWeight: 700, fontSize: 10, textShadow: "0 0 2px rgba(0,0,0,.55)" }}>{cell.abbr}</span>
                                  )}
                                </td>
                              );
                            })}
                            <td style={{ textAlign: "center", fontWeight: 700, ...sepStyle }}>{l.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted" style={{ marginTop: 8 }}>
                    Une case colorée = un jour d&apos;absence (couleur et code du motif). {abs.lignes.length} personne{abs.lignes.length > 1 ? "s" : ""} concernée{abs.lignes.length > 1 ? "s" : ""} sur la fenêtre.
                  </p>
                </div>

                <div className="report-section">
                  <h2>Par motif</h2>
                  <div className="card">
                    <table>
                      <thead>
                        <tr><th>Motif</th><th style={{ textAlign: "center" }}>Personnes</th><th style={{ textAlign: "center" }}>Jours</th></tr>
                      </thead>
                      <tbody>
                        {abs.recap.map((m, i) => (
                          <tr key={i}>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <span style={{ minWidth: 26, textAlign: "center", padding: "1px 5px", borderRadius: 4, background: m.couleur ?? "#94a3b8", color: "#fff", fontWeight: 700, fontSize: 11, textShadow: "0 0 2px rgba(0,0,0,.55)" }}>{m.abbr}</span>
                                {m.libelle}
                              </span>
                            </td>
                            <td style={{ textAlign: "center" }}>{m.personnes}</td>
                            <td style={{ textAlign: "center", fontWeight: 600 }}>{m.jours}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="muted" style={{ marginTop: 8 }}>
                      « Jours » = jours d&apos;absence tombant dans la fenêtre de 4 semaines. « Personnes » = personnes distinctes ayant ce motif sur la fenêtre.
                    </p>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* -------------------------------------------------- Vue INTERIM */}
        {vue === "interim" && (
          <>
            {groupes.length === 0 ? (
              <div className="card"><p className="muted">Aucun intérimaire sur la semaine {semaineLabel}.</p></div>
            ) : (
              <>
                <p className="muted noprint" style={{ marginTop: -4, marginBottom: 14 }}>
                  {nbPlaces} placé{nbPlaces > 1 ? "s" : ""} · {nbSansBesoin} sans besoin · {groupes.length} agence{groupes.length > 1 ? "s" : ""}. Chaque bloc est imprimable séparément (bouton « PDF agence »).
                </p>
                {groupes.map((g, gi) => {
                  const secId = `agence-${gi}`;
                  return (
                    <section key={g.agence} id={secId} data-agence-section className="agence-print report-section">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                        <h2 style={{ margin: 0 }}>
                          {g.agence}{" "}
                          <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>
                            · {g.lignes.length} placé{g.lignes.length > 1 ? "s" : ""}
                            {g.sansBesoin.length > 0 ? ` · ${g.sansBesoin.length} sans besoin` : ""} · semaine {semaineLabel}
                          </span>
                        </h2>
                        <AgencePrintButton targetId={secId} />
                      </div>

                      {g.lignes.length > 0 && (
                        <div className="card" style={{ overflowX: "auto" }}>
                          <table className="matrix" style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", minWidth: 160 }}>Intérimaire</th>
                                {joursSem.map((j) => (
                                  <th key={j.iso} style={{ textAlign: "center", minWidth: 92, fontSize: 12 }}>
                                    {j.nom.slice(0, 3)}<br /><span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>{j.num}</span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {g.lignes.map((p) => (
                                <tr key={p.personneId}>
                                  <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>
                                    <span style={{ background: INTERIM_BG, borderRadius: 3, padding: "0 4px" }}>{p.nom} {p.prenom}</span>
                                  </td>
                                  {joursSem.map((j) => {
                                    const cells = p.cells[j.iso] ?? [];
                                    return (
                                      <td key={j.iso} style={{ verticalAlign: "top", padding: "4px 6px", textAlign: "center" }}>
                                        {cells.length === 0 ? (
                                          <span style={{ color: "#cbd5e1" }}>—</span>
                                        ) : (
                                          cells.map((c, i) => (
                                            <div key={i} style={{ lineHeight: 1.25, marginBottom: i < cells.length - 1 ? 5 : 0 }}>
                                              {c.horaire && <div style={{ color: "#1d4ed8", fontWeight: 600, fontSize: 13 }}>{c.horaire}</div>}
                                              <div style={{ fontSize: 12 }}>{c.posteNom}</div>
                                              <div className="muted" style={{ fontSize: 11 }}>{c.atelierNom}</div>
                                            </div>
                                          ))
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {g.sansBesoin.length > 0 && (
                        <div className="card" style={{ marginTop: g.lignes.length > 0 ? 8 : 0, background: "#f8fafc" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 6 }}>
                            Pas de besoin cette semaine
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px" }}>
                            {g.sansBesoin.map((p) => (
                              <span key={p.personneId} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "1px 10px", fontSize: 13 }}>
                                {p.nom} {p.prenom}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
