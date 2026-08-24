import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import PrintButton from "@/components/PrintButton";
import { requireModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { isoDate, addDays, monthDays, monthLabel } from "@/lib/week";

type Personne = {
  id: string;
  nom: string;
  prenom: string;
  statut: string;
  type_contrat: string;
  date_fin: string | null;
  equipe_id: string | null;
  sexe: string | null;
};
type LigneRow = { id: string; nom: string; poste: { id: string; nom: string; actif: boolean }[] };
type Mat = { personne_id: string; poste_id: string };

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export default async function CockpitPage() {
  const { profile } = await requireModule("bilans", "read");

  const today = new Date();
  const todayIso = isoDate(today);
  const in30Iso = isoDate(addDays(today, 30));
  const in60Iso = isoDate(addDays(today, 60));
  const monthIsos = monthDays(today.getFullYear(), today.getMonth()).map((d) => d.iso);

  const supabase = await getServerClient();
  const [{ data: persD }, { data: lignesD }, matD, plD, { data: eqD }] =
    await Promise.all([
      supabase
        .from("personne")
        .select("id, nom, prenom, statut, type_contrat, date_fin, equipe_id, sexe")
        .returns<Personne[]>(),
      supabase.from("ligne").select("id, nom, poste(id, nom, actif)").eq("actif", true).returns<LigneRow[]>(),
      fetchAll<Mat>(() => supabase.from("matrice").select("personne_id, poste_id").gte("niveau_actuel", 2).order("id").returns<Mat[]>()),
      fetchAll<{ poste_id: string | null; motif_absence_id: string | null }>(() =>
        supabase
          .from("placement")
          .select("poste_id, motif_absence_id")
          .in("jour", monthIsos)
          .order("id")
          .returns<{ poste_id: string | null; motif_absence_id: string | null }[]>()
      ),
      supabase.from("equipe").select("id, nom").returns<{ id: string; nom: string }[]>(),
    ]);

  const persons = persD ?? [];
  const active = persons.filter((p) => p.statut === "ACTIF");
  const activeIds = new Set(active.map((p) => p.id));
  const effectifActif = active.length;
  const nb = (t: string) => active.filter((p) => p.type_contrat === t).length;
  const interim = nb("INTERIM");
  const cdd = nb("CDD");
  const cdi = nb("CDI");
  const pctInterim = effectifActif ? Math.round((interim / effectifActif) * 100) : 0;

  // Repartition H / F
  const hommes = active.filter((p) => p.sexe === "H").length;
  const femmes = active.filter((p) => p.sexe === "F").length;
  const sexeRens = hommes + femmes;
  const pctH = sexeRens ? Math.round((hommes / sexeRens) * 100) : 0;
  const pctF = sexeRens ? 100 - pctH : 0;
  const sexeNr = effectifActif - sexeRens;

  // Fins de contrat a venir (CDD / interim actifs)
  const finsContrat = active
    .filter((p) => p.type_contrat !== "CDI" && p.date_fin && p.date_fin >= todayIso && p.date_fin <= in60Iso)
    .sort((a, b) => (a.date_fin ?? "").localeCompare(b.date_fin ?? ""));
  const fin30 = finsContrat.filter((p) => (p.date_fin ?? "") <= in30Iso).length;

  // Absences du mois
  const placements = plD;
  const absDays = placements.filter((r) => r.motif_absence_id).length;
  const presentDays = placements.filter((r) => r.poste_id).length;
  const tauxAbs = absDays + presentDays > 0 ? Math.round((absDays / (absDays + presentDays)) * 100) : 0;

  // Postes fragiles : nb de personnes actives competentes (niveau >= 2) par poste
  const postes = (lignesD ?? []).flatMap((l) =>
    (l.poste ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, nom: p.nom, ligne: l.nom }))
  );
  const compByPoste = new Map<string, Set<string>>();
  for (const r of matD) {
    if (!activeIds.has(r.personne_id)) continue;
    (compByPoste.get(r.poste_id) ?? compByPoste.set(r.poste_id, new Set()).get(r.poste_id)!).add(r.personne_id);
  }
  const postesEval = postes.map((p) => ({ ...p, n: compByPoste.get(p.id)?.size ?? 0 }));
  const fragiles = postesEval.filter((p) => p.n <= 1).sort((a, b) => a.n - b.n);
  const sansReleve = postesEval.filter((p) => p.n === 0).length;

  const eqNom = (id: string | null) => (id ? (eqD ?? []).find((e) => e.id === id)?.nom ?? "—" : "—");

  const categories = [
    { href: "/bilans/personnel", ic: "👥", t: "Personnel", d: "Effectif, contrats, absentéisme, mouvements.", on: true },
    { href: "/bilans/polyvalence", ic: "🎯", t: "Polyvalence & compétences", d: "Compétence moyenne par atelier, postes fragiles, écarts cible, habilitations.", on: true },
    { href: "/bilans/montee-competence", ic: "📈", t: "Plan de montée en compétence", d: "Actuel vs cible en global, puis qui former sur quel poste, atelier par atelier.", on: true },
    { href: "/bilans/couverture", ic: "🛡️", t: "Adéquation Charge / capacité", d: "Besoin d'après l'ordonnancement vs présents, par quart et par atelier.", on: true },
    { href: "/bilans/anticipation", ic: "🔭", t: "Anticipation", d: "Capacité vs charge à venir, impact des absences et des fins de contrat.", on: true },
    { href: "/bilans/projection", ic: "🧮", t: "Projection de capacité", d: "Tenue semaine par semaine sur 4/8/12 sem. : une personne polyvalente compte pour une seule place (affectation optimale). Habilitations expirées déduites.", on: true },
  ];

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Cockpit — pilotage d&apos;équipe</PageTitle>
            <div className="sub">Synthèse au {fmtDate(todayIso)} · absences sur {monthLabel(today.getFullYear(), today.getMonth())}</div>
          </div>
          <PrintButton />
        </div>

        {/* KPIs */}
        <div className="kpi-grid">
          <div className="kpi">
            <div className="v">{effectifActif}</div>
            <div className="l">Effectif actif</div>
            <div className="s">{cdi} CDI · {cdd} CDD · {interim} intérim</div>
          </div>
          <div className={`kpi ${pctInterim >= 25 ? "warn" : ""}`}>
            <div className="v">{pctInterim}<small> %</small></div>
            <div className="l">Part d&apos;intérim</div>
            <div className="s">{interim} intérimaire{interim > 1 ? "s" : ""}</div>
          </div>
          <div className="kpi">
            <div className="v">
              <span style={{ color: "#1d4ed8" }}>{hommes}</span>
              <span style={{ color: "var(--muted)", fontSize: 18 }}> / </span>
              <span style={{ color: "#db2777" }}>{femmes}</span>
            </div>
            <div className="l">Hommes / Femmes</div>
            <div className="s">{pctH}% H · {pctF}% F{sexeNr > 0 ? ` · ${sexeNr} n.r.` : ""}</div>
          </div>
          <div className={`kpi ${fin30 > 0 ? "danger" : finsContrat.length > 0 ? "warn" : "ok"}`}>
            <div className="v">{fin30}</div>
            <div className="l">Contrats &lt; 30 j</div>
            <div className="s">{finsContrat.length} sur 60 jours</div>
          </div>
          <div className={`kpi ${tauxAbs >= 10 ? "danger" : tauxAbs >= 5 ? "warn" : "ok"}`}>
            <div className="v">{tauxAbs}<small> %</small></div>
            <div className="l">Taux d&apos;absence (mois)</div>
            <div className="s">{absDays} j d&apos;absence</div>
          </div>
          <div className={`kpi ${fragiles.length > 0 ? "warn" : "ok"}`}>
            <div className="v">{fragiles.length}</div>
            <div className="l">Postes fragiles</div>
            <div className="s">≤ 1 personne compétente</div>
          </div>
          <div className={`kpi ${sansReleve > 0 ? "danger" : "ok"}`}>
            <div className="v">{sansReleve}</div>
            <div className="l">Postes sans relève</div>
            <div className="s">aucune personne compétente</div>
          </div>
        </div>

        {/* Alertes */}
        <div className="report-grid2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 15 }}>Fins de contrat à venir (60 j)</h2>
            {finsContrat.length === 0 ? (
              <p className="muted">Aucune fin de contrat dans les 60 jours.</p>
            ) : (
              <table>
                <tbody>
                  {finsContrat.slice(0, 8).map((p) => {
                    const urgent = (p.date_fin ?? "") <= in30Iso;
                    return (
                      <tr key={p.id}>
                        <td>{p.nom} {p.prenom}</td>
                        <td className="muted">{p.type_contrat === "INTERIM" ? "Intérim" : p.type_contrat} · {eqNom(p.equipe_id)}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className={`rbadge ${urgent ? "danger" : "warn"}`}>{fmtDate(p.date_fin)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 15 }}>Postes fragiles</h2>
            {fragiles.length === 0 ? (
              <p className="muted">Aucun poste fragile : chaque poste a au moins 2 personnes compétentes.</p>
            ) : (
              <table>
                <tbody>
                  {fragiles.slice(0, 8).map((p) => (
                    <tr key={p.id}>
                      <td>{p.nom}</td>
                      <td className="muted">{p.ligne}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className={`rbadge ${p.n === 0 ? "danger" : "warn"}`}>
                          {p.n === 0 ? "aucune relève" : "1 personne"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Navigation par categorie */}
        <div className="report-section">
          <h2>Rapports détaillés</h2>
          <div className="navcards">
            {categories.map((c) => (
              <Link key={c.t} href={c.on ? c.href : "#"} className={`navcard ${c.on ? "" : "disabled"}`}>
                <div className="ic">{c.ic}</div>
                <div className="t">{c.t}{!c.on && " · à venir"}</div>
                <div className="d">{c.d}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
