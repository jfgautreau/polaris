import { cookies } from "next/headers";
import { getServerClient } from "@/lib/supabase-server";
import { COOKIE_QUART, COOKIE_PLACEMENT_SERVICE, valeurValide } from "@/lib/filtres-session";
import { getCurrentSite } from "@/lib/current-site";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import { requireModule, canWritePlacementData } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { enAvance } from "@/lib/en-avance";
import { quartParDefaut, quartOuDefaut, memeQuart } from "@/lib/quarts";
import { chargerPosteQuart, tourneSurQuart, effectifSurQuart } from "@/lib/poste-quart";
import { chargerValidites, actifLe } from "@/lib/referentiel-validite";
import { isoDate, mondayOf, addDays } from "@/lib/week";
import { getRotationRefsC, getTypesAgenceC } from "@/lib/refdata";
import { rotationForWeek, equipesParQuart } from "@/lib/rotation";
import { addMonthsIso } from "@/lib/habilitations";
import { estAuTravailLe, deriverArriveeDepart } from "@/lib/personne-statut";
import { horaireTxt, dowLundi, type HM, type TpCfg, type HorairePlace } from "@/lib/horaires";
import { chargerNuitsAvant } from "@/lib/nuit-avant-data";
import PlacementBoard from "./PlacementBoard";
import QuartBandeau from "../planning/QuartBandeau";

type Atelier = { id: string; nom: string };
type Equipe = { id: string; nom: string; couleur: string | null; quart_fixe?: string | null };
type Quart = { code: string; libelle: string; ordre: number; creneau: string | null; couleur?: string | null };
type Personne = { id: string; nom: string; prenom: string; equipe_id: string | null; atelier_id: string | null; type_contrat: string };
type PosteRow = { id: string; nom: string; nom_court: string | null; actif: boolean; effectif_requis: number; niveau_min_requis: number; ordre_affichage: number; numero_rotation: string | null; imprimable?: boolean; zone_attente?: boolean };
type LigneRow = { id: string; nom: string; ordre_affichage: number; atelier_id: string; couleur: string | null; poste: PosteRow[] };
type Placement = { personne_id: string; poste_id: string | null; motif_absence_id: string | null; non_travaille: boolean; quart_code: string | null; numero_rotation: string | null };
type MatRow = { personne_id: string; poste_id: string; niveau_actuel: number };
type Motif = { id: string; code_court: string; libelle: string; couleur: string; visible_operateurs?: boolean };
type PcrRow = { poste_id: string; competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null };
type PcDetRow = { personne_id: string; competence_id: string; date_obtention: string | null; date_expiration: string | null };

const ordreThenNom = <T extends { ordre_affichage?: number; nom: string }>(a: T, b: T) =>
  (a.ordre_affichage ?? 0) - (b.ordre_affichage ?? 0) || a.nom.localeCompare(b.nom);

export default async function PlacementPage({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; date?: string; quart?: string; vue?: string }>;
}) {
  const { profile } = await requireModule("placement", "write");
  const site = await getCurrentSite();
  const sp = await searchParams;

  const supabase = await getServerClient();
  const jour = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : isoDate(new Date());

  // Perf P5 (2026-09-28) : lectures qui ne dépendent que du JOUR ou de l'appelant,
  // lancées dès maintenant ; chaque bloc plus bas attend la sienne au lieu de les
  // enchaîner (≈ 12 allers-retours en série auparavant). Traitements inchangés.
  type TpConf = { off?: Record<string, string[]> } | null;
  const pConducteurs = enAvance(
    fetchAll<{ personne_id: string }>(() =>
      supabase
        .from("matrice")
        .select("personne_id, poste!inner(categorie, actif)")
        .eq("poste.categorie", "conducteur")
        .eq("poste.actif", true)
        .gte("niveau_actuel", 1)
        .order("id")
        .returns<{ personne_id: string }[]>()
    )
  );
  const pPlacementsJour = enAvance(
    supabase.from("placement").select("personne_id, poste_id, motif_absence_id, non_travaille, quart_code, numero_rotation").eq("jour", jour).returns<Placement[]>()
  );
  const pCommentaires = enAvance(
    supabase
      .from("horaire_exception")
      .select("personne_id, motif, debut, fin")
      .eq("jour", jour)
      .returns<{ personne_id: string; motif: string | null; debut: string | null; fin: string | null }[]>()
  );
  const pFullWrite = enAvance(canWritePlacementData(profile.role));
  const pChefTeams = enAvance(
    supabase.from("equipe_chef").select("equipe_id").eq("app_user_id", profile.authId).returns<{ equipe_id: string }[]>()
  );
  const pRotRefs = enAvance(getRotationRefsC());
  const pTypesAgence = enAvance(getTypesAgenceC());
  const pTpPeriodes = enAvance(
    supabase
      .from("tp_periode")
      .select("personne_id, date_debut, date_fin, tp_config")
      .lte("date_debut", jour)
      .or(`date_fin.is.null,date_fin.gte.${jour}`)
      .returns<{ personne_id: string; date_debut: string; date_fin: string | null; tp_config: TpConf }[]>()
  );
  const pTpFallback = enAvance(
    supabase.from("personne").select("id, tp_config").eq("temps_partiel", true).returns<{ id: string; tp_config: TpConf }[]>()
  );

  const [{ data: ateliersD }, { data: equipesD }, { data: quartsD, error: quartsErr }, { data: persD }, { data: motifsD }] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("ordre_affichage").order("nom").returns<Atelier[]>(),
    supabase.from("equipe").select("id, nom, couleur, quart_fixe").eq("actif", true).order("nom").returns<Equipe[]>(),
    // Migration 0068 : la colonne `couleur` peut ne pas encore exister — repli
    // silencieux plus bas (relecture sans `couleur`) pour ne pas planter la page.
    supabase.from("quart").select("code, libelle, ordre, creneau, couleur").order("ordre").returns<Quart[]>(),
    supabase.from("personne").select("id, nom, prenom, equipe_id, atelier_id, type_contrat").in("statut", ["ACTIF", "A_VENIR"]).order("nom").returns<Personne[]>(),
    supabase.from("motif_absence").select("id, code_court, libelle, couleur, visible_operateurs").eq("actif", true).order("libelle").returns<Motif[]>(),
  ]);

  const ateliers = ateliersD ?? [];
  const equipes = equipesD ?? [];
  // Repli si migration 0068 (colonne `couleur`) non appliquée : on relit sans.
  let quarts: Quart[] = quartsD ?? [];
  if (quartsErr && (quartsErr.code === "42703" || quartsErr.code === "PGRST204")) {
    const { data: q2 } = await supabase.from("quart").select("code, libelle, ordre, creneau").order("ordre").returns<Omit<Quart, "couleur">[]>();
    quarts = (q2 ?? []).map((q) => ({ ...q, couleur: null }));
  }
  const quartCodes = quarts.map((q) => q.code);
  // Cycle de vie (0049 + 0050) : on masque du placement les personnes qui ne
  // sont pas effectivement au travail le jour choisi — hors fenetre d'activite
  // ou dans un trou entre deux contrats. Les A_VENIR sont incluses pour qu'on
  // puisse les placer des qu'un contrat les couvre ; les PARTI restent exclues
  // par le filtre .in("statut"). Les dates d'arrivee/depart sont DERIVEES des
  // contrats (0050), plus stockees sur personne.
  const personnesActives = persD ?? [];
  const idsPourContrat = personnesActives.map((p) => p.id);
  const contratsMap = new Map<string, { date_debut: string | null; date_fin: string | null }[]>();
  if (idsPourContrat.length) {
    // fetchAll (L8) : plusieurs contrats par personne, le volume peut dépasser 1000.
    const cpD = await fetchAll<{ personne_id: string; date_debut: string | null; date_fin: string | null }>(() =>
      supabase
        .from("contrat_periode")
        .select("personne_id, date_debut, date_fin")
        .in("personne_id", idsPourContrat)
        .order("id")
        .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>()
    );
    for (const r of cpD) {
      const arr = contratsMap.get(r.personne_id) ?? [];
      arr.push({ date_debut: r.date_debut, date_fin: r.date_fin });
      contratsMap.set(r.personne_id, arr);
    }
  }
  const personnes = personnesActives.filter((p) => {
    const contrats = contratsMap.get(p.id) ?? [];
    return estAuTravailLe(deriverArriveeDepart(contrats), contrats, jour);
  });
  const motifs = motifsD ?? [];

  // Set des personnes « Conducteur » : au moins une compétence (niveau ≥ 1) sur
  // au moins un poste `categorie = 'conducteur'` actif. Utilisé par le filtre
  // client dans PlacementBoard (bascule optionnelle, cumulée aux autres filtres ;
  // la recherche par nom passe outre). fetchAll : matrice > 1000 lignes (L8).
  const conducteurIds: string[] = [];
  {
    const rows = await pConducteurs; // lancée d'entrée
    const uniq = new Set<string>();
    for (const r of rows) uniq.add(r.personne_id);
    conducteurIds.push(...uniq);
  }

  // Defauts de SESSION (cookies, cf. src/lib/filtres-session.ts) quand l'URL ne
  // precise rien : dernier quart choisi (Planning ou Placement), dernier plan
  // (service) ouvert ici — c'est aussi la reponse a « Service : tous » au Planning.
  // Valeurs revalidees contre les quarts / ateliers du site.
  const jar = await cookies();
  const quart =
    (sp.quart && quartCodes.includes(sp.quart) ? sp.quart : "") ||
    valeurValide(jar.get(COOKIE_QUART)?.value, quartCodes) ||
    quartParDefaut(quarts);
  // Bascule Plan / Absences portee par ?vue : l'atelier reste selectionne dans les
  // deux cas, c'est lui qui filtre les absences affichees.
  const vueAbsences = sp.vue === "absences";
  const atelierIds = ateliers.map((a) => a.id);
  const atelierId =
    (sp.atelier && atelierIds.includes(sp.atelier) ? sp.atelier : "") ||
    valeurValide(jar.get(COOKIE_PLACEMENT_SERVICE)?.value, atelierIds) ||
    ateliers[0]?.id ||
    "";

  // Ouverture (jour + fenêtre du calendrier) : dépend du quart résolu, part avec
  // la vague ci-dessous au lieu de l'attendre (cf. commentaires plus bas).
  const winStart = isoDate(addDays(new Date(jour + "T00:00"), -90));
  const winEnd = isoDate(addDays(new Date(jour + "T00:00"), 150));
  const pOuverture = enAvance(
    Promise.all([
      supabase
        .from("ouverture_quart")
        .select("ligne_id, ouverte")
        .eq("quart_code", quart)
        .eq("jour", jour)
        .returns<{ ligne_id: string; ouverte: boolean }[]>(),
      supabase
        .from("jour_quart")
        .select("actif")
        .eq("quart_code", quart)
        .eq("jour", jour)
        .maybeSingle<{ actif: boolean }>(),
      supabase
        .from("jour_quart")
        .select("jour, actif")
        .eq("quart_code", quart)
        .gte("jour", winStart)
        .lte("jour", winEnd)
        .returns<{ jour: string; actif: boolean }[]>(),
    ])
  );

  // Postes de l'atelier + desactivations poste x quart + placements du jour + matrice.
  const [{ data: lignesD }, pq, { data: plD }, mat, ligneVal, posteVal] = await Promise.all([
    atelierId
      ? (async () => {
          // Lecture tolérante à l'absence de `poste.zone_attente` (0077) puis de
          // `poste.imprimable` (0073) : une colonne absente ferait échouer TOUTE la
          // requête imbriquée (L19) et viderait le plan. Replis successifs, défauts
          // false / true.
          const embed = (extra: string) =>
            `id, nom, ordre_affichage, atelier_id, couleur, poste(id, nom, nom_court, actif, effectif_requis, niveau_min_requis, ordre_affichage, numero_rotation${extra})`;
          const q = (extra: string) =>
            supabase.from("ligne").select(embed(extra)).eq("atelier_id", atelierId).eq("actif", true).order("nom").returns<LigneRow[]>();
          const colonneAbsente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
          const avec = await q(", imprimable, zone_attente");
          if (!colonneAbsente(avec.error)) return avec;
          const sans0077 = await q(", imprimable");
          if (!colonneAbsente(sans0077.error)) return sans0077;
          return q("");
        })()
      : Promise.resolve({ data: [] as LigneRow[] }),
    chargerPosteQuart(supabase),
    pPlacementsJour,
    (async () => {
      const posteIds = ((await supabase
        .from("ligne")
        .select("poste(id)")
        .eq("atelier_id", atelierId)
        .returns<{ poste: { id: string }[] }[]>()).data ?? []).flatMap((l) => l.poste.map((p) => p.id));
      if (!posteIds.length) return [] as MatRow[];
      return fetchAll<MatRow>(() =>
        supabase.from("matrice").select("personne_id, poste_id, niveau_actuel").in("poste_id", posteIds).order("id").returns<MatRow[]>()
      );
    })(),
    chargerValidites(supabase, "ligne"),
    chargerValidites(supabase, "poste"),
  ]);
  // Validité datée (0071) à AUJOURD'HUI : ligne / poste dont la fermeture est
  // atteinte (ou l'ouverture pas encore) est masqué.
  const todayIsoRef = new Date().toISOString().slice(0, 10);

  // Ouverture des lignes decidee dans l'Ordonnancement, pour ce jour et ce quart.
  // Memes regles que le Planning (cf. src/app/planning/page.tsx) : un quart sans
  // ligne dans `jour_quart` est FERME (rien n'est ouvert tant que la semaine n'a pas
  // ete initialisee) ; une ligne sans ligne dans `ouverture_quart` est ouverte.
  // Pas de fetchAll ici, contrairement au Planning et a l'affichage TV : la
  // lecture porte sur UN jour et UN quart, elle est donc bornee au nombre de
  // lignes de production (une vingtaine). Il faudrait 1000 lignes pour atteindre
  // le plafond PostgREST. Si cette requete est un jour elargie a une semaine,
  // il faudra la passer par fetchAll (cf. L8).
  const [{ data: ouvD }, { data: jqD }, { data: jqWin }] = await pOuverture;
  const quartOuvert = jqD?.actif === true;
  const ouvMap = new Map((ouvD ?? []).map((r) => [r.ligne_id, r.ouverte]));
  const ligneOuverte = (id: string) => quartOuvert && (ouvMap.get(id) ?? true);

  // Postes ouverts pour ce quart (poste actif + non desactive sur le quart), groupes par ligne.
  // Depuis 2026-09-09 : une ligne fermée par Ordonnancement (`ouverture_quart`) reste
  // affichée et plaçable — sa fermeture ne fait plus disparaître la ligne, elle rend
  // seulement son BESOIN nul (compteur « X/0 »). Le drapeau `fermee` par groupe est
  // relayé à `PlacementBoard`, qui pilote l'affichage du dénominateur et la couverture.
  // Effectif par quart (trois états, cf. src/lib/poste-quart.ts) : un poste qui ne
  // tourne pas sur le quart (« – ») est masqué ; sinon son besoin = effectif du quart.
  const groups = (lignesD ?? [])
    .filter((l) => actifLe(ligneVal.get(l.id), todayIsoRef)) // fermeture datée atteinte -> ligne masquée
    .map((l) => ({
      ligneId: l.id,
      ligneNom: l.nom,
      ligneOrdre: l.ordre_affichage ?? 0,
      couleur: l.couleur, // couleur des PDF (0082)
      fermee: !ligneOuverte(l.id), // ordonnancement : ligne fermée -> besoin 0
      postes: [...(l.poste ?? [])]
        .filter((p) => p.actif && actifLe(posteVal.get(p.id), todayIsoRef) && tourneSurQuart(pq, p.id, quart, p.effectif_requis))
        .sort(ordreThenNom)
        .map((p) => ({
          id: p.id,
          nom: p.nom,
          nomCourt: p.nom_court,
          effectifRequis: effectifSurQuart(pq, p.id, quart, p.effectif_requis),
          niveauMin: p.niveau_min_requis,
          numeroRotation: p.numero_rotation,
          // Défaut true si la migration 0073 (colonne imprimable) n'est pas passée.
          imprimable: p.imprimable ?? true,
          // Zone d'attente (0077) : affichée dans la colonne « À répartir », hors du plan.
          attente: p.zone_attente === true,
        })),
    }))
    .filter((g) => g.postes.length > 0)
    .sort((a, b) => a.ligneOrdre - b.ligneOrdre || a.ligneNom.localeCompare(b.ligneNom));

  // Habilitations exigees par les postes affiches, et celles que les gens detiennent.
  // Le manque est recalcule a l'affichage : un placement force redevient normal des
  // que l'habilitation est regularisee, et repasse en rouge si elle expire.
  const posteIdsAffiches = groups.flatMap((g) => g.postes.map((p) => p.id));
  const { data: pcrD } = posteIdsAffiches.length
    ? await supabase
        .from("poste_competence_requise")
        .select("poste_id, competence_id, competence:competence_id(nom, duree_validite_mois)")
        .in("poste_id", posteIdsAffiches)
        .returns<PcrRow[]>()
    : { data: [] as PcrRow[] };

  const habPoste: Record<string, string[]> = {};
  const habComp: Record<string, string> = {};
  const dureeComp: Record<string, number | null> = {};
  for (const r of pcrD ?? []) {
    (habPoste[r.poste_id] ??= []).push(r.competence_id);
    habComp[r.competence_id] = r.competence?.nom ?? "habilitation";
    dureeComp[r.competence_id] = r.competence?.duree_validite_mois ?? null;
  }

  // Echeance effective par (personne, habilitation requise) : "" = valable sans
  // echeance, sinon la date. Cle absente = habilitation non detenue.
  const compRequisesIds = Object.keys(habComp);
  const habPers: Record<string, string> = {};
  if (compRequisesIds.length) {
    const det = await fetchAll<PcDetRow>(() =>
      supabase
        .from("personne_competence")
        .select("personne_id, competence_id, date_obtention, date_expiration")
        .in("competence_id", compRequisesIds)
        .order("id")
        .returns<PcDetRow[]>()
    );
    for (const d of det)
      habPers[`${d.personne_id}:${d.competence_id}`] =
        d.date_expiration ?? addMonthsIso(d.date_obtention, dureeComp[d.competence_id]) ?? "";
  }

  // Etat initial des placements (pour ce jour / quart) + personnes deja sur un autre quart.
  const placeInit: Record<string, string> = {};
  const autreQuart: Record<string, string> = {};
  const numeroInit: Record<string, string> = {};
  for (const r of plD ?? []) {
    if (r.non_travaille) placeInit[r.personne_id] = "X";
    else if (r.motif_absence_id) placeInit[r.personne_id] = `m:${r.motif_absence_id}`;
    else if (r.poste_id && memeQuart(r.quart_code, quart, quarts)) {
      placeInit[r.personne_id] = r.poste_id;
      if (r.numero_rotation) numeroInit[r.personne_id] = r.numero_rotation;
    } else if (r.poste_id) autreQuart[r.personne_id] = quartOuDefaut(r.quart_code, quarts);
  }

  // Placés « HORS PLAN » (2026-09-28) : personne placée sur ce quart sur un poste
  // qu'AUCUN plan ne peut dessiner — le poste ne tourne pas sur ce quart (« – » au
  // Référentiel), ou le poste / sa ligne est désactivé(e) ou fermé(e) à la date.
  // Sans ce repérage, ces personnes étaient INVISIBLES : poste non dessiné, et nom
  // retiré de la liste par « Masquer les placés ». Le poste d'un AUTRE service
  // n'est pas concerné : il est dessiné dans le plan de ce service.
  const horsPlan: Record<string, { posteId: string; libelle: string }> = {};
  {
    const placesQuart = (plD ?? []).filter((r) => r.poste_id && memeQuart(r.quart_code, quart, quarts));
    const idsPostes = [...new Set(placesQuart.map((r) => r.poste_id as string))];
    if (idsPostes.length) {
      const { data: postesD } = await supabase
        .from("poste")
        .select("id, nom, actif, ligne_id, ligne:ligne_id(actif, atelier_id)")
        .in("id", idsPostes)
        .returns<{ id: string; nom: string; actif: boolean; ligne_id: string; ligne: { actif: boolean; atelier_id: string | null } | null }[]>();
      const posteInfo = new Map((postesD ?? []).map((p) => [p.id, p]));
      const ateliersActifs = new Set(ateliers.map((a) => a.id));
      for (const r of placesQuart) {
        const p = posteInfo.get(r.poste_id as string);
        if (!p) continue;
        const raison = !tourneSurQuart(pq, p.id, quart)
          ? "ne tourne pas sur ce quart"
          : !p.actif || p.ligne?.actif === false
            ? "poste désactivé"
            : !actifLe(posteVal.get(p.id), todayIsoRef) || !actifLe(ligneVal.get(p.ligne_id), todayIsoRef)
              ? "poste fermé à cette date"
              // Aucun plan ne dessine le poste d'un service désactivé / d'une ligne sans service.
              : !p.ligne?.atelier_id || !ateliersActifs.has(p.ligne.atelier_id)
                ? "service désactivé ou absent"
                : null;
        if (raison) horsPlan[r.personne_id] = { posteId: p.id, libelle: `${p.nom} — ${raison}` };
      }
    }

    // Placés mais ABSENTS de la liste chargée : partis, ou hors effectif ce jour
    // d'après leurs contrats. Ni la case du poste ni la liste ne les montraient.
    // On les ajoute (ils occupent réellement le poste) et on les signale.
    const connus = new Set(personnes.map((p) => p.id));
    const idsInconnus = [...new Set(placesQuart.map((r) => r.personne_id).filter((id) => !connus.has(id)))];
    if (idsInconnus.length) {
      const { data: extraD } = await supabase
        .from("personne")
        .select("id, nom, prenom, equipe_id, atelier_id, type_contrat, statut")
        .in("id", idsInconnus)
        .returns<(Personne & { statut: string })[]>();
      for (const e of extraD ?? []) {
        personnes.push({ id: e.id, nom: e.nom, prenom: e.prenom, equipe_id: e.equipe_id, atelier_id: e.atelier_id, type_contrat: e.type_contrat });
        const posteId = placesQuart.find((r) => r.personne_id === e.id)?.poste_id as string;
        if (!horsPlan[e.id]) {
          horsPlan[e.id] = {
            posteId,
            libelle: e.statut === "PARTI" ? "personne partie (statut Parti)" : "hors effectif ce jour (contrat)",
          };
        }
      }
    }
  }

  // Commentaires du jour (horaire_exception.motif, saisis au Planning via la
  // petite pendule) : affichés à côté du nom dans les PDF du Placement. Bornés
  // à UN jour → petite lecture, pas de fetchAll ; la table est site-scopée (RLS
  // via getServerClient).
  const { data: hexD } = await pCommentaires; // lancée d'entrée
  const commentaires: Record<string, string> = {};
  for (const r of hexD ?? []) {
    const m = (r.motif ?? "").trim();
    if (m) commentaires[r.personne_id] = m;
  }

  // Heures de chacun au poste, pour le « PDF heures » : même résolution que la
  // TV et les Synthèses (src/lib/horaires.ts) — horaire spécifique du jour >
  // temps partiel > horaire standard du poste pour ce quart et ce jour. Bornées
  // aux postes du plan et aux personnes placées ce jour-là : petites lectures.
  const placesPoste = (plD ?? []).filter((r) => r.poste_id && posteIdsAffiches.includes(r.poste_id));
  const idsPlaces = [...new Set(placesPoste.map((r) => r.personne_id))];
  const [{ data: horD }, { data: tpD }, nuits, { data: hpD }] = await Promise.all([
    posteIdsAffiches.length
      ? supabase
          .from("horaire_poste")
          .select("poste_id, quart_code, jour, debut, fin, debut_apres_nuit, fin_apres_nuit")
          .in("poste_id", posteIdsAffiches)
          .eq("jour", dowLundi(jour))
          .returns<{ poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null; debut_apres_nuit: string | null; fin_apres_nuit: string | null }[]>()
      : { data: [] },
    idsPlaces.length
      ? supabase
          .from("personne")
          .select("id, tp_config")
          .in("id", idsPlaces)
          .eq("temps_partiel", true)
          .returns<{ id: string; tp_config: TpCfg | null }[]>()
      : { data: [] },
    // Horaires « après une nuit » (0087) : la ligne a-t-elle tourné de nuit la veille ?
    chargerNuitsAvant(supabase, profile.siteId, [jour]),
    // Horaires par place (0088).
    posteIdsAffiches.length
      ? supabase
          .from("horaire_place")
          .select("poste_id, quart_code, numero, debut, fin, debut_apres_nuit, fin_apres_nuit")
          .in("poste_id", posteIdsAffiches)
          .returns<{ poste_id: string; quart_code: string; numero: string; debut: string | null; fin: string | null; debut_apres_nuit: string | null; fin_apres_nuit: string | null }[]>()
      : { data: [] },
  ]);
  const placeMap = new Map<string, HorairePlace>();
  for (const h of hpD ?? []) placeMap.set(`${h.poste_id}:${h.quart_code}:${h.numero}`, { debut: h.debut, fin: h.fin, debutN: h.debut_apres_nuit, finN: h.fin_apres_nuit });
  const horMap = new Map<string, HM>();
  const apresNuitMap = new Map<string, HM>();
  for (const h of horD ?? []) {
    horMap.set(`${h.poste_id}:${h.quart_code}:${h.jour}`, { debut: h.debut, fin: h.fin });
    if (h.debut_apres_nuit || h.fin_apres_nuit)
      apresNuitMap.set(`${h.poste_id}:${h.quart_code}:${h.jour}`, { debut: h.debut_apres_nuit, fin: h.fin_apres_nuit });
  }
  const excMap = new Map<string, HM>();
  for (const e of hexD ?? []) excMap.set(`${e.personne_id}:${jour}`, { debut: e.debut, fin: e.fin });
  const tpCfgMap = new Map<string, TpCfg>();
  for (const r of tpD ?? []) if (r.tp_config) tpCfgMap.set(r.id, r.tp_config);
  const heures: Record<string, string> = {};
  for (const r of placesPoste) {
    const h = horaireTxt({ horMap, excMap, tpCfgMap, apresNuitMap, nuitAvant: nuits.parPoste, placeMap }, quarts, r.personne_id, r.poste_id!, r.quart_code, jour, r.numero_rotation);
    if (h) heures[r.personne_id] = h;
  }

  // Niveau de competence par (personne, poste) pour l'aide au placement.
  const matrice: Record<string, number> = {};
  for (const r of mat) matrice[`${r.personne_id}:${r.poste_id}`] = r.niveau_actuel;

  // Perimetre d'edition : ecriture complete (admin/ordo) -> tout ; chef -> son equipe.
  // Doit coller a ce qu'acceptent les API (cf. canWritePlacementData), sinon la
  // grille se croirait editable la ou l'enregistrement echouerait.
  const fullWrite = await pFullWrite;
  const chefTeams = new Set<string>();
  if (!fullWrite) {
    const { data: ct } = await pChefTeams; // lancée d'entrée (ignorée si écriture complète)
    for (const r of ct ?? []) chefTeams.add(r.equipe_id);
  }
  const persos = personnes.map((p) => ({
    id: p.id,
    nom: p.nom,
    prenom: p.prenom,
    equipe_id: p.equipe_id,
    atelier_id: p.atelier_id,
    type_contrat: p.type_contrat,
    couleur: equipes.find((e) => e.id === p.equipe_id)?.couleur ?? null,
    editable: fullWrite || (p.equipe_id ? chefTeams.has(p.equipe_id) : false),
  }));

  const quartLib: Record<string, string> = {};
  for (const q of quarts) quartLib[q.code] = q.libelle;

  // Équipes qui travaillent chaque quart ce jour-là : celles dont le quart est
  // FIXE, plus celle que la rotation datée y place cette semaine (A ou B).
  // Le filtre du panneau des noms s'appuie dessus — choisir « Matin » doit
  // remonter « Fixe matin » ET l'équipe qui tourne au matin, pas une seule des
  // deux comme le faisait l'ancien pré-filtre.
  const rotWeek = rotationForWeek(await pRotRefs, isoDate(mondayOf(new Date(jour + "T00:00"))));
  const parQuart = equipesParQuart(equipes, rotWeek);

  // Jours OUVERTS (quart actif) sur une fenêtre autour du jour affiché. Sert à la
  // navigation par jour du Placement : les flèches sautent les jours fermés, et le
  // calendrier grise ces jours. Depuis 2026-09-09, seule la fermeture du quart entier
  // (`jour_quart.actif = false`) grise un jour — une ligne fermée par Ordonnancement
  // laisse le jour navigable, avec ses lignes affichées et besoin à 0.
  // Bornée au quart -> ≤ 240 lignes : pas de fetchAll. RLS (getServerClient) borne
  // déjà au site courant.
  // (Fenêtre winStart / winEnd et lecture jqWin : lancées avec l'ouverture.)
  const atelierLigneIds = (lignesD ?? []).map((l) => l.id);
  const openDays: string[] = [];
  if (atelierLigneIds.length) {
    for (const r of jqWin ?? []) if (r.actif) openDays.push(r.jour);
    openDays.sort();
  }

  // Temps partiel du jour (mêmes règles métier que le Planning et l'affichage TV,
  // cf. src/app/planning/page.tsx) : une personne est « TP » (indisponible ce
  // jour) si sa journée est entièrement off, ou si son équipe travaille ce jour-là
  // le créneau qu'elle NE fait PAS (mi-temps une semaine sur deux, piloté par la
  // rotation datée + quart.creneau). Sert à la colonne « Absents / TP » du PDF.
  const isoDow = (iso: string) => { const d = new Date(iso + "T00:00").getDay(); return d === 0 ? 7 : d; };
  const cfgTpByPers = new Map<string, TpConf>();
  {
    const { data: tpP } = await pTpPeriodes; // lancée d'entrée
    const avecPeriode = new Set<string>();
    for (const r of tpP ?? []) {
      avecPeriode.add(r.personne_id);
      if (r.date_debut <= jour && (!r.date_fin || r.date_fin >= jour)) cfgTpByPers.set(r.personne_id, r.tp_config);
    }
    // Repli personne.tp_config (temps_partiel=true sans période datée).
    const { data: tpFb } = await pTpFallback; // lancée d'entrée
    for (const r of tpFb ?? []) if (!avecPeriode.has(r.id)) cfgTpByPers.set(r.id, r.tp_config);
  }
  const quartFixe = new Map(equipes.map((e) => [e.id, e.quart_fixe ?? null]));
  const quartCreneau = new Map(quarts.map((q) => [q.code, q.creneau]));
  const creneauDe = (q: string | null | undefined): "matin" | "aprem" | null => {
    const c = q ? quartCreneau.get(q) : null;
    return c === "matin" || c === "aprem" ? c : null;
  };
  const dowJour = String(isoDow(jour));
  const tpIds: string[] = [];
  for (const p of personnes) {
    const cfg = cfgTpByPers.get(p.id);
    if (!cfg) continue;
    const off = cfg.off?.[dowJour] ?? [];
    if (!off.length) continue;
    const journee = off.includes("matin") && off.includes("aprem");
    let eqCr = false;
    if (p.equipe_id) {
      const cr = creneauDe(quartFixe.get(p.equipe_id) ?? rotWeek[p.equipe_id] ?? null);
      eqCr = !!cr && off.includes(cr);
    }
    if (journee || eqCr) tpIds.push(p.id);
  }

  return (
    <div className="pagecol">
      <AppHeader role={profile.role} active="/placement" />
      <PlacementBoard
        key={`${atelierId}|${jour}|${quart}`}
        vueAbsences={vueAbsences}
        numeroInit={numeroInit}
        commentaires={commentaires}
        heures={heures}
        title={<PageTitle module="placement" style={{ fontSize: 20 }}>Placement</PageTitle>}
        jour={jour}
        quart={quart}
        atelierId={atelierId}
        ateliers={ateliers}
        equipes={equipes}
        quarts={quarts}
        quartLib={quartLib}
        groups={groups}
        personnes={persos}
        placeInit={placeInit}
        autreQuart={autreQuart}
        horsPlan={horsPlan}
        matrice={matrice}
        motifs={motifs.map((m) => ({ id: m.id, code: m.code_court, libelle: m.libelle, couleur: m.couleur, operateurs: m.visible_operateurs === true }))}
        equipesParQuart={parQuart}
        habPoste={habPoste}
        habComp={habComp}
        habPers={habPers}
        quartOuvert={quartOuvert}
        siteNom={site.nom}
        tpIds={tpIds}
        openDays={openDays}
        winStart={winStart}
        winEnd={winEnd}
        conducteurIds={conducteurIds}
        agenceCodes={await pTypesAgence}
        quartBandeau={<QuartBandeau quart={quart} quarts={quarts} />}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
