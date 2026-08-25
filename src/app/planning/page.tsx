import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
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
} from "@/lib/week";
import { requireModule, canWrite } from "@/lib/permissions";
import PlanningFilters from "./PlanningFilters";
import AtelierFilter from "./AtelierFilter";
import QuartSelector from "./QuartSelector";
import PrefillButton from "./PrefillButton";
import PlanningGrid from "./PlanningGrid";
import { getRotationRefsC } from "@/lib/refdata";
import { rotationForWeek } from "@/lib/rotation";
import { addMonthsIso } from "@/lib/habilitations";
import { quartParDefaut, quartOuDefaut, memeQuart } from "@/lib/quarts";
import { estAuTravailLe, deriverArriveeDepart } from "@/lib/personne-statut";

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
type LigneRow = { id: string; nom: string; ordre_affichage: number; atelier: { id: string; nom: string } | null; poste: PosteRow[] };
type Equipe = { id: string; nom: string; couleur: string; quart_fixe: string | null };
type Quart = { code: string; libelle: string; ordre: number; creneau: string | null };
type Personne = {
  id: string;
  nom: string;
  prenom: string;
  equipe_id: string | null;
  type_contrat: string;
};
type Placement = {
  personne_id: string;
  jour: string;
  poste_id: string | null;
  motif_absence_id: string | null;
  non_travaille: boolean;
  quart_code: string | null;
};
type MatRow = { personne_id: string; poste_id: string; niveau_actuel: number };
type PcrRow = { poste_id: string; competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null };
type PcDetRow = { personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ equipe?: string; semaine?: string; quart?: string; atelier?: string; search?: string }>;
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

  const weekMondays = [addDays(center, -7), center, addDays(center, 7)];
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
    { data: quartsD },
    { data: allActiveD },
    { data: chefData },
    { data: pqOffD },
  ] = await Promise.all([
    supabase.from("equipe").select("id, nom, couleur, quart_fixe").eq("actif", true).order("nom").returns<Equipe[]>(),
    supabase
      .from("ligne")
      .select("id, nom, ordre_affichage, atelier:atelier_id(id, nom), poste(id, nom, nom_court, actif, effectif_requis, niveau_min_requis, categorie, ordre_affichage)")
      .eq("actif", true)
      .order("nom")
      .returns<LigneRow[]>(),
    supabase
      .from("motif_absence")
      .select("id, code_court, libelle, couleur")
      .eq("actif", true)
      .order("libelle")
      .returns<Motif[]>(),
    supabase.from("quart").select("code, libelle, ordre, creneau").order("ordre").returns<Quart[]>(),
    supabase.from("personne").select("id, nom, prenom, equipe_id, type_contrat").in("statut", ["ACTIF", "A_VENIR"]).order("nom").returns<Personne[]>(),
    canEditPlanningFull
      ? Promise.resolve({ data: [] as { equipe_id: string }[] })
      : supabase.from("equipe_chef").select("equipe_id").eq("app_user_id", profile.authId).returns<{ equipe_id: string }[]>(),
    supabase.from("poste_quart").select("poste_id, quart_code").eq("actif", false).returns<{ poste_id: string; quart_code: string }[]>(),
  ]);
  const motifs = motifsD ?? [];
  const quarts = quartsD ?? [];
  const quartCodes = quarts.map((q) => q.code);

  // Rotation calculee (reference datee) : { equipe -> quart }. `rotWeek` pour la
  // semaine centrale (auto-selection du quart) ; `rotByWeek` pour CHACUNE des 3
  // semaines affichees (sert au marquage TP « une semaine sur deux »).
  const rotRefs = await getRotationRefsC();
  const rotWeek = rotationForWeek(rotRefs, centerIso);
  const rotByWeek = weekMondays.map((wm) => rotationForWeek(rotRefs, isoDate(wm)));

  // Quart selectionne : ?quart, sinon quart fixe de l'equipe choisie, sinon
  // rotation de la semaine pour cette equipe, sinon "matin".
  let quart = sp.quart && quartCodes.includes(sp.quart) ? sp.quart : "";
  if (!quart && equipeIdSel) {
    const eqRow = (equipesD ?? []).find((e) => e.id === equipeIdSel);
    if (eqRow?.quart_fixe && quartCodes.includes(eqRow.quart_fixe)) {
      quart = eqRow.quart_fixe;
    } else if (rotWeek[equipeIdSel] && quartCodes.includes(rotWeek[equipeIdSel])) {
      quart = rotWeek[equipeIdSel];
    }
  }
  if (!quart) quart = quartParDefaut(quarts);

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
    .map((l) => ({
      ligneNom: l.nom,
      ligneId: l.id,
      ligneOrdre: l.ordre_affichage ?? 0,
      atelierId: l.atelier?.id ?? null,
      atelierNom: l.atelier?.nom ?? "",
      postes: [...(l.poste ?? [])].filter((p) => p.actif).sort(ordreThenNom),
    }))
    .filter((g) => g.postes.length > 0)
    .sort(
      (a, b) =>
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

  // Filtre poste x quart : un poste desactive pour le quart affiche n'apparait pas
  // (et n'est pas compte). Defaut actif : pqOff ne contient que les desactivations.
  const pqOff = new Set((pqOffD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`));
  const posteActifQuart = (pid: string) => !pqOff.has(`${pid}:${quart}`);

  const groups = (atelier ? groupsAll.filter((g) => g.atelierId === atelier) : groupsAll)
    .map((g) => ({ ...g, postes: g.postes.filter((p) => posteActifQuart(p.id)) }))
    .filter((g) => g.postes.length > 0);

  const lineEffectif: Record<string, number> = {};
  for (const g of groups)
    lineEffectif[g.ligneId] = g.postes.reduce((s, p) => s + (p.effectif_requis ?? 0), 0);

  // Ouverture par quart selectionne.
  // `ouverture_quart` passe par fetchAll : 3 semaines x 1 quart x N lignes, soit
  // ~420 lignes aujourd'hui mais 1000 des ~48 lignes de production (cf. L8 —
  // PostgREST tronque a 1000 SANS erreur, et le planning afficherait alors des
  // lignes fermees comme ouvertes). `jour_quart` reste direct : 21 lignes au plus.
  const [ouv, { data: jq }] = await Promise.all([
    fetchAll<{ jour: string; ligne_id: string; ouverte: boolean }>(() =>
      supabase
        .from("ouverture_quart")
        .select("jour, ligne_id, ouverte")
        .eq("quart_code", quart)
        .in("jour", allIsos)
        .order("jour").order("ligne_id").order("quart_code")
        .returns<{ jour: string; ligne_id: string; ouverte: boolean }[]>()
    ),
    supabase
      .from("jour_quart")
      .select("jour, actif")
      .eq("quart_code", quart)
      .in("jour", allIsos)
      .returns<{ jour: string; actif: boolean }[]>(),
  ]);
  const ouvMap = new Map<string, boolean>();
  for (const r of ouv) ouvMap.set(`${r.jour}:${r.ligne_id}`, r.ouverte);
  const actMap = new Map<string, boolean>();
  for (const r of jq ?? []) actMap.set(r.jour, r.actif);

  const quartActif = (iso: string) => (actMap.has(iso) ? actMap.get(iso)! : false);
  const lineOpen = (iso: string, ligneId: string) =>
    quartActif(iso) ? (ouvMap.has(`${iso}:${ligneId}`) ? ouvMap.get(`${iso}:${ligneId}`)! : true) : false;

  const visible = rawDays
    .map((d) => {
      const openIds = quartActif(d.iso) ? groups.filter((g) => lineOpen(d.iso, g.ligneId)).map((g) => g.ligneId) : [];
      const besoin = openIds.reduce((s, lid) => s + (lineEffectif[lid] ?? 0), 0);
      return { ...d, open: openIds.length > 0, besoin, openIds };
    })
    .filter((d) => d.open);

  const openByIso: Record<string, string[]> = {};
  for (const d of visible) openByIso[d.iso] = d.openIds;

  const days = visible.map((d) => ({ iso: d.iso, nom: d.nom, num: d.num, firstOfWeek: d.firstOfWeek }));
  const besoin = visible.map((d) => d.besoin);
  const visIsos = visible.map((d) => d.iso);

  const weekBlocks: { num: number; span: number; year: number; isCurrent: boolean }[] = [];
  for (let wi = 0; wi < 3; wi++) {
    const span = visible.filter((d) => d.wi === wi).length;
    if (span > 0)
      weekBlocks.push({
        num: isoWeekNumber(weekMondays[wi]),
        year: weekMondays[wi].getFullYear(),
        span,
        isCurrent: isoDate(weekMondays[wi]) === todayMondayIso,
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
    const { data: paData, error: paErr } = await supabase
      .from("personne")
      .select("id, atelier_id")
      .in("id", allIds)
      .returns<{ id: string; atelier_id: string | null }[]>();
    if (!paErr) for (const r of paData ?? []) persAtelier.set(r.id, r.atelier_id);
  }

  // Predicat d'appartenance au filtre courant (equipe + atelier). Sert a determiner
  // les lignes affichees PAR DEFAUT ; la recherche par nom (client) passe outre pour
  // toujours retrouver quelqu'un.
  const passeEquipe = (eqid: string | null): boolean => {
    if (equipeMode === "all") return true;
    if (equipeMode === "id") return eqid === equipeIdSel;
    // auto : appartient a une equipe de l'ensemble AUTO.
    return !!eqid && equipesAuto.has(eqid);
  };
  const displayed = allActive.filter(
    (p) => passeEquipe(p.equipe_id) && (!atelier || persAtelier.get(p.id) === atelier),
  );
  const displayedSet = new Set(displayed.map((p) => p.id));

  // Une affectation sur poste n'apparait que pour le quart courant ; une absence/NT
  // vaut pour tous les quarts. Les placements historiques sans quart passent par le
  // repli commun (`memeQuart`) : cet ecran utilisait `quartCodes[0]` — « journee » —
  // la ou le Placement et la TV utilisaient « matin », si bien que les memes lignes
  // s'affichaient sous deux quarts differents selon l'ecran.
  const matchQuart = (qc: string | null) => memeQuart(qc, quart, quarts);

  const initial: Record<string, string> = {};
  const otherByCell: Record<string, string> = {}; // place sur un autre quart -> code du quart
  const otherPosteByCell: Record<string, string> = {}; // ... et nom complet du poste occupe
  const matrice: Record<string, number> = {};
  const exceptions: Record<string, { debut: string; fin: string; motif: string }> = {};
  // Horaire standard par poste (quart affiche) et jour de semaine (0=lundi..6=dimanche),
  // sert a afficher l'horaire par defaut dans l'infobulle de la pendule.
  const horaireStd: Record<string, { debut: string; fin: string }> = {};
  if (allIds.length && visIsos.length) {
    const [pl, mat, { data: exc }, { data: horStd }] = await Promise.all([
      fetchAll<Placement>(() =>
        supabase
          .from("placement")
          .select("personne_id, jour, poste_id, motif_absence_id, non_travaille, quart_code")
          .in("jour", visIsos)
          .in("personne_id", allIds)
          .order("id")
          .returns<Placement[]>()
      ),
      fetchAll<MatRow>(() =>
        supabase
          .from("matrice")
          .select("personne_id, poste_id, niveau_actuel")
          .in("personne_id", allIds)
          .order("id")
          .returns<MatRow[]>()
      ),
      supabase
        .from("horaire_exception")
        .select("personne_id, jour, debut, fin, motif")
        .in("jour", visIsos)
        .in("personne_id", allIds)
        .returns<{ personne_id: string; jour: string; debut: string | null; fin: string | null; motif: string | null }[]>(),
      supabase
        .from("horaire_poste")
        .select("poste_id, jour, debut, fin")
        .eq("quart_code", quart)
        .returns<{ poste_id: string; jour: number; debut: string | null; fin: string | null }[]>(),
    ]);
    for (const h of horStd ?? []) horaireStd[`${h.poste_id}:${h.jour}`] = { debut: h.debut ?? "", fin: h.fin ?? "" };
    for (const r of pl) {
      const k = `${r.personne_id}:${r.jour}`;
      if (r.non_travaille) initial[k] = "X";
      else if (r.motif_absence_id) initial[k] = `m:${r.motif_absence_id}`;
      else if (r.poste_id && matchQuart(r.quart_code)) initial[k] = r.poste_id;
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
  }

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
    type TpRow = { id: string; personne_id: string; date_debut: string; date_fin: string | null; tp_config: { off?: Record<string, string[]> } | null };
    const minIso = visIsos[0];
    const maxIso = visIsos[visIsos.length - 1];
    const { data: tpPeriodes } = await supabase
      .from("tp_periode")
      .select("id, personne_id, date_debut, date_fin, tp_config")
      .lte("date_debut", maxIso)
      .or(`date_fin.is.null,date_fin.gte.${minIso}`)
      .order("date_debut")
      .returns<TpRow[]>();
    // Index par personne.
    const periodesByPers = new Map<string, TpRow[]>();
    for (const p of tpPeriodes ?? []) {
      (periodesByPers.get(p.personne_id) ?? periodesByPers.set(p.personne_id, []).get(p.personne_id)!).push(p);
    }
    // Repli : personnes avec temps_partiel=true mais sans ligne dans tp_periode
    // (cas de transition, avant que l'utilisateur ait ouvert la modale).
    const { data: tpFallback } = await supabase
      .from("personne")
      .select("id, tp_config")
      .eq("temps_partiel", true)
      .in("id", allIds)
      .returns<{ id: string; tp_config: { off?: Record<string, string[]> } | null }[]>();
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
    const contratsData = await fetchAll<{ personne_id: string; date_debut: string | null; date_fin: string | null }>(() =>
      supabase
        .from("contrat_periode")
        .select("personne_id, date_debut, date_fin")
        .in("personne_id", allIds)
        .order("id")
        .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>()
    );
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
  const gridPersonnes = allActive.map((p) => ({
    id: p.id,
    label: `${p.nom} ${p.prenom}`,
    equipe_id: p.equipe_id,
    interim: p.type_contrat === "INTERIM",
    color: p.equipe_id ? equipeColor[p.equipe_id] : undefined,
    editable: canEditPlanningFull || (p.equipe_id != null && chefEquipes.has(p.equipe_id)),
  }));
  const displayedIds = displayed.map((p) => p.id);

  const gridGroups = groups.map((g) => ({
    ligneNom: g.ligneNom,
    ligneId: g.ligneId,
    atelierNom: g.atelierNom,
    postes: g.postes.map((p) => ({
      id: p.id,
      nom: (p.nom_court || p.nom).slice(0, 6),
      niveauMin: p.niveau_min_requis,
      effectif: p.effectif_requis,
      categorie: p.categorie,
    })),
  }));

  // Habilitations exigees par les postes affiches, et celles que les gens detiennent.
  // Meme lecture qu'au Placement : le manque est RECALCULE a l'affichage, si bien
  // qu'un placement force redevient normal des la regularisation et repasse en
  // rouge si l'habilitation expire. On ne se fie donc pas au drapeau `forcage_*`
  // stocke, qui n'est qu'une trace d'audit.
  const posteIdsAffiches = groups.flatMap((g) => g.postes.map((p) => p.id));
  const habPoste: Record<string, string[]> = {};
  const habComp: Record<string, string> = {};
  const habPers: Record<string, string> = {};
  if (posteIdsAffiches.length) {
    const dureeComp: Record<string, number | null> = {};
    const { data: pcrD } = await supabase
      .from("poste_competence_requise")
      .select("poste_id, competence_id, competence:competence_id(nom, duree_validite_mois)")
      .in("poste_id", posteIdsAffiches)
      .returns<PcrRow[]>();
    for (const r of pcrD ?? []) {
      (habPoste[r.poste_id] ??= []).push(r.competence_id);
      habComp[r.competence_id] = r.competence?.nom ?? "habilitation";
      dureeComp[r.competence_id] = r.competence?.duree_validite_mois ?? null;
    }
    const compRequisesIds = Object.keys(habComp);
    if (compRequisesIds.length && allIds.length) {
      // personne_competence depasse 1000 lignes -> fetchAll obligatoire.
      const det = await fetchAll<PcDetRow>(() =>
        supabase
          .from("personne_competence")
          .select("personne_id, competence_id, date_obtention, date_expiration")
          .in("competence_id", compRequisesIds)
          .in("personne_id", allIds)
          .order("id")
          .returns<PcDetRow[]>()
      );
      for (const d of det)
        habPers[`${d.personne_id}:${d.competence_id}`] =
          d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp[d.competence_id]) ?? "";
    }
  }

  const quartLabel: Record<string, string> = {};
  for (const q of quarts) quartLabel[q.code] = q.libelle.slice(0, 3);

  const searchParam = sp.search ?? "";
  const extra: Record<string, string> = { quart };
  if (spEquipe) extra.equipe = spEquipe;
  if (atelier) extra.atelier = atelier;
  if (searchParam) extra.search = searchParam;

  return (
    <>
      <div className="pagecol">
      <AppHeader role={profile.role} active="/planning" />
        {/* Filtres : colonne centree de 1500 px. */}
        <div className="headband" style={{ paddingTop: 12 }}>
        <div className="planning-top" style={{ justifyContent: "space-between", gap: 28, flexWrap: "wrap", alignItems: "stretch" }}>
          {/* Partie gauche : Annee / Mois / Semaine */}
          <PlanningNav base="/planning" semaine={centerIso} extra={extra} />
          {/* Partie centrale : Equipe / Atelier / Quart (alignes sur les memes lignes) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <QuartSelector quarts={quarts} current={quart} semaine={centerIso} atelier={atelier} equipe={spEquipe} search={searchParam} />
            <AtelierFilter ateliers={ateliers} atelier={atelier} equipe={spEquipe} quart={quart} semaine={centerIso} search={searchParam} />
            <PlanningFilters
              equipes={(equipesD ?? []).map((e) => ({ id: e.id, label: e.nom, couleur: e.couleur }))}
              equipe={spEquipe}
              semaine={centerIso}
              quart={quart}
              atelier={atelier}
              search={searchParam}
            />
          </div>
          {/* Partie droite : liens (occupent la hauteur des 3 lignes de filtres) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignSelf: "stretch" }}>
            {canEditPlanningFull && (
              <PrefillButton
                semaines={weekMondays.map((wm) => isoDate(wm))}
                quart={quart}
                quartLabel={(quarts.find((q) => q.code === quart)?.libelle) ?? quart}
                weekLabel={`S${isoWeekNumber(weekMondays[0])} → S${isoWeekNumber(weekMondays[2])}`}
              />
            )}
            <Link href="/horaires-specifiques" className="navlink" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 10, whiteSpace: "nowrap" }}>
              🕐 Horaires spécifiques
            </Link>
            <Link href="/absences-specifiques" className="navlink" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 10, whiteSpace: "nowrap" }}>
              🤒 Absences spécifiques
            </Link>
          </div>
        </div>
        </div>

        {/* La grille prend toute la largeur de la fenetre. */}
        <div className="gridband" style={{ paddingBottom: 12 }}>
        <PlanningGrid
          key={`${spEquipe}|${atelier}|${quart}|${centerIso}`}
          days={days}
          weekBlocks={weekBlocks}
          todayIso={isoDate(new Date())}
          personnes={gridPersonnes}
          displayedIds={displayedIds}
          statIds={allIds}
          groups={gridGroups}
          openByIso={openByIso}
          motifs={motifs.map((m) => ({ id: m.id, code: m.code_court, couleur: m.couleur }))}
          formationMotifId={motifs.find((m) => m.libelle.toLowerCase().includes("formation"))?.id ?? null}
          besoin={besoin}
          initial={initial}
          matrice={matrice}
          habPoste={habPoste}
          habComp={habComp}
          habPers={habPers}
          quart={quart}
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
        />
        </div>
      </div>
    </>
  );
}
