import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import { requireRapportBilan } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { parseMonday, weekDays, isoWeekNumber, isoDate } from "@/lib/week";
import { chargerAbsencesSemaine, chargerHorairesInterim, type LigneAbsence } from "@/lib/synthese-data";
import { INTERIM_BG } from "@/lib/interim";
import SyntheseFilters from "./SyntheseFilters";
import AgencePrintButton from "./AgencePrintButton";

export const dynamic = "force-dynamic";

const fmtJour = (iso: string) => iso.split("-").reverse().join("/");
const jourCourt = (deb: string, fin: string) => {
  if (deb === fin) return fmtJour(deb);
  const [, dm, dd] = deb.split("-");
  const memeAnnee = deb.slice(0, 4) === fin.slice(0, 4);
  return `${memeAnnee ? `${dd}/${dm}` : fmtJour(deb)} → ${fmtJour(fin)}`;
};

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
  const jours = weekDays(monday);
  const weekIsos = jours.map((j) => j.iso);
  const semaineLabel = `S${isoWeekNumber(monday)} · ${jours[0].num} → ${jours[6].num}`;

  const supabase = await getServerClient();
  const quarts = await getQuartsC();

  // Listes pour les filtres (vue Absences).
  const [{ data: atD }, { data: motifD }] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("motif_absence").select("id, libelle").eq("actif", true).order("libelle").returns<{ id: string; libelle: string }[]>(),
  ]);

  let lignesAbs: LigneAbsence[] = [];
  let groupes: Awaited<ReturnType<typeof chargerHorairesInterim>> = [];
  if (vue === "absences") {
    lignesAbs = await chargerAbsencesSemaine(supabase, weekIsos);
    if (atelier) lignesAbs = lignesAbs.filter((l) => l.atelierId === atelier);
    if (motif) lignesAbs = lignesAbs.filter((l) => l.motifId === motif);
  } else {
    groupes = await chargerHorairesInterim(supabase, weekIsos, quarts);
  }

  // Sous-totaux par motif (vue Absences).
  const parMotif = new Map<string, { libelle: string; couleur: string | null; nb: number; jours: number }>();
  for (const l of lignesAbs) {
    const key = l.motifId ?? "—";
    const cur = parMotif.get(key) ?? { libelle: l.motifLibelle, couleur: l.motifCouleur, nb: 0, jours: 0 };
    cur.nb += 1;
    cur.jours += l.jours;
    parMotif.set(key, cur);
  }
  const totMotifs = [...parMotif.values()].sort((a, b) => b.jours - a.jours);
  const totalJours = lignesAbs.reduce((s, l) => s + l.jours, 0);

  const nbInterims = groupes.reduce((s, g) => s + g.lignes.length, 0);

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Synthèses hebdomadaires</PageTitle>
            <div className="sub">
              {vue === "absences"
                ? "Absences de la semaine (hors intérim) — période complète."
                : "Planning prévisionnel des intérimaires, par agence — export PDF."}
            </div>
          </div>
          <ReportActions />
        </div>

        <SyntheseFilters
          vue={vue}
          semaineIso={mondayIso}
          semaineLabel={semaineLabel}
          ateliers={atD ?? []}
          motifs={(motifD ?? []).map((m) => ({ id: m.id, nom: m.libelle }))}
          atelier={atelier}
          motif={motif}
        />

        {/* -------------------------------------------------- Vue ABSENCES */}
        {vue === "absences" && (
          <>
            {lignesAbs.length === 0 ? (
              <div className="card"><p className="muted">Aucune absence sur la semaine {semaineLabel}{atelier || motif ? " (avec ces filtres)" : ""}.</p></div>
            ) : (
              <>
                <div className="report-section">
                  <div className="card">
                    <table>
                      <thead>
                        <tr>
                          <th>Personne</th>
                          <th>Atelier</th>
                          <th>Équipe</th>
                          <th>Motif</th>
                          <th>Période</th>
                          <th style={{ textAlign: "center" }}>Jours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lignesAbs.map((l, i) => (
                          <tr key={`${l.personneId}-${l.debut}-${i}`}>
                            <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{l.nom} {l.prenom}</td>
                            <td className="muted">{l.atelierNom}</td>
                            <td className="muted">{l.equipeNom}</td>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 3, background: l.motifCouleur ?? "#cbd5e1", display: "inline-block" }} />
                                {l.motifLibelle}
                              </span>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {jourCourt(l.debut, l.fin)}
                              {!l.declaree && <span className="muted" title="Saisie au planning, sans période déclarée"> ·&nbsp;<span style={{ fontSize: 11 }}>planning</span></span>}
                            </td>
                            <td style={{ textAlign: "center", fontWeight: 600 }}>{l.jours}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5} style={{ textAlign: "right", fontWeight: 600 }}>Total ({lignesAbs.length} absence{lignesAbs.length > 1 ? "s" : ""})</td>
                          <td style={{ textAlign: "center", fontWeight: 700 }}>{totalJours}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div className="report-section">
                  <h2>Par motif</h2>
                  <div className="card">
                    <table>
                      <thead>
                        <tr><th>Motif</th><th style={{ textAlign: "center" }}>Absences</th><th style={{ textAlign: "center" }}>Jours (période)</th></tr>
                      </thead>
                      <tbody>
                        {totMotifs.map((m, i) => (
                          <tr key={i}>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 3, background: m.couleur ?? "#cbd5e1", display: "inline-block" }} />
                                {m.libelle}
                              </span>
                            </td>
                            <td style={{ textAlign: "center" }}>{m.nb}</td>
                            <td style={{ textAlign: "center", fontWeight: 600 }}>{m.jours}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="muted" style={{ marginTop: 8 }}>
                      « Jours (période) » = durée totale de chaque absence, week-ends non comptés, y compris les jours hors de la semaine affichée (les périodes sont montrées en entier).
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
              <div className="card"><p className="muted">Aucun intérimaire placé sur la semaine {semaineLabel}.</p></div>
            ) : (
              <>
                <p className="muted noprint" style={{ marginTop: -4, marginBottom: 14 }}>
                  {nbInterims} intérimaire{nbInterims > 1 ? "s" : ""} · {groupes.length} agence{groupes.length > 1 ? "s" : ""}. Chaque bloc est imprimable séparément (bouton « PDF agence »).
                </p>
                {groupes.map((g, gi) => {
                  const secId = `agence-${gi}`;
                  return (
                    <section key={g.agence} id={secId} data-agence-section className="agence-print report-section">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                        <h2 style={{ margin: 0 }}>
                          {g.agence} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {g.lignes.length} intérimaire{g.lignes.length > 1 ? "s" : ""} · semaine {semaineLabel}</span>
                        </h2>
                        <AgencePrintButton targetId={secId} />
                      </div>
                      <div className="card" style={{ overflowX: "auto" }}>
                        <table className="matrix" style={{ borderCollapse: "collapse", width: "100%" }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", minWidth: 160 }}>Intérimaire</th>
                              {jours.map((j) => (
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
                                {jours.map((j) => {
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
