import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import PersonnelEditor from "./PersonnelEditor";
import { getRotationRefsC, getTypesAgenceC } from "@/lib/refdata";

type Equipe = { id: string; nom: string; couleur: string | null; quart_fixe: string | null };
type Quart = { code: string; libelle: string; creneau: string | null };
type Atelier = { id: string; nom: string };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };
type Row = {
  id: string;
  matricule: string | null;
  nom: string;
  prenom: string;
  equipe_id: string | null;
  atelier_id: string | null;
  regroupement: string | null;
  sexe: string | null;
  numero_badge: string | null;
  date_livret_accueil: string | null;
  type_contrat: string;
  // Reflet dénormalisé du contrat courant (maintenu par syncPersonneFromPeriodes).
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  // Dates DERIVEES des contrats (migration 0050) : plus stockees sur personne.
  // Calculees serveur, injectees dans le row pour que le client conserve les
  // memes helpers (statutALaDate, alerte18, etc.). Le motif de depart est
  // celui du contrat le plus recent.
  date_arrivee: string | null;
  date_depart_prevu: string | null;
  motif_depart: string | null;
  contrat_debut: string | null; // idem date_arrivee, garde pour compat
  hasContrat: boolean; // true si au moins un contrat_periode existe
  // Contrat courant piloté par agence mais sans agence renseignée (fiche
  // incomplète) — dérivé serveur du drapeau avec_agence (0072).
  agenceManquante: boolean;
  pointure: string | null;
  commentaire: string | null;
  statut: string;
  temps_partiel: boolean;
  tp_type: string | null;
  tp_config: TpConfig | null;
  poste_fixe_id: string | null;
};
type HMap = Record<string, { debut: string; fin: string }>;
type TpConfig = { demi?: { mode: string; source: string; matin?: HMap; aprem?: HMap }; off?: Record<string, string[]>; horaires?: HMap };

const COLS_PERSONNE =
  "id, matricule, nom, prenom, equipe_id, atelier_id, regroupement, sexe, numero_badge, date_livret_accueil, " +
  "type_contrat, agence_interim, date_debut, date_fin, pointure, commentaire, statut, temps_partiel, tp_type, tp_config, poste_fixe_id";

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const sp = await searchParams;
  const { profile, perms } = await requireModule("personnel", "read");
  const canEdit = canWrite(perms, "personnel");
  // RGPD (export / anonymiser / supprimer) : droit dédié, distinct de l'édition
  // du personnel. Sans lui, la roue crantée n'apparaît pas — cf. les gardes des
  // trois actions (actions.ts, api/personnel/[id]/export).
  const canRgpd = canWrite(perms, "rgpd");
  // Déclaration d'absence : droit dédié « absences » (migration UI 2026-09), pas
  // `personnel`. Sans ça, le bouton d'absence de l'écran Personnel écrivait via
  // /api/absence gardé par un AUTRE module — un titulaire Personnel sans le droit
  // Absences obtenait « Échec » au save (couplage Personnel → Planning).
  const canEditAbsence = canWrite(perms, "absences");

  const supabase = await getServerClient();
  // Tout en parallele (une seule vague). Les colonnes etendues (atelier_id, sexe,
  // badge, livret, temps partiel) sont desormais toujours presentes (0020-0025).
  // `quart_fixe` + rotation + quarts : servent l'apercu de quinzaine de la modale
  // temps partiel (l'alternance « une semaine sur deux » vient de la rotation de
  // l'equipe, pas du temps partiel lui-meme).
  type BaseRow = Omit<Row, "contrat_debut" | "date_arrivee" | "date_depart_prevu" | "motif_depart" | "agenceManquante">;
  type CpRow = { personne_id: string; date_debut: string | null; date_fin: string | null; motif_fin: string | null; created_at: string };
  const [
    { data: equipesData },
    { data: ateliersData },
    { data: rowsData },
    { data: lignesPostesData },
    { data: cpData },
    { data: quartsData },
    rotationRefs,
    { data: motifsData },
    typesR,
    { data: agencesData },
    agenceCodesArr,
  ] = await Promise.all([
    supabase.from("equipe").select("id, nom, couleur, quart_fixe").order("nom").returns<Equipe[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<Atelier[]>(),
    supabase.from("personne").select(COLS_PERSONNE).order("nom").returns<BaseRow[]>(),
    // Postes actifs (pour le sélecteur « Poste fixe »), avec leur atelier.
    // `atelier_id` + `regroupement` (0069) servent en plus à lister les
    // regroupements proposés par service dans la colonne « Service ».
    supabase.from("ligne").select("nom, atelier_id, regroupement, atelier:atelier_id(nom), poste(id, nom, actif)").eq("actif", true).returns<{ nom: string; atelier_id: string | null; regroupement: string | null; atelier: { nom: string } | null; poste: { id: string; nom: string; actif: boolean }[] }[]>(),
    // Toutes les periodes : sert a DERIVER date_arrivee (MIN date_debut),
    // date_depart_prevu (MAX date_fin si aucun contrat ouvert), motif_depart
    // (motif_fin du contrat le plus recent). Depuis 0050 ces trois valeurs
    // ne sont plus stockees sur personne.
    supabase.from("contrat_periode").select("personne_id, date_debut, date_fin, motif_fin, created_at").returns<CpRow[]>(),
    supabase.from("quart").select("code, libelle, creneau").order("ordre").returns<Quart[]>(),
    getRotationRefsC(),
    // Motifs d absence : alimentent la declaration depuis la modale Absences.
    supabase.from("motif_absence").select("id, code_court, libelle, couleur").eq("actif", true).order("libelle").returns<Motif[]>(),
    // Types de contrat parametrables (migration 0040). Best-effort : si la
    // table n'existe pas encore, on retombe sur les 3 codes historiques.
    supabase.from("type_contrat").select("code, libelle").eq("actif", true).order("ordre").returns<{ code: string; libelle: string }[]>(),
    // Agences d'intérim actives (0034) : menu du champ Agence de la création.
    supabase.from("agence_interim").select("nom").eq("actif", true).order("nom").returns<{ nom: string }[]>(),
    // Codes de contrat pilotés par agence (0072) : conditionnent le champ Agence
    // (création) et le surlignage jaune ; source de la fiche « Incomplète » agence.
    getTypesAgenceC(),
  ]);
  const agenceCodesSet = new Set(agenceCodesArr);
  const agences = (agencesData ?? []).map((a) => a.nom);
  const types = typesR.data && typesR.data.length > 0
    ? typesR.data
    : [{ code: "CDI", libelle: "CDI" }, { code: "CDD", libelle: "CDD" }, { code: "INTERIM", libelle: "Intérim" }];

  // Postes actifs pour le sélecteur « Poste fixe » (modale Informations).
  const postesOpts = (lignesPostesData ?? [])
    .flatMap((l) => (l.poste ?? []).filter((p) => p.actif).map((p) => ({ id: p.id, nom: p.nom, atelierNom: l.atelier?.nom ?? "—" })))
    .sort((a, b) => a.nom.localeCompare(b.nom));

  // Regroupements de lignes proposés par service (0069) : distinct, triés, pour
  // la colonne « Service » du Personnel. Une valeur tapée au Référentiel devient
  // ici un choix « Atelier — Regroupement ».
  const regroupementsParAtelier: Record<string, string[]> = {};
  for (const l of lignesPostesData ?? []) {
    const nom = (l.regroupement ?? "").trim();
    if (!nom || !l.atelier_id) continue;
    (regroupementsParAtelier[l.atelier_id] ??= []).push(nom);
  }
  for (const k of Object.keys(regroupementsParAtelier)) {
    regroupementsParAtelier[k] = Array.from(new Set(regroupementsParAtelier[k])).sort((a, b) => a.localeCompare(b));
  }

  // Agregation des contrats par personne, pour deriver arrivee / depart / motif.
  const periodesParPersonne = new Map<string, CpRow[]>();
  for (const r of cpData ?? []) {
    const arr = periodesParPersonne.get(r.personne_id) ?? [];
    arr.push(r);
    periodesParPersonne.set(r.personne_id, arr);
  }
  const deriverPersonne = (personneId: string, dateDebutReflet: string | null) => {
    const periodes = periodesParPersonne.get(personneId) ?? [];
    if (periodes.length === 0) {
      // Aucun contrat : filet, on retombe sur le reflet ou null.
      return { arrivee: dateDebutReflet, depart: null, motifDepart: null };
    }
    let arrivee: string | null = null;
    let maxFin: string | null = null;
    let auMoinsUnOuvert = false;
    for (const p of periodes) {
      if (!p.date_debut) continue;
      if (arrivee === null || p.date_debut < arrivee) arrivee = p.date_debut;
      if (p.date_fin === null) auMoinsUnOuvert = true;
      else if (maxFin === null || p.date_fin > maxFin) maxFin = p.date_fin;
    }
    // motif_depart = motif_fin du contrat le PLUS RECENT (date_debut desc,
    // created_at desc en cas d'egalite).
    const trie = [...periodes].sort((a, b) => {
      const da = a.date_debut ?? "";
      const db = b.date_debut ?? "";
      if (da !== db) return db.localeCompare(da);
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
    return {
      arrivee: arrivee ?? dateDebutReflet,
      depart: auMoinsUnOuvert ? null : maxFin,
      motifDepart: trie[0]?.motif_fin ?? null,
    };
  };

  const rows: Row[] = (rowsData ?? []).map((r) => {
    const d = deriverPersonne(r.id, r.date_debut ?? null);
    return {
      ...r,
      contrat_debut: d.arrivee,
      date_arrivee: d.arrivee,
      date_depart_prevu: d.depart,
      motif_depart: d.motifDepart,
      hasContrat: periodesParPersonne.has(r.id),
      // Fiche incomplète (agence) : le contrat COURANT est piloté par agence
      // (drapeau avec_agence, 0072) mais aucune agence n'est renseignée. On se
      // base sur le reflet dénormalisé (personne.type_contrat + agence_interim),
      // qui suit le contrat le plus récent (syncPersonneFromPeriodes).
      agenceManquante: agenceCodesSet.has(r.type_contrat) && !(r.agence_interim ?? "").trim(),
    };
  });

  return (
    <>
      <div className="pagecol">
        <AppHeader role={profile.role} active="/personnel" />
        <PersonnelEditor
          initial={rows}
          equipes={equipesData ?? []}
          ateliers={ateliersData ?? []}
          regroupementsParAtelier={regroupementsParAtelier}
          postes={postesOpts}
          canEdit={canEdit}
          canRgpd={canRgpd}
          canEditAbsence={canEditAbsence}
          erreur={sp.err}
          quarts={quartsData ?? []}
          rotationRefs={rotationRefs}
          motifs={motifsData ?? []}
          types={types}
          agences={agences}
          agenceCodes={agenceCodesArr}
        />
      </div>
    </>
  );
}
