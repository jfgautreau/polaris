import Link from "next/link";
import { cookies } from "next/headers";
import { getServerClient } from "@/lib/supabase-server";
import { COOKIE_QUART, valeurValide } from "@/lib/filtres-session";
import { fetchAll } from "@/lib/fetch-all";
import AppHeader from "@/components/AppHeader";
import PlanningNav from "@/components/PlanningNav";
import WeekNav from "@/components/WeekNav";
import {
  parseMonday,
  weekDays,
  isoDate,
  addDays,
  mondayOf,
  isoWeekNumber,
  dowMon,
} from "@/lib/week";
import { requireModule, canWrite } from "@/lib/permissions";
import PlanningFilters from "./PlanningFilters";
import AtelierFilter from "./AtelierFilter";
import QuartSelector from "./QuartSelector";
import ConducteurToggle from "./ConducteurToggle";
import { TvIcon } from "@/components/icons";
import QuartBandeau from "./QuartBandeau";
import PlanningGrid from "./PlanningGrid";
import PlanningParPoste from "./PlanningParPoste";
import VueBascule from "./VueBascule";
import { parseNumeros } from "@/lib/numeros-rotation";
import { getRotationRefsC, getTypesAgenceC } from "@/lib/refdata";
import { rotationForWeek } from "@/lib/rotation";
import { addMonthsIso } from "@/lib/habilitations";
import { quartParDefaut, quartOuDefaut, memeQuart } from "@/lib/quarts";
import { chargerPosteQuart, tourneSurQuart, effectifSurQuart } from "@/lib/poste-quart";
import { chargerValidites, actifLe } from "@/lib/referentiel-validite";
import { estAuTravailLe, deriverArriveeDepart } from "@/lib/personne-statut";
import { enAvance } from "@/lib/en-avance";

type PosteRow = {
  id: string;
  nom: string;
  nom_court: string | null;
  actif: boolean;
  effectif_requis: number;
  niveau_min_requis: number;
  categorie: string;
  ordre_affichage: number;
};
type LigneRow = { id: string; nom: string; ordre_affichage: number; atelier: { id: string; nom: string; ordre_affichage: number | null } | null; poste: PosteRow[] };
type Equipe = { id: string; nom: string; couleur: string; quart_fixe: string | null };
type Quart = { code: string; libelle: string; ordre: number; creneau: string | null; couleur?: string | null };
type Personne = {
  id: string;
  nom: string;
  prenom: string;
  equipe_id: string | null;
  type_contrat: string;
  poste_fixe_id: string | null;
};
type Placement = {
  personne_id: string;
  jour: string;
  poste_id: string | null;
  motif_absence_id: string | null;
  non_travaille: boolean;
  quart_code: string | null;
  numero_rotation: string | null;
};
type MatRow = { personne_id: string; poste_id: string; niveau_actuel: number };
type PcrRow = { poste_id: string; competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null };
type PcDetRow = { personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ equipe?: string; semaine?: string; quart?: string; atelier?: string; search?: string; cond?: string; vue?: string; par?: string }>;
}) {
  const { profile, perms } = await requireModule("planning", "read");
  // Droit "planning: write" (hors chef) : édition complète ; le chef garde son périmètre.
  const canEditPlanningFull = canWrite(perms, "planning") && profile.role !== "chef_equipe";

  const sp = await searchParams;
  const center = parseMonday(sp.semaine);
  const centerIso = isoDate(center);
  // Filtre equipe a 3 etats, portes par ?equipe :
  //   • absent  -> "auto" : equipes du quart cette semaine (rotation) + fixe sur ce quart.
  //   • "all"   -> aucune filtre (toutes les equipes).
  //   • <id>    -> une equipe precise.
  // Auto est la valeur par defaut a l'ouverture (on regarde le quart d'apres, pas
  // toutes les equipes). Les autres filtres (atelier, recherche) restent orthogonaux.
  const spEquipe = sp.equipe ?? "";
  const equipeMode: "auto" | "all" | "id" =
    spEquipe === "" ? "auto" : spEquipe === "all" ? "all" : "id";
  const equipeIdSel = equipeMode === "id" ? spEquipe : "";
  const atelier = sp.atelier ?? "";
  // Filtre Conducteurs (?cond=1) : personnes ayant AU MOINS UNE compétence
  // (niveau_actuel ≥ 1) sur AU MOINS UN poste `categorie = 'conducteur'` actif.
  // Même seuil que la pastille orange « sans compétence » de la Matrice. Combiné
  // aux autres filtres (intersection) ; la recherche par nom passe outre (comme
  // pour atelier/équipe).
  const filtreConducteurs = sp.cond === "1";
  // Vue « Par poste » (?par=poste, tasks/planning-par-poste.md) : une ligne par
  // place de poste au lieu d'une ligne par personne. Mêmes données, un seul quart
  // (pas de « Suivre l'équipe »), filtres Équipe et Conducteurs sans objet.
  const vuePoste = sp.par === "poste";

  // La semaine choisie (par défaut la semaine EN COURS) est affichée À GAUCHE,
  // suivie des deux semaines à venir (S, S+1, S+2) : on regarde ce qui vient,
  // pas la semaine passée. Naviguer (WeekNav / PlanningNav) déplace ce trio.
  const weekMondays = [center, addDays(center, 7), addDays(center, 14)];
  const todayMondayIso = isoDate(mondayOf());
  const rawDays = weekMondays.flatMap((wm, wi) =>
    weekDays(wm).map((d, di) => ({ ...d, firstOfWeek: di === 0, wi }))
  );
  const allIsos = rawDays.map((d) => d.iso);

  const supabase = await getServerClient();
  // Pas de raccourci « role === admin » : c'est la matrice qui accorde le droit.
  // Vague 1 : referentiel + personnes + perimetre chef, tout independant du calcul
  // d'ouverture qui suit. allActive sert aux indicateurs (tout le quart, toutes equipes).
  const [
    { data: equipesD },
    { data: lignesD },
    { data: motifsD },
    { data: quartsD, error: quartsErr },
    { data: allActiveD },
    { data: chefData },
    pq,
    ligneVal,
    posteVal,
    rotRefs,
    typesAgence,
    { data: tcD, error: tcErr },
  ] = await Promise.all([
    supabase.from("equipe").select("id, nom, couleur, quart_fixe").eq("actif", true).order("nom").returns<Equipe[]>(),
    supabase
      .from("ligne")
      .select("id, nom, ordre_affichage, atelier:atelier_id(id, nom, ordre_affichage), poste(id, nom, nom_court, actif, effectif_requis, niveau_min_requis, categorie, ordre_affichage)")
      .eq("actif", true)
      .order("nom")
      .returns<LigneRow[]>(),
    supabase
      .from("motif_absence")
      .select("id, code_court, libelle, couleur")
      .eq("actif", true)
      .order("libelle")
      .returns<Motif[]>(),
    // Migration 0068 : la colonne `couleur` peut ne pas encore exister — repli
    // silencieux plus bas (relecture sans `couleur`) pour ne pas planter la page.
    supabase.from("quart").select("code, libelle, ordre, creneau, couleur").order("ordre").returns<Quart[]>(),
    supabase.from("personne").select("id, nom, prenom, equipe_id, type_contrat, poste_fixe_id").in("statut", ["ACTIF", "A_VENIR"]).order("nom").returns<Personne[]>(),
    canEditPlanningFull
      ? Promise.resolve({ data: [] as { equipe_id: string }[] })
      : supabase.from("equipe_chef").select("equipe_id").eq("app_user_id", profile.authId).returns<{ equipe_id: string }[]>(),
    chargerPosteQuart(supabase),
    chargerValidites(supabase, "ligne"),
    chargerValidites(supabase, "poste"),
    // Perf P5 : trois lectures indépendantes, jusqu'ici attendues en série plus bas.
    getRotationRefsC(),
    getTypesAgenceC(),
    // Semaines dont les TP ont été « chargés » (migration 0064), cf. plus bas.
    supabase
      .from("tp_charge")
      .select("semaine_lundi")
      .in("semaine_lundi", weekMondays.map((wm) => isoDate(wm)))
      .returns<{ semaine_lundi: string }[]>(),
  ]);
  // Validité datée (0071) évaluée à AUJOURD'HUI : une ligne / un poste dont la
  // fermeture est atteinte (ou l'ouverture pas encore) disparaît des écrans.
  const todayIsoRef = isoDate(new Date());
  const ligneOuverteDate = (lid: string) => actifLe(ligneVal.get(lid), todayIsoRef);
  const posteOuvertDate = (pid: string) => actifLe(posteVal.get(pid), todayIsoRef);
  const motifs = motifsD ?? [];
  // Repli si migration 0068 (colonne `couleur`) non appliquée : on relit sans.
  let quarts: Quart[] = quartsD ?? [];
  if (quartsErr && (quartsErr.code === "42703" || quartsErr.code === "PGRST204")) {
    const { data: q2 } = await supabase.from("quart").select("code, libelle, ordre, creneau").order("ordre").returns<Omit<Quart, "couleur">[]>();
    quarts = (q2 ?? []).map((q) => ({ ...q, couleur: null }));
  }
  const quartCodes = quarts.map((q) => q.code);

  // Rotation calculee (reference datee) : { equipe -> quart }. `rotWeek` pour la
  // semaine centrale (auto-selection du quart) ; `rotByWeek` pour CHACUNE des 3
  // semaines affichees (sert au marquage TP « une semaine sur deux »).
  const rotWeek = rotationForWeek(rotRefs, centerIso);
  const rotByWeek = weekMondays.map((wm) => rotationForWeek(rotRefs, isoDate(wm)));

  // Quart selectionne : ?quart, sinon quart fixe de l'equipe choisie, sinon
  // rotation de la semaine pour cette equipe, sinon quart memorise pour la
  // session (cookie, cf. src/lib/filtres-session.ts), sinon quart par defaut.
  let quart = sp.quart && quartCodes.includes(sp.quart) ? sp.quart : "";
  if (!quart && equipeIdSel) {
    const eqRow = (equipesD ?? []).find((e) => e.id === equipeIdSel);
    if (eqRow?.quart_fixe && quartCodes.includes(eqRow.quart_fixe)) {
      quart = eqRow.quart_fixe;
    } else if (rotWeek[equipeIdSel] && quartCodes.includes(rotWeek[equipeIdSel])) {
      quart = rotWeek[equipeIdSel];
    }
  }
  if (!quart) quart = valeurValide((await cookies()).get(COOKIE_QUART)?.value, quartCodes);
  if (!quart) quart = quartParDefaut(quarts);

  // Vue « Suivre l'équipe » (?vue=equipe) : chaque semaine affichée prend le quart
  // de l'équipe choisie CETTE semaine-là (S matin, S+1 après-midi, S+2 matin…), pour
  // recopier une affectation d'une semaine sur l'autre sans changer de quart.
  // Exige UNE équipe tournante : en Auto / Toutes, ou pour une équipe à quart fixe,
  // on reste sur « Suivre le quart » (le même quart sur les 3 semaines). Semaine
  // sans rotation connue : repli sur le quart de la première semaine.
  const eqSel = equipeIdSel ? (equipesD ?? []).find((e) => e.id === equipeIdSel) : undefined;
  const suivreEquipePossible = !!eqSel && !eqSel.quart_fixe;
  const suivreEquipe = suivreEquipePossible && sp.vue === "equipe" && !vuePoste;
  const quartDeSemaine = (wi: number): string => {
    const q = suivreEquipe ? rotByWeek[wi]?.[equipeIdSel] : undefined;
    return q && quartCodes.includes(q) ? q : "";
  };
  if (suivreEquipe && quartDeSemaine(0)) quart = quartDeSemaine(0);
  const quartsSemaine = weekMondays.map((_, wi) => quartDeSemaine(wi) || quart);
  const quartsDistincts = [...new Set(quartsSemaine)];
  const wiDuJour = new Map(rawDays.map((d) => [d.iso, d.wi]));
  const quartDuJour = (iso: string) => quartsSemaine[wiDuJour.get(iso) ?? 0];

  // Ensemble des equipes AUTO pour le quart courant : celles que la rotation de la
  // semaine place sur ce quart + celles dont `quart_fixe` vaut ce quart. Union, pas
  // ecrasement : une equipe fixe matin ET une equipe tournante au matin cohabitent.
  const equipesAuto = new Set<string>();
  for (const [eid, qc] of Object.entries(rotWeek)) if (qc === quart) equipesAuto.add(eid);
  for (const e of equipesD ?? []) if (e.quart_fixe === quart) equipesAuto.add(e.id);

  // Ordre du referentiel : ateliers regroupes, lignes puis postes par ordre_affichage
  // (fallback alphabetique). Le meme ordre sert a la grille et au panneau d'affectation.
  const ordreThenNom = <T extends { ordre_affichage?: number; nom: string }>(a: T, b: T) =>
    (a.ordre_affichage ?? 0) - (b.ordre_affichage ?? 0) || a.nom.localeCompare(b.nom);
  const groupsAll = (lignesD ?? [])
    .filter((l) => ligneOuverteDate(l.id)) // fermeture datée atteinte -> ligne masquée
    .map((l) => ({
      ligneNom: l.nom,
      ligneId: l.id,
      ligneOrdre: l.ordre_affichage ?? 0,
      atelierId: l.atelier?.id ?? null,
      atelierNom: l.atelier?.nom ?? "",
      atelierOrdre: l.atelier?.ordre_affichage ?? 0,
      postes: [...(l.poste ?? [])].filter((p) => p.actif && posteOuvertDate(p.id)).sort(ordreThenNom),
    }))
    .filter((g) => g.postes.length > 0)
    .sort(
      (a, b) =>
        a.atelierOrdre - b.atelierOrdre ||
        a.atelierNom.localeCompare(b.atelierNom) ||
        a.ligneOrdre - b.ligneOrdre ||
        a.ligneNom.localeCompare(b.ligneNom)
    );

  // Ateliers presents (lignes actives ayant au moins un poste actif) -> segments de filtre.
  const ateliersMap = new Map<string, string>();
  for (const g of groupsAll) {
    const l = (lignesD ?? []).find((x) => x.id === g.ligneId);
    if (l?.atelier) ateliersMap.set(l.atelier.id, l.atelier.nom);
  }
  const ateliers = [...ateliersMap]
    .map(([id, nom]) => ({ id, label: nom }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Etiquettes de tous les postes (pour afficher proprement un placement hors atelier filtre).
  const posteLabelAll: Record<string, string> = {};
  // Nom complet, non tronque : sert aux infobulles (ex. « placee sur un autre quart »),
  // ou l'etiquette de 6 caracteres ne suffit pas a identifier le poste.
  const posteNomAll: Record<string, string> = {};
  for (const g of groupsAll)
    for (const p of g.postes) {
      posteLabelAll[p.id] = (p.nom_court || p.nom).slice(0, 6);
      posteNomAll[p.id] = p.nom;
    }

  // Filtre poste x quart : un poste qui ne tourne pas sur le quart affiché (« – »)
  // n'apparaît pas. Un poste « tourne à 0 » reste visible (besoin 0). Effectif par
  // quart, cf. src/lib/poste-quart.ts. Un jeu de lignes PAR QUART affiché (un seul
  // en « Suivre le quart », jusqu'à trois en « Suivre l'équipe »).
  const postesDuQuart = <G extends { postes: PosteRow[] }>(gs: G[], q: string) =>
    gs
      .map((g) => ({ ...g, postes: g.postes.filter((p) => tourneSurQuart(pq, p.id, q, p.effectif_requis)) }))
      .filter((g) => g.postes.length > 0);
  const groupsAtelier = atelier ? groupsAll.filter((g) => g.atelierId === atelier) : groupsAll;
  const groupsParQuart = new Map(quartsDistincts.map((q) => [q, postesDuQuart(groupsAtelier, q)]));
  const groupsDe = (q: string) => groupsParQuart.get(q) ?? [];

  // Besoin de ligne = somme des effectifs requis SUR LE QUART AFFICHÉ (et non plus
  // l'effectif unique du poste, qui ignorait le quart). Clé « quart:ligne ».
  const lineEffectif: Record<string, number> = {};
  for (const q of quartsDistincts)
    for (const g of groupsDe(q))
      lineEffectif[`${q}:${g.ligneId}`] = g.postes.reduce((s, p) => s + effectifSurQuart(pq, p.id, q, p.effectif_requis), 0);

  // Perf P5 (2026-09-28) — VAGUE 2. Ces lectures ne dépendent que de l'effectif
  // (vague 1), des postes affichés ou des 3 semaines : elles partent ICI, en même
  // temps que l'ouverture, et chaque bloc plus bas attend la sienne au lieu de les
  // enchaîner. Les blocs de traitement sont inchangés.
  const idsEffectif = (allActiveD ?? []).map((p) => p.id);
  // Habilitations exigées : lues pour TOUS les postes du site, pas seulement ceux
  // du service filtré. Une personne listée peut être placée sur un poste d'un autre
  // service : sans son exigence, sa case perdait le rouge selon le filtre (bug du
  // 2026-10-09, case rouge filtre service 1, neutre filtre service 2).
  const postesHabIds = [...new Set(groupsAll.flatMap((g) => g.postes.map((p) => p.id)))];
  type TpRow = { id: string; personne_id: string; date_debut: string; date_fin: string | null; tp_config: { off?: Record<string, string[]> } | null };
  const pPersAtelier = enAvance<{ data: { id: string; atelier_id: string | null }[] | null; error: { message: string } | null }>(
    atelier && idsEffectif.length
      ? supabase.from("personne").select("id, atelier_id").in("id", idsEffectif).returns<{ id: string; atelier_id: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; atelier_id: string | null }[], error: null })
  );
  const pConducteurs = enAvance(
    filtreConducteurs
      ? fetchAll<{ personne_id: string }>(() =>
          supabase
            .from("matrice")
            .select("personne_id, poste!inner(categorie, actif)")
            .eq("poste.categorie", "conducteur")
            .eq("poste.actif", true)
            .gte("niveau_actuel", 1)
            .order("id")
            .returns<{ personne_id: string }[]>()
        )
      : Promise.resolve([] as { personne_id: string }[])
  );
  // Périodes TP : bornées sur les 3 semaines complètes (sur-ensemble des jours
  // visibles ; `configPourJour` ne retient que la période couvrant chaque jour).
  const pTpPeriodes = enAvance(
    supabase
      .from("tp_periode")
      .select("id, personne_id, date_debut, date_fin, tp_config")
      .lte("date_debut", allIsos[allIsos.length - 1])
      .or(`date_fin.is.null,date_fin.gte.${allIsos[0]}`)
      .order("date_debut")
      .returns<TpRow[]>()
  );
  const pTpFallback = enAvance(
    supabase
      .from("personne")
      .select("id, tp_config")
      .eq("temps_partiel", true)
      .in("id", idsEffectif)
      .returns<{ id: string; tp_config: { off?: Record<string, string[]> } | null }[]>()
  );
  const pContrats = enAvance(
    fetchAll<{ personne_id: string; date_debut: string | null; date_fin: string | null }>(() =>
      supabase
        .from("contrat_periode")
        .select("personne_id, date_debut, date_fin")
        .in("personne_id", idsEffectif)
        .order("id")
        .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>()
    )
  );
  // Habilitations exigées par les postes du site, puis — dès qu'on les connaît —
  // celles que les gens détiennent (chaîné, sans attendre le reste de la page).
  // Pas de `.in(poste_id, …)` : des centaines d'UUID allongeraient l'URL ; la
  // table est petite et bornée au site par la RLS, on filtre ici.
  const postesHabSet = new Set(postesHabIds);
  const pPcr = enAvance<{ data: PcrRow[] | null; error: { message: string } | null }>(
    postesHabIds.length
      ? supabase
          .from("poste_competence_requise")
          .select("poste_id, competence_id, competence:competence_id(nom, duree_validite_mois)")
          .returns<PcrRow[]>()
          .then((r) => ({ data: (r.data ?? []).filter((x) => postesHabSet.has(x.poste_id)), error: r.error }))
      : Promise.resolve({ data: [] as PcrRow[], error: null })
  );
  const pHabDet = enAvance(
    pPcr.then(({ data }) => {
      const compIds = [...new Set((data ?? []).map((r) => r.competence_id))];
      if (!compIds.length || !idsEffectif.length) return [] as PcDetRow[];
      // personne_competence depasse 1000 lignes -> fetchAll obligatoire.
      return fetchAll<PcDetRow>(() =>
        supabase
          .from("personne_competence")
          .select("personne_id, competence_id, date_obtention, date_expiration")
          .in("competence_id", compIds)
          .in("personne_id", idsEffectif)
          .order("id")
          .returns<PcDetRow[]>()
      );
    })
  );

  // Vue Par poste : numéros de rotation et zone d'attente (0077) des postes. Lecture
  // à part, tolérante à l'absence de `zone_attente` (migration non passée) : la
  // mettre dans la requête imbriquée des lignes ferait échouer tout l'écran (L19).
  type PosteExtra = { id: string; numero_rotation: string | null; zone_attente?: boolean };
  const pPosteExtra = enAvance<PosteExtra[]>(
    vuePoste
      ? (async () => {
          const avec = await supabase.from("poste").select("id, numero_rotation, zone_attente").returns<PosteExtra[]>();
          if (!avec.error) return avec.data ?? [];
          const sans = await supabase.from("poste").select("id, numero_rotation").returns<PosteExtra[]>();
          return sans.data ?? [];
        })()
      : Promise.resolve([] as PosteExtra[])
  );

  // Ouverture par quart selectionne.
  // `ouverture_quart` passe par fetchAll : 3 semaines x 1 quart x N lignes, soit
  // ~420 lignes aujourd'hui mais 1000 des ~48 lignes de production (cf. L8 —
  // PostgREST tronque a 1000 SANS erreur, et le planning afficherait alors des
  // lignes fermees comme ouvertes). `jour_quart` reste direct : 21 lignes au plus.
  // En « Suivre l'équipe », on lit les quarts des 3 semaines et on ne retient,
  // pour chaque jour, que les lignes du quart de SA semaine.
  const [ouv, { data: jq }] = await Promise.all([
    fetchAll<{ jour: string; ligne_id: string; ouverte: boolean; quart_code: string }>(() =>
      supabase
        .from("ouverture_quart")
        .select("jour, ligne_id, ouverte, quart_code")
        .in("quart_code", quartsDistincts)
        .in("jour", allIsos)
        .order("jour").order("ligne_id").order("quart_code")
        .returns<{ jour: string; ligne_id: string; ouverte: boolean; quart_code: string }[]>()
    ),
    supabase
      .from("jour_quart")
      .select("jour, actif, quart_code")
      .in("quart_code", quartsDistincts)
      .in("jour", allIsos)
      .returns<{ jour: string; actif: boolean; quart_code: string }[]>(),
  ]);
  const ouvMap = new Map<string, boolean>();
  for (const r of ouv) if (r.quart_code === quartDuJour(r.jour)) ouvMap.set(`${r.jour}:${r.ligne_id}`, r.ouverte);
  const actMap = new Map<string, boolean>();
  for (const r of jq ?? []) if (r.quart_code === quartDuJour(r.jour)) actMap.set(r.jour, r.actif);

  const quartActif = (iso: string) => (actMap.has(iso) ? actMap.get(iso)! : false);
  const lineOpen = (iso: string, ligneId: string) =>
    quartActif(iso) ? (ouvMap.has(`${iso}:${ligneId}`) ? ouvMap.get(`${iso}:${ligneId}`)! : true) : false;

  // On affiche désormais TOUS les jours de semaine (lundi→vendredi), même quand
  // aucune ligne n'est ouverte : la colonne porte alors un message « Jour sans
  // production » plutôt que de disparaître — sans quoi une semaine non initialisée
  // donnait l'impression d'un bug d'affichage. Les week-ends restent masqués tant
  // qu'ils ne produisent pas (une éventuelle production le samedi reste visible).
  //
  // Depuis 2026-09-09 : « jour fermé » = `jour_quart.actif = false` UNIQUEMENT.
  // Une ligne fermée dans Ordonnancement (`ouverture_quart.ouverte = false`) NE
  // ferme plus la colonne et NE masque plus la ligne — elle ne fait que retirer son
  // besoin du bilan (elle vaut 0). Le rendu de la grille reste identique
  // (toutes les lignes visibles) ; l'écran de saisie garde la case active. La règle
  // « une semaine non initialisée = colonne avec message » n'est déclenchée que par
  // `jour_quart` (arrêt d'usine, semaine non initialisée), pas par les fermetures
  // de ligne granulaires — celles-ci pilotent le compteur, plus la visibilité.
  const visible = rawDays
    .map((d) => {
      const qa = quartActif(d.iso);
      const q = quartsSemaine[d.wi];
      const openIds = qa ? groupsDe(q).filter((g) => lineOpen(d.iso, g.ligneId)).map((g) => g.ligneId) : [];
      const besoin = openIds.reduce((s, lid) => s + (lineEffectif[`${q}:${lid}`] ?? 0), 0);
      // open (= not-closed) ne dépend plus que du quart : une colonne où toutes les
      // lignes sont fermées par l'ordo reste ouverte, avec besoin/catRequis à 0.
      return { ...d, open: qa, besoin, openIds };
    })
    .filter((d) => dowMon(d.iso) < 5 || d.open);

  const openByIso: Record<string, string[]> = {};
  for (const d of visible) openByIso[d.iso] = d.openIds;

  // Lignes proposées par le panneau d'affectation (bouton « Voir tous ») : TOUTES
  // les lignes de l'usine dès que le quart est actif ce jour-là. Depuis 2026-09-09,
  // une ligne fermée dans Ordonnancement reste plaçable — sa fermeture ne joue plus
  // que sur le compteur de besoin, pas sur ce qu'on peut choisir dans le panneau.
  const openAllByIso: Record<string, string[]> = {};
  for (const d of visible)
    openAllByIso[d.iso] = quartActif(d.iso) ? groupsAll.map((g) => g.ligneId) : [];

  const days = visible.map((d) => ({ iso: d.iso, nom: d.nom, num: d.num, firstOfWeek: d.firstOfWeek, closed: !d.open, wi: d.wi, quart: quartsSemaine[d.wi] }));
  const besoin = visible.map((d) => d.besoin);
  const visIsos = visible.map((d) => d.iso);

  // Perf P5 — VAGUE 3 : lectures bornées aux jours visibles, lancées ensemble.
  const avecCases = idsEffectif.length > 0 && visIsos.length > 0;
  const quartDefautSite = quartParDefaut(quarts);
  const pAutoPlaced = enAvance(
    equipeMode === "auto" && visIsos.length
      ? fetchAll<{ personne_id: string }>(() =>
          supabase
            .from("placement")
            .select("personne_id")
            .not("poste_id", "is", null)
            .in("jour", visIsos)
            .or(quart === quartDefautSite ? `quart_code.eq.${quart},quart_code.is.null` : `quart_code.eq.${quart}`)
            .order("id")
            .returns<{ personne_id: string }[]>()
        )
      : Promise.resolve([] as { personne_id: string }[])
  );
  const pCases = enAvance(
    Promise.all([
      avecCases
        ? fetchAll<Placement>(() =>
            supabase
              .from("placement")
              .select("personne_id, jour, poste_id, motif_absence_id, non_travaille, quart_code, numero_rotation")
              .in("jour", visIsos)
              .in("personne_id", idsEffectif)
              .order("id")
              .returns<Placement[]>()
          )
        : Promise.resolve([] as Placement[]),
      avecCases
        ? fetchAll<MatRow>(() =>
            supabase
              .from("matrice")
              .select("personne_id, poste_id, niveau_actuel")
              .in("personne_id", idsEffectif)
              .order("id")
              .returns<MatRow[]>()
          )
        : Promise.resolve([] as MatRow[]),
      avecCases
        ? supabase
            .from("horaire_exception")
            .select("personne_id, jour, debut, fin, motif")
            .in("jour", visIsos)
            .in("personne_id", idsEffectif)
            .returns<{ personne_id: string; jour: string; debut: string | null; fin: string | null; motif: string | null }[]>()
        : Promise.resolve({ data: [] as { personne_id: string; jour: string; debut: string | null; fin: string | null; motif: string | null }[], error: null }),
      avecCases
        ? supabase
            .from("horaire_poste")
            .select("poste_id, jour, debut, fin, quart_code")
            .in("quart_code", quartsDistincts)
            .returns<{ poste_id: string; jour: number; debut: string | null; fin: string | null; quart_code: string }[]>()
        : Promise.resolve({ data: [] as { poste_id: string; jour: number; debut: string | null; fin: string | null; quart_code: string }[], error: null }),
      // TP MATÉRIALISÉS (0064) — best-effort, cf. plus bas.
      avecCases
        ? supabase
            .from("placement")
            .select("personne_id, jour")
            .eq("tp", true)
            .in("jour", visIsos)
            .in("personne_id", idsEffectif)
            .returns<{ personne_id: string; jour: string }[]>()
        : Promise.resolve({ data: [] as { personne_id: string; jour: string }[], error: null }),
    ] as const)
  );

  // `quart` (libellé + couleur) : bande colorée au-dessus de chaque semaine. En
  // « Suivre l'équipe », chaque semaine a le sien ; en « Suivre le quart », c'est le
  // même sur les trois (demande du 2026-10-09 : le rappeler au-dessus des semaines).
  const weekBlocks: { num: number; span: number; year: number; isCurrent: boolean; monday: string; quart?: { libelle: string; couleur: string | null } }[] = [];
  for (let wi = 0; wi < 3; wi++) {
    const span = visible.filter((d) => d.wi === wi).length;
    const qw = quarts.find((x) => x.code === quartsSemaine[wi]);
    if (span > 0)
      weekBlocks.push({
        num: isoWeekNumber(weekMondays[wi]),
        year: weekMondays[wi].getFullYear(),
        span,
        isCurrent: isoDate(weekMondays[wi]) === todayMondayIso,
        monday: isoDate(weekMondays[wi]),
        ...(qw ? { quart: { libelle: qw.libelle, couleur: qw.couleur ?? null } } : {}),
      });
  }
  const seenWeek = new Set<number>();
  visible.forEach((d, idx) => {
    days[idx].firstOfWeek = !seenWeek.has(d.wi);
    seenWeek.add(d.wi);
  });

  // Personnes actives recuperees en vague 1. On n'affiche que l'equipe filtree
  // (lignes), mais les indicateurs Present/Delta/Alertes comptent TOUT le quart.
  const allActive = allActiveD ?? [];
  const allIds = allActive.map((p) => p.id);

  // Filtre souple par atelier : on n'affiche que les personnes affectees a l'atelier
  // choisi (best-effort : colonne atelier_id ajoutee en 0020 ; si absente -> map vide).
  // Non bloquant : une personne reste placable sur n'importe quel poste.
  const persAtelier = new Map<string, string | null>();
  if (atelier && allIds.length) {
    const { data: paData, error: paErr } = await pPersAtelier; // lancée en vague 2
    if (!paErr) for (const r of paData ?? []) persAtelier.set(r.id, r.atelier_id);
  }

  // Filtre Conducteurs : personnes ayant au moins une compétence (niveau_actuel ≥ 1)
  // sur au moins un poste `categorie = 'conducteur'` actif. Requête indépendante du
  // filtre atelier — c'est un critère orthogonal (« sait conduire », partout dans
  // l'usine). fetchAll : `matrice` dépasse 1000 lignes (L8).
  const conducteurIds = new Set<string>();
  if (filtreConducteurs) {
    const rows = await pConducteurs; // lancée en vague 2
    for (const r of rows) conducteurIds.add(r.personne_id);
  }

  // Mode AUTO : personnes EFFECTIVEMENT placees sur ce quart au moins un jour sur
  // la fenetre 3 semaines affichee. On les ajoute a l'ensemble AUTO habituel
  // (equipes du quart via rotation + fixe) : si tu affectes quelqu'un de l'equipe A
  // sur nuit, il apparait quand tu cliques sur nuit meme si A tourne au matin cette
  // semaine. `poste_id NOT NULL` : les absences/NT sont neutres (elles ne
  // rattachent pas a un quart). Match du `quart_code` = egal, plus repli sur NULL
  // si `quart` est le quart par defaut du site (memes regles que `memeQuart`).
  // fetchAll obligatoire (L8) : les placements sur 3 semaines depassent 1000.
  const autoPlacedIds = new Set<string>();
  if (equipeMode === "auto" && visIsos.length) {
    const rows = await pAutoPlaced; // lancée en vague 3
    for (const r of rows) autoPlacedIds.add(r.personne_id);
  }

  // Predicat d'appartenance au filtre courant (equipe + atelier). Sert a determiner
  // les lignes affichees PAR DEFAUT ; la recherche par nom (client) passe outre pour
  // toujours retrouver quelqu'un.
  const passeEquipe = (pid: string, eqid: string | null): boolean => {
    if (equipeMode === "all") return true;
    if (equipeMode === "id") return eqid === equipeIdSel;
    // auto : equipe theorique du quart OU personne effectivement placee sur ce quart.
    return (!!eqid && equipesAuto.has(eqid)) || autoPlacedIds.has(pid);
  };
  const displayed = allActive.filter(
    (p) =>
      passeEquipe(p.id, p.equipe_id) &&
      (!atelier || persAtelier.get(p.id) === atelier) &&
      (!filtreConducteurs || conducteurIds.has(p.id)),
  );
  const displayedSet = new Set(displayed.map((p) => p.id));

  // Une affectation sur poste n'apparait que pour le quart courant ; une absence/NT
  // vaut pour tous les quarts. Les placements historiques sans quart passent par le
  // repli commun (`memeQuart`) : cet ecran utilisait `quartCodes[0]` — « journee » —
  // la ou le Placement et la TV utilisaient « matin », si bien que les memes lignes
  // s'affichaient sous deux quarts differents selon l'ecran.
  const matchQuart = (qc: string | null, iso: string) => memeQuart(qc, quartDuJour(iso), quarts);

  const initial: Record<string, string> = {};
  const numeroParCase: Record<string, string> = {}; // vue Par poste : place (n° de rotation) occupée
  const otherByCell: Record<string, string> = {}; // place sur un autre quart -> code du quart
  const otherPosteByCell: Record<string, string> = {}; // ... et nom complet du poste occupe
  const matrice: Record<string, number> = {};
  const exceptions: Record<string, { debut: string; fin: string; motif: string }> = {};
  // Horaire standard par quart, poste et jour de semaine (0=lundi..6=dimanche), clé
  // « quart:poste:jour » : sert a afficher l'horaire par defaut dans l'infobulle de
  // la pendule.
  const horaireStd: Record<string, { debut: string; fin: string }> = {};
  if (allIds.length && visIsos.length) {
    // Lancées en vague 3 (placements, matrice, exceptions, horaires, TP réels).
    const [pl, mat, { data: exc }, { data: horStd }, { data: tpReal, error: tpRealErr }] = await pCases;
    for (const h of horStd ?? []) horaireStd[`${h.quart_code}:${h.poste_id}:${h.jour}`] = { debut: h.debut ?? "", fin: h.fin ?? "" };
    for (const r of pl) {
      const k = `${r.personne_id}:${r.jour}`;
      if (r.non_travaille) initial[k] = "X";
      else if (r.motif_absence_id) initial[k] = `m:${r.motif_absence_id}`;
      else if (r.poste_id && matchQuart(r.quart_code, r.jour)) {
        initial[k] = r.poste_id;
        if (r.numero_rotation) numeroParCase[k] = r.numero_rotation;
      }
      else if (r.poste_id) {
        // Toutes les personnes actives, pas seulement l'ensemble affiche par
        // defaut : une recherche par nom peut faire apparaitre quelqu'un hors
        // filtre, et l'infobulle « place sur un autre quart » doit s'afficher.
        otherByCell[k] = quartOuDefaut(r.quart_code, quarts);
        // Poste desactive depuis : absent de posteNomAll -> l'infobulle se limite au quart.
        if (posteNomAll[r.poste_id]) otherPosteByCell[k] = posteNomAll[r.poste_id];
      }
    }
    for (const r of mat) matrice[`${r.personne_id}:${r.poste_id}`] = r.niveau_actuel;
    for (const r of exc ?? [])
      exceptions[`${r.personne_id}:${r.jour}`] = { debut: r.debut ?? "", fin: r.fin ?? "", motif: r.motif ?? "" };

    // TP MATÉRIALISÉS (migration 0064) : vraies lignes `placement.tp`, déplaçables.
    // Best-effort — si la colonne n'existe pas encore, on retombe sur le calcul
    // virtuel plus bas. Le jeton "TP" est rendu comme le TP calculé (fond violet),
    // mais draggable et effaçable.
    if (!tpRealErr) for (const r of tpReal ?? []) initial[`${r.personne_id}:${r.jour}`] = "TP";
  }

  // Semaines dont les TP ont été « chargés » (migration 0064). Sur ces semaines,
  // seules les vraies lignes placement.tp (lues ci-dessus) s'affichent ; le calcul
  // virtuel ne s'applique qu'aux semaines NON chargées (« repli tant que non
  // chargé »), sans quoi un TP déplacé serait aussitôt recréé à sa place. Best-
  // effort : table absente -> aucune semaine chargée, comportement d'avant 0064.
  // (Lecture faite en vague 1.)
  const chargedWeeks = new Set<string>();
  if (!tcErr) for (const r of tcD ?? []) chargedWeeks.add(r.semaine_lundi);
  const weekChargedByWi = weekMondays.map((wm) => chargedWeeks.has(isoDate(wm)));

  // Temps partiel (best-effort, colonnes 0025). Calcul serveur.
  //
  // ⚠️ Règle métier (24/07/2026, précisée). « TP » s'écrit dans le planning :
  //   1. sur une JOURNÉE entière non travaillée (les deux demi-journées `off`) ;
  //   2. quand l'ÉQUIPE de la personne est, cette semaine, sur le créneau
  //      qu'elle NE travaille PAS. Ex. Sylvie (mi-temps après-midi, off le
  //      matin) en équipe B : la semaine où B tourne au MATIN, elle ne peut pas
  //      travailler → « TP » toute la semaine ; la semaine où B est l'après-midi,
  //      rien (elle travaille). D'où un « TP » automatique une semaine sur deux,
  //      porté par la rotation datée de l'équipe — pas par le temps partiel seul.
  // Le créneau d'un quart : matin→"matin", apres_midi→"aprem" (journée/nuit :
  // pas de demi-journée, la personne est présente → pas de TP de ce chef).
  const tpBlocked: Record<string, boolean> = {};
  if (allIds.length && visIsos.length) {
    // Périodes TP couvrant la plage visible (anticipation incluse).
    // Repli sur personne.tp_config si tp_periode est vide (migration pas encore jouée,
    // ou personne dont la période n'a pas encore été migrée).
    // Lancée en vague 2 (bornes : les 3 semaines complètes).
    const { data: tpPeriodes } = await pTpPeriodes;
    // Index par personne.
    const periodesByPers = new Map<string, TpRow[]>();
    for (const p of tpPeriodes ?? []) {
      (periodesByPers.get(p.personne_id) ?? periodesByPers.set(p.personne_id, []).get(p.personne_id)!).push(p);
    }
    // Repli : personnes avec temps_partiel=true mais sans ligne dans tp_periode
    // (cas de transition, avant que l'utilisateur ait ouvert la modale).
    const { data: tpFallback } = await pTpFallback; // lancée en vague 2
    const fallbackMap = new Map<string, { off?: Record<string, string[]> } | null>();
    for (const r of tpFallback ?? []) {
      if (!periodesByPers.has(r.id)) fallbackMap.set(r.id, r.tp_config);
    }

    const isoDow = (iso: string) => {
      const d = new Date(iso + "T00:00").getDay();
      return d === 0 ? 7 : d;
    };
    const equipeDe = new Map(allActive.map((p) => [p.id, p.equipe_id]));
    const quartFixe = new Map((equipesD ?? []).map((e) => [e.id, e.quart_fixe]));
    // Créneau (demi-journée) d'un quart, désormais explicite en base
    // (quart.creneau), plus codé en dur sur matin/apres_midi. Un quart sans
    // créneau (plein : journée, nuit) ne bloque aucun mi-temps de ce chef.
    const quartCreneau = new Map(quarts.map((q) => [q.code, q.creneau]));
    const creneauDe = (q?: string | null): "matin" | "aprem" | null => {
      const c = q ? quartCreneau.get(q) : null;
      return c === "matin" || c === "aprem" ? c : null;
    };

    // Trouver la config TP applicable pour une personne à un jour donné.
    const configPourJour = (persId: string, iso: string): { off?: Record<string, string[]> } | null => {
      const periodes = periodesByPers.get(persId);
      if (periodes) {
        for (const p of periodes) {
          if (p.date_debut <= iso && (!p.date_fin || p.date_fin >= iso)) {
            return p.tp_config;
          }
        }
        return null; // Jour dans un trou = temps plein.
      }
      // Repli : personne.tp_config (pas de période migrée).
      return fallbackMap.get(persId) ?? null;
    };

    // Calculer tpBlocked pour chaque personne × jour.
    const personIds = new Set([...periodesByPers.keys(), ...fallbackMap.keys()]);
    for (const persId of personIds) {
      const eq = equipeDe.get(persId) ?? null;
      for (const d of visible) {
        // Semaine chargée : les vraies lignes placement.tp font foi, on ne calcule pas.
        if (weekChargedByWi[d.wi]) continue;
        // Une vraie ligne de placement existe déjà pour cette case (poste, absence,
        // NT ou TP matérialisé) : le virtuel ne doit pas la recouvrir. Rend un TP
        // réel toujours cliquable/draggable même si le marqueur tp_charge a échoué.
        if (initial[`${persId}:${d.iso}`] !== undefined) continue;
        const cfg = configPourJour(persId, d.iso);
        if (!cfg) continue;
        const dayOff = cfg.off?.[String(isoDow(d.iso))] ?? [];
        if (!dayOff.length) continue;
        const journee = dayOff.includes("matin") && dayOff.includes("aprem");
        let equipeCreneau = false;
        if (eq) {
          const teamQuart = quartFixe.get(eq) ?? rotByWeek[d.wi]?.[eq] ?? null;
          const cr = creneauDe(teamQuart);
          equipeCreneau = !!cr && dayOff.includes(cr);
        }
        if (journee || equipeCreneau) tpBlocked[`${persId}:${d.iso}`] = true;
      }
    }
  }

  // Cycle de vie (0049 + 0050) : on masque les cellules OU la personne n'est
  // pas effectivement au travail — hors fenetre d'activite (avant l'arrivee /
  // apres le depart) ou dans un trou entre deux contrats. Les dates
  // d'arrivee/depart sont DERIVEES des contrats (0050).
  //
  // ⚠️ On avait initialement recycle `tpBlocked` : meme comportement (case
  // grisee, non cliquable), mais l'ecran l'interpretait comme TEMPS PARTIEL
  // et affichait « TP » partout, y compris pour des personnes sans TP.
  // Canal separe `horsEffectif` : meme desactivation, rendu vide (pas de « TP »).
  const horsEffectif: Record<string, boolean> = {};
  if (allIds.length && visIsos.length) {
    const contratsData = await pContrats; // lancée en vague 2
    const contratsParPersonne = new Map<string, { date_debut: string | null; date_fin: string | null }[]>();
    for (const r of contratsData) {
      const arr = contratsParPersonne.get(r.personne_id) ?? [];
      arr.push({ date_debut: r.date_debut, date_fin: r.date_fin });
      contratsParPersonne.set(r.personne_id, arr);
    }
    for (const p of allActive) {
      const contrats = contratsParPersonne.get(p.id) ?? [];
      const dates = deriverArriveeDepart(contrats);
      for (const d of visible) {
        if (!estAuTravailLe(dates, contrats, d.iso)) {
          horsEffectif[`${p.id}:${d.iso}`] = true;
        }
      }
    }
  }

  // Perimetre chef recupere en vague 1.
  const chefEquipes = new Set((chefData ?? []).map((r) => r.equipe_id));

  const equipeColor: Record<string, string> = {};
  for (const e of equipesD ?? []) equipeColor[e.id] = e.couleur;

  // On passe TOUTES les personnes actives a la grille (avec `displayedIds` a cote
  // pour ne rendre que le sous-ensemble filtre par defaut). La recherche par nom,
  // cote client, filtre alors dans l'effectif complet et retrouve quelqu'un meme
  // hors atelier/equipe courants.
  // Contrats pilotés par agence (drapeau avec_agence, 0072) : surlignés en jaune
  // comme l'intérim (intérim + CDI intérimaire…).
  const agenceCodesSet = new Set(typesAgence);
  const gridPersonnes = allActive.map((p) => ({
    id: p.id,
    label: `${p.nom} ${p.prenom}`,
    equipe_id: p.equipe_id,
    interim: agenceCodesSet.has(p.type_contrat),
    color: p.equipe_id ? equipeColor[p.equipe_id] : undefined,
    editable: canEditPlanningFull || (p.equipe_id != null && chefEquipes.has(p.equipe_id)),
  }));
  const displayedIds = displayed.map((p) => p.id);

  const mapGroup = (q: string) => (g: { ligneNom: string; ligneId: string; atelierNom: string; postes: PosteRow[] }) => ({
    ligneNom: g.ligneNom,
    ligneId: g.ligneId,
    atelierNom: g.atelierNom,
    postes: g.postes.map((p) => ({
      id: p.id,
      nom: (p.nom_court || p.nom).slice(0, 6),
      niveauMin: p.niveau_min_requis,
      effectif: effectifSurQuart(pq, p.id, q, p.effectif_requis),
      categorie: p.categorie,
    })),
  });
  // Un jeu de lignes par semaine affichée (celui du quart de la semaine). Même
  // référence d'une semaine à l'autre quand le quart ne change pas.
  const gridParQuart = new Map(quartsDistincts.map((q) => [q, groupsDe(q).map(mapGroup(q))]));
  const gridGroups = quartsSemaine.map((q) => gridParQuart.get(q) ?? []);
  // Tous les ateliers (indépendant du filtre atelier), même filtrage poste×quart :
  // alimente le panneau d'affectation « Voir tous » -> toute l'usine.
  const allGridParQuart = new Map(quartsDistincts.map((q) => [q, postesDuQuart(groupsAll, q).map(mapGroup(q))]));
  const allGridGroups = quartsSemaine.map((q) => allGridParQuart.get(q) ?? []);

  // Habilitations exigees par les postes affiches, et celles que les gens detiennent.
  // Meme lecture qu'au Placement : le manque est RECALCULE a l'affichage, si bien
  // qu'un placement force redevient normal des la regularisation et repasse en
  // rouge si l'habilitation expire. On ne se fie donc pas au drapeau `forcage_*`
  // stocke, qui n'est qu'une trace d'audit.
  const habPoste: Record<string, string[]> = {};
  const habComp: Record<string, string> = {};
  const habPers: Record<string, string> = {};
  if (postesHabIds.length) {
    const dureeComp: Record<string, number | null> = {};
    const { data: pcrD } = await pPcr; // lancée en vague 2
    for (const r of pcrD ?? []) {
      (habPoste[r.poste_id] ??= []).push(r.competence_id);
      habComp[r.competence_id] = r.competence?.nom ?? "habilitation";
      dureeComp[r.competence_id] = r.competence?.duree_validite_mois ?? null;
    }
    const compRequisesIds = Object.keys(habComp);
    if (compRequisesIds.length && allIds.length) {
      const det = await pHabDet; // chaînée sur pPcr en vague 2
      for (const d of det)
        habPers[`${d.personne_id}:${d.competence_id}`] =
          d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp[d.competence_id]) ?? "";
    }
  }

  const quartLabel: Record<string, string> = {};
  for (const q of quarts) quartLabel[q.code] = q.libelle.slice(0, 3);

  const searchParam = sp.search ?? "";

  // ─── Vue « Par poste » : mêmes données, pivotées par poste côté client ───
  // (src/app/planning/PlanningParPoste.tsx). Un seul quart : `quart`.
  let parPoste: Omit<React.ComponentProps<typeof PlanningParPoste>, "weekNav" | "actions" | "gauche" | "quartBandeau"> | null = null;
  if (vuePoste) {
    const extraPoste = new Map((await pPosteExtra).map((p) => [p.id, p]));
    const titulaires = new Map<string, string[]>();
    for (const p of allActive) {
      if (!p.poste_fixe_id) continue;
      const t = titulaires.get(p.poste_fixe_id) ?? [];
      t.push(p.id);
      titulaires.set(p.poste_fixe_id, t);
    }
    // Équipes de service sur ce quart, semaine par semaine (rotation + quart fixe) :
    // ordre des candidats et décompte des « non placés ».
    const equipesQuart = weekMondays.map((_, wi) => {
      const eqs = new Set<string>();
      for (const [eid, qc] of Object.entries(rotByWeek[wi] ?? {})) if (qc === quart) eqs.add(eid);
      for (const e of equipesD ?? []) if (e.quart_fixe === quart) eqs.add(e.id);
      return [...eqs];
    });
    // Placés hors plan : sur un poste qu'aucun plan du site ne dessine sur ce quart
    // (ne tourne pas, désactivé, fermé). Toujours montrés, jamais perdus de vue.
    const dessines = new Set(postesDuQuart(groupsAll, quart).flatMap((g) => g.postes.map((p) => p.id)));
    const nomPosteTous = new Map<string, string>();
    for (const l of lignesD ?? []) for (const p of l.poste ?? []) nomPosteTous.set(p.id, p.nom);
    const horsPlanMap = new Map<string, { pid: string; poste: string; jours: string[] }>();
    for (const [k, v] of Object.entries(initial)) {
      if (v === "X" || v === "TP" || v.startsWith("m:") || dessines.has(v)) continue;
      const [pid, iso] = k.split(":");
      const hk = `${pid}:${v}`;
      const h = horsPlanMap.get(hk) ?? { pid, poste: nomPosteTous.get(v) ?? "poste désactivé", jours: [] };
      h.jours.push(iso);
      horsPlanMap.set(hk, h);
    }
    const quartLibelle: Record<string, string> = {};
    for (const q of quarts) quartLibelle[q.code] = q.libelle;
    parPoste = {
      days,
      weekBlocks,
      todayIso: isoDate(new Date()),
      quart,
      quartLibelle,
      semaine: centerIso,
      atelier,
      initialSearch: searchParam,
      lignes: groupsDe(quart).map((g) => ({
        ligneId: g.ligneId,
        ligneNom: g.ligneNom,
        atelierId: g.atelierId ?? "",
        atelierNom: g.atelierNom,
        postes: g.postes.map((p) => ({
          id: p.id,
          nom: p.nom,
          court: p.nom_court || p.nom,
          categorie: p.categorie,
          effectif: effectifSurQuart(pq, p.id, quart, p.effectif_requis),
          niveauMin: p.niveau_min_requis,
          numeros: parseNumeros(extraPoste.get(p.id)?.numero_rotation),
          attente: extraPoste.get(p.id)?.zone_attente === true,
          titulaires: titulaires.get(p.id) ?? [],
        })),
      })),
      personnes: allActive.map((p) => ({
        id: p.id,
        label: `${p.nom} ${p.prenom}`,
        court: p.prenom ? `${p.nom} ${p.prenom.charAt(0).toUpperCase()}.` : p.nom,
        equipe_id: p.equipe_id,
        interim: agenceCodesSet.has(p.type_contrat),
        editable: canEditPlanningFull || (p.equipe_id != null && chefEquipes.has(p.equipe_id)),
      })),
      equipesQuart,
      vals: initial,
      numeros: numeroParCase,
      otherByCell,
      tpBlocked,
      horsEffectif,
      motifs: motifs.map((m) => ({ id: m.id, code: m.code_court })),
      matrice,
      habPoste,
      habComp,
      habPers,
      openByIso,
      horsPlan: [...horsPlanMap.values()],
      nomsPostes: Object.fromEntries(nomPosteTous),
      postesAttente: [...extraPoste.values()].filter((p) => p.zone_attente === true).map((p) => p.id),
    };
  }

  // `vue` reste dans l'URL même quand elle ne s'applique pas (Auto, Toutes, équipe à
  // quart fixe) : revenir sur une équipe tournante retrouve « Suivre l'équipe ».
  const vue = sp.vue === "equipe" ? "equipe" : "";
  const extra: Record<string, string> = { quart };
  if (vue) extra.vue = vue;
  if (spEquipe) extra.equipe = spEquipe;
  if (atelier) extra.atelier = atelier;
  if (searchParam) extra.search = searchParam;
  if (filtreConducteurs) extra.cond = "1";
  if (vuePoste) extra.par = "poste";

  // Raccourcis à droite de la recherche (TV, horaires, absences), communs aux
  // deux vues ; le filtre Conducteurs ne sert qu'à la vue Par nom.
  const raccourcis = (
    <>
      {atelier && (
        <Link
          href={`/affichage/atelier/${atelier}`}
          target="_blank"
          title={`Affichage TV — ${ateliersMap.get(atelier) ?? "service"}`}
          aria-label="Affichage TV du service"
          style={{ width: 30, height: 30, boxSizing: "border-box", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1, color: "#1d4ed8", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", textDecoration: "none" }}
        >
          <TvIcon size={18} />
        </Link>
      )}
      <Link
        href="/horaires-specifiques"
        title="Horaires spécifiques"
        aria-label="Horaires spécifiques"
        style={{ width: 30, height: 30, boxSizing: "border-box", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1, fontSize: 15, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", textDecoration: "none" }}
      >
        🕐
      </Link>
      <Link
        href={(() => {
          const p = new URLSearchParams();
          if (atelier) p.set("atelier", atelier);
          if (searchParam) p.set("search", searchParam);
          const qs = p.toString();
          return qs ? `/absences-specifiques?${qs}` : "/absences-specifiques";
        })()}
        title="Absences spécifiques"
        aria-label="Absences spécifiques"
        style={{ width: 30, height: 30, boxSizing: "border-box", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1, fontSize: 15, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", textDecoration: "none" }}
      >
        🤒
      </Link>
    </>
  );

  return (
    <>
      <div className="pagecol">
      <AppHeader role={profile.role} active="/planning" />
        {/* Filtres : colonne centree de 1500 px. */}
        <div className="headband" style={{ paddingTop: 12 }}>
        <div className="planning-top" style={{ justifyContent: "space-between", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Partie gauche : Annee / Mois / Semaine */}
          <PlanningNav base="/planning" semaine={centerIso} extra={extra} />
          {/* Partie centrale : Quart / Atelier / Équipe (colonne flex, gap 2).
              Chaque composant rend une .filterrow, dont la hauteur est fixée à
              32 px par .planning-top .filterrow -> alignée avec la colonne de
              gauche (Année/Mois/Semaine). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <QuartSelector
              quarts={quarts}
              current={quart}
              semaine={centerIso}
              atelier={atelier}
              equipe={spEquipe}
              search={searchParam}
              cond={filtreConducteurs}
              suivreEquipe={suivreEquipe}
              par={vuePoste ? "poste" : ""}
              suivreEquipeRaison={
                suivreEquipePossible
                  ? ""
                  : eqSel
                    ? `L'équipe ${eqSel.nom} est à quart fixe : son quart ne change pas d'une semaine à l'autre`
                    : "Choisissez une équipe pour suivre sa rotation d'une semaine sur l'autre"
              }
            />
            <AtelierFilter ateliers={ateliers} atelier={atelier} equipe={spEquipe} quart={quart} semaine={centerIso} search={searchParam} cond={filtreConducteurs} vue={vue} par={vuePoste ? "poste" : ""} />
            {!vuePoste && <PlanningFilters
              equipes={(equipesD ?? []).map((e) => ({ id: e.id, label: e.nom, couleur: e.couleur }))}
              equipe={spEquipe}
              semaine={centerIso}
              quart={quart}
              atelier={atelier}
              search={searchParam}
              cond={filtreConducteurs}
              vue={vue}
            />}
          </div>
          {/* La colonne d'icônes à droite du bandeau a été retirée le 2026-09-10 :
              ces 4 boutons (TV, Horaires, Absences, Conducteurs) sont désormais
              rendus en HORIZONTAL, à droite de la barre de recherche, via la
              prop `actions` de <PlanningGrid> (cf. plus bas). */}
        </div>
        </div>

        {/* La grille prend toute la largeur de la fenetre. */}
        <div className="gridband" style={{ paddingBottom: 12 }}>
        {parPoste ? (
          <PlanningParPoste
            key={`poste|${atelier}|${quart}|${centerIso}`}
            {...parPoste}
            weekNav={<WeekNav base="/planning" semaine={centerIso} extra={extra} />}
            actions={raccourcis}
            gauche={<VueBascule parPoste />}
            quartBandeau={<QuartBandeau quart={quart} quarts={quarts} suivi={null} />}
          />
        ) : (
        <PlanningGrid
          key={`${spEquipe}|${atelier}|${quartsSemaine.join(",")}|${centerIso}`}
          days={days}
          weekBlocks={weekBlocks}
          canPrefill={canEditPlanningFull}
          todayIso={isoDate(new Date())}
          personnes={gridPersonnes}
          displayedIds={displayedIds}
          statIds={allIds}
          groups={gridGroups}
          allGroups={allGridGroups}
          openByIso={openByIso}
          openAllByIso={openAllByIso}
          motifs={motifs.map((m) => ({ id: m.id, code: m.code_court, couleur: m.couleur }))}
          formationMotifId={motifs.find((m) => m.libelle.toLowerCase().includes("formation"))?.id ?? null}
          besoin={besoin}
          initial={initial}
          matrice={matrice}
          habPoste={habPoste}
          habComp={habComp}
          habPers={habPers}
          otherByCell={otherByCell}
          otherPosteByCell={otherPosteByCell}
          tpBlocked={tpBlocked}
          horsEffectif={horsEffectif}
          quartLabel={quartLabel}
          posteLabelAll={posteLabelAll}
          exceptions={exceptions}
          horaireStd={horaireStd}
          weekNav={<WeekNav base="/planning" semaine={centerIso} extra={extra} />}
          initialSearch={searchParam}
          gauche={<VueBascule parPoste={false} />}
          actions={
            /* 4 boutons uniformes 30×30 (2026-09-10) : ne PAS utiliser
               `.navlink` (padding CSS écrasait la taille et cassait
               l'alignement contre ConducteurToggle). Style inline
               strictement identique sur les 4, `padding: 0`, `boxSizing:
               border-box` pour compter la bordure dans les 30 px, `line-height: 1`
               pour neutraliser l'ascender des emoji. */
            <>
              {raccourcis}
              <ConducteurToggle
                actif={filtreConducteurs}
                semaine={centerIso}
                quart={quart}
                atelier={atelier}
                equipe={spEquipe}
                search={searchParam}
                vue={vue}
              />
            </>
          }
          quartBandeau={
            <QuartBandeau
              quart={quart}
              quarts={quarts}
              suivi={suivreEquipe && eqSel ? { equipe: eqSel.nom } : null}
            />
          }
        />
        )}
        </div>
      </div>
    </>
  );
}
