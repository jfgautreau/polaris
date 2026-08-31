import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import ReportActions from "@/app/bilans/ReportActions";
import Bars from "@/app/bilans/Bars";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { isoDate, addDays } from "@/lib/week";
import { fetchAll } from "@/lib/fetch-all";

type Named = { id: string; nom: string; prenom?: string };
type LigneRow = { id: string; nom: string; atelier_id: string | null; poste: { id: string; nom: string; actif: boolean; categorie: string | null; remplacable: boolean }[] };
const CATS = [
  { key: "manager", label: "Managers" },
  { key: "conducteur", label: "Conducteurs" },
  { key: "operateur", label: "Opérateurs" },
] as const;
type Mat = { personne_id: string; poste_id: string; niveau_actuel: number; niveau_cible: number };
type Comp = { id: string; nom: string; a_recycler: boolean };
type PC = { personne_id: string; competence_id: string; date_expiration: string | null };

const SEUIL = 2;
const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export default async function PolyvalenceReport({ searchParams }: { searchParams: Promise<{ atelier?: string }> }) {
  const { profile } = await requireRapportBilan("polyvalence");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const todayIso = isoDate(new Date());
  const in30 = isoDate(addDays(new Date(), 30));
  const in60 = isoDate(addDays(new Date(), 60));

  const supabase = await getServerClient();
  const [{ data: persD }, { data: lignesD }, matD, { data: compD }, pcD, { data: atD }] = await Promise.all([
    supabase.from("personne").select("id, nom, prenom").eq("statut", "ACTIF").returns<Named[]>(),
    supabase.from("ligne").select("id, nom, atelier_id, poste(id, nom, actif, categorie, remplacable)").eq("actif", true).order("nom").returns<LigneRow[]>(),
    fetchAll<Mat>(() =>
      supabase.from("matrice").select("personne_id, poste_id, niveau_actuel, niveau_cible").order("id").returns<Mat[]>()
    ),
    supabase.from("competence").select("id, nom, a_recycler").eq("actif", true).returns<Comp[]>(),
    fetchAll<PC>(() =>
      supabase.from("personne_competence").select("personne_id, competence_id, date_expiration").order("id").returns<PC[]>()
    ),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
  ]);

  const active = persD ?? [];
  const activeIds = new Set(active.map((p) => p.id));
  const persNom = (id: string) => {
    const p = active.find((x) => x.id === id);
    return p ? `${p.nom} ${p.prenom ?? ""}`.trim() : "?";
  };

  // Postes du perimetre (filtre atelier via ligne.atelier_id).
  const lignesScoped = (lignesD ?? []).filter((l) => !atelier || l.atelier_id === atelier);
  const postes = lignesScoped.flatMap((l) =>
    (l.poste ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, nom: p.nom, ligne: l.nom, categorie: p.categorie ?? "operateur", atelierId: l.atelier_id, remplacable: p.remplacable !== false }))
  );
  // PTNR (non remplaçable) : exclus des analyses de fragilité / relève / écart-cible
  // — un seul titulaire par conception n'est pas une anomalie. Ils restent suivis,
  // isolés, dans le rapport Compétences critiques (départs / expirations).
  const postesRempl = postes.filter((p) => p.remplacable);
  const nbPtnr = postes.length - postesRempl.length;
  const posteNom = new Map(postes.map((p) => [p.id, p]));
  const scopedPosteIds = new Set(postes.map((p) => p.id));

  // ---- 2.0 Competence moyenne par atelier et par categorie ----
  // Moyenne ARITHMETIQUE des niveaux (0 a 4) sur toutes les cases de la matrice
  // qui croisent une personne active et un poste actif de la categorie, dans cet
  // atelier. Une case absente de la matrice vaut 0 : on la compte, sinon un
  // atelier ou personne n'est forme afficherait une moyenne flatteuse.
  const ateliers = atD ?? [];
  const postesTousAteliers = (lignesD ?? []).flatMap((l) =>
    (l.poste ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, categorie: p.categorie ?? "operateur", atelierId: l.atelier_id }))
  );
  const niveauDe = new Map<string, number>();
  for (const r of matD) niveauDe.set(`${r.personne_id}:${r.poste_id}`, r.niveau_actuel);
  const moyenne = (atelierId: string | null, cat: string) => {
    const ids = postesTousAteliers.filter((p) => p.atelierId === atelierId && p.categorie === cat).map((p) => p.id);
    if (ids.length === 0 || active.length === 0) return null;
    let somme = 0;
    let n = 0;
    for (const p of active) {
      for (const pid of ids) {
        // Une restriction (-1) n'est pas un niveau : elle ne pese pas la moyenne.
        const v = niveauDe.get(`${p.id}:${pid}`) ?? 0;
        if (v < 0) continue;
        somme += v;
        n++;
      }
    }
    return n ? somme / n : null;
  };
  const lignesMoyennes = ateliers
    .map((a) => ({ nom: a.nom, valeurs: CATS.map((c) => moyenne(a.id, c.key)) }))
    .filter((r) => r.valeurs.some((v) => v !== null));
  const fmtMoy = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
  // Teinte : rouge sous 1, orange sous 2 (le seuil de competence), vert au-dela.
  const teinteMoy = (v: number | null) =>
    v === null ? undefined : v < 1 ? "#fee2e2" : v < SEUIL ? "#ffedd5" : "#dcfce7";

  // Matrice cote personnes actives ET postes du perimetre.
  const mat = matD.filter((r) => activeIds.has(r.personne_id) && scopedPosteIds.has(r.poste_id));

  // ---- 2.1 Postes fragiles ----
  const compByPoste = new Map<string, string[]>(); // poste -> noms competents (>= seuil)
  for (const r of mat) {
    if (r.niveau_actuel >= SEUIL) (compByPoste.get(r.poste_id) ?? compByPoste.set(r.poste_id, []).get(r.poste_id)!).push(persNom(r.personne_id));
  }
  // Fragilité évaluée sur les seuls postes remplaçables (PTR).
  const postesEval = postesRempl.map((p) => ({ ...p, noms: compByPoste.get(p.id) ?? [] }));
  const fragiles = postesEval.filter((p) => p.noms.length <= 1).sort((a, b) => a.noms.length - b.noms.length);
  const sansReleve = fragiles.filter((p) => p.noms.length === 0).length;

  // ---- 2.2 Ecart actuel -> cible (par poste) ----
  // PTNR exclus : leur cible de relève est 1 par conception, pas un écart à combler.
  const ecarts = postesRempl
    .map((p) => {
      const rows = mat.filter((r) => r.poste_id === p.id);
      const actuel = rows.filter((r) => r.niveau_actuel >= SEUIL).length;
      const cible = rows.filter((r) => r.niveau_cible >= SEUIL).length;
      return { label: p.nom, ligne: p.ligne, actuel, cible, n: Math.max(0, cible - actuel) };
    })
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n);
  const ecartTotal = ecarts.reduce((s, e) => s + e.n, 0);

  // ---- 2.4 Habilitations a echeance ----
  const recyclables = new Set((compD ?? []).filter((c) => c.a_recycler).map((c) => c.id));
  const compNom = new Map((compD ?? []).map((c) => [c.id, c.nom]));
  const echeances = pcD
    .filter((r) => activeIds.has(r.personne_id) && recyclables.has(r.competence_id) && r.date_expiration && r.date_expiration <= in60)
    .map((r) => ({
      personne: persNom(r.personne_id),
      competence: compNom.get(r.competence_id) ?? "?",
      date: r.date_expiration!,
      statut: r.date_expiration! < todayIso ? "expiree" : r.date_expiration! <= in30 ? "urgent" : "proche",
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const echeancesCritiques = echeances.filter((e) => e.statut !== "proche").length;

  // ---- 2.5 Polyvalence par personne ----
  const masteredBy = new Map<string, number>();
  for (const r of mat) if (r.niveau_actuel >= SEUIL) masteredBy.set(r.personne_id, (masteredBy.get(r.personne_id) ?? 0) + 1);
  const polyParPers = active
    .map((p) => ({ id: p.id, label: `${p.nom} ${p.prenom ?? ""}`.trim(), n: masteredBy.get(p.id) ?? 0 }))
    .sort((a, b) => a.n - b.n);
  const polyMoy = active.length ? Math.round((polyParPers.reduce((s, p) => s + p.n, 0) / active.length) * 10) / 10 : 0;
  const moinsPoly = polyParPers.slice(0, 10);

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <h1>Polyvalence &amp; compétences</h1>
            <div className="sub">Compétent = niveau ≥ {SEUIL} · {active.length} personnes actives · {postes.length} postes actifs</div>
          </div>
          <ReportActions>
            <Link href="/matrice" className="navlink">Saisie matrice</Link>
          </ReportActions>
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />

        <div className="kpi-grid">
          <div className={`kpi ${fragiles.length > 0 ? "warn" : "ok"}`}><div className="v">{fragiles.length}</div><div className="l">Postes fragiles</div><div className="s">≤ 1 personne compétente</div></div>
          <div className={`kpi ${sansReleve > 0 ? "danger" : "ok"}`}><div className="v">{sansReleve}</div><div className="l">Postes sans relève</div></div>
          <div className={`kpi ${ecartTotal > 0 ? "warn" : "ok"}`}><div className="v">{ecartTotal}</div><div className="l">Écart à combler</div><div className="s">compétences manquantes vs cible</div></div>
          <div className={`kpi ${echeancesCritiques > 0 ? "danger" : "ok"}`}><div className="v">{echeances.length}</div><div className="l">Habilitations à échéance</div><div className="s">{echeancesCritiques} critique(s)</div></div>
          <div className="kpi accent"><div className="v">{polyMoy}</div><div className="l">Polyvalence moyenne</div><div className="s">postes maîtrisés / personne</div></div>
        </div>

        {/* 2.0 Competence moyenne par atelier */}
        <div className="report-section">
          <h2>Compétence moyenne par atelier</h2>
          <div className="card">
            {lignesMoyennes.length === 0 ? (
              <p className="muted">Aucun poste actif rattaché à un atelier.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Atelier</th>
                    {CATS.map((c) => (
                      <th key={c.key} style={{ textAlign: "center" }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignesMoyennes.map((r) => (
                    <tr key={r.nom}>
                      <td><strong>{r.nom}</strong></td>
                      {r.valeurs.map((v, i) => (
                        <td key={i} style={{ textAlign: "center", fontWeight: 700, background: teinteMoy(v) }}>{fmtMoy(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              Moyenne des niveaux de la matrice sur l&apos;ensemble des couples
              personne active × poste actif de la catégorie, dans cet atelier. Une compétence
              non saisie compte pour 0 ; une restriction médicale est exclue du calcul.
              Rouge &lt; 1 · orange &lt; {SEUIL} · vert ≥ {SEUIL}.
            </p>
          </div>
        </div>

        {/* 2.1 Postes fragiles */}
        <div className="report-section">
          <h2>Postes fragiles (risque mono-compétence)</h2>
          {nbPtnr > 0 && (
            <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>
              {nbPtnr} poste{nbPtnr > 1 ? "s" : ""} PTNR (non remplaçable{nbPtnr > 1 ? "s" : ""}) exclu{nbPtnr > 1 ? "s" : ""} de cette analyse — voir <Link href="/bilans/competences-critiques" className="navlink">Compétences critiques</Link>.
            </p>
          )}
          {fragiles.length === 0 ? (
            <p className="muted">Aucun poste fragile : chaque poste remplaçable a au moins 2 personnes compétentes.</p>
          ) : (
            <div className="card">
              <table>
                <thead><tr><th>Poste</th><th>Ligne</th><th>Personne compétente</th><th style={{ textAlign: "right" }}>Couverture</th></tr></thead>
                <tbody>
                  {fragiles.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.nom}</strong></td>
                      <td className="muted">{p.ligne}</td>
                      <td>{p.noms.length ? p.noms.join(", ") : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }}><span className={`rbadge ${p.noms.length === 0 ? "danger" : "warn"}`}>{p.noms.length === 0 ? "aucune relève" : "1 personne"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 2.2 Ecart cible */}
        <div className="report-section">
          <h2>Écart polyvalence actuel → cible</h2>
          <div className="card">
            {ecarts.length === 0 ? <p className="muted">Tous les objectifs de polyvalence sont atteints.</p> : (
              <Bars items={ecarts.map((e) => ({ label: e.label, n: e.n, sub: `${e.actuel}/${e.cible}` }))} accent="#d97706" />
            )}
          </div>
        </div>

        {/* Le plan de montee en competence a son propre rapport : on ne garde
            ici qu'un renvoi, pour eviter deux tableaux a maintenir en parallele. */}
        <div className="report-section">
          <h2>Plan de montée en compétence</h2>
          <div className="card">
            <p style={{ margin: 0 }}>
              {ecartTotal === 0
                ? "Tous les objectifs de polyvalence sont atteints."
                : `${ecartTotal} compétence(s) à acquérir pour atteindre les cibles.`}{" "}
              <Link href="/bilans/montee-competence" className="navlink">
                Ouvrir le plan détaillé &rarr;
              </Link>
            </p>
          </div>
        </div>

        {/* 2.4 Habilitations a echeance */}
        <div className="report-section">
          <h2>Habilitations à recycler — échéances (60 jours)</h2>
          <div className="card">
            {echeances.length === 0 ? <p className="muted">Aucune habilitation à recycler dans les 60 jours.</p> : (
              <table>
                <thead><tr><th>Personne</th><th>Habilitation</th><th style={{ textAlign: "right" }}>Expiration</th></tr></thead>
                <tbody>
                  {echeances.map((e, i) => (
                    <tr key={i}>
                      <td>{e.personne}</td>
                      <td>{e.competence}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className={`rbadge ${e.statut === "expiree" ? "danger" : e.statut === "urgent" ? "danger" : "warn"}`}>
                          {e.statut === "expiree" ? "expirée · " : ""}{fmtDate(e.date)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 2.5 Polyvalence par personne */}
        <div className="report-section">
          <h2>Personnes à développer (polyvalence la plus faible)</h2>
          <div className="card">
            <Bars items={moinsPoly} accent="#7c3aed" suffix=" postes" />
          </div>
        </div>
      </div>
    </>
  );
}
