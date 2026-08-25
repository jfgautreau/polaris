import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import ReportActions from "@/app/bilans/ReportActions";
import OrdoMonthNav from "@/app/ordonnancement/OrdoMonthNav";
import Bars from "@/app/bilans/Bars";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import { requireModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { parseMois, monthDays, monthLabel, isoDate, addDays } from "@/lib/week";

type Personne = {
  id: string;
  nom: string;
  prenom: string;
  statut: string;
  type_contrat: string;
  date_debut: string | null;
  date_fin: string | null;
  equipe_id: string | null;
  atelier_id: string | null;
};
type Named = { id: string; nom: string };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };
type Placement = { personne_id: string; poste_id: string | null; motif_absence_id: string | null };

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export default async function PersonnelReport({ searchParams }: { searchParams: Promise<{ mois?: string; atelier?: string }> }) {
  const { profile } = await requireModule("bilans", "read");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const { year, month0 } = parseMois(sp.mois);
  const days = monthDays(year, month0);
  const monthIsos = days.map((d) => d.iso);
  const moisDebut = monthIsos[0];
  const moisFin = monthIsos[monthIsos.length - 1];
  const todayIso = isoDate(new Date());
  const in90Iso = isoDate(addDays(new Date(), 90));

  const supabase = await getServerClient();
  const [{ data: persD }, { data: eqD }, { data: atD }, { data: motD }, plD] = await Promise.all([
    supabase
      .from("personne")
      .select("id, nom, prenom, statut, type_contrat, date_debut, date_fin, equipe_id, atelier_id")
      .returns<Personne[]>(),
    supabase.from("equipe").select("id, nom").returns<Named[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<Named[]>(),
    supabase.from("motif_absence").select("id, code_court, libelle, couleur").order("libelle").returns<Motif[]>(),
    fetchAll<Placement>(() =>
      supabase.from("placement").select("personne_id, poste_id, motif_absence_id").in("jour", monthIsos).order("id").returns<Placement[]>()
    ),
  ]);

  const allPersons = persD ?? [];
  const inAt = (p: Personne) => !atelier || p.atelier_id === atelier;
  const persons = allPersons.filter(inAt);
  const persAtelier = new Map(allPersons.map((p) => [p.id, p.atelier_id]));
  const active = persons.filter((p) => p.statut === "ACTIF");
  const eqNom = (id: string | null) => (id ? (eqD ?? []).find((e) => e.id === id)?.nom ?? "—" : "Sans équipe");
  const atNom = (id: string | null) => (id ? (atD ?? []).find((a) => a.id === id)?.nom ?? "—" : "Sans atelier");
  const persNom = (id: string) => {
    const p = persons.find((x) => x.id === id);
    return p ? `${p.nom} ${p.prenom}` : "?";
  };

  // ---- 1.1 Effectif & contrats ----
  const cdi = active.filter((p) => p.type_contrat === "CDI").length;
  const cdd = active.filter((p) => p.type_contrat === "CDD").length;
  const interim = active.filter((p) => p.type_contrat === "INTERIM").length;

  const countBy = (key: (p: Personne) => string, label: (k: string) => string) => {
    const m = new Map<string, number>();
    for (const p of active) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ label: label(k), n })).sort((a, b) => b.n - a.n);
  };
  const parEquipe = countBy((p) => p.equipe_id ?? "", (k) => eqNom(k || null));
  const parAtelier = countBy((p) => p.atelier_id ?? "", (k) => atNom(k || null));

  const finsContrat = active
    .filter((p) => p.type_contrat !== "CDI" && p.date_fin && p.date_fin >= todayIso && p.date_fin <= in90Iso)
    .sort((a, b) => (a.date_fin ?? "").localeCompare(b.date_fin ?? ""));

  // ---- 1.2 Absentéisme (mois) ----
  const placements = plD.filter((r) => !atelier || persAtelier.get(r.personne_id) === atelier);
  const absDays = placements.filter((r) => r.motif_absence_id).length;
  const presentDays = placements.filter((r) => r.poste_id).length;
  const taux = absDays + presentDays > 0 ? Math.round((absDays / (absDays + presentDays)) * 1000) / 10 : 0;

  const motifs = motD ?? [];
  const absParMotif = motifs
    .map((m) => ({
      label: `${m.code_court} · ${m.libelle}`,
      n: placements.filter((r) => r.motif_absence_id === m.id).length,
      color: m.couleur,
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  // ---- 1.3 Mouvements (mois) ----
  // HORS INTERIM : les entrees et sorties d'interimaires sont permanentes et
  // noieraient le signal ; ce bloc suit les mouvements de l'effectif propre.
  const inMonth = (d: string | null) => !!d && d >= moisDebut && d <= moisFin;
  const permanents = persons.filter((p) => p.type_contrat !== "INTERIM");
  const arrivees = permanents.filter((p) => inMonth(p.date_debut)).sort((a, b) => (a.date_debut ?? "").localeCompare(b.date_debut ?? ""));
  const departs = permanents.filter((p) => inMonth(p.date_fin)).sort((a, b) => (a.date_fin ?? "").localeCompare(b.date_fin ?? ""));

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <h1>Personnel</h1>
            <div className="sub">Effectif au {fmtDate(todayIso)} · absences et mouvements sur {monthLabel(year, month0)}</div>
          </div>
          <ReportActions />
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />
        <div className="noprint">
          <OrdoMonthNav base="/bilans/personnel" year={year} month0={month0} />
        </div>

        {/* 1.1 Effectif & contrats */}
        <div className="report-section">
          <h2>Effectif &amp; contrats</h2>
          <div className="kpi-grid">
            <div className="kpi"><div className="v">{active.length}</div><div className="l">Effectif actif</div></div>
            <div className="kpi ok"><div className="v">{cdi}</div><div className="l">CDI</div></div>
            <div className="kpi warn"><div className="v">{cdd}</div><div className="l">CDD</div></div>
            <div className="kpi accent"><div className="v">{interim}</div><div className="l">Intérim</div></div>
          </div>
          <div className="report-grid2">
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Répartition par équipe</h2>
              <Bars items={parEquipe} />
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Répartition par atelier</h2>
              <Bars items={parAtelier} accent="#7c3aed" />
            </div>
          </div>
          <div className="card section" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: 15 }}>Fins de contrat à venir (90 jours)</h2>
            {finsContrat.length === 0 ? (
              <p className="muted">Aucune fin de contrat dans les 90 jours.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Personne</th><th>Contrat</th><th>Équipe</th><th style={{ textAlign: "right" }}>Fin</th></tr>
                </thead>
                <tbody>
                  {finsContrat.map((p) => {
                    const urgent = (p.date_fin ?? "") <= isoDate(addDays(new Date(), 30));
                    return (
                      <tr key={p.id}>
                        <td>{p.nom} {p.prenom}</td>
                        <td>{p.type_contrat === "INTERIM" ? "Intérim" : p.type_contrat}</td>
                        <td className="muted">{eqNom(p.equipe_id)}</td>
                        <td style={{ textAlign: "right" }}><span className={`rbadge ${urgent ? "danger" : "warn"}`}>{fmtDate(p.date_fin)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 1.2 Absentéisme */}
        <div className="report-section">
          <h2>Absentéisme · {monthLabel(year, month0)} <Link href="/bilans/absenteisme" className="navlink" style={{ fontSize: 13, fontWeight: 400 }}>Analyse 12 mois &amp; Bradford &rarr;</Link></h2>
          <div className="kpi-grid">
            <div className={`kpi ${taux >= 10 ? "danger" : taux >= 5 ? "warn" : "ok"}`}>
              <div className="v">{taux}<small> %</small></div>
              <div className="l">Taux d&apos;absence</div>
              <div className="s">jours d&apos;absence / jours travaillés</div>
            </div>
            <div className="kpi"><div className="v">{absDays}</div><div className="l">Jours d&apos;absence</div></div>
            <div className="kpi"><div className="v">{presentDays}</div><div className="l">Jours travaillés</div></div>
          </div>
          {/* « Personnes les plus absentes » retire : nommer les gens dans un
              rapport imprimable posait plus de problemes qu'il n'en resolvait. */}
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 15 }}>Jours d&apos;absence par motif</h2>
            <Bars items={absParMotif} />
          </div>
        </div>

        {/* 1.3 Mouvements */}
        <div className="report-section">
          <h2>Mouvements hors intérim · {monthLabel(year, month0)}</h2>
          <div className="kpi-grid">
            <div className="kpi ok"><div className="v">{arrivees.length}</div><div className="l">Entrées</div></div>
            <div className="kpi warn"><div className="v">{departs.length}</div><div className="l">Sorties / fins de contrat</div></div>
          </div>
          <div className="report-grid2">
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Entrées du mois</h2>
              {arrivees.length === 0 ? <p className="muted">Aucune entrée.</p> : (
                <table><tbody>
                  {arrivees.map((p) => (
                    <tr key={p.id}><td>{p.nom} {p.prenom}</td><td className="muted">{p.type_contrat} · {eqNom(p.equipe_id)}</td><td style={{ textAlign: "right" }}>{fmtDate(p.date_debut)}</td></tr>
                  ))}
                </tbody></table>
              )}
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Sorties / fins de contrat du mois</h2>
              {departs.length === 0 ? <p className="muted">Aucune sortie.</p> : (
                <table><tbody>
                  {departs.map((p) => (
                    <tr key={p.id}><td>{p.nom} {p.prenom}</td><td className="muted">{p.type_contrat} · {eqNom(p.equipe_id)}</td><td style={{ textAlign: "right" }}>{fmtDate(p.date_fin)}</td></tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Entrées = début de contrat dans le mois · Sorties = fin de contrat dans le mois.
            <strong> Les intérimaires sont exclus</strong> : leurs entrées et sorties, très
            nombreuses, masqueraient les mouvements de l&apos;effectif propre.
          </p>
        </div>
      </div>
    </>
  );
}
