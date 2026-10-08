// Visites médicales — lecture des données et assemblage des lignes de l'écran.
//
// Tout le calcul vit dans `src/lib/visites.ts` (pur, testé). Ce module ne fait
// que lire la base et nourrir `evaluerPersonne`. Il est appelé par la page
// `/visites` avec le client RLS de l'utilisateur.
//
// PERF : deux vagues de lectures parallèles. La première charge les référentiels
// et le dossier des personnes ; la seconde n'existe que parce qu'elle dépend de
// la première (placements sur les postes à risque, absences sur les motifs
// cochés). `fetchAll` partout où la lecture peut dépasser 1000 lignes
// (personne_competence, placement).

import type { getServerClient } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/fetch-all";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { grouperAbsences } from "@/lib/absences-periodes";
import {
  evaluerPersonne,
  lireParametres,
  repriseDepuisPeriodes,
  REGIMES_DEFAUT,
  type Contexte,
  type Evaluation,
  type Parametres,
  type Regime,
  type RegimeCode,
  type VisiteLue,
  type CategorieVisite,
  estRegime,
} from "@/lib/visites";

type SupabaseClient = Awaited<ReturnType<typeof getServerClient>>;

export type TypeVisite = { id: string; code: string; libelle: string; categorie: CategorieVisite; actif: boolean; ordre: number };
export type UsageAnci = { id: string; code: string; libelle: string; actif: boolean; ordre: number };

export type VisiteRow = {
  id: string;
  personne_id: string;
  type_id: string;
  date_rdv: string | null;
  date_visite: string | null;
  avis: string | null;
  prochaine_date: string | null;
  professionnel: string | null;
  prochain_professionnel: string | null;
  commentaire: string | null;
  anci: string[];
};

export type ContrainteRow = {
  id: string;
  personne_id: string;
  quart_code: string | null;
  poste_id: string | null;
  date_debut: string;
  date_fin: string | null;
};

export type LigneVisite = Evaluation & {
  id: string;
  nom: string;
  prenom: string;
  matricule: string | null;
  equipe_id: string | null;
  equipe: string;
  atelier_id: string | null;
  atelier: string;
  arrivee: string | null;
  suiviAdapte: boolean;
  regimeForce: RegimeCode | null;
  visites: VisiteRow[];
  contraintes: ContrainteRow[];
  ancisRequis: string[];
  /** Qui la personne doit voir à la prochaine visite (code de `PROFESSIONNELS`). */
  prochainPro: string | null;
};

export type DonneesEcran = {
  lignes: LigneVisite[];
  types: TypeVisite[];
  usages: UsageAnci[];
  regimes: Regime[];
  params: Parametres;
  aujourdhui: string;
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Charge tout ce dont l'écran Suivi a besoin, pour un site.
 *
 * `typesAgence` : codes de type de contrat pilotés par une agence. Les
 * intérimaires en sont exclus — leur suivi médical relève de l'entreprise de
 * travail temporaire (R4625-8), pas de l'usine.
 */
export async function chargerVisites(
  supabase: SupabaseClient,
  siteId: string,
  typesAgence: string[],
): Promise<DonneesEcran> {
  const aujourdhui = iso(new Date());

  const [
    paramsRes,
    regimesRes,
    typesRes,
    usagesRes,
    quartsRes,
    equipesRes,
    ateliersRes,
    personnesRes,
    postesRes,
    compsRes,
    motifsRes,
    suivisRes,
    contraintesRes,
    contratsRows,
    pcRows,
    visitesRows,
    anciRows,
  ] = await Promise.all([
    supabase.from("visite_parametre").select("cle, valeur").eq("site_id", siteId).returns<{ cle: string; valeur: string }[]>(),
    supabase
      .from("visite_regime")
      .select("code, libelle, mois_renouvellement, mois_intermediaire, ordre")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<{ code: string; libelle: string; mois_renouvellement: number; mois_intermediaire: number | null; ordre: number }[]>(),
    supabase
      .from("visite_type")
      .select("id, code, libelle, categorie, actif, ordre")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<TypeVisite[]>(),
    supabase
      .from("visite_anci_usage")
      .select("id, code, libelle, actif, ordre")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<UsageAnci[]>(),
    supabase.from("quart").select("code, libelle, nuit, rotation").eq("site_id", siteId).returns<{ code: string; libelle: string; nuit: boolean; rotation: boolean }[]>(),
    supabase.from("equipe").select("id, nom, quart_fixe").eq("site_id", siteId).returns<{ id: string; nom: string; quart_fixe: string | null }[]>(),
    supabase.from("atelier").select("id, nom").eq("site_id", siteId).returns<{ id: string; nom: string }[]>(),
    supabase
      .from("personne")
      .select("id, nom, prenom, matricule, equipe_id, atelier_id, poste_fixe_id, statut, type_contrat")
      .eq("site_id", siteId)
      .neq("statut", "PARTI")
      .order("nom")
      .returns<PersonneRow[]>(),
    supabase
      .from("poste")
      .select("id, nom, suivi_renforce, anci_usage")
      .eq("site_id", siteId)
      .returns<{ id: string; nom: string; suivi_renforce: boolean; anci_usage: string | null }[]>(),
    supabase
      .from("competence")
      .select("id, nom, duree_validite_mois, suivi_renforce, anci_usage")
      .eq("site_id", siteId)
      .returns<{ id: string; nom: string; duree_validite_mois: number | null; suivi_renforce: boolean; anci_usage: string | null }[]>(),
    supabase.from("motif_absence").select("id, libelle, visite_reprise").eq("site_id", siteId).returns<{ id: string; libelle: string; visite_reprise: boolean }[]>(),
    supabase.from("personne_suivi").select("personne_id, suivi_adapte, regime_force").eq("site_id", siteId).returns<{ personne_id: string; suivi_adapte: boolean; regime_force: string | null }[]>(),
    supabase
      .from("contrainte_affectation")
      .select("id, personne_id, quart_code, poste_id, date_debut, date_fin")
      .eq("site_id", siteId)
      .order("date_debut")
      .returns<ContrainteRow[]>(),
    fetchAll<{ personne_id: string; date_debut: string | null; date_fin: string | null }>(() =>
      supabase
        .from("contrat_periode")
        .select("personne_id, date_debut, date_fin")
        .eq("site_id", siteId)
        .order("personne_id")
        .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>(),
    ),
    fetchAll<{ personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null }>(() =>
      supabase
        .from("personne_competence")
        .select("personne_id, competence_id, date_obtention, date_expiration")
        .eq("site_id", siteId)
        .order("id")
        .returns<{ personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null }[]>(),
    ),
    fetchAll<VisiteBrute>(() =>
      supabase
        .from("visite")
        .select("id, personne_id, type_id, date_rdv, date_visite, avis, prochaine_date, professionnel, prochain_professionnel, commentaire")
        .eq("site_id", siteId)
        .order("id")
        .returns<VisiteBrute[]>(),
    ),
    fetchAll<{ visite_id: string; usage_code: string }>(() =>
      supabase
        .from("visite_anci")
        .select("visite_id, usage_code")
        .eq("site_id", siteId)
        .order("visite_id")
        .returns<{ visite_id: string; usage_code: string }[]>(),
    ),
  ]);

  const params = lireParametres(paramsRes.data);
  const regimes: Regime[] = REGIMES_DEFAUT.map((def) => {
    const r = (regimesRes.data ?? []).find((x) => x.code === def.code);
    return r
      ? { code: def.code, libelle: r.libelle, mois: r.mois_renouvellement, moisInter: r.mois_intermediaire }
      : def;
  });
  const types = typesRes.data ?? [];
  const usages = usagesRes.data ?? [];
  const quarts = quartsRes.data ?? [];
  const equipes = equipesRes.data ?? [];
  const ateliers = ateliersRes.data ?? [];
  const postes = postesRes.data ?? [];
  const comps = compsRes.data ?? [];

  // Intérim exclu : suivi assuré par l'agence (R4625-8).
  const agence = new Set(typesAgence.map((c) => c.toUpperCase()));
  const personnes = (personnesRes.data ?? []).filter((p) => !agence.has(String(p.type_contrat ?? "").toUpperCase()));

  // --- Travail de nuit ------------------------------------------------------
  // Une équipe à quart fixe suit CE quart ; une équipe tournante passe par tous
  // les quarts du cycle, donc de nuit dès qu'un quart tournant est de nuit.
  const quartsNuit = new Set(quarts.filter((q) => q.nuit).map((q) => q.code));
  const rotationDeNuit = quarts.some((q) => q.nuit && q.rotation);
  const equipeById = new Map(equipes.map((e) => [e.id, e]));
  const equipeDeNuit = (equipeId: string | null): boolean => {
    if (!equipeId) return false;
    const e = equipeById.get(equipeId);
    if (!e) return false;
    return e.quart_fixe ? quartsNuit.has(e.quart_fixe) : rotationDeNuit;
  };

  // --- Postes et habilitations à risque ------------------------------------
  const posteById = new Map(postes.map((p) => [p.id, p]));
  const postesSIR = new Set(postes.filter((p) => p.suivi_renforce).map((p) => p.id));
  const compById = new Map(comps.map((c) => [c.id, c]));

  // --- Deuxième vague : ce qui dépend des référentiels ci-dessus ------------
  const motifsReprise = new Map(
    (motifsRes.data ?? []).filter((m) => m.visite_reprise).map((m) => [m.id, m.libelle] as const),
  );
  const depuisPlacement = iso(new Date(Date.now() - params.posteSemaines * 7 * 86_400_000));
  // 18 mois d'absences : de quoi retrouver un arrêt long dont le retour n'a pas
  // encore été régularisé, sans balayer tout l'historique.
  const depuisAbsence = iso(new Date(Date.now() - 550 * 86_400_000));

  const [placementsSIR, joursAbsence] = await Promise.all([
    postesSIR.size
      ? fetchAll<{ personne_id: string; poste_id: string }>(() =>
          supabase
            .from("placement")
            .select("personne_id, poste_id")
            .eq("site_id", siteId)
            .gte("jour", depuisPlacement)
            .in("poste_id", [...postesSIR])
            .order("id")
            .returns<{ personne_id: string; poste_id: string }[]>(),
        )
      : Promise.resolve([]),
    motifsReprise.size
      ? fetchAll<{ personne_id: string; jour: string; motif_absence_id: string | null }>(() =>
          supabase
            .from("placement")
            .select("personne_id, jour, motif_absence_id")
            .eq("site_id", siteId)
            .gte("jour", depuisAbsence)
            .in("motif_absence_id", [...motifsReprise.keys()])
            .order("id")
            .returns<{ personne_id: string; jour: string; motif_absence_id: string | null }[]>(),
        )
      : Promise.resolve([]),
  ]);

  // Placements sur poste à risque, comptés par (personne, poste).
  const compteurPoste = new Map<string, number>();
  for (const p of placementsSIR) {
    const k = `${p.personne_id}:${p.poste_id}`;
    compteurPoste.set(k, (compteurPoste.get(k) ?? 0) + 1);
  }

  // Index par personne.
  const parPersonne = <T extends { personne_id: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const l = m.get(r.personne_id);
      if (l) l.push(r);
      else m.set(r.personne_id, [r]);
    }
    return m;
  };
  const contratsPar = parPersonne(contratsRows);
  const pcPar = parPersonne(pcRows);
  const visitesPar = parPersonne(visitesRows);
  const suiviPar = new Map((suivisRes.data ?? []).map((s) => [s.personne_id, s]));
  const contraintesPar = parPersonne(contraintesRes.data ?? []);
  const absencesPar = parPersonne(joursAbsence);
  const anciPar = new Map<string, string[]>();
  for (const a of anciRows) {
    const l = anciPar.get(a.visite_id);
    if (l) l.push(a.usage_code);
    else anciPar.set(a.visite_id, [a.usage_code]);
  }

  const typeById = new Map(types.map((t) => [t.id, t]));
  const ctx: Contexte = { aujourdhui, regimes, params };

  const lignes: LigneVisite[] = personnes.map((p) => {
    const contrats = contratsPar.get(p.id) ?? [];
    const arrivee = contrats.reduce<string | null>(
      (min, c) => (c.date_debut && (!min || c.date_debut < min) ? c.date_debut : min),
      null,
    );

    // Habilitations détenues et encore valables.
    const habs = (pcPar.get(p.id) ?? []).filter((h) => {
      const c = compById.get(h.competence_id);
      if (!c) return false;
      const exp = h.date_expiration ?? addMonthsIso(h.date_obtention, c.duree_validite_mois);
      return habValable({ expiration: exp });
    });
    const habsSIR: string[] = [];
    let renforceDepuis: string | null = null;
    const ancisRequis = new Set<string>();
    for (const h of habs) {
      const c = compById.get(h.competence_id)!;
      if (c.suivi_renforce) {
        habsSIR.push(c.nom);
        if (h.date_obtention && (!renforceDepuis || h.date_obtention < renforceDepuis)) renforceDepuis = h.date_obtention;
      }
      if (c.anci_usage) ancisRequis.add(c.anci_usage);
    }

    // Postes à risque tenus : titulaire (poste fixe) ou placé assez souvent.
    const postesSIRTenus: string[] = [];
    for (const posteId of postesSIR) {
      const tenu =
        p.poste_fixe_id === posteId || (compteurPoste.get(`${p.id}:${posteId}`) ?? 0) >= params.postePlacements;
      if (!tenu) continue;
      const poste = posteById.get(posteId);
      postesSIRTenus.push(poste?.nom ?? "poste à risque");
      if (poste?.anci_usage) ancisRequis.add(poste.anci_usage);
    }
    // Le poste fixe peut exiger une attestation sans être à suivi renforcé.
    const posteFixe = p.poste_fixe_id ? posteById.get(p.poste_fixe_id) : undefined;
    if (posteFixe?.anci_usage) ancisRequis.add(posteFixe.anci_usage);

    const visites: VisiteRow[] = (visitesPar.get(p.id) ?? []).map((v) => ({
      ...v,
      anci: anciPar.get(v.id) ?? [],
    }));
    const visitesLues: VisiteLue[] = visites.map((v) => {
      const t = typeById.get(v.type_id);
      return {
        date_visite: v.date_visite,
        date_rdv: v.date_rdv,
        prochaine_date: v.prochaine_date,
        categorie: t?.categorie ?? "ponctuelle",
        libelle: t?.libelle ?? "Visite",
        anci: v.anci,
      };
    });

    // Qui voir la prochaine fois : le rendez-vous en attente le dit s'il est
    // renseigné, sinon la dernière visite réalisée (« à revoir par… »).
    const rdvEnAttente = visites
      .filter((v) => !v.date_visite && v.date_rdv && v.professionnel)
      .sort((a, b) => (a.date_rdv ?? "").localeCompare(b.date_rdv ?? ""))[0];
    const derniereRealisee = visites
      .filter((v) => v.date_visite)
      .sort((a, b) => (b.date_visite ?? "").localeCompare(a.date_visite ?? ""))[0];
    const prochainPro = rdvEnAttente?.professionnel ?? derniereRealisee?.prochain_professionnel ?? null;

    const periodes = grouperAbsences(
      (absencesPar.get(p.id) ?? []).map((a) => ({ jour: a.jour, motif_absence_id: a.motif_absence_id })),
    );
    const reprise = repriseDepuisPeriodes(periodes, motifsReprise, params.repriseJours);

    const suivi = suiviPar.get(p.id);
    const regimeForce = estRegime(suivi?.regime_force) ? suivi.regime_force : null;

    const evaluation = evaluerPersonne(
      {
        nuit: equipeDeNuit(p.equipe_id),
        postesSIR: postesSIRTenus,
        habsSIR,
        suiviAdapte: suivi?.suivi_adapte ?? false,
        force: regimeForce,
        renforceDepuis,
        arrivee,
        visites: visitesLues,
        ancisRequis: [...ancisRequis],
        reprise,
      },
      ctx,
    );

    return {
      ...evaluation,
      id: p.id,
      nom: p.nom,
      prenom: p.prenom,
      matricule: p.matricule,
      equipe_id: p.equipe_id,
      equipe: equipeById.get(p.equipe_id ?? "")?.nom ?? "—",
      atelier_id: p.atelier_id,
      atelier: ateliers.find((a) => a.id === p.atelier_id)?.nom ?? "—",
      arrivee,
      suiviAdapte: suivi?.suivi_adapte ?? false,
      regimeForce,
      visites,
      contraintes: contraintesPar.get(p.id) ?? [],
      ancisRequis: [...ancisRequis],
      prochainPro,
    };
  });

  // À venir en tête des retards : l'urgence d'abord, puis l'ordre alphabétique.
  const rang: Record<string, number> = { retard: 0, reprise: 1, planifier: 2, rdv: 3, ok: 4 };
  lignes.sort(
    (a, b) =>
      rang[a.statut] - rang[b.statut] ||
      (a.prochaine?.due ?? "9999").localeCompare(b.prochaine?.due ?? "9999") ||
      a.nom.localeCompare(b.nom),
  );

  return { lignes, types, usages, regimes, params, aujourdhui };
}

type PersonneRow = {
  id: string;
  nom: string;
  prenom: string;
  matricule: string | null;
  equipe_id: string | null;
  atelier_id: string | null;
  poste_fixe_id: string | null;
  statut: string;
  type_contrat: string | null;
};

type VisiteBrute = {
  id: string;
  personne_id: string;
  type_id: string;
  date_rdv: string | null;
  date_visite: string | null;
  avis: string | null;
  prochaine_date: string | null;
  professionnel: string | null;
  prochain_professionnel: string | null;
  commentaire: string | null;
};
