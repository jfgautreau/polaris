import Link from "next/link";
import { Fragment } from "react";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import ReportEquipeFilter from "@/app/bilans/ReportEquipeFilter";
import { requireRapportBilan } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { getNbNiveauxC, getCouleursNiveauxC } from "@/lib/refdata";
import { couleursNiveau } from "@/lib/couleurs-niveau";
import HabilitationsToggle from "./HabilitationsToggle";
import {
  calculerGrille,
  construireSemaines,
  lundiIsoDe,
  nbQuartsPostesDe,
  type Atelier,
  type Contrat,
  type MatCell,
  type Personne,
  type Poste,
} from "@/lib/feuille-route-data";

const HORIZON = 24;
const CAT_COULEUR: Record<string, { fg: string; bg: string }> = {
  manager: { fg: "#9333ea", bg: "#f3e8ff" },
  conducteur: { fg: "#4338ca", bg: "#eceafe" },
  operateur: { fg: "#0e7490", bg: "#e2f2f6" },
};

type LigneAtelier = {
  id: string;
  atelier_id: string | null;
  poste: { id: string; actif: boolean; categorie: string | null; effectif_requis: number | null }[];
};

type PlRow = { personne_id: string; jour: string; motif_absence_id: string | null };
type CpRow = { personne_id: string; date_debut: string; date_fin: string | null };
type PcRow = { personne_id: string; competence_id: string; date_expiration: string | null };
type PcReqRow = { poste_id: string; competence_id: string };

export default async function FeuilleRouteReport({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; equipe?: string; hab?: string }>;
}) {
  const { profile } = await requireRapportBilan("feuille-route");
  const sp = await searchParams;
  const atelier = sp.atelier ?? "";
  const equipe = sp.equipe ?? "";
  // Bascule habilitations : `hab=off` = mode « ignorées » ; par défaut strict.
  const habilitationStricte = sp.hab !== "off";

  const supabase = await getServerClient();

  const pivotLundi = lundiIsoDe(new Date());
  const semaines = construireSemaines(pivotLundi, HORIZON);
  const derniereIso = semaines[semaines.length - 1].lundi;
  // Fenêtre absences : du 1er lundi au vendredi de la dernière semaine.
  const finFenetreIso = (() => {
    const d = new Date(derniereIso + "T00:00:00");
    d.setDate(d.getDate() + 4);
    return d.toISOString().slice(0, 10);
  })();

  const nbNiveaux = await getNbNiveauxC();
  const couleursCfg = await getCouleursNiveauxC();
  const couleurs = couleursNiveau(couleursCfg);

  const [{ data: atD }, { data: eqD }, { data: persD }, { data: lignesD }, matD, plD, cpD, pcD, { data: pcrD }, { data: quartsD }, { data: pqOffD }] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<Atelier[]>(),
    supabase.from("equipe").select("id, nom, couleur").eq("actif", true).order("nom").returns<{ id: string; nom: string; couleur: string | null }[]>(),
    supabase.from("personne").select("id, atelier_id, equipe_id").eq("statut", "ACTIF").returns<Personne[]>(),
    supabase
      .from("ligne")
      .select("id, atelier_id, poste(id, actif, categorie, effectif_requis)")
      .eq("actif", true)
      .returns<LigneAtelier[]>(),
    fetchAll<MatCell>(() =>
      supabase.from("matrice").select("personne_id, poste_id, niveau_actuel").order("id").returns<MatCell[]>(),
    ),
    fetchAll<PlRow>(() =>
      supabase
        .from("placement")
        .select("personne_id, jour, motif_absence_id")
        .gte("jour", pivotLundi)
        .lte("jour", finFenetreIso)
        .not("motif_absence_id", "is", null)
        .order("jour")
        .returns<PlRow[]>(),
    ),
    fetchAll<CpRow>(() =>
      supabase.from("contrat_periode").select("personne_id, date_debut, date_fin").order("id").returns<CpRow[]>(),
    ),
    fetchAll<PcRow>(() =>
      supabase.from("personne_competence").select("personne_id, competence_id, date_expiration").order("id").returns<PcRow[]>(),
    ),
    supabase.from("poste_competence_requise").select("poste_id, competence_id").returns<PcReqRow[]>(),
    // Quarts du site + désactivations poste×quart : servent à compter les
    // quarts POSTÉS de chaque poste pour le besoin (matin + après-midi = 2).
    supabase.from("quart").select("code, creneau, ordre").order("ordre").returns<{ code: string; creneau: string | null; ordre: number }[]>(),
    supabase.from("poste_quart").select("poste_id, quart_code").eq("actif", false).returns<{ poste_id: string; quart_code: string }[]>(),
  ]);

  // Quarts postés par poste (référentiel) : tous les quarts du site sauf ceux
  // désactivés (`poste_quart`, défaut actif). `journeeCode` = quart pleine
  // journée (sans créneau, plus petit ordre) — même détection que l'ordo.
  const quartCodes = (quartsD ?? []).map((q) => q.code);
  const journeeCode = [...(quartsD ?? [])].filter((q) => !q.creneau).sort((a, b) => a.ordre - b.ordre)[0]?.code ?? null;
  const pqOff = new Set((pqOffD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`));
  const nbQuartsDe = (posteId: string): number => {
    const actifs = quartCodes.filter((q) => !pqOff.has(`${posteId}:${q}`));
    return nbQuartsPostesDe(actifs, journeeCode);
  };

  // Postes actifs indexés + rattachement à leur atelier (via ligne). L'atelier_id
  // du POSTE est celui de sa ligne : il sert à ventiler le Besoin et la Cible par
  // service (indépendamment de l'atelier d'affectation des personnes).
  const postes: Poste[] = [];
  for (const l of lignesD ?? []) {
    for (const p of l.poste ?? []) {
      if (!p.actif) continue;
      postes.push({
        id: p.id,
        atelier_id: l.atelier_id,
        actif: true,
        categorie: p.categorie ?? "operateur",
        effectif_requis: p.effectif_requis ?? 0,
        nbQuartsPostes: nbQuartsDe(p.id),
      });
    }
  }

  // Contrats indexés par personne.
  const contratsParPersonne = new Map<string, Contrat[]>();
  for (const c of cpD) {
    const arr = contratsParPersonne.get(c.personne_id) ?? [];
    arr.push({ personne_id: c.personne_id, date_debut: c.date_debut, date_fin: c.date_fin });
    contratsParPersonne.set(c.personne_id, arr);
  }

  // Jours d'absence par personne (fenêtre).
  const absencesParPersonne = new Map<string, Set<string>>();
  for (const r of plD) {
    if (!r.motif_absence_id) continue;
    let s = absencesParPersonne.get(r.personne_id);
    if (!s) { s = new Set(); absencesParPersonne.set(r.personne_id, s); }
    s.add(r.jour);
  }

  // Habilitations exigées par poste + habilitations de chaque personne.
  const posteCompRequise = new Map<string, string[]>();
  for (const r of pcrD ?? []) {
    const arr = posteCompRequise.get(r.poste_id) ?? [];
    arr.push(r.competence_id);
    posteCompRequise.set(r.poste_id, arr);
  }
  const competencesPersonne = new Map<string, Map<string, string | null>>();
  for (const r of pcD) {
    let m = competencesPersonne.get(r.personne_id);
    if (!m) { m = new Map(); competencesPersonne.set(r.personne_id, m); }
    m.set(r.competence_id, r.date_expiration);
  }

  const grille = calculerGrille({
    personnes: persD ?? [],
    postes,
    matrice: matD,
    contratsParPersonne,
    absencesParPersonne,
    posteCompRequise,
    competencesPersonne,
    ateliers: atD ?? [],
    ateliersFiltre: atelier ? [atelier] : null,
    equipesFiltre: equipe ? [equipe] : null,
    semaines,
    nbNiveaux,
    habilitationStricte,
  });

  const semainesLabel = grille.semaines.map((s) => `S${String(s.num).padStart(2, "0")}`);
  const todayLundi = pivotLundi;
  // Regroupement des semaines par année pour la rangée d'en-tête supérieure :
  // les 24 semaines peuvent enjamber le 31 décembre (…S52 2026, S01 2027…).
  const anneeSpans: { annee: number; span: number; firstIdx: number }[] = [];
  grille.semaines.forEach((s, i) => {
    const last = anneeSpans[anneeSpans.length - 1];
    if (last && last.annee === s.annee) last.span++;
    else anneeSpans.push({ annee: s.annee, span: 1, firstIdx: i });
  });

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="report-head">
          <div>
            <PageTitle module="bilans">Projection de compétences — feuille de route</PageTitle>
            <div className="sub">
              24 semaines glissantes · comptage <strong>exact</strong> (personne = son niveau MAX par catégorie) · service = <strong>atelier d&apos;affectation</strong> de la personne · variations : absences pleine semaine, expirations d&apos;habilitation, fins de contrat.
            </div>
            <div className="sub" style={{ marginTop: 4 }}>
              <strong>Besoin</strong> = somme, sur les postes actifs de la catégorie <em>dans l&apos;atelier</em>, de <code>effectif_requis × nombre de quarts postés</code> (Référentiel) : 1 poste à 1 place tournant matin + après-midi compte 2. La journée pleine compte 1 (elle ne se cumule pas avec matin/après-midi).{" "}
              <strong>Total</strong> = nombre de personnes compétentes de la catégorie (niv.&nbsp;1 à&nbsp;{nbNiveaux}, chacune comptée une fois) ; <span style={{ color: "#15803d", fontWeight: 700 }}>vert</span> si ≥ besoin, <span style={{ color: "#b91c1c", fontWeight: 700 }}>rouge</span> si &lt; besoin.
            </div>
          </div>
        </div>

        <ReportAtelierFilter ateliers={atD ?? []} atelier={atelier} />
        <ReportEquipeFilter equipes={eqD ?? []} equipe={equipe} />
        <HabilitationsToggle strict={habilitationStricte} />

        {grille.services.length === 0 ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Aucune personne dans ce filtre.</p></div>
        ) : (
          grille.services.map((svc) => (
            <div key={svc.atelierId} className="card" style={{ marginBottom: 18, padding: "12px 14px" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{svc.atelierNom}</h2>
              <table className="matrix" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 170 }} />
                  {grille.semaines.map((_, i) => <col key={i} />)}
                </colgroup>
                <thead>
                  {/* Rangée années : une cellule fusionnée par année couverte. */}
                  <tr>
                    <th style={{ padding: "2px 8px", background: "#fff" }}>&nbsp;</th>
                    {anneeSpans.map((a) => (
                      <th
                        key={a.annee}
                        colSpan={a.span}
                        style={{
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--muted)",
                          padding: "2px 0",
                          background: "#f1f5f9",
                          borderLeft: "1px solid var(--border)",
                        }}
                      >
                        {a.annee}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 12, color: "var(--muted)" }}>&nbsp;</th>
                    {grille.semaines.map((s, i) => (
                      <th
                        key={s.lundi}
                        style={{
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "4px 0",
                          background: s.lundi === todayLundi ? "#dbeafe" : "#f8fafc",
                          borderLeft: i === 0 ? "1px solid var(--border)" : "1px solid #eef2f7",
                        }}
                        title={`Lundi ${s.lundi} — S${s.num} / ${s.annee}`}
                      >
                        {semainesLabel[i]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {svc.blocs.map((bloc) => {
                    const cat = CAT_COULEUR[bloc.cat] ?? { fg: "#334155", bg: "#f1f5f9" };
                    return (
                      <Fragment key={`${svc.atelierId}:${bloc.cat}`}>
                        <tr key={`${svc.atelierId}:${bloc.cat}:head`}>
                          <td colSpan={grille.semaines.length + 1} style={{ padding: "8px 8px 4px", fontWeight: 700, fontSize: 13 }}>
                            <span
                              style={{
                                display: "inline-block",
                                background: cat.bg,
                                color: cat.fg,
                                padding: "1px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {bloc.catLabel}
                            </span>
                          </td>
                        </tr>
                        {/* Ligne Besoin (abaque) : constante sur l'horizon, sert
                            de référence pour lire les niveaux ci-dessous. */}
                        {bloc.besoin > 0 && (
                          <tr key={`${svc.atelierId}:${bloc.cat}:besoin`}>
                            <td
                              style={{ padding: "3px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: "#334155" }}
                              title={`Somme de (effectif_requis × nombre de quarts postés) sur les postes ${bloc.catLabel.toLowerCase()} actifs de l'atelier (Référentiel). 1 place tournant matin + après-midi = 2. Constant sur les 24 semaines : abaque de référence, pas une charge datée.`}
                            >
                              Besoin
                            </td>
                            {grille.semaines.map((s, wi) => (
                              <td
                                key={wi}
                                style={{
                                  textAlign: "center",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#334155",
                                  background: s.lundi === todayLundi ? "#eff6ff" : "#f8fafc",
                                  borderLeft: wi === 0 ? "1px solid var(--border)" : "1px solid #eef2f7",
                                }}
                              >
                                {bloc.besoin}
                              </td>
                            ))}
                          </tr>
                        )}
                        {bloc.niveaux.map((niv, ni) => {
                          const teinte = couleurs[niv.niveau] ?? "#94a3b8";
                          return (
                            <tr key={`${svc.atelierId}:${bloc.cat}:${niv.niveau}`}>
                              <td style={{ padding: "3px 8px", fontSize: 12, whiteSpace: "nowrap" }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    width: 10,
                                    height: 10,
                                    borderRadius: 999,
                                    background: teinte ?? "#fff",
                                    border: teinte ? undefined : "1px solid #94a3b8",
                                    marginRight: 6,
                                    verticalAlign: "middle",
                                  }}
                                />
                                Niv.&nbsp;{niv.niveau}
                              </td>
                              {niv.parSemaine.map((v, wi) => {
                                const prev = wi > 0 ? niv.parSemaine[wi - 1] : v;
                                const couleurVal =
                                  wi === 0 || v === prev
                                    ? "var(--text)"
                                    : v > prev
                                    ? "#15803d"
                                    : "#b91c1c";
                                return (
                                  <td
                                    key={wi}
                                    style={{
                                      textAlign: "center",
                                      fontSize: 12,
                                      fontWeight: v > 0 ? 700 : 400,
                                      color: v > 0 ? couleurVal : "#cbd5e1",
                                      background: grille.semaines[wi].lundi === todayLundi ? "#eff6ff" : undefined,
                                      borderLeft: ni === 0 && wi === 0 ? "1px solid var(--border)" : "1px solid #eef2f7",
                                    }}
                                    title={wi > 0 && v !== prev ? `${prev} → ${v} (${v > prev ? "+" : ""}${v - prev})` : undefined}
                                  >
                                    {v || "·"}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                        {/* Ligne Total : somme des niveaux (personnes compétentes,
                            comptées une fois). Vert si ≥ besoin, rouge si en-dessous. */}
                        <tr style={{ borderTop: "2px solid #cbd5e1" }}>
                          <td
                            style={{ padding: "3px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}
                            title={`Nombre de personnes ${bloc.catLabel.toLowerCase()} compétentes (niv. 1 à ${nbNiveaux}), chacune comptée une fois. Vert si ≥ besoin (${bloc.besoin}), rouge sinon.`}
                          >
                            Total
                          </td>
                          {grille.semaines.map((s, wi) => {
                            const total = bloc.niveaux.reduce((acc, niv) => acc + niv.parSemaine[wi], 0);
                            const suffisant = total >= bloc.besoin;
                            return (
                              <td
                                key={wi}
                                style={{
                                  textAlign: "center",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#fff",
                                  background: suffisant ? "#15803d" : "#b91c1c",
                                  borderLeft: wi === 0 ? "1px solid var(--border)" : "1px solid rgba(255,255,255,0.35)",
                                  outline: s.lundi === todayLundi ? "2px solid #1d4ed8" : undefined,
                                  outlineOffset: -2,
                                }}
                                title={`${total} compétent(s) / besoin ${bloc.besoin}${suffisant ? "" : ` — manque ${bloc.besoin - total}`}`}
                              >
                                {total}
                              </td>
                            );
                          })}
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}

        <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>
          <Link href="/matrice" className="navlink">Modifier la matrice</Link>{" "}
          &nbsp;·&nbsp;{" "}
          <Link href="/admin/competences" className="navlink">Régler les niveaux</Link>
        </p>
      </div>
    </>
  );
}
