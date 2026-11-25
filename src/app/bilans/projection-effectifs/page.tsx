import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import BandeauErreur from "@/components/BandeauErreur";
import ReportActions from "@/app/bilans/ReportActions";
import ReportAtelierFilter from "@/app/bilans/ReportAtelierFilter";
import { requireRapportBilan, canWrite } from "@/lib/permissions";
import { LIBELLE_CATEGORIE, MOIS_COURTS, cumuler, lireAnnee, type Cumul } from "@/lib/gpec";
import { chargerGpec, type Gpec, type LignePoste } from "@/lib/gpec-data";
import type { CelluleXlsx, FeuilleXlsx } from "@/lib/xlsx";
import ExportProjection from "./ExportProjection";

// Projection des effectifs (GPEC) : pour l'année choisie, le besoin déduit des
// volumes et du Référentiel, comparé aux titulaires — postes en déficit, à
// former depuis le vivier interne, à recruter. Hypothèses : /admin/gpec.

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
const entier = (x: number) => Math.round(x).toLocaleString("fr-FR");
const cat = (c: string) => LIBELLE_CATEGORIE[c] ?? c;
const COULEUR_PALIER: Record<number, string> = { 1: "#e0f2fe", 2: "#dcfce7", 3: "#fef3c7", 4: "#fee2e2" };
const droite: React.CSSProperties = { textAlign: "right" };
const centre: React.CSSProperties = { textAlign: "center" };

function LigneCumul({ libelle, sous, c, gras }: { libelle: string; sous?: string; c: Cumul; gras?: boolean }) {
  const st: React.CSSProperties = gras ? { fontWeight: 700, background: "#f8fafc" } : {};
  return (
    <tr style={st}>
      <td>{libelle}</td>
      <td className={gras ? undefined : "muted"}>{sous ?? ""}</td>
      <td style={droite}>{entier(c.besoinTheorique)}</td>
      <td style={droite}>{n1(c.besoinReel)}</td>
      <td style={droite}>{c.departs || "—"}</td>
      <td style={droite}>{n1(c.besoinTotal)}</td>
      <td style={droite}>{c.disponibilite}</td>
      <td style={droite}>{c.enFormation || "—"}</td>
      <td style={droite}>{pct(c.couverture)}</td>
      <td style={{ ...droite, fontWeight: 700, color: c.deficit ? "#b91c1c" : undefined }}>{c.deficit || "—"}</td>
      <td style={droite}>{c.aFormer || "—"}</td>
      <td style={{ ...droite, fontWeight: 700 }}>{c.aRecruter || "—"}</td>
    </tr>
  );
}

export default async function ProjectionEffectifsReport({ searchParams }: { searchParams: Promise<{ annee?: string; atelier?: string }> }) {
  const { profile, perms } = await requireRapportBilan("projection-effectifs");
  const sp = await searchParams;
  const annee = lireAnnee(sp.annee, new Date());
  const atelier = sp.atelier ?? "";
  const aujourdhui = new Date().toISOString().slice(0, 10);

  let g: Gpec | null = null;
  let erreur = "";
  try {
    g = await chargerGpec(await getServerClient(), profile.siteId, annee);
  } catch (e) {
    erreur = e instanceof Error ? e.message : "Lecture impossible.";
  }

  const lienAnnee = (a: number) => `/bilans/projection-effectifs?annee=${a}${atelier ? `&atelier=${atelier}` : ""}`;
  const entete = (sous: React.ReactNode, actions?: React.ReactNode) => (
    <div className="report-head">
      <div>
        <PageTitle module="bilans">Projection des effectifs {annee}</PageTitle>
        <div className="sub">{sous}</div>
      </div>
      <ReportActions>
        {actions}
        {canWrite(perms, "gpec") && <Link href={`/admin/gpec?annee=${annee}`} className="navlink" prefetch={false}>Hypothèses</Link>}
      </ReportActions>
    </div>
  );

  if (!g) {
    return (
      <>
        <AppHeader role={profile.role} active="/bilans" />
        <div className="container" style={{ maxWidth: 1500 }}>
          {entete("GPEC — besoin, disponibilité, formations et recrutements")}
          <BandeauErreur message={`La projection ne peut pas être calculée (${erreur}). La migration 0097 a-t-elle été exécutée ?`} />
        </div>
      </>
    );
  }

  // Filtre de service : restreint les postes et les listes ; les lignes
  // capacitaires et les hypothèses restent celles du site.
  const nomAtelier = g.ateliers.find((a) => a.id === atelier)?.nom ?? "";
  const postes = atelier ? g.postes.filter((p) => p.atelierId === atelier) : g.postes;
  const groupes = atelier ? g.groupes.filter((x) => x.atelierId === atelier) : g.groupes;
  const parService = atelier ? g.parService.filter((x) => x.atelierId === atelier) : g.parService;
  const total = atelier ? cumuler(postes) : g.total;
  const formations = atelier ? g.formations.filter((f) => f.service === nomAtelier) : g.formations;
  const departs = atelier ? g.departs.filter((d) => d.service === nomAtelier) : g.departs;
  const recrutements = postes.filter((p) => p.aRecruter > 0).sort((a, b) => b.aRecruter - a.aRecruter || a.nom.localeCompare(b.nom));
  const aTitulariser = formations.filter((f) => f.type === "titulariser");
  const aProgresser = formations.filter((f) => f.type === "progresser");
  const subi = atelier ? g.subi.filter((s) => s.atelierId === atelier) : g.subi;
  const semProgramme = g.hyp.semConges + g.hyp.semModulation;
  const capasSansCalcul = g.capas.filter((c) => c.sat.palier === null).map((c) => c.nom);

  // ---- Extraction Excel (mêmes lignes que l'écran) ----
  const titres = (t: string) => [`Projection des effectifs ${annee} — ${t}`, `${nomAtelier || "Tous les services"} · extrait le ${fmtDate(aujourdhui)}`];
  const ligneCumul = (a: string, b: string, c: Cumul): CelluleXlsx[] => [a, b, c.besoinTheorique, Math.round(c.besoinReel * 10) / 10, c.departs, Math.round(c.besoinTotal * 10) / 10, c.disponibilite, c.enFormation, c.couverture === null ? null : Math.round(c.couverture * 100), c.deficit, c.aFormer, c.aRecruter];
  const colsBilan = ["Besoin théorique (postes)", "Besoin réel (ETP)", "Départs", "Besoin total", "Disponibilité", "Dont en cours de formation", "Couverture (%)", "Postes en déficit", "À former", "À recruter"].map((titre) => ({ titre, largeur: 14 }));
  const feuilles: FeuilleXlsx[] = [
    {
      nom: "Bilan",
      titres: titres("bilan"),
      colonnes: [{ titre: "Service", largeur: 20 }, { titre: "Catégorie", largeur: 16 }, ...colsBilan],
      lignes: [
        ...groupes.map((x) => ligneCumul(x.atelierNom, cat(x.categorie), x.cumul)),
        ...parService.map((x) => ligneCumul(x.atelierNom, "Total", x.cumul)),
        ...(atelier ? [] : [ligneCumul("Site", "Total", total)]),
      ],
    },
    {
      nom: "Postes",
      titres: titres("détail par poste"),
      colonnes: [{ titre: "Service", largeur: 18 }, { titre: "Ligne", largeur: 18 }, { titre: "Poste", largeur: 28 }, { titre: "Catégorie", largeur: 14 }, { titre: "Ligne capacitaire", largeur: 16 }, { titre: "Palier", largeur: 8 }, ...colsBilan.filter((c) => c.titre !== "Couverture (%)"), { titre: "Référents", largeur: 10 }, { titre: "Vivier interne", largeur: 12 }, { titre: "Cible posée (matrice)", largeur: 14 }],
      lignes: postes.map((p): CelluleXlsx[] => [p.atelierNom, p.ligne, p.nom, cat(p.categorie), p.capaNom ?? "Organisation actuelle", p.palier, p.besoinTheorique, Math.round(p.besoinReel * 10) / 10, p.departs, Math.round(p.besoinTotal * 10) / 10, p.disponibilite, p.enFormation, p.deficit, p.aFormer, p.aRecruter, p.referents, p.vivier, p.enCible]),
    },
    {
      nom: "Recrutements",
      titres: titres("recrutements par poste"),
      colonnes: [{ titre: "Service", largeur: 18 }, { titre: "Ligne", largeur: 18 }, { titre: "Poste", largeur: 28 }, { titre: "Catégorie", largeur: 14 }, { titre: "Besoin total", largeur: 12 }, { titre: "Disponibilité", largeur: 12 }, { titre: "Postes en déficit", largeur: 12 }, { titre: "À former", largeur: 10 }, { titre: "À recruter", largeur: 10 }],
      lignes: recrutements.map((p): CelluleXlsx[] => [p.atelierNom, p.ligne, p.nom, cat(p.categorie), Math.round(p.besoinTotal * 10) / 10, p.disponibilite, p.deficit, p.aFormer, p.aRecruter]),
    },
    {
      nom: "Formations",
      titres: titres("personnes à former"),
      colonnes: [{ titre: "Personne", largeur: 24 }, { titre: "Service du poste", largeur: 18 }, { titre: "Ligne", largeur: 18 }, { titre: "Poste", largeur: 28 }, { titre: "Niveau actuel", largeur: 12 }, { titre: "Niveau requis", largeur: 12 }, { titre: "Action", largeur: 34 }],
      lignes: formations.map((f): CelluleXlsx[] => [f.personne, f.service, f.ligne, f.poste, f.niveau, f.requis, f.type === "titulariser" ? "Vivier interne : à faire passer titulaire" : "Titulaire : à amener au niveau requis"]),
    },
    {
      nom: "Départs",
      titres: titres("départs prévus"),
      colonnes: [{ titre: "Personne", largeur: 24 }, { titre: "Service", largeur: 18 }, { titre: "Poste titulaire", largeur: 28 }, { titre: "Date prévue", largeur: 13 }, { titre: "Motif", largeur: 16 }, { titre: "Commentaire", largeur: 30 }, { titre: "Origine", largeur: 16 }],
      lignes: departs.map((d): CelluleXlsx[] => [d.nom, d.service, d.poste, d.date ? { date: d.date } : null, d.motif, d.commentaire, d.source === "contrat" ? "Contrat" : "Saisi"]),
    },
    {
      nom: "Saturation",
      titres: titres("saturation des lignes"),
      colonnes: [{ titre: "Ligne capacitaire", largeur: 18 }, { titre: "Lignes rattachées", largeur: 34 }, { titre: "Volume", largeur: 14 }, { titre: "Capacité par jour", largeur: 14 }, { titre: "Capacité annuelle", largeur: 14 }, { titre: "Saturation (%)", largeur: 12 }, { titre: "Palier", largeur: 8 }],
      lignes: g.capas.map((c): CelluleXlsx[] => [c.nom, c.nomsLignes.join(", "), c.sat.volume, c.capaciteJour, c.sat.capaciteAnnuelle, c.sat.saturation === null ? null : Math.round(c.sat.saturation * 100), c.sat.palier]),
    },
  ];

  const ligneDetail = (p: LignePoste) => (
    <tr key={p.id}>
      <td className="muted">{p.atelierNom}</td>
      <td className="muted">{p.ligne}</td>
      <td style={{ fontWeight: 600 }}>{p.nom}</td>
      <td className="muted">{cat(p.categorie)}</td>
      <td style={centre}>{p.palier ? <span style={{ padding: "1px 8px", borderRadius: 999, background: COULEUR_PALIER[p.palier] }} title={p.capaNom ?? ""}>{p.palier}</span> : <span className="muted" title="Ligne non rattachée à une ligne capacitaire : organisation actuelle du Référentiel">—</span>}</td>
      <td style={droite}>{p.besoinTheorique}</td>
      <td style={droite}>{n1(p.besoinReel)}</td>
      <td style={droite}>{p.departs || "—"}</td>
      <td style={droite}>{n1(p.besoinTotal)}</td>
      <td style={droite}>{p.disponibilite}{p.enFormation ? <span className="muted" title="Titulaires sous le niveau requis"> ({p.enFormation} en form.)</span> : null}</td>
      <td style={{ ...droite, fontWeight: 700, color: p.deficit ? "#b91c1c" : undefined }}>{p.deficit || "—"}</td>
      <td style={droite} title={`Vivier interne du poste : ${p.vivier}`}>{p.aFormer || "—"}</td>
      <td style={{ ...droite, fontWeight: 700 }}>{p.aRecruter || "—"}</td>
      <td style={droite} className="muted">{p.referents || <span className="rbadge warn" title="Aucun titulaire au niveau maximum">0</span>}</td>
      <td style={droite} className="muted">{p.enCible || "—"}</td>
    </tr>
  );

  return (
    <>
      <AppHeader role={profile.role} active="/bilans" />
      <div className="container" style={{ maxWidth: 1500 }}>
        {entete(
          <>
            {postes.length} poste{postes.length > 1 ? "s" : ""} · {g.nbComptes} personnes comptées (hors {g.nbInterim} intérimaire{g.nbInterim > 1 ? "s" : ""}) · absences programmées {n1(semProgramme)} sem. · au {fmtDate(aujourdhui)}
          </>,
          <ExportProjection feuilles={feuilles} nomFichier={`projection-effectifs-${annee}-${aujourdhui}.xlsx`} />
        )}

        <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span className="muted" style={{ fontWeight: 600 }}>Année :</span>
          <div className="segments">
            {[annee - 1, annee, annee + 1].map((a) => (
              <Link key={a} href={lienAnnee(a)} className={a === annee ? "seg active" : "seg"} prefetch={false}>{a}</Link>
            ))}
          </div>
        </div>
        <ReportAtelierFilter ateliers={g.ateliers} atelier={atelier} />

        <div className="kpi-grid">
          <div className="kpi accent"><div className="v">{entier(total.besoinTheorique)}</div><div className="l">Besoin théorique</div><div className="s">postes à tenir, tous quarts ouverts</div></div>
          <div className="kpi accent"><div className="v">{n1(total.besoinTotal)}</div><div className="l">Besoin total</div><div className="s">{n1(total.besoinReel)} ETP absences comprises + {total.departs} départ{total.departs > 1 ? "s" : ""}</div></div>
          <div className={`kpi ${total.couverture !== null && total.couverture < 1 ? "warn" : "ok"}`}><div className="v">{total.disponibilite}</div><div className="l">Disponibilité</div><div className="s">titulaires · couverture {pct(total.couverture)} · {total.enFormation} en cours de formation</div></div>
          <div className={`kpi ${total.deficit ? "danger" : "ok"}`}><div className="v">{total.deficit}</div><div className="l">Postes en déficit</div><div className="s">personnes qui manquent, poste par poste</div></div>
          <div className={`kpi ${total.aFormer ? "warn" : "ok"}`}><div className="v">{total.aFormer}</div><div className="l">À former</div><div className="s">couverts par le vivier interne</div></div>
          <div className={`kpi ${total.aRecruter ? "danger" : "ok"}`}><div className="v">{total.aRecruter}</div><div className="l">À recruter</div><div className="s">le reste du déficit</div></div>
        </div>

        {/* Points d'attention : ce qui fausse la lecture si on l'ignore */}
        {(g.capas.length === 0 || g.lignesNonRattachees.length > 0 || capasSansCalcul.length > 0 || g.nbSansPosteFixe > 0) && (
          <div className="card" style={{ marginTop: 14, borderLeft: "3px solid #d97706" }}>
            <h3 style={{ marginTop: 0 }}>Points d&apos;attention</h3>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {g.capas.length === 0 && <li>Aucun volume saisi pour {annee} : le besoin est celui de l&apos;organisation actuelle du Référentiel, sans effet des volumes.</li>}
              {capasSansCalcul.length > 0 && <li>Saturation non calculable (volume ou capacité manquant) : <strong>{capasSansCalcul.join(", ")}</strong> — leurs postes sont comptés sur l&apos;organisation actuelle.</li>}
              {g.capas.length > 0 && g.lignesNonRattachees.length > 0 && <li>Lignes rattachées à aucune ligne capacitaire (organisation actuelle) : {g.lignesNonRattachees.join(", ")}.</li>}
              {g.nbSansPosteFixe > 0 && <li><strong>{g.nbSansPosteFixe}</strong> personne{g.nbSansPosteFixe > 1 ? "s" : ""} sur {g.nbComptes} sans poste fixe : hors disponibilité, comptée{g.nbSansPosteFixe > 1 ? "s" : ""} au vivier interne des postes qu&apos;elle{g.nbSansPosteFixe > 1 ? "s" : ""} tien{g.nbSansPosteFixe > 1 ? "nent" : "t"}. Un titulaire se déclare au Référentiel (colonne Titulaire) ou au Personnel (poste fixe).</li>}
            </ul>
          </div>
        )}

        {/* Saturation */}
        {g.capas.length > 0 && (
          <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>Saturation des lignes</h3>
            <table>
              <thead>
                <tr>
                  <th>Ligne capacitaire</th>
                  <th>Lignes rattachées</th>
                  <th style={droite}>Volume</th>
                  <th style={droite}>Capacité / jour</th>
                  <th style={droite}>Capacité annuelle</th>
                  <th style={droite}>Saturation</th>
                  <th style={centre}>Palier</th>
                  {g.capas.some((c) => c.sat.mensuel) && MOIS_COURTS.map((m) => <th key={m} style={{ ...centre, fontSize: 11 }}>{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {g.capas.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.nom}</td>
                    <td className="muted">{c.nomsLignes.join(", ") || "—"}</td>
                    <td style={droite}>{c.sat.volume === null ? "—" : entier(c.sat.volume)}</td>
                    <td style={droite}>{c.capaciteJour === null ? "—" : entier(c.capaciteJour)}</td>
                    <td style={droite}>{c.sat.capaciteAnnuelle === null ? "—" : entier(c.sat.capaciteAnnuelle)}</td>
                    <td style={{ ...droite, fontWeight: 700 }}>{pct(c.sat.saturation)}</td>
                    <td style={centre}>{c.sat.palier ? <span style={{ padding: "1px 10px", borderRadius: 999, fontWeight: 700, background: COULEUR_PALIER[c.sat.palier] }}>{c.sat.palier}</span> : "—"}</td>
                    {g.capas.some((x) => x.sat.mensuel) && MOIS_COURTS.map((m, i) => {
                      const sm = c.sat.mensuel?.[i];
                      return <td key={m} style={{ ...centre, fontSize: 11, background: sm?.palier ? COULEUR_PALIER[sm.palier] : undefined }}>{sm?.saturation != null ? pct(sm.saturation) : ""}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Saturation = volume ÷ (capacité par jour × {g.hyp.joursOuvres} jours ouvrés). Palier 1 sous {pct(g.hyp.seuil1)}, 2 jusqu&apos;à {pct(g.hyp.seuil2)}, 3 jusqu&apos;à {pct(g.hyp.seuil3)}, 4 au-delà.
              Le besoin en postes suit le palier de l&apos;<strong>année</strong> ; les mois montrent où la charge s&apos;écarte de ce palier.
            </p>
          </div>
        )}

        {/* Bilan */}
        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Bilan par service et catégorie</h3>
          {postes.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Aucun poste dans la sélection.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Catégorie</th>
                  <th style={droite}>Besoin théorique</th>
                  <th style={droite}>Besoin réel</th>
                  <th style={droite}>Départs</th>
                  <th style={droite}>Besoin total</th>
                  <th style={droite}>Disponibilité</th>
                  <th style={droite}>Dont en cours de formation</th>
                  <th style={droite}>Couverture</th>
                  <th style={droite}>Postes en déficit</th>
                  <th style={droite}>À former</th>
                  <th style={droite}>À recruter</th>
                </tr>
              </thead>
              <tbody>
                {parService.map((s) => (
                  <ServiceBloc key={s.atelierId} nom={s.atelierNom} total={s.cumul} lignes={groupes.filter((x) => x.atelierId === s.atelierId).map((x) => ({ categorie: cat(x.categorie), cumul: x.cumul }))} />
                ))}
                {!atelier && <LigneCumul libelle="Site" sous="Total" c={total} gras />}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            <strong>Besoin réel</strong> = postes × 52 ÷ (52 − semaines d&apos;absence programmée et subie). <strong>Disponibilité</strong> = titulaires (poste fixe), hors intérim.
            {" "}<strong>Postes en déficit</strong> = manque arrondi à l&apos;entier supérieur sur chaque poste : un excédent ici ne compense pas un manque là, la couverture peut donc dépasser 100 % avec des postes en déficit.
            {" "}<strong>À former</strong> = part du déficit couverte par le vivier interne (personnes sans poste fixe qui tiennent le poste, chacune comptée une seule fois) ; <strong>à recruter</strong> = le reste.
          </p>
        </div>

        {/* Absentéisme retenu */}
        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Absences retenues dans le besoin réel</h3>
          <table>
            <thead>
              <tr><th>Service</th><th style={droite}>Effectif compté</th><th style={droite}>Programmé (sem.)</th><th style={droite}>Subi (sem.)</th><th>Origine du subi</th></tr>
            </thead>
            <tbody>
              {subi.map((s) => (
                <tr key={s.atelierId}>
                  <td>{s.nom}</td>
                  <td style={droite}>{s.effectif}</td>
                  <td style={droite}>{n1(semProgramme)}</td>
                  <td style={{ ...droite, fontWeight: 600 }}>{n1(s.retenu)}</td>
                  <td className="muted">{s.force !== null ? `Valeur forcée (calcul : ${n1(s.auto)})` : "Calculé sur les absences non planifiées des 12 derniers mois"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recrutements */}
        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Recrutements par poste ({recrutements.reduce((s, p) => s + p.aRecruter, 0)})</h3>
          {recrutements.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Aucun recrutement : chaque déficit est couvert par le vivier interne.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Service</th><th>Ligne</th><th>Poste</th><th>Catégorie</th><th style={droite}>Besoin total</th><th style={droite}>Disponibilité</th><th style={droite}>Postes en déficit</th><th style={droite}>À former</th><th style={droite}>À recruter</th></tr>
              </thead>
              <tbody>
                {recrutements.map((p) => (
                  <tr key={p.id}>
                    <td className="muted">{p.atelierNom}</td>
                    <td className="muted">{p.ligne}</td>
                    <td style={{ fontWeight: 600 }}>{p.nom}</td>
                    <td className="muted">{cat(p.categorie)}</td>
                    <td style={droite}>{n1(p.besoinTotal)}</td>
                    <td style={droite}>{p.disponibilite}</td>
                    <td style={droite}>{p.deficit}</td>
                    <td style={droite}>{p.aFormer || "—"}</td>
                    <td style={{ ...droite, fontWeight: 700, color: "#b91c1c" }}>{p.aRecruter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Formations */}
        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Personnes à former ({formations.length})</h3>
          {formations.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Personne à former dans la sélection.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Personne</th><th>Service du poste</th><th>Ligne</th><th>Poste</th><th style={centre}>Niveau actuel</th><th style={centre}>Niveau requis</th><th>Action</th></tr>
              </thead>
              <tbody>
                {[...aTitulariser, ...aProgresser].map((f, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{f.personne}</td>
                    <td className="muted">{f.service}</td>
                    <td className="muted">{f.ligne}</td>
                    <td>{f.poste}</td>
                    <td style={centre}>{f.niveau}</td>
                    <td style={centre}>{f.requis}</td>
                    <td>{f.type === "titulariser" ? <span className="rbadge ok">Vivier interne : à faire passer titulaire</span> : <span className="rbadge warn">Titulaire : à amener au niveau requis</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            {aTitulariser.length} personne{aTitulariser.length > 1 ? "s" : ""} du vivier interne à faire passer titulaire sur un poste en déficit · {aProgresser.length} titulaire{aProgresser.length > 1 ? "s" : ""} sous le niveau requis de {aProgresser.length > 1 ? "leur" : "son"} poste (déjà compté{aProgresser.length > 1 ? "s" : ""} dans la disponibilité).
          </p>
        </div>

        {/* Départs */}
        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Départs prévus jusqu&apos;à fin {annee} ({departs.length})</h3>
          {departs.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Aucun départ prévu.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Personne</th><th>Service</th><th>Poste titulaire</th><th style={centre}>Date prévue</th><th>Motif</th><th>Commentaire</th><th>Origine</th></tr>
              </thead>
              <tbody>
                {departs.map((d, i) => (
                  <tr key={d.id ?? `c${i}`}>
                    <td style={{ fontWeight: 600 }}>{d.nom}</td>
                    <td className="muted">{d.service}</td>
                    <td>{d.poste}</td>
                    <td style={centre}>{fmtDate(d.date)}</td>
                    <td>{d.motif}</td>
                    <td className="muted">{d.commentaire || "—"}</td>
                    <td className="muted">{d.source === "contrat" ? "Fin de contrat (Personnel)" : "Saisi dans les hypothèses"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Seul le départ d&apos;un titulaire s&apos;ajoute au besoin de son poste. Une personne sur le départ sort aussi du vivier interne.</p>
        </div>

        {/* Détail */}
        <div className="card print-flow" style={{ overflowX: "auto", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Détail par poste ({postes.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Service</th><th>Ligne</th><th>Poste</th><th>Catégorie</th><th style={centre}>Palier</th>
                <th style={droite}>Besoin théorique</th><th style={droite}>Besoin réel</th><th style={droite}>Départs</th><th style={droite}>Besoin total</th>
                <th style={droite}>Disponibilité</th><th style={droite}>Déficit</th><th style={droite}>À former</th><th style={droite}>À recruter</th>
                <th style={droite}>Référents</th><th style={droite} title="Non-titulaires dont la cible de la Matrice vise ce poste">Cible posée</th>
              </tr>
            </thead>
            <tbody>{postes.map(ligneDetail)}</tbody>
          </table>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            <strong>Référents</strong> = titulaires au niveau maximum de la Matrice. <strong>Cible posée</strong> = personnes non titulaires du poste dont la cible de la Matrice atteint le niveau requis sans que l&apos;actuel y soit : formations déjà engagées.
            {" "}Les habilitations exigées par un poste ne sont pas vérifiées ici.
          </p>
        </div>
      </div>
    </>
  );
}

function ServiceBloc({ nom, total, lignes }: { nom: string; total: Cumul; lignes: { categorie: string; cumul: Cumul }[] }) {
  return (
    <>
      {lignes.map((l) => <LigneCumul key={l.categorie} libelle={nom} sous={l.categorie} c={l.cumul} />)}
      <LigneCumul libelle={nom} sous="Total" c={total} gras />
    </>
  );
}
