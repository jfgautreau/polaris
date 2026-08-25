import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { isoDate, monthLabel } from "@/lib/week";
import { grouperAbsences } from "@/lib/absences-periodes";
import { estNonPlanifie, bradford, palierBradford, type PalierBradford } from "@/lib/absenteisme";

// Absentéisme v2 : tendance 12 mois avec distinction PLANIFIÉ / NON PLANIFIÉ
// (le non planifié — maladie, AT, injustifié — est le vrai risque ligne),
// facteur de Bradford par personne, et vue par équipe.

type Motif = { id: string; code_court: string | null; libelle: string | null; couleur: string | null; non_planifie?: boolean | null };
type Placement = { personne_id: string; jour: string; poste_id: string | null; motif_absence_id: string | null };
type Personne = { id: string; nom: string; prenom: string; statut: string; equipe_id: string | null; atelier_id: string | null };

// Jours ouvrés (lundi-vendredi) d'un mois. Base contractuelle standard pour un
// taux d'absence — indépendante du remplissage du planning.
function joursOuvres(y: number, m0: number): number {
  let n = 0;
  const dernier = new Date(y, m0 + 1, 0).getDate();
  for (let d = 1; d <= dernier; d++) { const wd = new Date(y, m0, d).getDay(); if (wd >= 1 && wd <= 5) n++; }
  return n;
}

export default async function AbsenteismeReport({ searchParams }: { searchParams: Promise<{ atelier?: string }> }) {
  const { profile } = await requireRapportBilan("absenteisme");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";

  // Fenêtre = 12 mois glissants finissant au mois courant.
  const now = new Date();
  const mois: { key: string; y: number; m0: number; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    mois.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, y: d.getFullYear(), m0: d.getMonth(), label: monthLabel(d.getFullYear(), d.getMonth()) });
  }
  const firstIso = `${mois[0].key}-01`;
  const lastIso = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const supabase = await getServerClient();
  const [motifsR, { data: persD }, { data: eqD }, { data: atD }, plD] = await Promise.all([
    supabase.from("motif_absence").select("id, code_court, libelle, couleur, non_planifie").returns<Motif[]>(),
    supabase.from("personne").select("id, nom, prenom, statut, equipe_id, atelier_id").returns<Personne[]>(),
    supabase.from("equipe").select("id, nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    fetchAll<Placement>(() => supabase.from("placement").select("personne_id, jour, poste_id, motif_absence_id").gte("jour", firstIso).lte("jour", lastIso).order("id").returns<Placement[]>()),
  ]);
  // Repli sur l'heuristique de libellé tant que la migration 0060 (colonne
  // non_planifie) n'est pas jouée : on relit les motifs sans la colonne.
  let motD = motifsR.data;
  if (motifsR.error) {
    const { data } = await supabase.from("motif_absence").select("id, code_court, libelle, couleur").returns<Motif[]>();
    motD = data;
  }

  const persById = new Map((persD ?? []).map((p) => [p.id, p]));
  const eqNom = (id: string | null) => (id ? (eqD ?? []).find((e) => e.id === id)?.nom ?? "—" : "Sans équipe");
  const nonPlanifie = new Map((motD ?? []).map((m) => [m.id, estNonPlanifie(m)]));

  // Population de référence = personnes ACTIVES du périmètre (atelier). Le taux
  // se mesure sur cet effectif × jours ouvrés — jamais sur les jours placés, très
  // incomplets rétroactivement (le planning n'est pas rempli mois par mois).
  const actifs = (persD ?? []).filter((p) => p.statut === "ACTIF" && (!atelier || p.atelier_id === atelier));
  const actifSet = new Set(actifs.map((p) => p.id));
  const effectif = actifs.length;
  const placements = plD.filter((r) => actifSet.has(r.personne_id));

  // ---- Tendance 12 mois : jours d'absence planifiée / non planifiée ----
  type MoisAgg = { plan: number; np: number };
  const parMois = new Map<string, MoisAgg>();
  for (const mo of mois) parMois.set(mo.key, { plan: 0, np: 0 });
  for (const r of placements) {
    if (!r.motif_absence_id) continue;
    const agg = parMois.get(r.jour.slice(0, 7));
    if (!agg) continue;
    if (nonPlanifie.get(r.motif_absence_id)) agg.np++;
    else agg.plan++;
  }
  const serie = mois.map((mo) => {
    const a = parMois.get(mo.key)!;
    const base = effectif * joursOuvres(mo.y, mo.m0); // jours théoriques travaillables
    return { ...mo, ...a, base, tauxNP: base ? a.np / base : 0, tauxPlan: base ? a.plan / base : 0, tauxTot: base ? (a.plan + a.np) / base : 0 };
  });

  const totPlan = serie.reduce((s, x) => s + x.plan, 0);
  const totNP = serie.reduce((s, x) => s + x.np, 0);
  const base12 = serie.reduce((s, x) => s + x.base, 0);
  const tauxNP12 = base12 ? Math.round((totNP / base12) * 1000) / 10 : 0;
  const tauxTot12 = base12 ? Math.round(((totPlan + totNP) / base12) * 1000) / 10 : 0;

  // ---- Bradford par personne (sur le NON PLANIFIÉ, 12 mois) ----
  const npByPers = new Map<string, { jour: string; motif_absence_id: string | null }[]>();
  for (const r of placements) if (r.motif_absence_id && nonPlanifie.get(r.motif_absence_id)) (npByPers.get(r.personne_id) ?? npByPers.set(r.personne_id, []).get(r.personne_id)!).push({ jour: r.jour, motif_absence_id: r.motif_absence_id });
  const bradfords = [...npByPers.entries()]
    .map(([id, jours]) => {
      const periodes = grouperAbsences(jours);
      const episodes = periodes.length;
      const total = periodes.reduce((s, p) => s + p.jours, 0);
      const score = bradford(episodes, total);
      const pr = persById.get(id);
      return { id, nom: pr ? `${pr.nom} ${pr.prenom}` : "?", equipe: eqNom(pr?.equipe_id ?? null), episodes, jours: total, score, palier: palierBradford(score) };
    })
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score);
  const nbAlerte = bradfords.filter((b) => b.palier === "alerte" || b.palier === "critique").length;

  // ---- Par équipe : taux non planifié 12 mois (effectif équipe × jours ouvrés) ----
  const ouvres12 = mois.reduce((s, mo) => s + joursOuvres(mo.y, mo.m0), 0);
  const effEquipe = new Map<string, number>();
  for (const p of actifs) effEquipe.set(p.equipe_id ?? "", (effEquipe.get(p.equipe_id ?? "") ?? 0) + 1);
  const npEquipe = new Map<string, number>();
  for (const r of placements) if (r.motif_absence_id && nonPlanifie.get(r.motif_absence_id)) { const eq = persById.get(r.personne_id)?.equipe_id ?? ""; npEquipe.set(eq, (npEquipe.get(eq) ?? 0) + 1); }
  const parEquipe = [...effEquipe.entries()]
    .map(([eq, eff]) => { const np = npEquipe.get(eq) ?? 0; const base = eff * ouvres12; return { equipe: eqNom(eq || null), taux: base ? Math.round((np / base) * 1000) / 10 : 0, np }; })
    .filter((x) => x.np > 0)
    .sort((a, b) => b.taux - a.taux);

  // Graphe : barres empilées planifié (clair) / non planifié (rouge), en % de la base.
  const CW = 78, CH = 150, PAD = 10;
  const chartW = Math.max(1, serie.length) * CW;
  const maxTaux = Math.max(0.05, ...serie.map((s) => s.tauxTot));
  const hOf = (t: number) => (t / maxTaux) * (CH - 2 * PAD);
  const palColor: Record<PalierBradford, string> = { ok: "#16a34a", surveiller: "#d97706", alerte: "#dc2626", critique: "#7f1d1d" };
  const palLabel: Record<PalierBradford, string> = { ok: "OK", surveiller: "à surveiller", alerte: "alerte", critique: "critique" };

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Absentéisme</PageTitle>
            <div className="sub">12 mois glissants · distinction planifié / non planifié · facteur de Bradford</div>
          </div>
          <ReportActions />
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />

        <div className="kpi-grid">
          <div className={`kpi ${tauxNP12 >= 4 ? "danger" : tauxNP12 >= 2 ? "warn" : "ok"}`}><div className="v">{tauxNP12}<small> %</small></div><div className="l">Taux non planifié</div><div className="s">maladie · AT · injustifié (12 mois)</div></div>
          <div className="kpi"><div className="v">{tauxTot12}<small> %</small></div><div className="l">Taux d&apos;absence total</div><div className="s">planifié + non planifié</div></div>
          <div className={`kpi ${nbAlerte > 0 ? "danger" : "ok"}`}><div className="v">{nbAlerte}</div><div className="l">Bradford en alerte</div><div className="s">absences courtes &amp; répétées</div></div>
          <div className="kpi"><div className="v">{totNP}</div><div className="l">Jours non planifiés</div><div className="s">sur 12 mois</div></div>
        </div>

        {/* Tendance 12 mois */}
        <div className="report-section">
          <h2>Tendance — 12 mois glissants</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <svg width={chartW} height={CH + 34} role="img" aria-label="Taux d'absence par mois">
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1={0} x2={chartW} y1={PAD + (1 - f) * (CH - 2 * PAD)} y2={PAD + (1 - f) * (CH - 2 * PAD)} stroke="#f1f5f9" />
              ))}
              {serie.map((s, i) => {
                const x = i * CW + CW / 2;
                const hNP = hOf(s.tauxNP), hPlan = hOf(s.tauxPlan);
                const yBase = CH - PAD;
                return (
                  <g key={s.key}>
                    <rect x={x - 16} y={yBase - hPlan} width={32} height={hPlan} fill="#cbd5e1" />
                    <rect x={x - 16} y={yBase - hPlan - hNP} width={32} height={hNP} fill="#dc2626" />
                    <text x={x} y={yBase - hPlan - hNP - 3} fontSize={9} fill="#7f1d1d" textAnchor="middle" fontWeight={700}>{s.np || ""}</text>
                    <text x={x} y={CH + 12} fontSize={9} fill="#64748b" textAnchor="middle">{s.label.slice(0, 3)}</text>
                    <text x={x} y={CH + 24} fontSize={8} fill="#94a3b8" textAnchor="middle">{Math.round(s.tauxTot * 100)}%</text>
                  </g>
                );
              })}
            </svg>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              <span style={{ background: "#dc2626", color: "#fff", padding: "0 5px", borderRadius: 3 }}>non planifié</span>{" "}
              <span style={{ background: "#cbd5e1", padding: "0 5px", borderRadius: 3 }}>planifié</span>{" "}
              · en % des jours théoriques travaillables du mois (effectif actif × jours ouvrés). Le chiffre rouge = jours non planifiés.
            </p>
          </div>
        </div>

        {/* Bradford */}
        <div className="report-section">
          <h2>Facteur de Bradford — absences non planifiées répétées</h2>
          <div className="card">
            {bradfords.length === 0 ? <p className="muted">Aucune absence non planifiée sur 12 mois.</p> : (
              <table>
                <thead><tr><th>Personne</th><th>Équipe</th><th style={{ textAlign: "center" }}>Épisodes</th><th style={{ textAlign: "center" }}>Jours</th><th style={{ textAlign: "center" }}>Bradford</th><th style={{ textAlign: "right" }}>Niveau</th></tr></thead>
                <tbody>
                  {bradfords.slice(0, 20).map((b) => (
                    <tr key={b.id}>
                      <td>{b.nom}</td>
                      <td className="muted">{b.equipe}</td>
                      <td style={{ textAlign: "center" }}>{b.episodes}</td>
                      <td style={{ textAlign: "center" }}>{b.jours}</td>
                      <td style={{ textAlign: "center", fontWeight: 700 }}>{b.score}</td>
                      <td style={{ textAlign: "right" }}><span className="rbadge" style={{ background: palColor[b.palier], color: "#fff" }}>{palLabel[b.palier]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Bradford = épisodes² × jours, sur le <strong>non planifié</strong> des 12 derniers mois. Un même total de jours pèse d&apos;autant plus qu&apos;il est fractionné en absences courtes et répétées. Seuils : &gt; 50 à surveiller · &gt; 200 alerte · &gt; 500 critique.
            </p>
          </div>
        </div>

        {/* Par équipe */}
        <div className="report-section">
          <h2>Taux non planifié par équipe (12 mois)</h2>
          <div className="card">
            {parEquipe.length === 0 ? <p className="muted">Aucune absence non planifiée.</p> : (
              <table>
                <thead><tr><th>Équipe</th><th style={{ textAlign: "center" }}>Jours non planifiés</th><th style={{ textAlign: "right" }}>Taux</th></tr></thead>
                <tbody>
                  {parEquipe.map((e, i) => (
                    <tr key={i}>
                      <td><strong>{e.equipe}</strong></td>
                      <td style={{ textAlign: "center" }}>{e.np}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: e.taux >= 4 ? "var(--danger)" : e.taux >= 2 ? "#9a3412" : "var(--ok)" }}>{e.taux} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
