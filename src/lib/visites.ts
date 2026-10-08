// Visites médicales — règles de calcul.
//
// Ce module ne contient QUE des fonctions pures : aucune lecture Supabase, aucun
// composant. C'est là que vit tout ce qui décide « qui doit passer quelle visite,
// et avant quand ». Les écrans et les routes API lisent les données, appellent
// `evaluerPersonne`, puis affichent.
//
// PRINCIPE. Le régime de suivi n'est pas saisi, il est DÉDUIT de ce que Polaris
// sait déjà : quart de nuit, poste tenu, habilitation détenue, plus une case
// « suivi adapté » cochée par les RH sans motif. Aucune donnée de santé n'entre
// ici : on manipule des dates, des libellés de poste ou d'habilitation, et le
// TYPE d'avis rendu.
//
// PLAFONDS. Les durées du Code du travail sont des MAXIMA, jamais des cibles :
// les RH peuvent les raccourcir (protocole du service de santé au travail), et
// une date fixée par le professionnel sur l'avis l'emporte si elle est plus
// proche (`prochaine_date`).

import { ecartJours } from "@/lib/absences-periodes";

export type RegimeCode = "simple" | "adapte" | "renforce";

export type Regime = {
  code: RegimeCode;
  libelle: string;
  /** Plafond de renouvellement, en mois. */
  mois: number;
  /** Visite intermédiaire (suivi renforcé), en mois. Null = aucune. */
  moisInter: number | null;
};

// Maxima du Code du travail. Servent de valeurs par défaut ET de repère : au
// paramétrage, une valeur supérieure est signalée à l'écran.
//   simple   R4624-16 · 5 ans
//   adapté   R4624-17 · 3 ans (travailleur de nuit, travailleur handicapé,
//            titulaire d'une pension d'invalidité, moins de 18 ans)
//   renforcé R4624-28 · 4 ans, avec une visite intermédiaire à 2 ans
export const MAX_LEGAL: Record<RegimeCode, { mois: number; moisInter: number | null }> = {
  simple: { mois: 60, moisInter: null },
  adapte: { mois: 36, moisInter: null },
  renforce: { mois: 48, moisInter: 24 },
};

export const REGIMES_DEFAUT: Regime[] = [
  { code: "simple", libelle: "Simple", mois: 60, moisInter: null },
  { code: "adapte", libelle: "Adapté", mois: 36, moisInter: null },
  { code: "renforce", libelle: "Renforcé", mois: 48, moisInter: 24 },
];

export const REGIME_CODES: RegimeCode[] = ["simple", "adapte", "renforce"];
const RANG: Record<RegimeCode, number> = { simple: 0, adapte: 1, renforce: 2 };

export const estRegime = (v: unknown): v is RegimeCode =>
  typeof v === "string" && (REGIME_CODES as string[]).includes(v);

// Motifs réglementaires d'un poste à risques particuliers (R4624-23). Liste
// fermée : les catégories I et II sont fixées par le Code du travail, la
// dernière correspond à la liste complémentaire de l'employeur, qui exige l'avis
// du médecin du travail et du CSE et se transmet chaque année au service de
// prévention et de santé au travail.
export const MOTIFS_SIR: { code: string; libelle: string }[] = [
  { code: "cmr", libelle: "Agents cancérogènes, mutagènes ou toxiques pour la reproduction" },
  { code: "amiante_plomb", libelle: "Amiante, plomb" },
  { code: "biologique", libelle: "Agents biologiques des groupes 3 et 4" },
  { code: "rayonnements", libelle: "Rayonnements ionisants" },
  { code: "hyperbare", libelle: "Risque hyperbare" },
  { code: "chute", libelle: "Chute de hauteur (montage / démontage d'échafaudages)" },
  { code: "conduite", libelle: "Autorisation de conduite (R4323-56)" },
  { code: "electrique", libelle: "Habilitation électrique (R4544-10)" },
  { code: "manutention", libelle: "Manutention manuelle de charges > 55 kg (R4541-9)" },
  { code: "employeur", libelle: "Liste complémentaire de l'employeur (avis médecin + CSE)" },
];

export type CategorieVisite = "initiale" | "periodique" | "intermediaire" | "reprise" | "ponctuelle";
export const CATEGORIES: CategorieVisite[] = ["initiale", "periodique", "intermediaire", "reprise", "ponctuelle"];

export const LIBELLE_CATEGORIE: Record<CategorieVisite, string> = {
  initiale: "Initiale",
  periodique: "Périodique",
  intermediaire: "Intermédiaire",
  reprise: "Reprise",
  ponctuelle: "Ponctuelle",
};

export type Avis = "attestation" | "apte" | "apte_amenagement" | "inapte";
export const AVIS: { code: Avis; libelle: string }[] = [
  { code: "attestation", libelle: "Attestation de suivi" },
  { code: "apte", libelle: "Apte" },
  { code: "apte_amenagement", libelle: "Apte avec aménagements" },
  { code: "inapte", libelle: "Inapte" },
];
export const libelleAvis = (a: string | null): string => AVIS.find((x) => x.code === a)?.libelle ?? "—";

// Qui reçoit la personne : information d'organisation, bornée par un CHECK (0079).
export type Professionnel = "medecin" | "infirmier";
export const PROFESSIONNELS: { code: Professionnel; libelle: string }[] = [
  { code: "medecin", libelle: "Médecin du travail" },
  { code: "infirmier", libelle: "Infirmier(ère)" },
];
export const libelleProfessionnel = (p: string | null): string =>
  PROFESSIONNELS.find((x) => x.code === p)?.libelle ?? "—";

// --- Réglages du module ------------------------------------------------------
// Les DÉFAUTS vivent ici : une clé absente de `visite_parametre` n'est pas une
// valeur nulle, c'est la valeur par défaut. Une base sans aucun réglage se
// comporte donc déjà correctement.
export type Parametres = {
  /** Durée d'absence continue (jours calendaires) déclenchant une visite de reprise. */
  repriseJours: number;
  /** Délai légal pour organiser la visite de reprise après le retour (R4624-31). */
  repriseDelaiJours: number;
  /** Une échéance passe « à planifier » ce nombre de jours avant son terme. */
  alerteJours: number;
  /** Alerte avant l'arrivée d'une personne soumise à une visite avant affectation. */
  alerteArriveeJours: number;
  /** Délai légal pour la visite d'embauche en suivi simple (R4624-10). */
  embaucheMois: number;
  /** « Tenir » un poste : nombre de placements… */
  postePlacements: number;
  /** …sur ce nombre de semaines glissantes. */
  posteSemaines: number;
  /** Critères qui déclenchent l'avertissement au Placement (sans détail). */
  alertePlacementContrainte: boolean;
  alertePlacementAnci: boolean;
  alertePlacementSir: boolean;
  alertePlacementReprise: boolean;
};

export const PARAMETRES_DEFAUT: Parametres = {
  repriseJours: 60,
  repriseDelaiJours: 8,
  alerteJours: 90,
  alerteArriveeJours: 30,
  embaucheMois: 3,
  postePlacements: 3,
  posteSemaines: 12,
  // Les quatre avertissements du Placement partent ÉTEINTS. Le module démarre
  // vide : tant que l'historique des visites n'est pas repris, tout le monde
  // serait « en retard » et l'avertissement perdrait tout son sens. Les RH les
  // allument un par un depuis « Param. Visites → Alertes », quand les données
  // sont là. Aucun contrôle activé = la route de placement ne lit rien de plus
  // que les réglages (cf. src/lib/visites-placement.ts).
  alertePlacementContrainte: false,
  alertePlacementAnci: false,
  alertePlacementSir: false,
  alertePlacementReprise: false,
};

// Description des réglages, partagée par l'écran de paramétrage et la route qui
// les écrit : une seule table, donc aucune divergence entre les deux.
export type DescParam = { cle: keyof Parametres; type: "nombre" | "bool"; min?: number; max?: number };
export const DESC_PARAMS: DescParam[] = [
  { cle: "repriseJours", type: "nombre", min: 1, max: 366 },
  { cle: "repriseDelaiJours", type: "nombre", min: 1, max: 90 },
  { cle: "alerteJours", type: "nombre", min: 1, max: 365 },
  { cle: "alerteArriveeJours", type: "nombre", min: 0, max: 365 },
  { cle: "embaucheMois", type: "nombre", min: 1, max: 24 },
  { cle: "postePlacements", type: "nombre", min: 1, max: 60 },
  { cle: "posteSemaines", type: "nombre", min: 1, max: 104 },
  { cle: "alertePlacementContrainte", type: "bool" },
  { cle: "alertePlacementAnci", type: "bool" },
  { cle: "alertePlacementSir", type: "bool" },
  { cle: "alertePlacementReprise", type: "bool" },
];

/** Lignes `visite_parametre` -> réglages typés, défauts compris. */
export function lireParametres(lignes: { cle: string; valeur: string }[] | null | undefined): Parametres {
  const out = { ...PARAMETRES_DEFAUT };
  for (const l of lignes ?? []) {
    const desc = DESC_PARAMS.find((d) => d.cle === l.cle);
    if (!desc) continue;
    if (desc.type === "bool") {
      (out[desc.cle] as boolean) = l.valeur === "1" || l.valeur === "true";
    } else {
      const n = Number(l.valeur);
      if (Number.isFinite(n)) (out[desc.cle] as number) = borner(n, desc.min ?? 0, desc.max ?? 9999);
    }
  }
  return out;
}

const borner = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

// --- Dates -------------------------------------------------------------------

export function ajouterMoisIso(iso: string, mois: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + mois, d);
  return isoDe(dt);
}

export function ajouterJoursIso(iso: string, jours: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + jours);
  return isoDe(dt);
}

const isoDe = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Plus petite des deux dates, en tolérant les absentes. */
export function plusTot(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

// --- Travail de nuit ---------------------------------------------------------

/** Plage légale du travail de nuit : 21 h → 6 h (L3122-2). */
export const PLAGE_NUIT = { debut: 21, fin: 6 };

/** Seuil à partir duquel un quart est proposé comme quart de nuit (L3122-5). */
export const HEURES_NUIT_MIN = 3;

/**
 * Heures d'un quart comprises dans la plage de nuit. Sert d'INDICATION au
 * paramétrage : c'est la coche `quart.nuit` qui fait foi, pas ce calcul — un
 * accord d'entreprise peut décaler la plage, et le code d'un quart ne dit rien
 * de sa sémantique (cf. src/lib/quarts.ts).
 *
 * `debut` et `fin` au format « HH:MM » ou « HH:MM:SS ». Un quart qui enjambe
 * minuit est découpé en deux morceaux.
 */
export function heuresDeNuit(debut: string | null, fin: string | null): number {
  const h = (t: string | null): number | null => {
    if (!t) return null;
    const [hh, mm] = t.split(":").map(Number);
    return Number.isFinite(hh) ? hh + (Number.isFinite(mm) ? mm : 0) / 60 : null;
  };
  const d = h(debut);
  const f = h(fin);
  if (d === null || f === null || d === f) return 0;
  // Segments du quart, ramenés à une journée linéaire.
  const segments: [number, number][] = d < f ? [[d, f]] : [[d, 24], [0, f]];
  // Plage de nuit, sur la même échelle.
  const nuit: [number, number][] = [[PLAGE_NUIT.debut, 24], [0, PLAGE_NUIT.fin]];
  let total = 0;
  for (const [a, b] of segments) {
    for (const [na, nb] of nuit) {
      total += Math.max(0, Math.min(b, nb) - Math.max(a, na));
    }
  }
  return Math.round(total * 10) / 10;
}

// --- Régime ------------------------------------------------------------------

export type RaisonRegime = { source: "quart" | "poste" | "habilitation" | "manuel"; texte: string };

export type EntreesRegime = {
  /** La personne travaille sur un quart marqué « nuit ». */
  nuit?: boolean;
  /** Libellés des postes à suivi renforcé que la personne tient. */
  postesSIR?: string[];
  /** Libellés des habilitations à suivi renforcé qu'elle détient. */
  habsSIR?: string[];
  /** Case « suivi adapté » cochée par les RH — sans motif. */
  suiviAdapte?: boolean;
  /** Régime imposé à la main, qui court-circuite le calcul. */
  force?: RegimeCode | null;
  /**
   * Date d'entrée dans le suivi renforcé, quand elle est connue (obtention de
   * l'habilitation à risque). Une visite antérieure à cette date n'a pas pu
   * porter sur le risque : l'examen d'aptitude est alors dû AVANT l'affectation
   * (R4624-24), sans attendre le plafond de renouvellement.
   */
  renforceDepuis?: string | null;
};

/**
 * Régime de suivi et raisons qui l'expliquent. Quand plusieurs déclencheurs
 * s'appliquent, LE PLUS EXIGEANT L'EMPORTE — mais toutes les raisons sont
 * rendues : l'écran doit pouvoir répondre « pourquoi ce régime ».
 */
export function regimeDe(e: EntreesRegime): { regime: RegimeCode; raisons: RaisonRegime[] } {
  const raisons: RaisonRegime[] = [];
  let regime: RegimeCode = "simple";
  const monter = (r: RegimeCode) => {
    if (RANG[r] > RANG[regime]) regime = r;
  };

  for (const p of e.postesSIR ?? []) {
    raisons.push({ source: "poste", texte: p });
    monter("renforce");
  }
  for (const h of e.habsSIR ?? []) {
    raisons.push({ source: "habilitation", texte: h });
    monter("renforce");
  }
  if (e.nuit) {
    raisons.push({ source: "quart", texte: "Travail de nuit" });
    monter("adapte");
  }
  if (e.suiviAdapte) {
    raisons.push({ source: "manuel", texte: "Suivi adapté" });
    monter("adapte");
  }
  if (e.force) {
    raisons.push({ source: "manuel", texte: `Régime imposé : ${libelleRegime(e.force)}` });
    return { regime: e.force, raisons };
  }
  return { regime, raisons };
}

export const libelleRegime = (c: RegimeCode): string =>
  REGIMES_DEFAUT.find((r) => r.code === c)?.libelle ?? c;

export function regimeDuSite(regimes: Regime[], code: RegimeCode): Regime {
  return regimes.find((r) => r.code === code) ?? REGIMES_DEFAUT.find((r) => r.code === code)!;
}

// --- Évaluation d'une personne ----------------------------------------------

export type VisiteLue = {
  /** Date de réalisation. Null = simple rendez-vous pris. */
  date_visite: string | null;
  date_rdv: string | null;
  /** Date fixée par le professionnel sur l'avis. */
  prochaine_date: string | null;
  categorie: CategorieVisite;
  libelle: string;
  /** Usages d'ANCI délivrés par cette visite. */
  anci: string[];
};

export type Reprise = {
  /** Dernier jour de l'absence. */
  fin: string;
  /** Durée calendaire de l'absence, en jours. */
  jours: number;
  motif: string;
};

export type DonneesPersonne = EntreesRegime & {
  /** Date d'arrivée (début du premier contrat). */
  arrivee: string | null;
  visites: VisiteLue[];
  /** Usages d'ANCI exigés par les postes tenus ou les habilitations détenues. */
  ancisRequis: string[];
  /** Absence longue dont le retour n'a pas encore donné lieu à une visite. */
  reprise: Reprise | null;
};

export type Contexte = {
  aujourdhui: string;
  regimes: Regime[];
  params: Parametres;
};

export type StatutVisite = "retard" | "reprise" | "planifier" | "rdv" | "ok";

export const LIBELLE_STATUT: Record<StatutVisite, string> = {
  retard: "En retard",
  reprise: "Reprise à organiser",
  planifier: "À planifier",
  rdv: "RDV pris",
  ok: "À jour",
};

export const COULEUR_STATUT: Record<StatutVisite, { bg: string; fg: string }> = {
  retard: { bg: "#fde8e8", fg: "#b91c1c" },
  reprise: { bg: "#efe9fd", fg: "#6d28d9" },
  planifier: { bg: "#fdf0dc", fg: "#b45309" },
  rdv: { bg: "#e8eefc", fg: "#1d4ed8" },
  ok: { bg: "#e3f4e8", fg: "#15803d" },
};

export type Echeance = { libelle: string; due: string | null; motif: string };

export type Evaluation = {
  regime: RegimeCode;
  raisons: RaisonRegime[];
  derniere: { date: string; libelle: string } | null;
  prochaine: Echeance | null;
  statut: StatutVisite;
  /** Rendez-vous pris et pas encore honoré. */
  rdv: string | null;
  /** Usages d'ANCI exigés dont l'attestation manque ou est périmée. */
  anciManquants: string[];
};

/** Dernière visite réalisée parmi les catégories demandées. */
export function derniereVisite(visites: VisiteLue[], cats: CategorieVisite[]): VisiteLue | null {
  let out: VisiteLue | null = null;
  for (const v of visites) {
    if (!v.date_visite || !cats.includes(v.categorie)) continue;
    if (!out || v.date_visite > out.date_visite!) out = v;
  }
  return out;
}

/**
 * Échéance du renouvellement périodique.
 *
 * Trois cas, dans cet ordre :
 *   1. une visite périodique a eu lieu → date + plafond du régime, ou la date
 *      fixée par le professionnel si elle est PLUS PROCHE ;
 *   2. aucune visite mais une arrivée connue → en suivi simple, l'embauche
 *      laisse 3 mois (R4624-10) ; en suivi adapté ou renforcé, la visite est
 *      due AVANT l'affectation, donc à la date d'arrivée elle-même ;
 *   3. ni l'un ni l'autre → pas d'échéance calculable (l'écran le signale).
 */
export function echeancePeriodique(d: DonneesPersonne, regime: RegimeCode, ctx: Contexte): Echeance | null {
  const reg = regimeDuSite(ctx.regimes, regime);
  const derniere = derniereVisite(d.visites, ["initiale", "periodique"]);
  const libelle = regime === "renforce" ? "Examen médical d'aptitude" : "Visite d'information et de prévention";

  // Entrée récente dans le suivi renforcé : la dernière visite est antérieure au
  // risque, elle ne vaut pas aptitude. L'examen est dû avant l'affectation.
  if (regime === "renforce" && d.renforceDepuis && (!derniere?.date_visite || derniere.date_visite < d.renforceDepuis)) {
    return {
      libelle: "Examen médical d'aptitude",
      due: d.renforceDepuis,
      motif: "avant affectation au poste à risque",
    };
  }

  if (derniere?.date_visite) {
    const plafond = ajouterMoisIso(derniere.date_visite, reg.mois);
    const due = plusTot(plafond, derniere.prochaine_date);
    const motif =
      due === derniere.prochaine_date && derniere.prochaine_date !== plafond
        ? "date fixée par le professionnel de santé"
        : `${reg.mois} mois après la dernière visite`;
    return { libelle, due, motif };
  }
  if (d.arrivee) {
    if (regime === "simple") {
      return {
        libelle: "VIP d'embauche",
        due: ajouterMoisIso(d.arrivee, ctx.params.embaucheMois),
        motif: `${ctx.params.embaucheMois} mois après la prise de poste`,
      };
    }
    return { libelle: "Visite avant affectation", due: d.arrivee, motif: "avant la prise de poste" };
  }
  return { libelle, due: null, motif: "aucune visite connue" };
}

/** Échéance de la visite intermédiaire (suivi renforcé seulement). */
export function echeanceIntermediaire(d: DonneesPersonne, regime: RegimeCode, ctx: Contexte): Echeance | null {
  if (regime !== "renforce") return null;
  const reg = regimeDuSite(ctx.regimes, regime);
  if (!reg.moisInter) return null;
  const socle = derniereVisite(d.visites, ["initiale", "periodique"]);
  if (!socle?.date_visite) return null;
  // Socle antérieur à l'entrée dans le suivi renforcé : c'est l'examen d'aptitude
  // qui est dû, pas une intermédiaire greffée sur une visite sans rapport.
  if (d.renforceDepuis && socle.date_visite < d.renforceDepuis) return null;
  const inter = derniereVisite(d.visites, ["intermediaire"]);
  // Une intermédiaire postérieure au socle a déjà rempli l'obligation du cycle.
  if (inter?.date_visite && inter.date_visite >= socle.date_visite) return null;
  return {
    libelle: "Visite intermédiaire",
    due: ajouterMoisIso(socle.date_visite, reg.moisInter),
    motif: `${reg.moisInter} mois après l'examen d'aptitude`,
  };
}

/** Échéance de la visite de reprise, si un retour d'absence longue l'appelle. */
export function echeanceReprise(d: DonneesPersonne, ctx: Contexte): Echeance | null {
  if (!d.reprise) return null;
  const faite = derniereVisite(d.visites, ["reprise"]);
  if (faite?.date_visite && faite.date_visite >= d.reprise.fin) return null;
  return {
    libelle: "Visite de reprise",
    due: ajouterJoursIso(d.reprise.fin, ctx.params.repriseDelaiJours),
    motif: `${d.reprise.motif} · ${d.reprise.jours} jours, retour le ${fmtFr(d.reprise.fin)}`,
  };
}

/**
 * Usages d'ANCI exigés dont l'attestation manque ou est périmée.
 *
 * Une attestation de non contre-indication est délivrée PAR une visite et vaut
 * jusqu'à la prochaine visite due pour cette personne : on recalcule donc son
 * terme depuis la visite qui l'a délivrée, avec le plafond du régime (ou la date
 * fixée par le professionnel si elle est plus proche).
 */
export function anciManquants(d: DonneesPersonne, regime: RegimeCode, ctx: Contexte): string[] {
  const reg = regimeDuSite(ctx.regimes, regime);
  const requis = [...new Set(d.ancisRequis)];
  return requis.filter((usage) => {
    let valide = false;
    for (const v of d.visites) {
      if (!v.date_visite || !v.anci.includes(usage)) continue;
      const terme = plusTot(ajouterMoisIso(v.date_visite, reg.mois), v.prochaine_date);
      if (terme && terme >= ctx.aujourdhui) valide = true;
    }
    return !valide;
  });
}

/** Rendez-vous pris, à venir, pas encore honoré. */
export function prochainRdv(visites: VisiteLue[], aujourdhui: string): string | null {
  let out: string | null = null;
  for (const v of visites) {
    if (v.date_visite || !v.date_rdv || v.date_rdv < aujourdhui) continue;
    if (!out || v.date_rdv < out) out = v.date_rdv;
  }
  return out;
}

/** Évaluation complète d'une personne : régime, échéance la plus proche, statut. */
export function evaluerPersonne(d: DonneesPersonne, ctx: Contexte): Evaluation {
  const { regime, raisons } = regimeDe(d);
  const reprise = echeanceReprise(d, ctx);
  const candidats = [reprise, echeanceIntermediaire(d, regime, ctx), echeancePeriodique(d, regime, ctx)].filter(
    (e): e is Echeance => e !== null,
  );

  // La reprise passe devant à égalité de date : c'est l'obligation la plus
  // contrainte (huit jours après le retour), et elle porte un vrai risque.
  let prochaine: Echeance | null = null;
  for (const c of candidats) {
    if (!prochaine) prochaine = c;
    else if (c.due && prochaine.due && c.due < prochaine.due) prochaine = c;
    else if (c.due && !prochaine.due) prochaine = c;
  }
  if (reprise) prochaine = reprise;

  const rdv = prochainRdv(d.visites, ctx.aujourdhui);
  const derniereV = derniereVisite(d.visites, CATEGORIES);

  let statut: StatutVisite;
  if (reprise) statut = "reprise";
  else if (prochaine?.due && prochaine.due < ctx.aujourdhui) statut = "retard";
  else if (rdv) statut = "rdv";
  else if (prochaine?.due && prochaine.due <= ajouterJoursIso(ctx.aujourdhui, ctx.params.alerteJours))
    statut = "planifier";
  else statut = "ok";
  // Un rendez-vous déjà pris n'efface pas un retard mais l'apaise : on le montre
  // comme « RDV pris », l'action attendue étant d'attendre le rendez-vous.
  if (statut === "retard" && rdv) statut = "rdv";

  return {
    regime,
    raisons,
    derniere: derniereV?.date_visite ? { date: derniereV.date_visite, libelle: derniereV.libelle } : null,
    prochaine,
    statut,
    rdv,
    anciManquants: anciManquants(d, regime, ctx),
  };
}

// --- Absence longue ----------------------------------------------------------

/**
 * Dernière absence continue atteignant le seuil et dont le retour n'est pas
 * encore régularisé. La durée compte en jours CALENDAIRES (week-ends compris) :
 * c'est ainsi que le Code du travail la mesure, alors que `grouperAbsences`
 * compte les jours réellement posés.
 *
 * Les périodes encore en cours (fin dans le futur) sont retenues aussi : la
 * visite se prépare avant le retour.
 */
export function repriseDepuisPeriodes(
  periodes: { debut: string; fin: string; motif_absence_id: string | null }[],
  motifsComptes: Map<string, string>,
  seuilJours: number,
): Reprise | null {
  let out: Reprise | null = null;
  for (const p of periodes) {
    const motif = p.motif_absence_id ? motifsComptes.get(p.motif_absence_id) : undefined;
    if (!motif) continue;
    const jours = ecartJours(p.debut, p.fin) + 1;
    if (jours < seuilJours) continue;
    if (!out || p.fin > out.fin) out = { fin: p.fin, jours, motif };
  }
  return out;
}

// --- Contraintes d'affectation ----------------------------------------------

export type Contrainte = {
  quart_code: string | null;
  poste_id: string | null;
  date_debut: string;
  date_fin: string | null;
};

/** La contrainte s'applique-t-elle à cette affectation, ce jour-là ? */
export function contrainteApplicable(c: Contrainte, jour: string, quart: string | null, posteId: string | null): boolean {
  if (jour < c.date_debut) return false;
  if (c.date_fin && jour > c.date_fin) return false;
  if (c.quart_code && quart && c.quart_code === quart) return true;
  if (c.poste_id && posteId && c.poste_id === posteId) return true;
  return false;
}

// --- Affichage ---------------------------------------------------------------

export const fmtFr = (iso: string | null | undefined): string =>
  iso ? iso.split("-").reverse().join("/") : "—";

/** « dans 35 j », « il y a 16 j », « aujourd'hui ». */
export function delaiTexte(due: string | null, aujourdhui: string): string {
  if (!due) return "—";
  const j = ecartJours(aujourdhui, due);
  if (j === 0) return "aujourd'hui";
  return j > 0 ? `dans ${j} j` : `en retard de ${-j} j`;
}
