import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import OrdoMonthNav from "@/app/ordonnancement/OrdoMonthNav";
import { requireModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { isoDate, isoWeekNumber, parseMois, monthDays, monthLabel } from "@/lib/week";
import { buildJourFlow, type BesoinPoste, type PersonneDispo } from "@/lib/projection-capacite";

type LigneRow = { id: string; nom: string; atelier_id: string | null; poste: { id: string; nom: string; actif: boolean; effectif_requis: number; categorie: string }[] };

const CATS = [
  { key: "manager", label: "Managers" },
  { key: "conducteur", label: "Conducteurs" },
  { key: "operateur", label: "Opérateurs" },
] as const;
const JN = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
type Personne = { id: string; nom: string; prenom: string; type_contrat: string; date_fin: string | null };
type Placement = { personne_id: string; jour: string; motif_absence_id: string | null };
type Mat = { personne_id: string; poste_id: string; niveau_actuel: number };

const SEUIL = 2;
const fmtDate = (d: string) => d.split("-").reverse().join("/");

export default async function AnticipationReport({ searchParams }: { searchParams: Promise<{ atelier?: string; mois?: string }> }) {
  const { profile } = await requireModule("bilans", "read");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const { year, month0 } = parseMois(sp.mois);

  const todayIso = isoDate(new Date());
  const horizonIsos = monthDays(year, month0).map((d) => d.iso);
  const firstIso = horizonIsos[0];
  const lastIso = horizonIsos[horizonIsos.length - 1];

  const supabase = await getServerClient();
  const [{ data: lignesD }, { data: quartsD }, { data: jqD }, ovD, { data: pqOffD }, { data: persD }, plD, matD, { data: atD }] =
    await Promise.all([
      supabase.from("ligne").select("id, nom, atelier_id, poste(id, nom, actif, effectif_requis, categorie)").eq("actif", true).returns<LigneRow[]>(),
      supabase.from("quart").select("code").returns<{ code: string }[]>(),
      supabase.from("jour_quart").select("jour, quart_code, actif").in("jour", horizonIsos).returns<{ jour: string; quart_code: string; actif: boolean }[]>(),
      fetchAll<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }>(() =>
        supabase.from("ouverture_quart").select("jour, ligne_id, quart_code, ouverte").in("jour", horizonIsos).order("jour").order("ligne_id").order("quart_code").returns<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }[]>()
      ),
      supabase.from("poste_quart").select("poste_id, quart_code").eq("actif", false).returns<{ poste_id: string; quart_code: string }[]>(),
      supabase.from("personne").select("id, nom, prenom, type_contrat, date_fin").eq("statut", "ACTIF").returns<Personne[]>(),
      fetchAll<Placement>(() =>
        supabase.from("placement").select("personne_id, jour, motif_absence_id").in("jour", horizonIsos).order("id").returns<Placement[]>()
      ),
      fetchAll<Mat>(() => supabase.from("matrice").select("personne_id, poste_id, niveau_actuel").gte("niveau_actuel", SEUIL).order("id").returns<Mat[]>()),
      supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    ]);

  const quarts = (quartsD ?? []).map((q) => q.code);
  const pqOff = new Set((pqOffD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`));
  const actMap = new Map<string, boolean>();
  for (const r of jqD ?? []) actMap.set(`${r.quart_code}:${r.jour}`, r.actif);
  const ouvMap = new Map<string, boolean>();
  for (const r of ovD) ouvMap.set(`${r.quart_code}:${r.ligne_id}:${r.jour}`, r.ouverte);
  const quartActif = (q: string, iso: string) => actMap.get(`${q}:${iso}`) ?? false;
  const ligneOuverte = (lid: string, q: string, iso: string) => ouvMap.get(`${q}:${lid}:${iso}`) ?? true;
  const lignes = (lignesD ?? []).filter((l) => !atelier || l.atelier_id === atelier);
  const scopedPosteIds = new Set(lignes.flatMap((l) => (l.poste ?? []).filter((p) => p.actif).map((p) => p.id)));
  const besoinJour = (iso: string) => {
    let b = 0;
    for (const q of quarts) {
      if (!quartActif(q, iso)) continue;
      for (const l of lignes) {
        if (!ligneOuverte(l.id, q, iso)) continue;
        for (const p of l.poste ?? []) if (p.actif && !pqOff.has(`${p.id}:${q}`)) b += p.effectif_requis ?? 0;
      }
    }
    return b;
  };

  const active = persD ?? [];
  const activeIds = new Set(active.map((p) => p.id));
  const activeCount = active.length;
  const persNom = (id: string) => {
    const p = active.find((x) => x.id === id);
    return p ? `${p.nom} ${p.prenom}` : "?";
  };

  // Absences connues (saisies) par jour
  const placements = plD;
  const absByDay = new Map<string, string[]>();
  for (const r of placements) if (r.motif_absence_id && r.jour >= todayIso) (absByDay.get(r.jour) ?? absByDay.set(r.jour, []).get(r.jour)!).push(persNom(r.personne_id));
  const contractEndedBy = (iso: string) => active.filter((p) => p.date_fin && p.date_fin < iso).length;

  // ---- 4.1 Besoin vs competences disponibles, par jour et par categorie ----
  const posteCat = new Map<string, string>();
  for (const l of lignes) for (const p of l.poste ?? []) if (p.actif) posteCat.set(p.id, p.categorie ?? "operateur");

  // Competences explicites (niveau >= SEUIL) par personne : ensemble des categories
  // qu'elle peut tenir (un poste actif de la categorie suffit).
  const compCats = new Map<string, Set<string>>();
  for (const r of matD) {
    if (!activeIds.has(r.personne_id) || !scopedPosteIds.has(r.poste_id)) continue;
    const c = posteCat.get(r.poste_id);
    if (!c) continue;
    (compCats.get(r.personne_id) ?? compCats.set(r.personne_id, new Set<string>()).get(r.personne_id)!).add(c);
  }
  const competentPeople = [...compCats.keys()];

  // Absents (motif) par jour ; fins de contrat par personne.
  const absSet = new Map<string, Set<string>>();
  for (const r of placements) if (r.motif_absence_id) (absSet.get(r.jour) ?? absSet.set(r.jour, new Set()).get(r.jour)!).add(r.personne_id);
  const finMap = new Map(active.map((p) => [p.id, p.date_fin]));

  const besoinCat = (cat: string, iso: string) => {
    let b = 0;
    for (const q of quarts) {
      if (!quartActif(q, iso)) continue;
      for (const l of lignes) {
        if (!ligneOuverte(l.id, q, iso)) continue;
        for (const p of l.poste ?? []) if (p.actif && (p.categorie ?? "operateur") === cat && !pqOff.has(`${p.id}:${q}`)) b += p.effectif_requis ?? 0;
      }
    }
    return b;
  };
  const besoinTotJour = (iso: string) => CATS.reduce((s, c) => s + besoinCat(c.key, iso), 0);

  // Couvrable par categorie SANS double comptage, par AFFECTATION OPTIMALE
  // (max-flow), comme l'ecran Projection de capacite : chaque personne est une
  // place unique (capacite 1) reliee aux categories qu'elle peut tenir. Le flot
  // maximum donne le nombre de besoins reellement pourvoyables ; une personne
  // polyvalente ne couvre qu'une categorie, jamais plusieurs. Remplace l'ancien
  // glouton (sous-optimal et divergent de la Projection).
  const allocCache = new Map<string, Record<string, number>>();
  const getDispo = (iso: string): Record<string, number> => {
    const cached = allocCache.get(iso);
    if (cached) return cached;
    const abs = absSet.get(iso);
    const besoins: BesoinPoste[] = CATS
      .map((c) => ({ cle: c.key, posteId: c.key, quart: "", effectifRequis: besoinCat(c.key, iso) }))
      .filter((b) => b.effectifRequis > 0);
    const out: Record<string, number> = { manager: 0, conducteur: 0, operateur: 0 };
    for (const b of besoins) out[b.posteId] = b.effectifRequis; // couvrable = besoin - rupture
    if (besoins.length) {
      const dispoPeople: PersonneDispo[] = [];
      for (const id of competentPeople) {
        if (abs?.has(id)) continue;
        const fin = finMap.get(id);
        if (fin && fin < iso) continue;
        const cats = [...compCats.get(id)!].filter((c) => besoins.some((b) => b.posteId === c));
        if (cats.length) dispoPeople.push({ id, peutTenir: cats });
      }
      const flow = buildJourFlow(dispoPeople, besoins);
      for (const r of flow.ruptures) out[r.posteId] -= r.manque;
    }
    allocCache.set(iso, out);
    return out;
  };
  const dispoCat = (cat: string, iso: string) => getDispo(iso)[cat] ?? 0;

  const horizonDays = horizonIsos.map((iso) => {
    const dt = new Date(iso + "T00:00");
    return { iso, nom: JN[(dt.getDay() + 6) % 7], num: String(dt.getDate()).padStart(2, "0"), week: isoWeekNumber(dt) };
  });
  const openDays = horizonDays.filter((d) => besoinTotJour(d.iso) > 0);
  const joursTension = openDays.filter((d) => CATS.some((c) => dispoCat(c.key, d.iso) < besoinCat(c.key, d.iso))).length;

  // Blocs-semaine pour l'en-tete du tableau.
  const weekBlocks: { label: string; span: number }[] = [];
  const isWeekStart: boolean[] = [];
  let prevW = -1;
  openDays.forEach((d, i) => {
    const start = d.week !== prevW;
    isWeekStart[i] = start;
    if (start) weekBlocks.push({ label: `S${d.week}`, span: 1 });
    else weekBlocks[weekBlocks.length - 1].span++;
    prevW = d.week;
  });
  const sepDay = (i: number): React.CSSProperties => (isWeekStart[i] ? { borderLeft: "2px solid #94a3b8" } : {});

  // Compteur d'en-tete : le detail jour par jour (« Impact des absences
  // connues ») a ete retire, seul l'indicateur reste.
  const joursAvecAbsence = horizonIsos.filter((iso) => iso >= todayIso && (absByDay.get(iso)?.length ?? 0) > 0).length;

  // ---- 4.3 Impact des fins de contrat sur la polyvalence ----
  const compByPoste = new Map<string, Set<string>>();
  for (const r of matD) if (activeIds.has(r.personne_id) && scopedPosteIds.has(r.poste_id)) (compByPoste.get(r.poste_id) ?? compByPoste.set(r.poste_id, new Set()).get(r.poste_id)!).add(r.personne_id);
  const posteNom = new Map<string, string>();
  for (const l of lignes) for (const p of l.poste ?? []) if (p.actif) posteNom.set(p.id, p.nom);
  const compByPers = new Map<string, string[]>();
  for (const r of matD) if (activeIds.has(r.personne_id) && scopedPosteIds.has(r.poste_id)) (compByPers.get(r.personne_id) ?? compByPers.set(r.personne_id, []).get(r.personne_id)!).push(r.poste_id);

  const fromIso = firstIso > todayIso ? firstIso : todayIso;
  const departs = active
    .filter((p) => p.type_contrat !== "CDI" && p.date_fin && p.date_fin >= fromIso && p.date_fin <= lastIso)
    .map((p) => {
      const postesRisque = (compByPers.get(p.id) ?? [])
        .filter((pid) => (compByPoste.get(pid)?.size ?? 0) - 1 <= 1)
        .map((pid) => ({ nom: posteNom.get(pid) ?? "?", restant: (compByPoste.get(pid)?.size ?? 0) - 1 }));
      return { personne: `${p.nom} ${p.prenom}`, date: p.date_fin!, postesRisque };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const postesMisEnRisque = new Set(departs.flatMap((d) => d.postesRisque.map((r) => r.nom))).size;

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <h1>Anticipation</h1>
            <div className="sub">{monthLabel(year, month0)} · projection compétences vs besoin · {activeCount} personnes actives</div>
          </div>
          <ReportActions />
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />
        <div className="noprint"><OrdoMonthNav base="/bilans/anticipation" year={year} month0={month0} /></div>

        <div className="kpi-grid">
          <div className={`kpi ${joursTension > 0 ? "danger" : "ok"}`}><div className="v">{joursTension}</div><div className="l">Jours en tension</div><div className="s">compétences dispo &lt; besoin</div></div>
          <div className={`kpi ${joursAvecAbsence > 0 ? "warn" : "ok"}`}><div className="v">{joursAvecAbsence}</div><div className="l">Jours avec absences saisies</div></div>
          <div className={`kpi ${postesMisEnRisque > 0 ? "danger" : "ok"}`}><div className="v">{postesMisEnRisque}</div><div className="l">Postes mis en risque</div><div className="s">par fins de contrat</div></div>
        </div>

        {/* 4.1 Besoin vs competences disponibles, par jour */}
        <div className="report-section">
          <h2>Besoin vs compétences disponibles — par jour</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            {openDays.length === 0 ? (
              <p className="muted">Aucune journée planifiée sur l&apos;horizon (ordonnancement non initialisé).</p>
            ) : (
              <table className="matrix" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff", minWidth: 120 }}>Catégorie</th>
                    {weekBlocks.map((w, i) => (
                      <th key={i} colSpan={w.span} style={{ textAlign: "center", borderLeft: "2px solid #94a3b8", background: "#f8fafc", fontSize: 12 }}>{w.label}</th>
                    ))}
                  </tr>
                  <tr>
                    {openDays.map((d, i) => (
                      <th key={d.iso} style={{ width: 32, textAlign: "center", ...sepDay(i) }}>{d.nom}<br /><span className="muted" style={{ fontWeight: 400, fontSize: 9 }}>{d.num}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "#f8fafc" }}>
                    <td style={{ position: "sticky", left: 0, background: "#f8fafc", fontWeight: 600, color: "var(--muted)" }}>Besoin total</td>
                    {openDays.map((d, i) => (<td key={d.iso} style={{ textAlign: "center", color: "var(--muted)", fontWeight: 700, ...sepDay(i) }}>{besoinTotJour(d.iso)}</td>))}
                  </tr>
                  {CATS.map((c) => (
                    <tr key={c.key}>
                      <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{c.label}</td>
                      {openDays.map((d, i) => {
                        const disp = dispoCat(c.key, d.iso);
                        const bes = besoinCat(c.key, d.iso);
                        const manque = bes > 0 && disp < bes;
                        return (
                          <td key={d.iso} title={`${disp} dispo / ${bes} besoin`} style={{ textAlign: "center", fontWeight: 700, ...sepDay(i), color: manque ? "#7f1d1d" : bes === 0 ? "#cbd5e1" : "var(--ok)", background: manque ? "#fee2e2" : undefined }}>
                            {disp}<span style={{ fontWeight: 400, fontSize: 11, opacity: 0.7 }}>/{bes}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8 }}>
              <strong>Couvrable / besoin</strong> par catégorie et par jour. Couvrable = besoins réellement pourvoyables par <strong>affectation optimale</strong> (max-flow), à partir des personnes actives compétentes (niveau ≥ {SEUIL}) non absentes (motif saisi) et hors fin de contrat. <strong>Une personne polyvalente n&apos;est comptée qu&apos;une seule fois</strong> — même moteur que l&apos;écran Projection de capacité. Besoin = ordonnancement. En{" "}
              <span style={{ color: "#7f1d1d", background: "#fee2e2", padding: "0 4px" }}>rouge</span> quand les compétences disponibles ne couvrent pas le besoin.
            </p>
          </div>
        </div>

        {/* 4.3 Impact fins de contrat */}
        <div className="report-section">
          <h2>Impact des fins de contrat sur la polyvalence</h2>
          <div className="card">
            {departs.length === 0 ? <p className="muted">Aucune fin de contrat sur l&apos;horizon.</p> : (
              <table>
                <thead><tr><th>Personne</th><th style={{ textAlign: "center" }}>Fin</th><th>Postes mis en risque (relève restante)</th></tr></thead>
                <tbody>
                  {departs.map((d, i) => (
                    <tr key={i}>
                      <td>{d.personne}</td>
                      <td style={{ textAlign: "center" }}><span className="rbadge warn">{fmtDate(d.date)}</span></td>
                      <td>
                        {d.postesRisque.length === 0 ? <span className="muted">aucun (relève suffisante)</span> : d.postesRisque.map((r, k) => (
                          <span key={k} className={`rbadge ${r.restant <= 0 ? "danger" : "warn"}`} style={{ marginRight: 6 }}>{r.nom} ({r.restant <= 0 ? "0 relève" : "1 restant"})</span>
                        ))}
                      </td>
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
