import { getServerClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import { requireModule, canWritePlacementData } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { quartParDefaut, quartOuDefaut, memeQuart } from "@/lib/quarts";
import { chargerPosteQuart, tourneSurQuart, effectifSurQuart } from "@/lib/poste-quart";
import { isoDate, mondayOf, addDays } from "@/lib/week";
import { getRotationRefsC } from "@/lib/refdata";
import { rotationForWeek, equipesParQuart } from "@/lib/rotation";
import { addMonthsIso } from "@/lib/habilitations";
import { estAuTravailLe, deriverArriveeDepart } from "@/lib/personne-statut";
import PlacementBoard from "./PlacementBoard";
import QuartBandeau from "../planning/QuartBandeau";

type Atelier = { id: string; nom: string };
type Equipe = { id: string; nom: string; couleur: string | null; quart_fixe?: string | null };
type Quart = { code: string; libelle: string; ordre: number; creneau: string | null; couleur?: string | null };
type Personne = { id: string; nom: string; prenom: string; equipe_id: string | null; atelier_id: string | null; type_contrat: string };
type PosteRow = { id: string; nom: string; nom_court: string | null; actif: boolean; effectif_requis: number; niveau_min_requis: number; ordre_affichage: number; numero_rotation: string | null };
type LigneRow = { id: string; nom: string; ordre_affichage: number; atelier_id: string; poste: PosteRow[] };
type Placement = { personne_id: string; poste_id: string | null; motif_absence_id: string | null; non_travaille: boolean; quart_code: string | null; numero_rotation: string | null };
type MatRow = { personne_id: string; poste_id: string; niveau_actuel: number };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };
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

  const [{ data: ateliersD }, { data: equipesD }, { data: quartsD, error: quartsErr }, { data: persD }, { data: motifsD }] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<Atelier[]>(),
    supabase.from("equipe").select("id, nom, couleur, quart_fixe").eq("actif", true).order("nom").returns<Equipe[]>(),
    // Migration 0068 : la colonne `couleur` peut ne pas encore exister — repli
    // silencieux plus bas (relecture sans `couleur`) pour ne pas planter la page.
    supabase.from("quart").select("code, libelle, ordre, creneau, couleur").order("ordre").returns<Quart[]>(),
    supabase.from("personne").select("id, nom, prenom, equipe_id, atelier_id, type_contrat").in("statut", ["ACTIF", "A_VENIR"]).order("nom").returns<Personne[]>(),
    supabase.from("motif_absence").select("id, code_court, libelle, couleur").eq("actif", true).order("libelle").returns<Motif[]>(),
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
    const { data: cpD } = await supabase
      .from("contrat_periode")
      .select("personne_id, date_debut, date_fin")
      .in("personne_id", idsPourContrat)
      .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>();
    for (const r of cpD ?? []) {
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
    const rows = await fetchAll<{ personne_id: string }>(() =>
      supabase
        .from("matrice")
        .select("personne_id, poste!inner(categorie, actif)")
        .eq("poste.categorie", "conducteur")
        .eq("poste.actif", true)
        .gte("niveau_actuel", 1)
        .order("id")
        .returns<{ personne_id: string }[]>()
    );
    const uniq = new Set<string>();
    for (const r of rows) uniq.add(r.personne_id);
    conducteurIds.push(...uniq);
  }

  const quart = sp.quart && quartCodes.includes(sp.quart) ? sp.quart : quartParDefaut(quarts);
  // Bascule Plan / Absences portee par ?vue : l'atelier reste selectionne dans les
  // deux cas, c'est lui qui filtre les absences affichees.
  const vueAbsences = sp.vue === "absences";
  const atelierId = ateliers.find((a) => a.id === sp.atelier)?.id ?? ateliers[0]?.id ?? "";

  // Postes de l'atelier + desactivations poste x quart + placements du jour + matrice.
  const [{ data: lignesD }, pq, { data: plD }, mat] = await Promise.all([
    atelierId
      ? supabase
          .from("ligne")
          .select("id, nom, ordre_affichage, atelier_id, poste(id, nom, nom_court, actif, effectif_requis, niveau_min_requis, ordre_affichage, numero_rotation)")
          .eq("atelier_id", atelierId)
          .eq("actif", true)
          .order("nom")
          .returns<LigneRow[]>()
      : Promise.resolve({ data: [] as LigneRow[] }),
    chargerPosteQuart(supabase),
    supabase.from("placement").select("personne_id, poste_id, motif_absence_id, non_travaille, quart_code, numero_rotation").eq("jour", jour).returns<Placement[]>(),
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
  ]);

  // Ouverture des lignes decidee dans l'Ordonnancement, pour ce jour et ce quart.
  // Memes regles que le Planning (cf. src/app/planning/page.tsx) : un quart sans
  // ligne dans `jour_quart` est FERME (rien n'est ouvert tant que la semaine n'a pas
  // ete initialisee) ; une ligne sans ligne dans `ouverture_quart` est ouverte.
  // Pas de fetchAll ici, contrairement au Planning et a l'affichage TV : la
  // lecture porte sur UN jour et UN quart, elle est donc bornee au nombre de
  // lignes de production (une vingtaine). Il faudrait 1000 lignes pour atteindre
  // le plafond PostgREST. Si cette requete est un jour elargie a une semaine,
  // il faudra la passer par fetchAll (cf. L8).
  const [{ data: ouvD }, { data: jqD }] = await Promise.all([
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
  ]);
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
    .map((l) => ({
      ligneId: l.id,
      ligneNom: l.nom,
      ligneOrdre: l.ordre_affichage ?? 0,
      fermee: !ligneOuverte(l.id), // ordonnancement : ligne fermée -> besoin 0
      postes: [...(l.poste ?? [])]
        .filter((p) => p.actif && tourneSurQuart(pq, p.id, quart, p.effectif_requis))
        .sort(ordreThenNom)
        .map((p) => ({
          id: p.id,
          nom: p.nom,
          nomCourt: p.nom_court,
          effectifRequis: effectifSurQuart(pq, p.id, quart, p.effectif_requis),
          niveauMin: p.niveau_min_requis,
          numeroRotation: p.numero_rotation,
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

  // Niveau de competence par (personne, poste) pour l'aide au placement.
  const matrice: Record<string, number> = {};
  for (const r of mat) matrice[`${r.personne_id}:${r.poste_id}`] = r.niveau_actuel;

  // Perimetre d'edition : ecriture complete (admin/ordo) -> tout ; chef -> son equipe.
  // Doit coller a ce qu'acceptent les API (cf. canWritePlacementData), sinon la
  // grille se croirait editable la ou l'enregistrement echouerait.
  const fullWrite = await canWritePlacementData(profile.role);
  const chefTeams = new Set<string>();
  if (!fullWrite) {
    const { data: ct } = await supabase.from("equipe_chef").select("equipe_id").eq("app_user_id", profile.authId).returns<{ equipe_id: string }[]>();
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
  const rotWeek = rotationForWeek(await getRotationRefsC(), isoDate(mondayOf(new Date(jour + "T00:00"))));
  const parQuart = equipesParQuart(equipes, rotWeek);

  // Jours OUVERTS (quart actif) sur une fenêtre autour du jour affiché. Sert à la
  // navigation par jour du Placement : les flèches sautent les jours fermés, et le
  // calendrier grise ces jours. Depuis 2026-09-09, seule la fermeture du quart entier
  // (`jour_quart.actif = false`) grise un jour — une ligne fermée par Ordonnancement
  // laisse le jour navigable, avec ses lignes affichées et besoin à 0.
  // Bornée au quart -> ≤ 240 lignes : pas de fetchAll. RLS (getServerClient) borne
  // déjà au site courant.
  const winStart = isoDate(addDays(new Date(jour + "T00:00"), -90));
  const winEnd = isoDate(addDays(new Date(jour + "T00:00"), 150));
  const atelierLigneIds = (lignesD ?? []).map((l) => l.id);
  const openDays: string[] = [];
  if (atelierLigneIds.length) {
    const { data: jqWin } = await supabase
      .from("jour_quart")
      .select("jour, actif")
      .eq("quart_code", quart)
      .gte("jour", winStart)
      .lte("jour", winEnd)
      .returns<{ jour: string; actif: boolean }[]>();
    for (const r of jqWin ?? []) if (r.actif) openDays.push(r.jour);
    openDays.sort();
  }

  // Temps partiel du jour (mêmes règles métier que le Planning et l'affichage TV,
  // cf. src/app/planning/page.tsx) : une personne est « TP » (indisponible ce
  // jour) si sa journée est entièrement off, ou si son équipe travaille ce jour-là
  // le créneau qu'elle NE fait PAS (mi-temps une semaine sur deux, piloté par la
  // rotation datée + quart.creneau). Sert à la colonne « Absents / TP » du PDF.
  const isoDow = (iso: string) => { const d = new Date(iso + "T00:00").getDay(); return d === 0 ? 7 : d; };
  type TpConf = { off?: Record<string, string[]> } | null;
  const cfgTpByPers = new Map<string, TpConf>();
  {
    const { data: tpP } = await supabase
      .from("tp_periode")
      .select("personne_id, date_debut, date_fin, tp_config")
      .lte("date_debut", jour)
      .or(`date_fin.is.null,date_fin.gte.${jour}`)
      .returns<{ personne_id: string; date_debut: string; date_fin: string | null; tp_config: TpConf }[]>();
    const avecPeriode = new Set<string>();
    for (const r of tpP ?? []) {
      avecPeriode.add(r.personne_id);
      if (r.date_debut <= jour && (!r.date_fin || r.date_fin >= jour)) cfgTpByPers.set(r.personne_id, r.tp_config);
    }
    // Repli personne.tp_config (temps_partiel=true sans période datée).
    const { data: tpFb } = await supabase
      .from("personne")
      .select("id, tp_config")
      .eq("temps_partiel", true)
      .returns<{ id: string; tp_config: TpConf }[]>();
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
        matrice={matrice}
        motifs={motifs.map((m) => ({ id: m.id, code: m.code_court, libelle: m.libelle, couleur: m.couleur }))}
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
        quartBandeau={<QuartBandeau quart={quart} quarts={quarts} />}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
