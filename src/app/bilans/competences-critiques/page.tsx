import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import { requireModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { isoDate, addDays } from "@/lib/week";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { deriverArriveeDepart, type Periode } from "@/lib/personne-statut";

// Compétences critiques (SPOF — single point of failure). Croise, poste par
// poste, la relève réellement disponible (au niveau requis ET habilitée
// aujourd'hui) avec les risques qui pèsent dessus : départ (fin de contrat /
// retraite) et expiration d'habilitation. Fait ressortir les postes qu'on va
// perdre et les personnes irremplaçables sur le point de partir.

type Named = { id: string; nom: string; prenom: string; type_contrat: string; equipe_id: string | null };
type LigneRow = { id: string; nom: string; atelier_id: string | null; poste: { id: string; nom: string; actif: boolean; niveau_min_requis: number; categorie: string | null }[] };
type Mat = { personne_id: string; poste_id: string; niveau_actuel: number };
type Pcr = { poste_id: string; competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null };
type Pc = { personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null };
type Contrat = { personne_id: string; date_debut: string | null; date_fin: string | null; motif_fin: string | null };

const H_DEPART = 180; // jours : horizon de vigilance sur les départs
const H_HAB = 90; // jours : horizon de vigilance sur les habilitations
const fmt = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const estRetraite = (m: string | null) => !!m && /retrait/i.test(m);

export default async function CompetencesCritiquesReport({ searchParams }: { searchParams: Promise<{ atelier?: string }> }) {
  const { profile } = await requireModule("bilans", "read");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const todayIso = isoDate(new Date());
  const limDepart = isoDate(addDays(new Date(), H_DEPART));
  const limHab = isoDate(addDays(new Date(), H_HAB));

  const supabase = await getServerClient();
  const [{ data: persD }, { data: lignesD }, matD, { data: pcrD }, { data: atD }, contratD] = await Promise.all([
    supabase.from("personne").select("id, nom, prenom, type_contrat, equipe_id").eq("statut", "ACTIF").returns<Named[]>(),
    supabase.from("ligne").select("id, nom, atelier_id, poste(id, nom, actif, niveau_min_requis, categorie)").eq("actif", true).order("nom").returns<LigneRow[]>(),
    fetchAll<Mat>(() => supabase.from("matrice").select("personne_id, poste_id, niveau_actuel").order("id").returns<Mat[]>()),
    supabase.from("poste_competence_requise").select("poste_id, competence_id, competence:competence_id(nom, duree_validite_mois)").returns<Pcr[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    fetchAll<Contrat>(() => supabase.from("contrat_periode").select("personne_id, date_debut, date_fin, motif_fin").order("id").returns<Contrat[]>()),
  ]);

  const active = persD ?? [];
  const activeIds = new Set(active.map((p) => p.id));
  const persById = new Map(active.map((p) => [p.id, p]));
  const atelierNom = new Map((atD ?? []).map((a) => [a.id, a.nom]));

  // Départ prévu par personne (dérivé des contrats) + motif du dernier contrat.
  const contrats = new Map<string, Contrat[]>();
  for (const c of contratD) (contrats.get(c.personne_id) ?? contrats.set(c.personne_id, []).get(c.personne_id)!).push(c);
  const departDe = new Map<string, { date: string; motif: string | null } | null>();
  for (const id of activeIds) {
    const cs = contrats.get(id) ?? [];
    const { date_depart_prevu } = deriverArriveeDepart(cs as Periode[]);
    if (!date_depart_prevu) { departDe.set(id, null); continue; }
    const dernier = cs.filter((c) => c.date_fin === date_depart_prevu).sort((a, b) => (b.date_fin ?? "").localeCompare(a.date_fin ?? ""))[0];
    departDe.set(id, { date: date_depart_prevu, motif: dernier?.motif_fin ?? null });
  }

  // Habilitations requises par poste + échéance effective détenue par personne.
  const habPoste = new Map<string, { id: string; nom: string }[]>();
  const dureeComp: Record<string, number | null> = {};
  for (const r of pcrD ?? []) {
    (habPoste.get(r.poste_id) ?? habPoste.set(r.poste_id, []).get(r.poste_id)!).push({ id: r.competence_id, nom: r.competence?.nom ?? "habilitation" });
    dureeComp[r.competence_id] = r.competence?.duree_validite_mois ?? null;
  }
  const compReq = [...new Set([...habPoste.values()].flat().map((c) => c.id))];
  const habExp = new Map<string, string | null>();
  if (compReq.length) {
    const det = await fetchAll<Pc>(() => supabase.from("personne_competence").select("personne_id, competence_id, date_obtention, date_expiration").in("competence_id", compReq).order("id").returns<Pc[]>());
    for (const d of det) habExp.set(`${d.personne_id}:${d.competence_id}`, d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp[d.competence_id]));
  }

  const matNiveau = new Map<string, number>();
  for (const r of matD) matNiveau.set(`${r.personne_id}:${r.poste_id}`, r.niveau_actuel);

  // Postes du périmètre.
  const lignes = (lignesD ?? []).filter((l) => !atelier || l.atelier_id === atelier);
  const postes = lignes.flatMap((l) => (l.poste ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, nom: p.nom, min: p.niveau_min_requis ?? 0, atelierId: l.atelier_id, atelierNom: l.atelier_id ? atelierNom.get(l.atelier_id) ?? "—" : "—", ligne: l.nom })));

  // Habilitation détenue et valide aujourd'hui ?
  const habOkAujourdhui = (pid: string, cid: string) => {
    const exp = habExp.get(`${pid}:${cid}`);
    if (exp === undefined) return false;
    return habValable({ expiration: exp });
  };
  // Prochaine échéance d'habilitation requise sous H_HAB pour une personne sur un poste.
  const habEnRisque = (pid: string, posteId: string): { nom: string; exp: string } | null => {
    let pire: { nom: string; exp: string } | null = null;
    for (const c of habPoste.get(posteId) ?? []) {
      const exp = habExp.get(`${pid}:${c.id}`);
      if (exp && exp <= limHab && (!pire || exp < pire.exp)) pire = { nom: c.nom, exp };
    }
    return pire;
  };

  type Membre = { id: string; nom: string; risque: string | null };
  const analyse = postes.map((p) => {
    // Relève = actifs au niveau requis ET habilités aujourd'hui.
    const releve: Membre[] = [];
    for (const id of activeIds) {
      if ((matNiveau.get(`${id}:${p.id}`) ?? 0) < p.min) continue;
      const reqs = habPoste.get(p.id) ?? [];
      if (reqs.some((c) => !habOkAujourdhui(id, c.id))) continue;
      // Risque imminent sur cette personne pour ce poste.
      const dep = departDe.get(id);
      const hab = habEnRisque(id, p.id);
      let risque: string | null = null;
      if (dep && dep.date <= limDepart) risque = estRetraite(dep.motif) ? `retraite ${fmt(dep.date)}` : `départ ${fmt(dep.date)}`;
      else if (hab) risque = `${hab.nom} exp. ${fmt(hab.exp)}`;
      const pr = persById.get(id)!;
      releve.push({ id, nom: `${pr.nom} ${pr.prenom}`, risque });
    }
    const sure = releve.filter((m) => !m.risque).length;
    const verdict: "critique" | "fragile" | "ok" = releve.length === 0 || sure === 0 ? "critique" : sure === 1 ? "fragile" : "ok";
    return { ...p, releve, sure, verdict };
  });

  const critiques = analyse.filter((a) => a.verdict !== "ok").sort((a, b) => (a.verdict === b.verdict ? a.releve.length - b.releve.length : a.verdict === "critique" ? -1 : 1));
  const sansReleve = analyse.filter((a) => a.releve.length === 0).length;
  const nbCritiques = analyse.filter((a) => a.verdict === "critique").length;
  const nbFragiles = analyse.filter((a) => a.verdict === "fragile").length;

  // Personnes clés : seule relève d'au moins un poste.
  const soloDe = new Map<string, string[]>(); // pid -> postes dont il est seule relève
  for (const a of analyse) if (a.releve.length === 1) (soloDe.get(a.releve[0].id) ?? soloDe.set(a.releve[0].id, []).get(a.releve[0].id)!).push(a.nom);
  const clesARisque = [...soloDe.entries()]
    .map(([id, postesSolo]) => ({ id, nom: persById.get(id) ? `${persById.get(id)!.nom} ${persById.get(id)!.prenom}` : "?", contrat: persById.get(id)?.type_contrat ?? "", depart: departDe.get(id), postes: postesSolo }))
    .filter((x) => x.depart && x.depart.date <= limDepart)
    .sort((a, b) => (a.depart!.date).localeCompare(b.depart!.date));
  const nbClesPartantes = clesARisque.length;

  const badge = (v: "critique" | "fragile" | "ok") =>
    v === "critique" ? <span className="rbadge danger">critique</span> : v === "fragile" ? <span className="rbadge warn">fragile</span> : <span className="muted">—</span>;

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Compétences critiques</PageTitle>
            <div className="sub">Postes à relève fragile croisés avec départs (≤ {H_DEPART} j), retraites et expirations d&apos;habilitation (≤ {H_HAB} j)</div>
          </div>
          <ReportActions />
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />

        <div className="kpi-grid">
          <div className={`kpi ${sansReleve > 0 ? "danger" : "ok"}`}><div className="v">{sansReleve}</div><div className="l">Postes sans relève</div><div className="s">personne habilitée aujourd&apos;hui</div></div>
          <div className={`kpi ${nbCritiques > 0 ? "danger" : "ok"}`}><div className="v">{nbCritiques}</div><div className="l">Postes critiques</div><div className="s">0 relève sûre à {H_DEPART} j</div></div>
          <div className={`kpi ${nbFragiles > 0 ? "warn" : "ok"}`}><div className="v">{nbFragiles}</div><div className="l">Postes fragiles</div><div className="s">1 seule relève sûre</div></div>
          <div className={`kpi ${nbClesPartantes > 0 ? "danger" : "ok"}`}><div className="v">{nbClesPartantes}</div><div className="l">Personnes clés partantes</div><div className="s">seule relève d&apos;un poste</div></div>
        </div>

        {/* Postes critiques & fragiles */}
        <div className="report-section">
          <h2>Postes critiques &amp; fragiles</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            {critiques.length === 0 ? (
              <p className="muted">Aucun poste critique ou fragile : chaque poste a au moins 2 personnes habilitées sans risque imminent.</p>
            ) : (
              <table>
                <thead><tr><th>Poste</th><th>Atelier</th><th style={{ textAlign: "center" }}>Relève sûre</th><th>Relève (risque)</th><th style={{ textAlign: "right" }}>Verdict</th></tr></thead>
                <tbody>
                  {critiques.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.nom}</strong><br /><span className="muted" style={{ fontSize: 11 }}>{a.ligne}</span></td>
                      <td className="muted">{a.atelierNom}</td>
                      <td style={{ textAlign: "center", fontWeight: 700, color: a.sure === 0 ? "var(--danger)" : a.sure === 1 ? "#9a3412" : "var(--ok)" }}>{a.sure}</td>
                      <td>
                        {a.releve.length === 0 ? <span className="rbadge danger">aucune relève</span> : a.releve.map((m) => (
                          <span key={m.id} style={{ marginRight: 8, whiteSpace: "nowrap" }}>
                            {m.nom}{m.risque ? <span className="rbadge warn" style={{ marginLeft: 4 }}>{m.risque}</span> : null}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: "right" }}>{badge(a.verdict)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              <strong>Relève</strong> = personnes actives au niveau requis <strong>et</strong> habilitées aujourd&apos;hui. <strong>Relève sûre</strong> = celles sans risque imminent (départ ≤ {H_DEPART} j, retraite, ou habilitation exigée expirant ≤ {H_HAB} j). <strong>Critique</strong> = 0 relève sûre (poste que vous allez perdre) · <strong>fragile</strong> = une seule.
            </p>
          </div>
        </div>

        {/* Personnes clés à risque */}
        <div className="report-section">
          <h2>Personnes clés sur le départ</h2>
          <div className="card">
            {clesARisque.length === 0 ? (
              <p className="muted">Aucune personne « seule relève d&apos;un poste » ne quitte l&apos;effectif dans les {H_DEPART} jours.</p>
            ) : (
              <table>
                <thead><tr><th>Personne</th><th>Départ</th><th>Postes dont elle est la seule relève</th></tr></thead>
                <tbody>
                  {clesARisque.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nom} <span className="muted">· {c.contrat}</span></td>
                      <td><span className={`rbadge ${estRetraite(c.depart!.motif) ? "danger" : "warn"}`}>{estRetraite(c.depart!.motif) ? "retraite · " : ""}{fmt(c.depart!.date)}</span></td>
                      <td>{c.postes.map((n, i) => (<span key={i} className="rbadge danger" style={{ marginRight: 6 }}>{n}</span>))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Ces personnes emportent un savoir-faire non doublé : à former en priorité avant leur départ.</p>
          </div>
        </div>
      </div>
    </>
  );
}
