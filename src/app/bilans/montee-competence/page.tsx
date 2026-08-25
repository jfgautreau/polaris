import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import ReportActions from "@/app/bilans/ReportActions";
import Bars from "@/app/bilans/Bars";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";

type Named = { id: string; nom: string; prenom?: string };
type LigneRow = {
  id: string;
  nom: string;
  atelier_id: string | null;
  poste: { id: string; nom: string; actif: boolean; categorie: string | null; effectif_requis: number }[];
};
type Mat = { personne_id: string; poste_id: string; niveau_actuel: number; niveau_cible: number };

// Seuil de « competent », commun a tous les rapports.
const SEUIL = 2;

const CATS = [
  { key: "manager", label: "Managers" },
  { key: "conducteur", label: "Conducteurs" },
  { key: "operateur", label: "Opérateurs" },
] as const;

// Rapport dedie : ou en est-on de la montee en competence, et qui former sur quoi.
// Vue globale (actuel vs cible) puis detail atelier par atelier.
export default async function MonteeCompetenceReport({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string }>;
}) {
  const { profile } = await requireRapportBilan("montee-competence");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";

  const supabase = await getServerClient();
  const [{ data: persD }, { data: lignesD }, matD, { data: atD }] = await Promise.all([
    supabase.from("personne").select("id, nom, prenom").eq("statut", "ACTIF").order("nom").returns<Named[]>(),
    supabase
      .from("ligne")
      .select("id, nom, atelier_id, poste(id, nom, actif, categorie, effectif_requis)")
      .eq("actif", true)
      .order("nom")
      .returns<LigneRow[]>(),
    fetchAll<Mat>(() =>
      supabase.from("matrice").select("personne_id, poste_id, niveau_actuel, niveau_cible").order("id").returns<Mat[]>()
    ),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
  ]);

  const active = persD ?? [];
  const activeIds = new Set(active.map((p) => p.id));
  const persNom = (id: string) => {
    const p = active.find((x) => x.id === id);
    return p ? `${p.nom} ${p.prenom ?? ""}`.trim() : "?";
  };

  const ateliers = atD ?? [];
  const atNom = new Map(ateliers.map((a) => [a.id, a.nom]));

  // Tous les postes actifs, avec leur ligne et leur atelier.
  const tousPostes = (lignesD ?? []).flatMap((l) =>
    (l.poste ?? [])
      .filter((p) => p.actif)
      .map((p) => ({
        id: p.id,
        nom: p.nom,
        ligne: l.nom,
        atelierId: l.atelier_id,
        atelier: l.atelier_id ? atNom.get(l.atelier_id) ?? "—" : "Sans atelier",
        categorie: p.categorie ?? "operateur",
        effectif: p.effectif_requis ?? 0,
      }))
  );
  const postes = tousPostes.filter((p) => !atelier || p.atelierId === atelier);
  const posteById = new Map(tousPostes.map((p) => [p.id, p]));
  const scopedPosteIds = new Set(postes.map((p) => p.id));

  // Matrice restreinte aux personnes actives et aux postes du perimetre.
  const mat = matD.filter((r) => activeIds.has(r.personne_id) && scopedPosteIds.has(r.poste_id));

  // ---- Vue globale : actuel vs cible, par poste ----
  // Actuel = nombre de personnes au niveau >= SEUIL. Cible = nombre de personnes
  // dont l'OBJECTIF est >= SEUIL. L'ecart est ce qu'il reste a former.
  const parPoste = postes.map((p) => {
    const rows = mat.filter((r) => r.poste_id === p.id);
    const actuel = rows.filter((r) => r.niveau_actuel >= SEUIL).length;
    const cible = rows.filter((r) => r.niveau_cible >= SEUIL).length;
    return { ...p, actuel, cible, ecart: Math.max(0, cible - actuel) };
  });

  const totalActuel = parPoste.reduce((s, p) => s + p.actuel, 0);
  const totalCible = parPoste.reduce((s, p) => s + p.cible, 0);
  const totalEcart = parPoste.reduce((s, p) => s + p.ecart, 0);
  const pctAtteint = totalCible > 0 ? Math.round((Math.min(totalActuel, totalCible) / totalCible) * 100) : 100;
  const postesConcernes = parPoste.filter((p) => p.ecart > 0).length;

  // Synthese par categorie (les trois niveaux hierarchiques).
  const parCategorie = CATS.map((c) => {
    const rows = parPoste.filter((p) => p.categorie === c.key);
    return {
      label: c.label,
      actuel: rows.reduce((s, p) => s + p.actuel, 0),
      cible: rows.reduce((s, p) => s + p.cible, 0),
      ecart: rows.reduce((s, p) => s + p.ecart, 0),
    };
  }).filter((r) => r.cible > 0 || r.actuel > 0);

  // Synthese par atelier, pour la vue globale.
  const parAtelier = ateliers
    .map((a) => {
      const rows = parPoste.filter((p) => p.atelierId === a.id);
      return {
        id: a.id,
        nom: a.nom,
        actuel: rows.reduce((s, p) => s + p.actuel, 0),
        cible: rows.reduce((s, p) => s + p.cible, 0),
        ecart: rows.reduce((s, p) => s + p.ecart, 0),
      };
    })
    .filter((r) => r.cible > 0 || r.actuel > 0);

  // ---- Fragilite du poste : la seule « priorite » calculable aujourd'hui ----
  // Aucune priorite n'est saisie nulle part. On la DEDUIT du nombre de personnes
  // competentes rapporte a l'effectif requis :
  //   critique = personne ne tient le poste · elevee = une seule, ou moins de
  //   monde que de places a pourvoir · normale = le reste.
  const niveauFragilite = (p: (typeof parPoste)[number]): "critique" | "elevee" | "normale" => {
    if (p.actuel === 0) return "critique";
    if (p.actuel <= 1 || p.actuel < p.effectif) return "elevee";
    return "normale";
  };
  const fragiliteParPoste = new Map(parPoste.map((p) => [p.id, niveauFragilite(p)]));
  const RANG = { critique: 0, elevee: 1, normale: 2 } as const;

  // ---- Detail : qui former, sur quel poste ----
  const aFormer = mat
    .filter((r) => r.niveau_actuel < r.niveau_cible)
    .map((r) => {
      const p = posteById.get(r.poste_id)!;
      return {
        personne: persNom(r.personne_id),
        poste: p.nom,
        ligne: p.ligne,
        atelierId: p.atelierId,
        atelier: p.atelier,
        actuel: r.niveau_actuel,
        cible: r.niveau_cible,
        gap: r.niveau_cible - r.niveau_actuel,
        fragilite: fragiliteParPoste.get(r.poste_id) ?? "normale",
      };
    })
    .sort(
      (a, b) =>
        RANG[a.fragilite] - RANG[b.fragilite] ||
        b.gap - a.gap ||
        a.atelier.localeCompare(b.atelier) ||
        a.personne.localeCompare(b.personne)
    );

  // Regroupement par atelier pour le detail.
  const groupes = [...new Set(aFormer.map((r) => r.atelier))]
    .sort((a, b) => a.localeCompare(b))
    .map((nom) => ({ nom, lignes: aFormer.filter((r) => r.atelier === nom) }));

  const badge = (f: "critique" | "elevee" | "normale") =>
    f === "critique" ? <span className="rbadge danger">critique</span>
    : f === "elevee" ? <span className="rbadge warn">élevée</span>
    : <span className="muted">—</span>;

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <h1>Plan de montée en compétence</h1>
            <div className="sub">
              Compétent = niveau ≥ {SEUIL} · {active.length} personnes actives · {postes.length} postes actifs
            </div>
          </div>
          <ReportActions />
        </div>

        <ReportAtelierFilter ateliers={ateliers} atelier={atelier} />

        <div className="kpi-grid">
          <div className={`kpi ${pctAtteint < 100 ? "warn" : "ok"}`}>
            <div className="v">{pctAtteint}<small> %</small></div>
            <div className="l">Objectif atteint</div>
            <div className="s">{totalActuel} / {totalCible} compétences cibles</div>
          </div>
          <div className={`kpi ${totalEcart > 0 ? "warn" : "ok"}`}>
            <div className="v">{totalEcart}</div>
            <div className="l">Formations à réaliser</div>
            <div className="s">couples personne × poste</div>
          </div>
          <div className={`kpi ${postesConcernes > 0 ? "warn" : "ok"}`}>
            <div className="v">{postesConcernes}</div>
            <div className="l">Postes sous leur cible</div>
          </div>
          <div className={`kpi ${aFormer.filter((r) => r.fragilite === "critique").length > 0 ? "danger" : "ok"}`}>
            <div className="v">{aFormer.filter((r) => r.fragilite === "critique").length}</div>
            <div className="l">Sur poste sans titulaire</div>
            <div className="s">à traiter en premier</div>
          </div>
        </div>

        {/* ---- Vue globale ---- */}
        <div className="report-section">
          <h2>Vue globale — actuel vs cible</h2>
          <div className="report-grid2">
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Par catégorie</h2>
              {parCategorie.length === 0 ? (
                <p className="muted">Aucun objectif de polyvalence saisi.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Catégorie</th>
                      <th style={{ textAlign: "center" }}>Actuel</th>
                      <th style={{ textAlign: "center" }}>Cible</th>
                      <th style={{ textAlign: "center" }}>Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parCategorie.map((r) => (
                      <tr key={r.label}>
                        <td><strong>{r.label}</strong></td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{r.actuel}</td>
                        <td style={{ textAlign: "center" }} className="muted">{r.cible}</td>
                        <td style={{ textAlign: "center", fontWeight: 700, color: r.ecart > 0 ? "var(--danger)" : "var(--ok)" }}>
                          {r.ecart > 0 ? `−${r.ecart}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Par atelier</h2>
              {parAtelier.length === 0 ? (
                <p className="muted">Aucun objectif de polyvalence saisi.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Atelier</th>
                      <th style={{ textAlign: "center" }}>Actuel</th>
                      <th style={{ textAlign: "center" }}>Cible</th>
                      <th style={{ textAlign: "center" }}>Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parAtelier.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.nom}</strong></td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{r.actuel}</td>
                        <td style={{ textAlign: "center" }} className="muted">{r.cible}</td>
                        <td style={{ textAlign: "center", fontWeight: 700, color: r.ecart > 0 ? "var(--danger)" : "var(--ok)" }}>
                          {r.ecart > 0 ? `−${r.ecart}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: 15 }}>Postes les plus éloignés de leur cible</h2>
            <Bars
              items={parPoste
                .filter((p) => p.ecart > 0)
                .sort((a, b) => b.ecart - a.ecart)
                .slice(0, 15)
                .map((p) => ({ label: p.nom, n: p.ecart, sub: `${p.actuel}/${p.cible}` }))}
              accent="#d97706"
            />
          </div>
        </div>

        {/* ---- Detail par atelier ---- */}
        <div className="report-section">
          <h2>Qui former, sur quel poste</h2>
          {groupes.length === 0 ? (
            <p className="muted">Aucun écart individuel : tout le monde est au niveau cible.</p>
          ) : (
            groupes.map((g) => (
              <div className="card" key={g.nom} style={{ marginBottom: 14 }}>
                <h2 style={{ marginTop: 0, fontSize: 15 }}>
                  {g.nom} <span className="muted" style={{ fontWeight: 400 }}>· {g.lignes.length} formation(s)</span>
                </h2>
                <table>
                  <thead>
                    <tr>
                      <th>Personne</th>
                      <th>Poste</th>
                      <th>Ligne</th>
                      <th style={{ textAlign: "center" }}>Actuel → Cible</th>
                      <th style={{ textAlign: "right" }}>Fragilité du poste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lignes.map((r, i) => (
                      <tr key={i}>
                        <td>{r.personne}</td>
                        <td><strong>{r.poste}</strong></td>
                        <td className="muted">{r.ligne}</td>
                        <td style={{ textAlign: "center" }}>{r.actuel} → {r.cible}</td>
                        <td style={{ textAlign: "right" }}>{badge(r.fragilite)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Écart individuel = niveau actuel inférieur au niveau cible saisi dans la matrice.
            La <strong>fragilité du poste</strong> est calculée, jamais saisie :
            <strong> critique</strong> = personne ne tient le poste ·
            <strong> élevée</strong> = une seule personne, ou moins de personnes compétentes
            que de places à pourvoir.
          </p>
        </div>
      </div>
    </>
  );
}
