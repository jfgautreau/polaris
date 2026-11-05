import type { ReactNode } from "react";
import { getAdminClient } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/fetch-all";
import { getRotationRefsC, getHorairesPosteC, getHorairesPlaceC } from "@/lib/refdata";
import { rotationForWeek } from "@/lib/rotation";
import { quartOuDefaut } from "@/lib/quarts";
import { horaireTxt as horaireTxtShared, type MapsHoraire, type HorairePlace } from "@/lib/horaires";
import { chargerNuitsAvant } from "@/lib/nuit-avant-data";
import { INTERIM_BG } from "@/lib/interim";
import { isoDate, isoWeekNumber, mondayOf, type Jour } from "@/lib/week";
import FeuillesImpression from "./FeuillesImpression";
import { FEUILLE_L, FEUILLE_H, ENTETE_H, PIED_H, ECART_H } from "./feuilles-impression";

type Atelier = { id: string; nom: string };
type Site = { id: string; nom: string };
type Quart = { code: string; libelle?: string; ordre?: number; creneau?: string | null };
type Personne = { nom: string; prenom: string; type_contrat: string };

// « Nouveau » à l'affichage (2026-11-05) : arrivé (début du 1er contrat, lu dans
// contrat_periode — personne n'a plus de colonne d'arrivée depuis 0050) depuis
// moins de 14 jours, ou arrivée à venir. Un intérimaire revenu avec un ancien
// contrat garde sa première arrivée : il n'est pas nouveau.
const NOUVEAU_JOURS = 14;
const NOUVEAU_COULEUR = "#1e40af";
type PlacementRow = {
  poste_id: string | null;
  jour: string;
  quart_code: string | null;
  personne_id: string;
  numero_rotation: string | null;
};
type HoraireRow = { poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null; debut_apres_nuit: string | null; fin_apres_nuit: string | null };

const isoDow = (iso: string) => {
  const d = new Date(iso + "T00:00").getDay();
  return d === 0 ? 7 : d; // 1=lundi .. 7=dimanche (cle tp_config)
};

// Contenu « affichage TV » d'UN atelier, sans le cadre d'impression ni l'auto-
// refresh : partagé entre l'écran TV live (`page.tsx`) et la page d'impression
// « tous les plannings » (`../../impression`). `actions` reçoit la barre
// (impression + logo) sur l'écran live ; vide sur la feuille imprimée.
export default async function AtelierPlanning({
  atelierRef,
  site,
  quarts,
  days,
  actions,
}: {
  atelierRef: string;
  site: Site;
  quarts: Quart[];
  days: Jour[];
  actions?: ReactNode;
}) {
  const isos = days.map((d) => d.iso);
  const todayIso = isoDate(new Date());

  const admin = getAdminClient();

  // MULTI-SITE : borne par site_id (service_role bypass la RLS). Sans
  // cela un atelier d'un autre site pourrait être matché par nom
  // identique et son placement affiché ici.
  const { data: ateliers } = await admin
    .from("atelier")
    .select("id, nom")
    .eq("site_id", site.id)
    .returns<Atelier[]>();
  const decoded = decodeURIComponent(atelierRef).toLowerCase();
  const atelier = (ateliers ?? []).find((a) => a.id === atelierRef || a.nom.toLowerCase() === decoded);

  if (!atelier) {
    return (
      <div className="container">
        <h1>Service introuvable</h1>
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

  // ROSTER (2026-11-05) : toute personne ayant au moins une affectation sur un
  // poste de CE service pendant la fenêtre, quel que soit son service à la fiche
  // Personnel — et elle seule. Quelqu'un du Condi affecté en FAB toute la semaine
  // n'apparaît qu'en FAB ; affecté aux deux, il figure sur les deux plannings.
  // Une personne sans aucune affectation (absente, non planifiée) n'est affichée
  // nulle part. Rempli plus bas depuis les placements.
  const displayById = new Map<string, Personne>();

  // Codes de contrat pilotés par agence (drapeau avec_agence, 0072) : surlignés en
  // jaune (intérim + CDI intérimaire…). Route publique → on ne passe pas par
  // getTypesAgenceC (cookie) mais par une requête bornée au site. Repli sur le
  // seul code INTERIM si la colonne n'existe pas encore.
  const { data: typesAg } = await admin
    .from("type_contrat")
    .select("code, avec_agence")
    .eq("site_id", site.id)
    .returns<{ code: string; avec_agence: boolean }[]>();
  const agenceSet = new Set<string>(["INTERIM"]);
  for (const t of typesAg ?? []) if (t.avec_agence) agenceSet.add(t.code);

  const horMap = new Map<string, { debut: string | null; fin: string | null }>(); // `${poste}:${quart}:${dow}`
  // Variante « après une nuit » (0087), même clé ; et la règle de nuit des lignes.
  const apresNuitMap = new Map<string, { debut: string | null; fin: string | null }>();
  // Horaires par place (0088), « poste:quart:numero ».
  const placeMap = new Map<string, HorairePlace>();
  const pNuits = chargerNuitsAvant(admin, site.id, isos);
  const excMap = new Map<string, { debut: string | null; fin: string | null; motif: string | null }>(); // `${personne}:${iso}` (horaire specifique + commentaire)
  type TpHM = Record<string, { debut: string; fin: string }>;
  type TpCfg = { demi?: { source?: string; matin?: TpHM; aprem?: TpHM }; horaires?: TpHM };
  const tpCfgMap = new Map<string, TpCfg>(); // personne_id -> tp_config (temps partiel)
  const actMap = new Map<string, boolean>(); // `${quart}:${iso}`
  const byPerson = new Map<string, PlacementRow[]>(); // `${personne_id}:${iso}`
  const openDays = new Set<string>();   // jours (iso) ouverts par l Ordonnancement
  const tpSet = new Set<string>();      // `${personne_id}:${iso}` bloque par temps partiel

  if (posteIds.length) {
    // Placements du site sur la fenêtre, avec le nom de la personne (une seule
    // lecture, sans liste d'ids dans l'URL — 2026-10-14). Sert à la fois au roster
    // (personnes affectées sur un poste de ce service) et aux cellules.
    type PlSite = PlacementRow & { personne: Personne | null };
    const plSite = await fetchAll<PlSite>(() =>
      admin
        .from("placement")
        .select("poste_id, jour, quart_code, personne_id, numero_rotation, personne:personne_id(nom, prenom, type_contrat)")
        .eq("site_id", site.id)
        .in("jour", isos)
        .not("poste_id", "is", null)
        .order("id")
        .returns<PlSite[]>()
    );
    // Postes concernés par les horaires : ceux de l'atelier + ceux où quelqu'un
    // est placé sur la fenêtre (filtre en mémoire sur le référentiel en cache).
    const involved = new Set<string>(posteIds);
    for (const r of plSite) if (r.poste_id) involved.add(r.poste_id);
    // Horaires (standard et par place) : référentiel en cache (refdata,
    // REFERENTIEL_TAG), bornés ici aux postes concernés — plus de liste dans l'URL.
    const pPlaces = getHorairesPlaceC().then((rows) => rows.filter((h) => involved.has(h.poste_id)));

    // Les autres lectures couvrent une SEMAINE ENTIERE, tous quarts confondus, et
    // peuvent dépasser 1000 lignes (cf. L8) → fetchAll avec `.order()` déterministe
    // (`horaire_poste` n'a pas d'`id`, on trie sur la clé composite). Écran non
    // surveillé : une troncature y afficherait des horaires faux ou des postes
    // manquants sans que personne ne s'en aperçoive.
    // NB : `ouverture_quart` n'est plus lu ici depuis 2026-09-09 — la TV n'utilise
    // plus la fermeture de ligne (qui pilote seulement le besoin dans Placement).
    const [hor, { data: jq }, { data: exc }, { data: tpH }] = await Promise.all([
      getHorairesPosteC().then((rows): HoraireRow[] => rows.filter((h) => involved.has(h.poste_id))),
      // MULTI-SITE : jour_quart, horaire_exception et la liste des personnes TP
      // sont bornés par site_id — le service_role bypass la RLS.
      admin
        .from("jour_quart")
        .select("jour, quart_code, actif")
        .eq("site_id", site.id)
        .in("jour", isos)
        .returns<{ jour: string; quart_code: string; actif: boolean }[]>(),
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
    for (const h of hor) {
      horMap.set(`${h.poste_id}:${h.quart_code}:${h.jour}`, { debut: h.debut, fin: h.fin });
      if (h.debut_apres_nuit || h.fin_apres_nuit)
        apresNuitMap.set(`${h.poste_id}:${h.quart_code}:${h.jour}`, { debut: h.debut_apres_nuit, fin: h.fin_apres_nuit });
    }
    for (const e of exc ?? []) excMap.set(`${e.personne_id}:${e.jour}`, { debut: e.debut, fin: e.fin, motif: e.motif });
  for (const h of await pPlaces) placeMap.set(`${h.poste_id}:${h.quart_code}:${h.numero}`, { debut: h.debut, fin: h.fin, debutN: h.debut_apres_nuit, finN: h.fin_apres_nuit });
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
      // Créneau (matin/aprem/null) d'un quart : lu sur la colonne `quart.creneau`,
      // JAMAIS déduit du code (à La Vraie Croix le code `apres_midi` porte le
      // créneau « matin » — deviner par le code inverserait les demi-journées TP).
      const creneauParCode = new Map(quarts.map((q) => [q.code, q.creneau ?? null]));
      const creneauDe = (q?: string | null): "matin" | "aprem" | null => {
        const c = q ? creneauParCode.get(q) : null;
        return c === "matin" || c === "aprem" ? c : null;
      };

      // TP MATÉRIALISÉS (migration 0064). Sur une semaine « chargée » (tp_charge),
      // le manager a pu DÉPLACER un jour de TP dans le Planning : on lit alors les
      // vraies lignes placement.tp au lieu de recalculer depuis tp_config. Repli
      // sur le calcul pour les semaines non chargées. Best-effort avant migration.
      const chargedMondays = new Set<string>();
      {
        const { data: tcD, error: tcErr } = await admin
          .from("tp_charge")
          .select("semaine_lundi")
          .eq("site_id", site.id)
          .in("semaine_lundi", [...mondaySet])
          .returns<{ semaine_lundi: string }[]>();
        if (!tcErr) for (const r of tcD ?? []) chargedMondays.add(r.semaine_lundi);
      }
      const jourCharge = (iso: string) => chargedMondays.has(isoDate(mondayOf(new Date(iso + "T00:00"))));
      if (chargedMondays.size) {
        const { data: tpReal, error: tpRealErr } = await admin
          .from("placement")
          .select("personne_id, jour")
          .eq("tp", true)
          .eq("site_id", site.id)
          .in("jour", isos)
          .returns<{ personne_id: string; jour: string }[]>();
        if (!tpRealErr) for (const r of tpReal ?? []) if (jourCharge(r.jour)) tpSet.add(`${r.personne_id}:${r.jour}`);
      }

      for (const [persId, periodes] of periodesByPers) {
        const eq = tpEquipe.get(persId) ?? null;
        for (const iso of isos) {
          // Semaine chargée : les vraies lignes placement.tp font foi (ci-dessus).
          if (jourCharge(iso)) continue;
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

    // Une cellule est affichée dès que le QUART est actif ce jour-là. Depuis
    // 2026-09-09, une ligne fermée par Ordonnancement (`ouverture_quart`) ne masque
    // plus le placement : sa fermeture ne joue que sur le compteur de besoin
    // (Planning / Placement), pas sur ce que voient les opérateurs à la TV. Sinon
    // un manager qui place quelqu'un sur une ligne fermée verrait la case remplie
    // dans Placement mais rien à l'écran de production — trou d'information.
    const isOpen = (_ligneId: string, quart: string, iso: string) =>
      actMap.has(`${quart}:${iso}`) ? actMap.get(`${quart}:${iso}`)! : false;

    // Jours OUVERTS : au moins un quart actif ce jour-là (jour_quart). Auparavant
    // conditionné à la présence d'une ligne ouverte — la nouvelle règle rend cette
    // condition inutile puisque toutes les lignes sont visibles quand le quart l'est.
    for (const iso of isos) {
      for (const q of quarts) {
        if (isOpen("", q.code, iso)) { openDays.add(iso); break; }
      }
    }

    // Index par personne et jour (tout le site : on ne sait qu'après qui est
    // affiché). Une personne affectée au moins une fois sur un poste de CE service
    // pendant la fenêtre forme le roster (2026-11-05), quel que soit son service
    // d'affectation : elle peut donc figurer sur deux plannings la même semaine.
    const posteIciSet = new Set(posteIds);
    for (const r of plSite) {
      if (!r.poste_id) continue;
      const info = posteInfo.get(r.poste_id);
      if (info && !info.actif) continue; // poste desactive : ne pas ressortir un placement residuel
      const qc = quartOuDefaut(r.quart_code, quarts);
      if (info && !isOpen(info.ligneId, qc, r.jour)) continue; // quart fermé ce jour -> on n'affiche pas
      const pk = `${r.personne_id}:${r.jour}`;
      (byPerson.get(pk) ?? byPerson.set(pk, []).get(pk)!).push(r);
      if (posteIciSet.has(r.poste_id) && r.personne && !displayById.has(r.personne_id)) {
        const p = r.personne;
        displayById.set(r.personne_id, { nom: p.nom, prenom: p.prenom, type_contrat: p.type_contrat });
      }
    }
  }

  // Personnes affichées, orphelins compris (découverts dans le bloc ci-dessus).
  const personIds = [...displayById.keys()];

  // Arrivée = plus ancien début de contrat (contrat_periode, seule source depuis
  // 0050). Lecture du site, sans liste d'ids dans l'URL ; fetchAll (> 1000 lignes).
  const pArrivees = fetchAll<{ personne_id: string; date_debut: string | null }>(() =>
    admin
      .from("contrat_periode")
      .select("personne_id, date_debut")
      .eq("site_id", site.id)
      .order("id")
      .returns<{ personne_id: string; date_debut: string | null }[]>()
  ).catch(() => [] as { personne_id: string; date_debut: string | null }[]); // signal secondaire : un échec ne casse pas l’écran

  // Absences (tous motifs) des personnes affichées -> une simple mention "Absence"
  // (pas de detail du motif). fetchAll : L8 (troncature silencieuse > 1000 lignes).
  const absByPerson = new Map<string, Set<string>>(); // personne_id -> jours (iso) absents
  if (personIds.length) {
    // Plus de liste des personnes dans l'URL (2026-10-14) : absences du site sur
    // la fenêtre, triées en mémoire.
    const personSet = new Set(personIds);
    const absPl = (
      await fetchAll<{ personne_id: string; jour: string }>(() =>
        admin
          .from("placement")
          .select("personne_id, jour")
          .eq("site_id", site.id)
          .in("jour", isos)
          .not("motif_absence_id", "is", null)
          .order("id")
          .returns<{ personne_id: string; jour: string }[]>()
      )
    ).filter((r) => personSet.has(r.personne_id));
    for (const r of absPl) {
      (absByPerson.get(r.personne_id) ?? absByPerson.set(r.personne_id, new Set()).get(r.personne_id)!).add(r.jour);
    }
  }

  // Resolution de l'horaire affiche : logique partagee avec la synthese interim
  // (`src/lib/horaires.ts`), pour que les deux ecrans ne divergent pas.
  const nuits = await pNuits;
  const mapsHoraire: MapsHoraire = { horMap, excMap, tpCfgMap, apresNuitMap, nuitAvant: nuits.parPoste, placeMap };
  const horaireTxt = (personId: string, posteId: string, quartCode: string | null, iso: string, numero?: string | null) =>
    horaireTxtShared(mapsHoraire, quarts, personId, posteId, quartCode, iso, numero);

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
      const h = horaireTxt(personId, r.poste_id, r.quart_code, iso, r.numero_rotation);
      const cmt = commentTxt(personId, iso);
      return (
        <div key={i} style={{ lineHeight: 1.2, marginBottom: i < rows.length - 1 ? 6 : 0 }}>
          <div style={{ fontWeight: 600 }}>{info?.nom ?? "?"}</div>
          {distant && (
            <div style={{ color: "#b45309", fontStyle: "italic", fontSize: 12 }}>
              (Service {atelierNomById.get(info!.atelierId) ?? "?"})
            </div>
          )}
          {h && <div style={{ color: "#1d4ed8", fontSize: 14 }}>{h}</div>}
          {cmt && <div style={{ color: "#6b7280", fontStyle: "italic", fontSize: 12 }}>{cmt}</div>}
        </div>
      );
    });
  };

  // Colonnes affichees : les jours OUVERTS par l'Ordonnancement (même vides — une
  // journée ouverte doit se voir), PLUS les jours où au moins une personne
  // affichée est placée. Ce second terme fait apparaître la feuille même quand
  // l'atelier maison est FERMÉ ce jour-là mais que des gens sont prêtés ailleurs.
  // `byPerson` couvre tout le site : seules comptent les personnes affichées.
  const placementDays = new Set<string>();
  for (const [k, rows] of byPerson) {
    if (rows.length && displayById.has(k.slice(0, k.indexOf(":")))) placementDays.add(k.slice(k.indexOf(":") + 1));
  }
  const shownDays = days.filter((d) => openDays.has(d.iso) || placementDays.has(d.iso));
  const noWork = shownDays.length === 0;

  // Liste des lignes : le roster entier — chacun y a au moins une affectation sur
  // un poste de ce service (cf. ROSTER). Les absences / TP des autres jours restent
  // visibles dans ses cases.
  const personList = personIds
    .map((id) => ({ id, ...displayById.get(id)! }))
    .sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));

  // Sections Matin / Après-midi / Nuit (2026-11-05) : une personne figure dans
  // CHAQUE section où elle a au moins une affectation sur un poste de ce service
  // pendant la fenêtre. En Matin lundi-mercredi puis Nuit jeudi-vendredi, elle est
  // donc sur la page Matin ET sur la page Nuit ; chaque ligne montre sa semaine
  // entière (poste + horaire, autres quarts compris).
  // Classe un quart en Matin / Après-midi / Nuit (sans code en dur) : créneau
  // matin/aprem = direct ; créneau null = soit la JOURNÉE (plein temps, plus petit
  // ordre parmi les quarts sans créneau → rangée en Matin car présente le matin),
  // soit la NUIT (les autres quarts sans créneau).
  const ordreJournee = Math.min(
    ...quarts.filter((q) => !q.creneau).map((q) => q.ordre ?? 0),
    Number.POSITIVE_INFINITY,
  );
  type Section = "matin" | "aprem" | "nuit";
  const sectionDuQuart = (code: string | null | undefined): Section => {
    const q = quarts.find((x) => x.code === code);
    if (!q) return "matin";
    if (q.creneau === "matin") return "matin";
    if (q.creneau === "aprem") return "aprem";
    return (q.ordre ?? 0) === ordreJournee ? "matin" : "nuit";
  };
  const posteIci = new Set(posteIds);
  const sectionsDe = (persId: string): Set<Section> => {
    const s = new Set<Section>();
    for (const iso of isos)
      for (const r of byPerson.get(`${persId}:${iso}`) ?? [])
        if (r.poste_id && posteIci.has(r.poste_id)) s.add(sectionDuQuart(quartOuDefaut(r.quart_code, quarts)));
    return s;
  };
  const sectionsParPers = new Map(personList.map((p) => [p.id, sectionsDe(p.id)] as const));
  const matinList = personList.filter((p) => sectionsParPers.get(p.id)?.has("matin"));
  const apremList = personList.filter((p) => sectionsParPers.get(p.id)?.has("aprem"));
  const nuitList = personList.filter((p) => sectionsParPers.get(p.id)?.has("nuit"));

  // Nouveaux : arrivée dans les NOUVEAU_JOURS derniers jours (ou à venir).
  const seuilNouveau = isoDate(new Date(Date.now() - NOUVEAU_JOURS * 86400000));
  const arrivee = new Map<string, string>();
  {
    const affiches = new Set(personIds);
    for (const c of await pArrivees) {
      if (!c.date_debut || !affiches.has(c.personne_id)) continue;
      const d = arrivee.get(c.personne_id);
      if (!d || c.date_debut < d) arrivee.set(c.personne_id, c.date_debut);
    }
  }
  const estNouveau = (id: string) => (arrivee.get(id) ?? "") >= seuilNouveau;

  // Numéro(s) de semaine ISO des jours affichés, en tête de chaque page imprimée
  // (et à l'écran à côté du nom du service). Une fenêtre à cheval sur deux
  // semaines affiche les deux.
  const semaines = [...new Set(shownDays.map((d) => isoWeekNumber(new Date(d.iso + "T00:00"))))];
  const libelleSemaine = semaines.length > 1 ? `Semaines ${semaines.join(" – ")}` : `Semaine ${semaines[0] ?? ""}`;
  const periodeTxt = shownDays.length ? `du ${shownDays[0].num} au ${shownDays[shownDays.length - 1].num}` : "";

  const sections = [
    { titre: "Matin", liste: matinList, teinte: "#1e3a8a" },
    { titre: "Après-midi", liste: apremList, teinte: "#7c2d12" },
    ...(nuitList.length ? [{ titre: "Nuit", liste: nuitList, teinte: "#312e81" }] : []),
  ] as { titre: string; liste: typeof matinList; teinte: string }[];

  const legende = (
    <>
      Légende : <span style={{ background: INTERIM_BG, padding: "0 6px" }}>Intérimaire</span>{" "}
      · <span style={{ background: AUJOURDHUI, padding: "0 6px" }}>Aujourd&apos;hui</span> · horaires en bleu ·{" "}
      <span style={{ color: "#b45309", fontStyle: "italic" }}>(Service X)</span> = affecté à un autre service ·{" "}
      <span style={{ color: "#b91c1c" }}>Absence</span>{" "}
      · <span style={{ color: "#3730a3" }}>TP</span> (temps partiel) ·{" "}
      <span style={{ color: NOUVEAU_COULEUR, fontWeight: 700 }}>★ Nouveau</span> (arrivé depuis moins de 2 semaines).
    </>
  );

  return (
    <FeuillesImpression>
      {/* Impression (2026-11-05) : une feuille A3 portrait par section, mise à
          l'échelle par FeuillesImpression ; en-tête (semaine en gros, service,
          section) et pied (légende) à taille fixe, hors zone mise à l'échelle. */}
      <style>{`
        /* Retraits des cellules : ici et en !important, pour que la règle
           d'impression globale des rapports (globals.css, « td { padding: 1.5px
           6px !important } ») ne les écrase pas sur papier. Sinon chaque rangée
           imprimée était plus basse que la mesure faite à l'écran, et une page
           dense gardait une marge blanche en bas (2026-11-05). */
        .aff-zoom th { padding: 8px 6px !important; }
        .aff-zoom td { padding: 4px 6px !important; }
        .aff-zoom th.aff-nom { padding: 8px 10px !important; }
        .aff-zoom td.aff-nom { padding: 5px 10px !important; }
        .aff-zoom td.aff-vide { padding: 10px !important; }
        @media print {
          @page { size: A3 portrait; margin: 10mm; }
          .aff-feuille {
            width: ${FEUILLE_L}px; height: ${FEUILLE_H}px; overflow: hidden;
            margin: 0 !important; position: relative;
            break-before: page; page-break-before: always; break-inside: avoid;
          }
          .aff-entete { height: ${ENTETE_H}px; }
          .aff-zoom { margin-top: ${ECART_H}px; }
          /* Rangées étirées pour remplir la page (FeuillesImpression) : contenu centré. */
          .aff-etire tbody td { vertical-align: middle !important; }
          .aff-pied { position: absolute; left: 0; right: 0; bottom: 0; height: ${PIED_H}px; font-size: 14px; color: #6b7280; }
        }
      `}</style>

      <div className="noprint" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>{atelier.nom}</h1>
          {!noWork && <span style={{ fontSize: 26, fontWeight: 800, color: "#111827" }}>{libelleSemaine}</span>}
          <span style={{ fontSize: 16, color: "#6b7280", fontWeight: 500 }}>{site.nom}</span>
        </div>
        {actions}
      </div>

      {noWork ? (
        <div>
          <h1 className="printonly" style={{ fontSize: 30, margin: "0 0 8px" }}>{atelier.nom}</h1>
          <p className="muted" style={{ fontSize: 18, padding: 20 }}>
            Aucun jour ouvert dans ce service sur la période affichée.
            Vérifiez l’ouverture des lignes dans Ordonnancement.
          </p>
        </div>
      ) : (
        <>
          {/* Tableaux empilés : Matin, Après-midi, puis Nuit (seulement si des
              personnes y travaillent). Une personne figure dans chaque section où
              elle est affectée — cf. `sectionsDe()`. Un tableau vide affiche un message
              discret à l'écran et n'est pas imprimé (sauf si tout est vide). */}
          {sections.map(({ titre, liste, teinte }) => (
            <section
              key={titre}
              className={`aff-feuille${liste.length === 0 && personList.length > 0 ? " noprint" : ""}`}
              style={{ marginBottom: 18 }}
            >
              <div className="printonly aff-entete">
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", height: "100%", borderBottom: `4px solid ${teinte}` }}>
                  <div style={{ lineHeight: 1.05 }}>
                    <div style={{ fontSize: 56, fontWeight: 800, color: "#111827" }}>{libelleSemaine}</div>
                    <div style={{ fontSize: 16, color: "#6b7280" }}>{periodeTxt}</div>
                  </div>
                  <div style={{ textAlign: "center", lineHeight: 1.1 }}>
                    <div style={{ fontSize: 36, fontWeight: 700 }}>{atelier.nom}</div>
                    <div style={{ fontSize: 30, fontWeight: 700, color: teinte }}>{titre}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 18, color: "#6b7280" }}>{site.nom}</div>
                </div>
              </div>
              <h2 className="noprint" style={{ fontSize: 20, margin: "6px 0 8px", color: teinte }}>{titre}</h2>
              <div className="aff-zoom">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th className="aff-nom" style={{ width: 260, border: cellBorder, background: teinte, color: "#fff" }}></th>
                      {shownDays.map((d) => (
                        <th
                          key={d.iso}
                          style={{
                            border: cellBorder,
                            textAlign: "center",
                            fontSize: 20,
                            background: colBg(d.iso) ?? teinte,
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
                    {liste.map((p) => {
                      const interim = agenceSet.has(p.type_contrat);
                      const nouveau = estNouveau(p.id);
                      return (
                        <tr key={p.id}>
                          {/* Nom trop long pour la colonne : le prénom passe à la ligne
                              (jamais rogné, colonne à largeur fixe). Le prénom reste
                              d'un bloc ; seul un nom à lui seul trop long se coupe. */}
                          <td
                            className="aff-nom"
                            style={{ border: cellBorder, fontWeight: nouveau ? 700 : 600, color: nouveau ? NOUVEAU_COULEUR : undefined, overflowWrap: "anywhere", lineHeight: 1.25 }}
                            title={nouveau ? "Nouveau : arrivé depuis moins de 2 semaines" : undefined}
                          >
                            {nouveau && <span aria-label="Nouveau" style={{ marginRight: 4 }}>★</span>}
                            <span
                              style={{
                                background: interim ? INTERIM_BG : undefined,
                                padding: interim ? "0 4px" : 0,
                                borderRadius: 3,
                                boxDecorationBreak: "clone",
                                WebkitBoxDecorationBreak: "clone",
                              }}
                            >
                              {p.nom} <span style={{ whiteSpace: "nowrap" }}>{p.prenom}</span>
                            </span>
                          </td>
                          {shownDays.map((d) => (
                            <td key={d.iso} style={{ border: cellBorder, verticalAlign: "top", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                              {cellNom(p.id, d.iso)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {liste.length === 0 && (
                      <tr>
                        <td colSpan={shownDays.length + 1} className="muted aff-vide">Aucune affectation {titre.toLowerCase()} sur la période affichée.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="printonly aff-pied">{legende}</div>
            </section>
          ))}
        </>
      )}

      <div className="noprint" style={{ marginTop: 14, fontSize: 14, color: "#6b7280" }}>{legende}</div>
    </FeuillesImpression>
  );
}
