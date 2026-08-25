import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import ProjectionFilters from "./ProjectionFilters";
import { requireRapportBilan } from "@/lib/permissions";
import { isoDate, mondayOf, isoWeekNumber } from "@/lib/week";
import { chargerProjection, type Couche } from "@/lib/projection-capacite-data";

const HORIZONS = [4, 8, 12];

export default async function ProjectionPage({ searchParams }: { searchParams: Promise<{ h?: string; couche?: string; atelier?: string }> }) {
  const { profile } = await requireRapportBilan("projection");
  const sp = await searchParams;
  const horizon = HORIZONS.includes(Number(sp.h)) ? Number(sp.h) : 8;
  const couche: Couche = sp.couche === "reelle" ? "reelle" : "structurelle";
  const atelier = sp.atelier ?? "";
  const lundiDepart = isoDate(mondayOf(new Date()));

  const supabase = await getServerClient();
  const [{ data: atD }, projection] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    chargerProjection(supabase, { lundiDepart, nbSemaines: horizon, atelier, couche }),
  ]);
  const { semaines, postes, bancPoste } = projection;
  const posteNom = new Map(postes.map((p) => [p.id, { nom: p.nom, atelier: p.atelierNom }]));

  // Libelle court d'une semaine : « S38 » + date du lundi.
  const semLabel = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return { s: `S${isoWeekNumber(new Date(y, m - 1, d))}`, j: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}` };
  };

  // KPIs.
  const enTension = semaines.filter((s) => s.besoin > 0 && s.couvrable < s.besoin);
  const clesRupture = new Set(semaines.flatMap((s) => s.postesEnRupture));
  const postesRupture = new Set([...clesRupture].map((c) => c.split(":")[0]));
  const semAvecBesoin = semaines.filter((s) => s.besoin > 0);
  const tauxMoyen = semAvecBesoin.length
    ? Math.round((semAvecBesoin.reduce((a, s) => a + s.taux, 0) / semAvecBesoin.length) * 100)
    : 100;
  const auMoinsUnBesoin = semaines.some((s) => s.besoin > 0);

  // Liste des ruptures : une ligne par (semaine, poste) non tenu.
  const ruptures = semaines.flatMap((s) => {
    const l = semLabel(s.semaine);
    return Object.entries(s.ruptureParPoste)
      .filter(([, manque]) => manque > 0)
      .map(([posteId, manque]) => ({
        semaine: s.semaine,
        semLabel: `${l.s} (${l.j})`,
        poste: posteNom.get(posteId)?.nom ?? "?",
        atelier: posteNom.get(posteId)?.atelier ?? "—",
        besoin: s.besoinParPoste[posteId] ?? 0,
        manque,
        banc: bancPoste[posteId] ?? 0,
      }));
  });

  // Postes qui ont du besoin quelque part sur l'horizon, groupes par atelier.
  const posteAUnBesoin = (id: string) => semaines.some((s) => (s.besoinParPoste[id] ?? 0) > 0);
  const postesVus = postes.filter((p) => posteAUnBesoin(p.id));
  const ateliersDetail = [...new Map(postesVus.map((p) => [p.atelierId ?? "—", p.atelierNom])).entries()];

  // Courbe de tendance : taux par semaine.
  const CW = 62, CH = 120, PAD = 8;
  const chartW = Math.max(1, semaines.length) * CW;
  const px = (i: number) => PAD + i * CW + CW / 2;
  const py = (taux: number) => PAD + (1 - Math.max(0, Math.min(1, taux))) * (CH - 2 * PAD);
  const pts = semaines.map((s, i) => `${px(i)},${py(s.taux)}`).join(" ");

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Projection de capacité</PageTitle>
            <div className="sub">
              {horizon} semaines · vue {couche === "reelle" ? "calendrier réel" : "structurelle"} · une personne polyvalente n&apos;est comptée qu&apos;<strong>une seule fois</strong> (affectation optimale)
            </div>
          </div>
          <ReportActions />
        </div>

        <ProjectionFilters horizon={horizon} couche={couche} />
        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />

        {!auMoinsUnBesoin ? (
          <div className="card"><p className="muted">Aucun besoin sur l&apos;horizon : ni ordonnancement initialisé, ni semaine-type définie sur ces semaines.</p></div>
        ) : (
          <>
            <div className="kpi-grid">
              <div className={`kpi ${enTension.length > 0 ? "danger" : "ok"}`}><div className="v">{enTension.length}</div><div className="l">Semaines en tension</div><div className="s">couvrable &lt; besoin</div></div>
              <div className={`kpi ${postesRupture.size > 0 ? "danger" : "ok"}`}><div className="v">{postesRupture.size}</div><div className="l">Postes en rupture</div><div className="s">au moins une semaine</div></div>
              <div className={`kpi ${tauxMoyen < 100 ? (tauxMoyen < 90 ? "danger" : "warn") : "ok"}`}><div className="v">{tauxMoyen}<small> %</small></div><div className="l">Taux de couverture réalisable</div><div className="s">moyen sur l&apos;horizon</div></div>
            </div>

            {/* Tableau tenue : global par semaine */}
            <div className="report-section">
              <h2>Tenue par semaine</h2>
              <div className="card" style={{ overflowX: "auto" }}>
                <table className="matrix" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", minWidth: 130 }}></th>
                      {semaines.map((s) => {
                        const l = semLabel(s.semaine);
                        return (
                          <th key={s.semaine} style={{ textAlign: "center", minWidth: 52, background: s.gabarit ? "#fffbeb" : "#f8fafc", fontSize: 12 }}>
                            {l.s}<br /><span className="muted" style={{ fontWeight: 400, fontSize: 9 }}>{l.j}{s.gabarit ? " *" : ""}</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, color: "var(--muted)" }}>Besoin</td>
                      {semaines.map((s) => (<td key={s.semaine} style={{ textAlign: "center", color: "var(--muted)", fontWeight: 700 }}>{s.besoin || ""}</td>))}
                    </tr>
                    <tr>
                      <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600 }}>Couvrable</td>
                      {semaines.map((s) => {
                        const manque = s.besoin > 0 && s.couvrable < s.besoin;
                        return (<td key={s.semaine} style={{ textAlign: "center", fontWeight: 700, color: manque ? "#7f1d1d" : s.besoin === 0 ? "#cbd5e1" : "var(--ok)", background: manque ? "#fee2e2" : undefined }}>{s.besoin === 0 ? "" : s.couvrable}</td>);
                      })}
                    </tr>
                    <tr>
                      <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600 }}>Taux</td>
                      {semaines.map((s) => {
                        const pct = Math.round(s.taux * 100);
                        const manque = s.besoin > 0 && s.couvrable < s.besoin;
                        return (<td key={s.semaine} style={{ textAlign: "center", fontWeight: 700, fontSize: 11, color: manque ? "#7f1d1d" : s.besoin === 0 ? "#cbd5e1" : "var(--ok)" }}>{s.besoin === 0 ? "—" : `${pct}%`}</td>);
                      })}
                    </tr>
                  </tbody>
                </table>
                <p className="muted" style={{ marginTop: 8 }}>
                  <strong>Couvrable</strong> = nombre de places réellement pourvoyables par affectation optimale (chaque personne présente et habilitée ne remplit qu&apos;un poste).
                  {" "}En <span style={{ color: "#7f1d1d", background: "#fee2e2", padding: "0 4px" }}>rouge</span> quand le besoin n&apos;est pas tenu.
                  {" "}Les semaines marquées <strong>*</strong> reposent sur la <strong>semaine-type</strong> (ordonnancement pas encore initialisé).
                </p>
              </div>
            </div>

            {/* Courbe de tendance */}
            <div className="report-section">
              <h2>Évolution du taux de couverture</h2>
              <div className="card" style={{ overflowX: "auto" }}>
                <svg width={chartW} height={CH + 26} style={{ display: "block" }} role="img" aria-label="Taux de couverture par semaine">
                  {[1, 0.9, 0.8].map((g) => (
                    <g key={g}>
                      <line x1={0} x2={chartW} y1={py(g)} y2={py(g)} stroke="#e2e8f0" strokeWidth={1} />
                      <text x={2} y={py(g) - 2} fontSize={9} fill="#94a3b8">{Math.round(g * 100)}%</text>
                    </g>
                  ))}
                  <polyline points={pts} fill="none" stroke="#4f46e5" strokeWidth={2} />
                  {semaines.map((s, i) => {
                    const manque = s.besoin > 0 && s.couvrable < s.besoin;
                    return (
                      <g key={s.semaine}>
                        <circle cx={px(i)} cy={py(s.taux)} r={4} fill={s.besoin === 0 ? "#cbd5e1" : manque ? "#dc2626" : "#16a34a"} />
                        <text x={px(i)} y={CH + 12} fontSize={9} fill="#64748b" textAnchor="middle">{semLabel(s.semaine).s}</text>
                        <text x={px(i)} y={CH + 22} fontSize={8} fill="#94a3b8" textAnchor="middle">{Math.round(s.taux * 100)}%</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Ruptures detaillees */}
            <div className="report-section">
              <h2>Ruptures détaillées</h2>
              <div className="card">
                {ruptures.length === 0 ? (
                  <p className="muted">Aucune rupture sur l&apos;horizon : le besoin est tenu chaque semaine.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Semaine</th><th>Atelier</th><th>Poste</th>
                        <th style={{ textAlign: "center" }}>Manque</th>
                        <th style={{ textAlign: "center" }}>Besoin</th>
                        <th style={{ textAlign: "center" }}>Relève (matrice)</th>
                        <th>Nature</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ruptures.slice(0, 60).map((r, i) => {
                        // Banc de fond insuffisant => probleme structurel ; sinon, le
                        // banc existe mais les personnes ne sont pas disponibles.
                        const structurel = r.banc < r.besoin;
                        return (
                          <tr key={i}>
                            <td>{r.semLabel}</td>
                            <td className="muted">{r.atelier}</td>
                            <td><strong>{r.poste}</strong></td>
                            <td style={{ textAlign: "center" }}><span className="rbadge danger">−{r.manque}</span></td>
                            <td style={{ textAlign: "center" }}>{r.besoin}</td>
                            <td style={{ textAlign: "center" }}><span className={`rbadge ${r.banc <= 1 ? "danger" : r.banc < r.besoin ? "warn" : ""}`}>{r.banc}</span></td>
                            <td className="muted">{structurel ? "Relève insuffisante (former / recruter)" : couche === "reelle" ? "Indisponibilités (absences, temps partiel)" : "Habilitations / disponibilité"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {ruptures.length > 60 && <p className="muted" style={{ marginTop: 6 }}>… et {ruptures.length - 60} autres.</p>}
                <p className="muted" style={{ marginTop: 8 }}>
                  <strong>Relève (matrice)</strong> = personnes distinctes atteignant le niveau requis, habilitations et calendrier mis à part.
                  {" "}Quand la relève est inférieure au besoin, le manque est <strong>structurel</strong> (banc trop court) ; sinon, le banc existe mais les personnes ne sont pas disponibles cette semaine. Astuce : ce qui reste rouge en vue <strong>Structurelle</strong> relève du banc ou des habilitations ; ce qui n&apos;apparaît qu&apos;en <strong>Calendrier réel</strong> vient des absences et du temps partiel.
                </p>
              </div>
            </div>

            {/* Detail par atelier / poste */}
            <div className="report-section">
              <h2>Détail par poste</h2>
              {ateliersDetail.map(([aid, anom]) => {
                const ps = postesVus.filter((p) => (p.atelierId ?? "—") === aid);
                return (
                  <div key={aid} className="card" style={{ overflowX: "auto", marginBottom: 14 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>{anom}</h3>
                    <table className="matrix" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", minWidth: 150 }}>Poste</th>
                          {semaines.map((s) => (<th key={s.semaine} style={{ textAlign: "center", minWidth: 48, fontSize: 11, background: s.gabarit ? "#fffbeb" : "#f8fafc" }}>{semLabel(s.semaine).s}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {ps.map((p) => (
                          <tr key={p.id}>
                            <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{p.nom}</td>
                            {semaines.map((s) => {
                              const bes = s.besoinParPoste[p.id] ?? 0;
                              const rup = s.ruptureParPoste[p.id] ?? 0;
                              const couv = bes - rup;
                              if (bes === 0) return <td key={s.semaine} style={{ textAlign: "center", color: "#e2e8f0" }}>·</td>;
                              return (
                                <td key={s.semaine} title={`${couv} couvrable / ${bes} besoin`} style={{ textAlign: "center", fontWeight: 700, fontSize: 11, color: rup > 0 ? "#7f1d1d" : "var(--ok)", background: rup > 0 ? "#fee2e2" : undefined }}>
                                  {couv}<span style={{ fontWeight: 400, opacity: 0.7 }}>/{bes}</span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
