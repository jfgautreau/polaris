import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportActions from "@/app/bilans/ReportActions";
import Bars from "@/app/bilans/Bars";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import ReportEquipeFilter from "@/app/bilans/ReportEquipeFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { chargerPolyvalenceCompetences, H_DEPART, H_HAB, type Verdict } from "@/lib/polyvalence-competences-data";

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const fmtMoy = (v: number) => v.toFixed(1).replace(".", ",");
const catBadge = (c: string) => {
  const s = c === "conducteur"
    ? { t: "Cond.", color: "#4338ca", bg: "#eceafe" }
    : c === "manager"
    ? { t: "Mgr", color: "#9333ea", bg: "#f3e8ff" }
    : { t: "Opér.", color: "#0e7490", bg: "#e2f2f6" };
  return <span className="rbadge" style={{ background: s.bg, color: s.color, fontSize: 10.5 }}>{s.t}</span>;
};
const verdictBadge = (v: Verdict) =>
  v === "critique" ? <span className="rbadge danger">critique</span> : v === "fragile" ? <span className="rbadge warn">fragile</span> : <span className="muted">—</span>;

const NAV = [
  { id: "constat", n: "1", t: "Constat" },
  { id: "postes", n: "2", t: "Postes & fragilité" },
  { id: "risques", n: "3", t: "Risques" },
  { id: "action", n: "4", t: "Qui former" },
];

export default async function PolyvalenceReport({ searchParams }: { searchParams: Promise<{ atelier?: string; equipe?: string }> }) {
  const { profile } = await requireRapportBilan("polyvalence");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const equipe = sp.equipe ?? "";

  const supabase = await getServerClient();
  const [{ data: atD }, { data: eqD }, r] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("equipe").select("id, nom, couleur").eq("actif", true).order("nom").returns<{ id: string; nom: string; couleur: string | null }[]>(),
    chargerPolyvalenceCompetences(supabase, { atelier, equipe }),
  ]);

  const polyMax = Math.max(1, ...r.polyParService.map((s) => s.moyenne));

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Polyvalence &amp; compétences</PageTitle>
            <div className="sub">
              Compétent = <strong>peut tenir le poste aujourd&apos;hui</strong> (niveau min. du poste + habilitation valide) ·
              {" "}{r.nbActifs} personnes actives · {r.nbPostes} postes actifs
            </div>
          </div>
          <ReportActions>
            <Link href="/matrice" className="navlink">Saisie matrice</Link>
          </ReportActions>
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />
        <ReportEquipeFilter equipes={eqD ?? []} equipe={equipe} />

        {/* Sous-navigation par ancres */}
        <nav className="noprint" style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "6px 0 16px", paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
          {NAV.map((s) => (
            <a key={s.id} href={`#${s.id}`} style={{ textDecoration: "none", fontSize: 13, fontWeight: 600, color: "var(--muted)", padding: "7px 13px", borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#e11d48", background: "#fdecf1", width: 20, height: 20, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
              {s.t}
            </a>
          ))}
        </nav>

        <div className="kpi-grid">
          <div className="kpi accent"><div className="v">{fmtMoy(r.polyvalenceMoyenne)}</div><div className="l">Polyvalence moyenne</div><div className="s">postes tenus / personne</div></div>
          <div className={`kpi ${r.nbSansReleveSure > 0 ? "danger" : "ok"}`}><div className="v">{r.nbSansReleveSure}</div><div className="l">Postes sans relève sûre</div><div className="s">0 relève fiable à {H_DEPART} j</div></div>
          <div className={`kpi ${r.nbFragiles > 0 ? "warn" : "ok"}`}><div className="v">{r.nbFragiles}</div><div className="l">Postes fragiles</div><div className="s">1 seule relève sûre</div></div>
          <div className={`kpi ${r.ecartTotal > 0 ? "warn" : "ok"}`}><div className="v">{r.ecartTotal}</div><div className="l">Écart à combler</div><div className="s">formations vers la cible</div></div>
          <div className={`kpi ${r.nbClesPartantes > 0 ? "danger" : "ok"}`}><div className="v">{r.nbClesPartantes}</div><div className="l">Personnes clés partantes</div><div className="s">seule relève d&apos;un poste</div></div>
          <div className={`kpi ${r.nbEcheancesCritiques > 0 ? "danger" : r.echeances.length > 0 ? "warn" : "ok"}`}><div className="v">{r.echeances.length}</div><div className="l">Habilitations à échéance</div><div className="s">{r.nbEcheancesCritiques} critique(s) · ≤ {H_HAB} j</div></div>
        </div>

        {/* ---------- 1. CONSTAT ---------- */}
        <div className="report-section" id="constat" style={{ scrollMarginTop: 16 }}>
          <h2>1 · Constat — état de la polyvalence</h2>
          <div className="report-grid2">
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Polyvalence moyenne par service</h2>
              {r.polyParService.length === 0 ? (
                <p className="muted">Aucune personne affectée à un service.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {r.polyParService.map((s) => (
                    <div key={s.atelierId} style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px", alignItems: "center", gap: 10, fontSize: 13 }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${s.nom} · ${s.nbPersonnes} pers.`}>{s.nom}</span>
                      <span style={{ background: "var(--border)", borderRadius: 6, height: 16, overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${(s.moyenne / polyMax) * 100}%`, background: "#4338ca", borderRadius: 6 }} />
                      </span>
                      <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoy(s.moyenne)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Pour chaque service, moyenne — sur les personnes qui y sont <strong>affectées</strong> — du nombre de
                postes <strong>de ce service</strong> que chacune peut tenir aujourd&apos;hui. Moyenne usine&nbsp;: <strong>{fmtMoy(r.polyvalenceMoyenne)}</strong>.
              </p>
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Personnes à développer <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· polyvalence la plus faible</span></h2>
              <Bars items={r.personnesADevelopper} accent="#7c3aed" suffix=" postes" />
            </div>
          </div>
        </div>

        {/* ---------- 2. POSTES ---------- */}
        <div className="report-section" id="postes" style={{ scrollMarginTop: 16 }}>
          <h2>2 · Postes — couverture &amp; fragilité</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            {r.postesCritiquesFragiles.length === 0 ? (
              <p className="muted">Aucun poste critique ou fragile : chaque poste remplaçable a au moins 2 relèves sûres.</p>
            ) : (
              <table>
                <thead><tr><th>Poste</th><th>Service</th><th>Cat.</th><th style={{ textAlign: "center" }}>Relève sûre</th><th style={{ textAlign: "center" }}>Cible</th><th>Relève (risque signalé)</th><th style={{ textAlign: "right" }}>Verdict</th></tr></thead>
                <tbody>
                  {r.postesCritiquesFragiles.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.nom}</strong><br /><span className="muted" style={{ fontSize: 11 }}>{a.ligne}</span></td>
                      <td className="muted">{a.atelierNom}</td>
                      <td>{catBadge(a.categorie)}</td>
                      <td style={{ textAlign: "center", fontWeight: 700, color: a.sure === 0 ? "var(--danger)" : a.sure === 1 ? "#9a3412" : "var(--ok)" }}>{a.sure}</td>
                      <td style={{ textAlign: "center" }} className="muted">{a.cible}</td>
                      <td>
                        {a.releve.length === 0 ? <span className="rbadge danger">aucune relève</span> : a.releve.map((m) => (
                          <span key={m.id} style={{ marginRight: 8, whiteSpace: "nowrap" }}>
                            {m.nom}{m.risque ? <span className="rbadge warn" style={{ marginLeft: 4 }}>{m.risque}</span> : null}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: "right" }}>{verdictBadge(a.verdict)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              <strong>Relève</strong> = personnes actives au niveau min. requis <strong>et</strong> habilitées aujourd&apos;hui.
              {" "}<strong>Relève sûre</strong> = sans risque imminent (départ ≤ {H_DEPART} j, retraite, ou habilitation exigée expirant ≤ {H_HAB} j).
              {" "}<strong>Critique</strong> = 0 relève sûre (poste que vous allez perdre) · <strong>fragile</strong> = une seule.
              {r.nbTenus > 0 && <> {" "}· {r.nbTenus} poste{r.nbTenus > 1 ? "s" : ""} tenu{r.nbTenus > 1 ? "s" : ""} (≥ 2 relèves sûres) non listé{r.nbTenus > 1 ? "s" : ""}.</>}
            </p>
          </div>

          {r.ptnr.length > 0 && (
            <div className="card" style={{ overflowX: "auto", marginTop: 14 }}>
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Postes à titulaire unique (PTNR) <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· un seul titulaire par conception</span></h2>
              <table>
                <thead><tr><th>Poste</th><th>Service</th><th>Titulaire(s)</th><th style={{ textAlign: "right" }}>État</th></tr></thead>
                <tbody>
                  {r.ptnr.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.nom}</strong><br /><span className="muted" style={{ fontSize: 11 }}>{a.ligne}</span></td>
                      <td className="muted">{a.atelierNom}</td>
                      <td>
                        {a.releve.length === 0 ? <span className="muted">—</span> : a.releve.map((m) => (
                          <span key={m.id} style={{ marginRight: 8, whiteSpace: "nowrap" }}>
                            {m.nom}{m.risque ? <span className="rbadge danger" style={{ marginLeft: 4 }}>{m.risque}</span> : null}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.vacant ? <span className="rbadge danger">poste vacant</span> : a.aRisque ? <span className="rbadge danger">titulaire sur le départ</span> : <span className="rbadge">tenu</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Ces postes sont <strong>exclus des indicateurs de fragilité</strong> ci-dessus (ils y fausseraient le compte). Le vrai risque ici est le <strong>départ du titulaire</strong> — à anticiper par un transfert de savoir.
              </p>
            </div>
          )}
        </div>

        {/* ---------- 3. RISQUES ---------- */}
        <div className="report-section" id="risques" style={{ scrollMarginTop: 16 }}>
          <h2>3 · Risques à anticiper</h2>
          <div className="report-grid2">
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Personnes clés sur le départ</h2>
              {r.clesARisque.length === 0 ? (
                <p className="muted">Aucune personne « seule relève d&apos;un poste » ne quitte l&apos;effectif dans les {H_DEPART} jours.</p>
              ) : (
                <table>
                  <thead><tr><th>Personne</th><th>Départ</th><th>Seule relève de</th></tr></thead>
                  <tbody>
                    {r.clesARisque.map((c) => (
                      <tr key={c.id}>
                        <td>{c.nom} <span className="muted">· {c.contrat}</span></td>
                        <td><span className={`rbadge ${c.retraite ? "danger" : "warn"}`}>{c.retraite ? "retraite · " : ""}{fmtDate(c.date)}</span></td>
                        <td>{c.postes.map((n, i) => (<span key={i} className="rbadge danger" style={{ marginRight: 6 }}>{n}</span>))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Ces personnes emportent un savoir non doublé : à former en priorité avant leur départ.</p>
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Habilitations à échéance <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· ≤ {H_HAB} jours</span></h2>
              {r.echeances.length === 0 ? (
                <p className="muted">Aucune habilitation à recycler dans les {H_HAB} jours.</p>
              ) : (
                <table>
                  <thead><tr><th>Personne</th><th>Habilitation</th><th style={{ textAlign: "right" }}>Expiration</th></tr></thead>
                  <tbody>
                    {r.echeances.slice(0, 40).map((e, i) => (
                      <tr key={i}>
                        <td>{e.personne}</td>
                        <td>{e.competence}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className={`rbadge ${e.statut === "proche" ? "warn" : "danger"}`}>{e.statut === "expiree" ? "expirée · " : ""}{fmtDate(e.date)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {r.echeances.length > 40 && <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>… et {r.echeances.length - 40} autres.</p>}
            </div>
          </div>
        </div>

        {/* ---------- 4. ACTION ---------- */}
        <div className="report-section" id="action" style={{ scrollMarginTop: 16 }}>
          <h2>4 · Qui former, sur quel poste</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            {r.ecartTotal === 0 ? (
              <p className="muted">Aucun écart individuel : tout le monde est au niveau cible.</p>
            ) : r.formations.length === 0 ? (
              <p style={{ margin: 0 }}>
                {r.ecartTotal} formation(s) vers la cible, toutes sur des postes déjà tenus (≥ 2 relèves).{" "}
                <Link href="/matrice" className="navlink">Détail dans la matrice &rarr;</Link>
              </p>
            ) : (
              <>
                <table>
                  <thead><tr><th>Personne</th><th>Poste à couvrir</th><th>Service</th><th style={{ textAlign: "center" }}>Actuel → Cible</th><th style={{ textAlign: "right" }}>Priorité (fragilité du poste)</th></tr></thead>
                  <tbody>
                    {r.formations.map((f, i) => (
                      <tr key={i}>
                        <td>{f.personne}</td>
                        <td><strong>{f.poste}</strong></td>
                        <td className="muted">{f.atelierNom}</td>
                        <td style={{ textAlign: "center" }}>{f.actuel} → {f.cible}</td>
                        <td style={{ textAlign: "right" }}>{verdictBadge(f.fragilite)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Les <strong>{r.nbFormationsPrioritaires} formation{r.nbFormationsPrioritaires > 1 ? "s" : ""} prioritaire{r.nbFormationsPrioritaires > 1 ? "s" : ""}</strong> (postes critiques et fragiles) d&apos;abord.
                  {r.nbFormationsAutres > 0 && <> <strong>+ {r.nbFormationsAutres} autre{r.nbFormationsAutres > 1 ? "s" : ""}</strong> sur des postes déjà tenus — <Link href="/matrice" className="navlink">détail complet dans la matrice &rarr;</Link></>}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
