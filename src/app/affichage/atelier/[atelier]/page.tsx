import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";
import { fetchAll } from "@/lib/fetch-all";
import { getQuartsC, getRotationRefsC } from "@/lib/refdata";
import { rotationForWeek } from "@/lib/rotation";
import { quartOuDefaut } from "@/lib/quarts";
import { INTERIM_BG } from "@/lib/interim";
import { isoDate, joursAutour, parseJour, mondayOf } from "@/lib/week";
import { getFenetreAffichage } from "@/lib/parametres";
import AutoRefresh from "@/components/AutoRefresh";
import AffichageBarre from "./AffichageBarre";

export const dynamic = "force-dynamic";

type Atelier = { id: string; nom: string };
type Personne = { nom: string; prenom: string; type_contrat: string };
type PlacementRow = {
  poste_id: string | null;
  jour: string;
  quart_code: string | null;
  personne_id: string;
};
type HoraireRow = { poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null };

const dow = (iso: string) => (new Date(iso + "T00:00").getDay() + 6) % 7;
const isoDow = (iso: string) => {
  const d = new Date(iso + "T00:00").getDay();
  return d === 0 ? 7 : d; // 1=lundi .. 7=dimanche (cle tp_config)
};

export default async function AffichageAtelier({
  params,
  searchParams,
}: {
  params: Promise<{ atelier: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { atelier: param } = await params;
  const sp = await searchParams;
  // Fenetre glissante autour d'aujourd'hui, dont les bornes sont reglees dans
  // Param. RH (jours_avant / jours_apres). Un ecran de couloir sert a savoir ce
  // qui vient, pas a relire le lundi passe.
  // `?date` deplace le pivot (sans recalage sur le lundi).
  const { jours_avant, jours_apres } = await getFenetreAffichage();
  const days = joursAutour(parseJour(sp.date), jours_avant, jours_apres);
  const isos = days.map((d) => d.iso);
  const todayIso = isoDate(new Date());

  const admin = getAdminClient();
  // Multi-tenant : nom d'usine affiche en haut a droite pour qu'un ecran
  // couloir d'un site ne puisse pas etre confondu avec celui d'un autre.
  const site = await getCurrentSite();
  // Liste des quarts du parametrage : sert de repli aux placements historiques
  // sans `quart_code` (cf. src/lib/quarts.ts).
  const quarts = await getQuartsC();

  // MULTI-SITE : borne par site_id (service_role bypass la RLS). Sans
  // cela un atelier d'un autre site pourrait être matché par nom
  // identique et son placement affiché ici.
  const { data: ateliers } = await admin
    .from("atelier")
    .select("id, nom")
    .eq("site_id", site.id)
    .returns<Atelier[]>();
  const decoded = decodeURIComponent(param).toLowerCase();
  const atelier = (ateliers ?? []).find((a) => a.id === param || a.nom.toLowerCase() === decoded);

  if (!atelier) {
    return (
      <div className="container">
        <h1>Atelier introuvable</h1>
        <p className="muted">Vérifiez l&apos;URL (/affichage).</p>
      </div>
    );
  }
  const atelierNomById = new Map((ateliers ?? []).map((a) => [a.id, a.nom]));

  const { data: lignesD } = await admin
    .from("ligne")
    .select("id, nom, ordre_affichage, poste(id, nom, ordre_affichage, actif)")
    .eq("site_id", site.id)
    .eq("atelier_id", atelier.id)
    .eq("actif", true)
    .returns<{ id: string; nom: string; ordre_affichage: number; poste: { id: string; nom: string; ordre_affichage: number; actif: boolean }[] }[]>();

  // Ordre d'affichage parametrable (ordre_affichage croissant, puis nom).
  const byOrdre = <T extends { ordre_affichage?: number; nom: string }>(a: T, b: T) =>
    (a.ordre_affichage ?? 0) - (b.ordre_affichage ?? 0) || a.nom.localeCompare(b.nom);
  const lignes = (lignesD ?? [])
    .map((l) => ({
      ...l,
      poste: [...(l.poste ?? [])].filter((p) => p.actif).sort(byOrdre),
    }))
    .filter((l) => l.poste.length > 0)
    .sort(byOrdre);
  const posteIds = lignes.flatMap((l) => l.poste.map((p) => p.id)); // postes de CET atelier

  // Carte GLOBALE poste -> { nom, ligne, atelier } sur tout le site : une personne
  // de cet atelier peut être prêtée à un poste d'un AUTRE atelier ; on doit alors
  // savoir le nommer et l'annoter « (Atelier X) ». Bornée au site (service_role).
  const { data: lignesSite } = await admin
    .from("ligne")
    .select("id, atelier_id, poste(id, nom, actif)")
    .eq("site_id", site.id)
    .returns<{ id: string; atelier_id: string; poste: { id: string; nom: string; actif: boolean }[] }[]>();
  const posteInfo = new Map<string, { nom: string; ligneId: string; atelierId: string; actif: boolean }>();
  for (const l of lignesSite ?? []) for (const p of l.poste ?? []) posteInfo.set(p.id, { nom: p.nom, ligneId: l.id, atelierId: l.atelier_id, actif: p.actif });

  // ROSTER de base : personnes dont l'atelier D'AFFECTATION est celui-ci. Une
  // personne rattachée n'apparaît que sur SON atelier, une seule fois, même les
  // jours de prêt (annotés en cellule). Les personnes d'un AUTRE atelier prêtées
  // ici n'y figurent pas — SAUF les personnes SANS atelier d'affectation
  // (`atelier_id` null), qui n'ont pas d'écran maison : elles restent sur leur
  // atelier de PLACEMENT (ajoutées dans le bloc ci-dessous depuis les placements
  // sur les postes de cet atelier).
  const { data: rosterD } = await admin
    .from("personne")
    .select("id, nom, prenom, type_contrat")
    .eq("site_id", site.id)
    .eq("atelier_id", atelier.id)
    .returns<(Personne & { id: string })[]>();
  const displayById = new Map<string, Personne>();
  for (const p of rosterD ?? []) displayById.set(p.id, { nom: p.nom, prenom: p.prenom, type_contrat: p.type_contrat });

  const horMap = new Map<string, { debut: string | null; fin: string | null }>(); // `${poste}:${quart}:${dow}`
  const excMap = new Map<string, { debut: string | null; fin: string | null; motif: string | null }>(); // `${personne}:${iso}` (horaire specifique + commentaire)
  type TpHM = Record<string, { debut: string; fin: string }>;
  type TpCfg = { demi?: { source?: string; matin?: TpHM; aprem?: TpHM }; horaires?: TpHM };
  const tpCfgMap = new Map<string, TpCfg>(); // personne_id -> tp_config (temps partiel)
  const actMap = new Map<string, boolean>(); // `${quart}:${iso}`
  const ouvMap = new Map<string, boolean>(); // `${quart}:${ligne}:${iso}`
  const byPerson = new Map<string, PlacementRow[]>(); // `${personne_id}:${iso}`
  const openDays = new Set<string>();   // jours (iso) ouverts par l Ordonnancement
  const tpSet = new Set<string>();      // `${personne_id}:${iso}` bloque par temps partiel

  if (posteIds.length) {
    // Personnes SANS atelier d'affectation placées ICI : pas d'écran maison, on
    // les garde sur leur atelier de placement. On lit les placements sur les
    // postes de CET atelier et on retient celles dont personne.atelier_id est null.
    type PlHere = { personne_id: string; personne: { atelier_id: string | null; nom: string; prenom: string; type_contrat: string } | null };
    const plHere = await fetchAll<PlHere>(() =>
      admin
        .from("placement")
        .select("personne_id, personne:personne_id(atelier_id, nom, prenom, type_contrat)")
        .eq("site_id", site.id)
        .in("jour", isos)
        .in("poste_id", posteIds)
        .not("poste_id", "is", null)
        .order("id")
        .returns<PlHere[]>()
    );
    for (const r of plHere) {
      const p = r.personne;
      if (p && p.atelier_id === null && !displayById.has(r.personne_id)) {
        displayById.set(r.personne_id, { nom: p.nom, prenom: p.prenom, type_contrat: p.type_contrat });
      }
    }
    const displayIds = [...displayById.keys()];

    // Placements des personnes affichées, TOUS postes confondus (y compris ceux
    // d'un autre atelier — le prêt). Borné aux `displayIds`, donc petit. fetchAll
    // + `.order("id")` : L8 (troncature silencieuse au-delà de 1000 lignes).
    const pl = displayIds.length
      ? await fetchAll<PlacementRow>(() =>
          admin
            .from("placement")
            .select("poste_id, jour, quart_code, personne_id")
            .eq("site_id", site.id)
            .in("jour", isos)
            .in("personne_id", displayIds)
            .not("poste_id", "is", null)
            .order("id")
            .returns<PlacementRow[]>()
        )
      : [];
    // Postes concernés par les horaires : ceux de l'atelier + ceux où quelqu'un
    // est prêté. On ne charge les horaires standards que pour ceux-là.
    const involved = new Set<string>(posteIds);
    for (const r of pl) if (r.poste_id) involved.add(r.poste_id);

    // Les autres lectures couvrent une SEMAINE ENTIERE, tous quarts confondus, et
    // peuvent dépasser 1000 lignes (cf. L8) → fetchAll avec `.order()` déterministe
    // (`horaire_poste` et `ouverture_quart` n'ont pas d'`id`, on trie sur la clé
    // composite). Écran non surveillé : une troncature y afficherait des horaires
    // faux ou des postes manquants sans que personne ne s'en aperçoive.
    const [hor, { data: jq }, ov, { data: exc }, { data: tpH }] = await Promise.all([
      fetchAll<HoraireRow>(() =>
        admin
          .from("horaire_poste")
          .select("poste_id, quart_code, jour, debut, fin")
          .eq("site_id", site.id)
          .in("poste_id", [...involved])
          .order("poste_id").order("quart_code").order("jour")
          .returns<HoraireRow[]>()
      ),
      // MULTI-SITE : jour_quart, ouverture_quart, horaire_exception et la liste
      // des personnes TP sont bornés par site_id — le service_role bypass la RLS.
      admin
        .from("jour_quart")
        .select("jour, quart_code, actif")
        .eq("site_id", site.id)
        .in("jour", isos)
        .returns<{ jour: string; quart_code: string; actif: boolean }[]>(),
      fetchAll<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }>(() =>
        admin
          .from("ouverture_quart")
          .select("jour, ligne_id, quart_code, ouverte")
          .eq("site_id", site.id)
          .in("jour", isos)
          .order("jour").order("ligne_id").order("quart_code")
          .returns<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }[]>()
      ),
      admin
        .from("horaire_exception")
        .select("personne_id, jour, debut, fin, motif")
        .eq("site_id", site.id)
        .in("jour", isos)
        .returns<{ personne_id: string; jour: string; debut: string | null; fin: string | null; motif: string | null }[]>(),
      admin
        .from("personne")
        .select("id, tp_config, equipe_id")
        .eq("site_id", site.id)
        .eq("temps_partiel", true)
        .returns<{ id: string; tp_config: TpCfg | null; equipe_id: string | null }[]>(),
    ]);
    for (const h of hor) horMap.set(`${h.poste_id}:${h.quart_code}:${h.jour}`, { debut: h.debut, fin: h.fin });
    for (const e of exc ?? []) excMap.set(`${e.personne_id}:${e.jour}`, { debut: e.debut, fin: e.fin, motif: e.motif });
    for (const r of tpH ?? []) if (r.tp_config) tpCfgMap.set(r.id, r.tp_config);
    // TP bloque : periodes datees (tp_periode, 0052) avec repli sur personne.tp_config.
    {
      const minIso = isos[0];
      const maxIso = isos[isos.length - 1];
      type TpPRow = { personne_id: string; date_debut: string; date_fin: string | null; tp_config: TpCfg | null; equipe_id: string | null };
      const { data: tpPeriodes } = await admin
        .from("tp_periode")
        .select("personne_id, date_debut, date_fin, tp_config, personne:personne_id(equipe_id)")
        .eq("site_id", site.id)
        .lte("date_debut", maxIso)
        .or(`date_fin.is.null,date_fin.gte.${minIso}`)
        .order("date_debut")
        .returns<(Omit<TpPRow, "equipe_id"> & { personne: { equipe_id: string | null } | null })[]>();
      // Index par personne.
      const periodesByPers = new Map<string, { date_debut: string; date_fin: string | null; tp_config: TpCfg | null }[]>();
      const tpEquipe = new Map<string, string | null>();
      for (const r of tpPeriodes ?? []) {
        (periodesByPers.get(r.personne_id) ?? periodesByPers.set(r.personne_id, []).get(r.personne_id)!).push(r);
        if (r.personne?.equipe_id) tpEquipe.set(r.personne_id, r.personne.equipe_id);
      }
      // Repli : personnes avec temps_partiel=true mais sans tp_periode.
      for (const r of tpH ?? []) {
        if (!periodesByPers.has(r.id) && r.tp_config) {
          tpEquipe.set(r.id, r.equipe_id);
          // Créer une fausse période couvrant toute la plage.
          periodesByPers.set(r.id, [{ date_debut: "2000-01-01", date_fin: null, tp_config: r.tp_config }]);
        }
      }

      const rotRefs = await getRotationRefsC();
      const { data: equipesD } = await admin
        .from("equipe")
        .select("id, quart_fixe")
        .eq("site_id", site.id)
        .eq("actif", true)
        .returns<{ id: string; quart_fixe: string | null }[]>();
      const quartFixe = new Map((equipesD ?? []).map((e) => [e.id, e.quart_fixe]));
      const mondaySet = new Set(isos.map((iso) => isoDate(mondayOf(new Date(iso + "T00:00")))));
      const rotByMonday = new Map<string, Record<string, string>>();
      for (const m of mondaySet) rotByMonday.set(m, rotationForWeek(rotRefs, m));
      const creneauDe = (q?: string | null) => (q === "matin" ? "matin" : q === "apres_midi" ? "aprem" : null);

      for (const [persId, periodes] of periodesByPers) {
        const eq = tpEquipe.get(persId) ?? null;
        for (const iso of isos) {
          // Trouver la période applicable pour ce jour.
          const per = periodes.find((p) => p.date_debut <= iso && (!p.date_fin || p.date_fin >= iso));
          if (!per?.tp_config) continue;
          const offCfg = (per.tp_config as { off?: Record<string, string[]> }).off ?? {};
          const dayOff = offCfg[String(isoDow(iso))] ?? [];
          if (!dayOff.length) continue;
          const journee = dayOff.includes("matin") && dayOff.includes("aprem");
          let equipeCreneau = false;
          if (eq) {
            const mon = isoDate(mondayOf(new Date(iso + "T00:00")));
            const rot = rotByMonday.get(mon) ?? {};
            const teamQuart = quartFixe.get(eq) ?? rot[eq] ?? null;
            const cr = creneauDe(teamQuart);
            equipeCreneau = !!cr && dayOff.includes(cr);
          }
          if (journee || equipeCreneau) tpSet.add(`${persId}:${iso}`);
        }
      }
    }
    for (const r of jq ?? []) actMap.set(`${r.quart_code}:${r.jour}`, r.actif);
    for (const r of ov) ouvMap.set(`${r.quart_code}:${r.ligne_id}:${r.jour}`, r.ouverte);

    // Une cellule est affichee seulement si la ligne est ouverte ce jour-la pour ce
    // quart (coherent avec le planning / l'ordonnancement).
    const isOpen = (ligneId: string, quart: string, iso: string) => {
      const a = actMap.has(`${quart}:${iso}`) ? actMap.get(`${quart}:${iso}`)! : false;
      if (!a) return false;
      const k = `${quart}:${ligneId}:${iso}`;
      return ouvMap.has(k) ? ouvMap.get(k)! : true;
    };

    // Jours OUVERTS au sens de l'Ordonnancement : au moins une ligne de cet
    // atelier ouverte sur au moins un quart. C'est ce qui decide des colonnes
    // affichees — auparavant on ne gardait que les jours ou quelqu'un etait deja
    // PLACE, si bien qu'une journee ouverte mais pas encore remplie disparaissait.
    for (const iso of isos) {
      for (const q of quarts) {
        if (lignes.some((l) => isOpen(l.id, q.code, iso))) {
          openDays.add(iso);
          break;
        }
      }
    }

    for (const r of pl) {
      if (!r.poste_id) continue;
      const info = posteInfo.get(r.poste_id);
      if (info && !info.actif) continue; // poste desactive : ne pas ressortir un placement residuel
      const qc = quartOuDefaut(r.quart_code, quarts);
      if (info && !isOpen(info.ligneId, qc, r.jour)) continue; // jour/ligne ferme -> on n'affiche pas
      const pk = `${r.personne_id}:${r.jour}`;
      (byPerson.get(pk) ?? byPerson.set(pk, []).get(pk)!).push(r);
    }
  }

  // Personnes affichées, orphelins compris (découverts dans le bloc ci-dessus).
  const personIds = [...displayById.keys()];

  // Absences (tous motifs) des personnes affichées -> une simple mention "Absence"
  // (pas de detail du motif). fetchAll : L8 (troncature silencieuse > 1000 lignes).
  const absByPerson = new Map<string, Set<string>>(); // personne_id -> jours (iso) absents
  if (personIds.length) {
    const absPl = await fetchAll<{ personne_id: string; jour: string }>(() =>
      admin
        .from("placement")
        .select("personne_id, jour")
        .eq("site_id", site.id)
        .in("jour", isos)
        .in("personne_id", personIds)
        .not("motif_absence_id", "is", null)
        .order("id")
        .returns<{ personne_id: string; jour: string }[]>()
    );
    for (const r of absPl) {
      (absByPerson.get(r.personne_id) ?? absByPerson.set(r.personne_id, new Set()).get(r.personne_id)!).add(r.jour);
    }
  }

  const horaireTxt = (personId: string, posteId: string, quartCode: string | null, iso: string) => {
    const q = quartOuDefaut(quartCode, quarts);
    const std = horMap.get(`${posteId}:${q}:${dow(iso)}`);
    const ex = excMap.get(`${personId}:${iso}`);
    // Temps partiel : demi-journee a horaires saisis (selon le quart du placement),
    // sinon horaires "journee entiere". Par jour de semaine (1=lundi..7=dimanche).
    const cfg = tpCfgMap.get(personId);
    let tpHor: { debut?: string; fin?: string } | undefined;
    if (cfg) {
      const d = String(isoDow(iso));
      // ⚠️ Couplage assume : `tp_config` stocke ses demi-journees sous les clefs
      // « matin » / « aprem », qui se trouvent porter les memes noms que deux
      // codes de quart. Ce n'est PAS le meme vocabulaire (un creneau de
      // demi-journee n'est pas un quart), mais la correspondance est ecrite ici
      // en dur. Un site dont les quarts porteraient d'autres codes n'aurait pas
      // d'horaires de temps partiel par demi-journee — repli silencieux, sans
      // casse. A traiter avec le modele de `tp_config`, pas avec les quarts.
      if (cfg.demi?.source === "horaires") {
        if (q === "matin") tpHor = cfg.demi.matin?.[d];
        else if (q === "apres_midi") tpHor = cfg.demi.aprem?.[d];
      }
      if (!tpHor && cfg.horaires) tpHor = cfg.horaires[d];
    }
    // Priorite : exception ponctuelle > horaires TP > horaire standard du poste.
    // ⚠️ La priorite porte sur la SOURCE, pas sur chaque borne prise a part.
    // Resoudre `debut` et `fin` independamment recomposait un horaire qui n'a
    // jamais ete saisi nulle part : une exception renseignee cote debut seul
    // donnait « debut de l'exception – fin du poste ». On choisit la premiere
    // source qui dit quelque chose, puis on lui prend ses deux bornes.
    const renseigne = (h?: { debut?: string | null; fin?: string | null } | null) => !!(h && (h.debut || h.fin));
    const source = renseigne(ex) ? ex : renseigne(tpHor) ? tpHor : std;
    const debut = source?.debut || null;
    const fin = source?.fin || null;
    if (!debut && !fin) return "";
    return `${debut ?? "?"}-${fin ?? "?"}`;
  };

  // Commentaire de l'horaire specifique (saisi dans le planning), affiche sous l'horaire.
  const commentTxt = (personId: string, iso: string) => (excMap.get(`${personId}:${iso}`)?.motif || "").trim();

  // Le jour courant passe du jaune au VERT : le jaune est désormais réservé aux
  // intérimaires, sur tous les écrans (cf. src/lib/interim.ts). Le vert, libéré
  // par l'intérim, sert donc à marquer « aujourd'hui ».
  const AUJOURDHUI = "#86efac"; // vert 300, franc sur le fond blanc de la TV
  const colBg = (iso: string) => (iso === todayIso ? AUJOURDHUI : undefined);
  const cellBorder = "1px solid #d9dce1";

  // Cellule vue "par nom" : sur quel poste cette personne est placee ce jour-la.
  // Poste d'un AUTRE atelier -> annotation « (Atelier X) » sous le nom du poste.
  const cellNom = (personId: string, iso: string) => {
    const rows = byPerson.get(`${personId}:${iso}`) ?? [];
    if (!rows.length) {
      // Aucune affectation poste : priorite absence > TP > vide.
      if (absByPerson.get(personId)?.has(iso)) {
        return <span style={{ color: "#b91c1c" }}>Absence</span>;
      }
      if (tpSet.has(`${personId}:${iso}`)) {
        return <span style={{ color: "#3730a3" }}>TP</span>;
      }
      return <span style={{ color: "#cbd5e1" }}>—</span>;
    }
    return rows.map((r, i) => {
      if (!r.poste_id) return null;
      const info = posteInfo.get(r.poste_id);
      const distant = info && info.atelierId !== atelier.id;
      const h = horaireTxt(personId, r.poste_id, r.quart_code, iso);
      const cmt = commentTxt(personId, iso);
      return (
        <div key={i} style={{ lineHeight: 1.2, marginBottom: i < rows.length - 1 ? 6 : 0 }}>
          <div style={{ fontWeight: 600 }}>{info?.nom ?? "?"}</div>
          {distant && (
            <div style={{ color: "#b45309", fontStyle: "italic", fontSize: 12 }}>
              (Atelier {atelierNomById.get(info!.atelierId) ?? "?"})
            </div>
          )}
          {h && <div style={{ color: "#1d4ed8", fontSize: 13 }}>{h}</div>}
          {cmt && <div style={{ color: "#6b7280", fontStyle: "italic", fontSize: 12 }}>{cmt}</div>}
        </div>
      );
    });
  };

  // Colonnes affichees : les jours OUVERTS par l'Ordonnancement (même vides — une
  // journée ouverte doit se voir), PLUS les jours où au moins une personne
  // affichée est placée. Ce second terme fait apparaître la feuille même quand
  // l'atelier maison est FERMÉ ce jour-là mais que des gens sont prêtés ailleurs.
  const placementDays = new Set<string>();
  for (const k of byPerson.keys()) placementDays.add(k.slice(k.indexOf(":") + 1));
  const shownDays = days.filter((d) => openDays.has(d.iso) || placementDays.has(d.iso));
  const noWork = shownDays.length === 0;

  // Liste des lignes : personnes de l'atelier ayant une activité sur les jours
  // affichés (placement ici ou ailleurs, absence, ou TP). On ALLÈGE l'écran en
  // retirant celles absentes sur TOUTE la période — inutile d'occuper une ligne
  // pour un mur d'« Absence ». Une absence partielle reste visible.
  const aUnPlacement = (id: string) => shownDays.some((d) => (byPerson.get(`${id}:${d.iso}`)?.length ?? 0) > 0);
  const aUneAbsence = (id: string) => shownDays.some((d) => absByPerson.get(id)?.has(d.iso));
  const aUnTp = (id: string) => shownDays.some((d) => tpSet.has(`${id}:${d.iso}`));
  const absentToutePeriode = (id: string) =>
    !noWork && !aUnPlacement(id) && shownDays.every((d) => absByPerson.get(id)?.has(d.iso));

  const personList = personIds
    .filter((id) => (aUnPlacement(id) || aUneAbsence(id) || aUnTp(id)) && !absentToutePeriode(id))
    .map((id) => ({ id, ...displayById.get(id)! }))
    .sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));

  return (
    // Deux boites imbriquees pour l'impression : `affichage-feuille` est le cadre,
    // borne a UNE page A3 verticale ; `affichage-contenu` porte la mise a l'echelle
    // mesuree par AffichageBarre. A l'ecran, elles sont transparentes.
    <div id="affichage-feuille" style={{ padding: "18px 24px" }}>
      <AutoRefresh seconds={300} />
      <div id="affichage-contenu" style={{ transformOrigin: "top left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>{atelier.nom}</h1>
          <span style={{ fontSize: 16, color: "#6b7280", fontWeight: 500 }}>{site.nom}</span>
        </div>
        <AffichageBarre cadreId="affichage-feuille" contenuId="affichage-contenu" />
      </div>

      {noWork ? (
        <p className="muted" style={{ fontSize: 18, padding: 20 }}>
          Aucun jour ouvert dans cet atelier sur la période affichée (J-1 à J+4).
          Vérifiez l’ouverture des lignes dans Ordonnancement.
        </p>
      ) : (
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: 260, border: cellBorder, background: "#1e3a8a", color: "#fff", padding: "8px 10px" }}></th>
            {shownDays.map((d) => (
              <th
                key={d.iso}
                style={{
                  border: cellBorder,
                  padding: "8px 6px",
                  textAlign: "center",
                  fontSize: 20,
                  background: colBg(d.iso) ?? "#1e3a8a",
                  color: d.iso === todayIso ? "#000" : "#fff",
                }}
              >
                {d.nom}
                <div style={{ fontSize: 14, fontWeight: 400 }}>{d.num}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {            personList.map((p) => {
              const interim = p.type_contrat === "INTERIM";
              return (
                <tr key={p.id}>
                  <td style={{ border: cellBorder, padding: "5px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    <span style={{ background: interim ? INTERIM_BG : undefined, padding: interim ? "0 4px" : 0, borderRadius: 3 }}>
                      {p.nom} {p.prenom}
                    </span>
                  </td>
                  {shownDays.map((d) => (
                    <td key={d.iso} style={{ border: cellBorder, padding: "4px 6px", verticalAlign: "top", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {cellNom(p.id, d.iso)}
                    </td>
                  ))}
                </tr>
              );
            })}

          {personList.length === 0 && (
            <tr>
              <td colSpan={shownDays.length + 1} className="muted" style={{ padding: 10 }}>Aucune affectation sur la période affichée.</td>
            </tr>
          )}
        </tbody>
      </table>
      )}

      <div style={{ marginTop: 14, fontSize: 14, color: "#6b7280" }}>
        Légende : <span style={{ background: INTERIM_BG, padding: "0 6px" }}>Intérimaire</span>{" "}
        · <span style={{ background: AUJOURDHUI, padding: "0 6px" }}>Aujourd&apos;hui</span> · horaires en bleu ·{" "}
        <span style={{ color: "#b45309", fontStyle: "italic" }}>(Atelier X)</span> = prêté ·{" "}
        <span style={{ color: "#b91c1c" }}>Absence</span>{" "}
        · <span style={{ color: "#3730a3" }}>TP</span> (temps partiel){" "}
        · mise à jour auto toutes les 5 min.
      </div>
      </div>
    </div>
  );
}
