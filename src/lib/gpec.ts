// GPEC — projection des effectifs d'une année : règles PURES (testées).
//
// Reprise de la démarche de l'outil Excel « Projection des compétences de
// production » :
//   volume ÷ (capacité/jour × jours ouvrés) = saturation → palier (1 à 4)
//   palier → quarts ouverts → besoin théorique en postes (effectif du Référentiel)
//   besoin réel (ETP) = postes × 52 ÷ (52 − semaines d'absence)
//   besoin total = besoin réel + départs prévus
//   disponibilité = titulaires du poste (poste fixe), contrats comptés
//   postes en déficit = manque arrondi à l'entier supérieur, POSTE PAR POSTE
//   à former = part du manque couverte par le vivier interne ; à recruter = le reste
//
// Ce qui diffère de l'Excel, par décision (2026-11-25) : rien n'est ressaisi.
// Le titulaire est le POSTE FIXE de la personne, son niveau est celui de la
// MATRICE sur ce poste, le vivier est fait des personnes SANS poste fixe qui
// tiennent le poste (niveau ≥ niveau minimum requis). Une personne du vivier
// n'est comptée qu'UNE fois (affectation sans double compte).

export type Palier = 1 | 2 | 3 | 4;
export const PALIERS: Palier[] = [1, 2, 3, 4];

export type Hypotheses = {
  annee: number;
  joursOuvres: number;
  semConges: number;
  semModulation: number;
  seuil1: number;
  seuil2: number;
  seuil3: number;
  // Absentéisme subi FORCÉ par service (semaines / an / salarié) ; absent = calcul auto.
  subiForce: Record<string, number>;
  // Motifs exclus du calcul automatique (longue maladie, accident du travail…).
  motifsExclus: string[];
};

export function hypothesesDefaut(annee: number): Hypotheses {
  return { annee, joursOuvres: 254, semConges: 5, semModulation: 0, seuil1: 0.5, seuil2: 0.75, seuil3: 1.05, subiForce: {}, motifsExclus: [] };
}

// Année projetée par défaut = l'année prochaine (N+1).
export function anneeParDefaut(aujourdhui: Date): number {
  return aujourdhui.getFullYear() + 1;
}
export function lireAnnee(brut: string | undefined, aujourdhui: Date): number {
  const n = Number(brut);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : anneeParDefaut(aujourdhui);
}

export type LigneCapa = {
  id: string;
  nom: string;
  capaciteJour: number | null;
  volumeAnnuel: number | null;
  volumesMois: (number | null)[] | null; // 12 valeurs, janvier → décembre
  lignes: string[]; // ids des lignes du Référentiel rattachées
  paliers: Record<string, string[]>; // "1".."4" → codes des quarts ouverts ; absent = tous
};

// Palier d'une saturation : 1 < seuil1 ≤ 2 < seuil2 ≤ 3 ≤ seuil3 < 4 (mêmes bornes que l'Excel).
export function palierDe(saturation: number, h: Pick<Hypotheses, "seuil1" | "seuil2" | "seuil3">): Palier {
  if (saturation < h.seuil1) return 1;
  if (saturation < h.seuil2) return 2;
  if (saturation <= h.seuil3) return 3;
  return 4;
}

// Lundi → vendredi de chaque mois, ramenés au total « jours ouvrés » saisi pour
// l'année (qui tient compte des fériés et des fermetures).
export function joursOuvresParMois(annee: number, joursOuvresAn: number): number[] {
  const bruts: number[] = [];
  for (let m = 0; m < 12; m++) {
    let n = 0;
    const dernier = new Date(annee, m + 1, 0).getDate();
    for (let d = 1; d <= dernier; d++) {
      const wd = new Date(annee, m, d).getDay();
      if (wd >= 1 && wd <= 5) n++;
    }
    bruts.push(n);
  }
  const total = bruts.reduce((s, n) => s + n, 0);
  return bruts.map((n) => (total ? (n * joursOuvresAn) / total : 0));
}

const moisSaisis = (l: LigneCapa) => (l.volumesMois ?? []).some((v) => v !== null && v !== undefined);

// Volume de l'année : somme des mois dès qu'un mois est saisi, sinon le volume annuel.
export function volumeAnnuel(l: LigneCapa): number | null {
  if (moisSaisis(l)) return (l.volumesMois ?? []).reduce<number>((s, v) => s + (v ?? 0), 0);
  return l.volumeAnnuel;
}

export type Saturation = {
  volume: number | null;
  capaciteAnnuelle: number | null;
  saturation: number | null; // null = non calculable (volume ou capacité manquant)
  palier: Palier | null;
  mensuel: { saturation: number | null; palier: Palier | null }[] | null; // null = pas de volumes mensuels
};

export function saturationLigne(l: LigneCapa, h: Hypotheses): Saturation {
  const volume = volumeAnnuel(l);
  const capaciteAnnuelle = l.capaciteJour ? l.capaciteJour * h.joursOuvres : null;
  const saturation = volume !== null && capaciteAnnuelle ? volume / capaciteAnnuelle : null;
  let mensuel: Saturation["mensuel"] = null;
  if (moisSaisis(l)) {
    const jours = joursOuvresParMois(h.annee, h.joursOuvres);
    mensuel = jours.map((j, i) => {
      const v = l.volumesMois?.[i];
      if (v === null || v === undefined || !l.capaciteJour || !j) return { saturation: null, palier: null };
      const s = v / (l.capaciteJour * j);
      return { saturation: s, palier: palierDe(s, h) };
    });
  }
  return { volume, capaciteAnnuelle, saturation, palier: saturation === null ? null : palierDe(saturation, h), mensuel };
}

// Quarts ouverts d'une ligne capacitaire à un palier : `null` = tous les quarts
// (palier non réglé → on garde l'organisation actuelle du Référentiel).
export function quartsOuverts(l: LigneCapa, palier: Palier): Set<string> | null {
  const q = l.paliers[String(palier)];
  return Array.isArray(q) ? new Set(q) : null;
}

// Besoin théorique d'un poste = somme de son effectif sur les quarts ouverts
// (Journée + quarts postés = personnes distinctes : le besoin les additionne).
export function besoinTheorique(effectifParQuart: Record<string, number>, ouverts: Set<string> | null): number {
  let n = 0;
  for (const [q, eff] of Object.entries(effectifParQuart)) if (!ouverts || ouverts.has(q)) n += eff;
  return n;
}

// Coefficient ETP : 52 ÷ (52 − semaines d'absence). Borné : au-delà de 40
// semaines d'absence la saisie est une erreur, on ne divise pas par ~0.
export function coefEtp(semProgramme: number, semSubi: number): number {
  const abs = Math.min(40, Math.max(0, semProgramme + semSubi));
  return 52 / (52 - abs);
}

// Absentéisme subi d'un service en semaines / an / salarié, d'après les jours
// d'absence non planifiée relevés sur 12 mois (5 jours = 1 semaine).
export function semainesSubies(joursNonPlanifies: number, effectif: number): number {
  if (effectif <= 0) return 0;
  return Math.round((joursNonPlanifies / effectif / 5) * 10) / 10;
}

// Jours d’absence subie retenus pour un service : tous les motifs non planifiés
// sauf ceux exclus (longue maladie, accident du travail…).
export function joursRetenus(parMotif: Record<string, number> | undefined, exclus: Set<string>): number {
  let n = 0;
  for (const [motif, jours] of Object.entries(parMotif ?? {})) if (!exclus.has(motif)) n += jours;
  return n;
}

// Arrondi du manque à l'entier supérieur (l'arrondi à 6 décimales évite qu'un
// 2,0000000001 né d'une division devienne 3).
export function arrondiSup(x: number): number {
  return Math.ceil(Math.round(Math.max(0, x) * 1e6) / 1e6);
}

export type TitulaireEntree = { id: string; niveau: number };
export type PosteEntree = {
  id: string;
  besoinTheorique: number;
  coef: number;
  niveauMin: number; // niveau minimum requis du poste (au moins 1)
  nbNiveaux: number; // niveau maximum du site = référent
  titulaires: TitulaireEntree[];
  departs: number; // titulaires qui partent + départs anonymes sur le poste
};
export type PosteCalcul = {
  id: string;
  besoinTheorique: number;
  besoinReel: number;
  departs: number;
  besoinTotal: number;
  disponibilite: number;
  referents: number; // titulaires au niveau maximum
  enFormation: number; // titulaires sous le niveau minimum requis
  ecart: number; // disponibilité − besoin total
  deficit: number; // personnes qui manquent, entier
};

export function calculerPoste(p: PosteEntree): PosteCalcul {
  const min = Math.max(1, p.niveauMin);
  const besoinReel = p.besoinTheorique * p.coef;
  const besoinTotal = besoinReel + p.departs;
  const disponibilite = p.titulaires.length;
  const ecart = disponibilite - besoinTotal;
  return {
    id: p.id,
    besoinTheorique: p.besoinTheorique,
    besoinReel,
    departs: p.departs,
    besoinTotal,
    disponibilite,
    referents: p.titulaires.filter((t) => t.niveau >= p.nbNiveaux).length,
    enFormation: p.titulaires.filter((t) => t.niveau < min).length,
    ecart,
    deficit: arrondiSup(-ecart),
  };
}

// Affectation du vivier aux postes en déficit SANS double compte : une personne
// couvre au plus UNE place manquante. Couplage maximal (chemins augmentants) —
// un polyvalent du vivier est orienté là où il est le seul à pouvoir aller.
// `candidats` : pour chaque poste, les personnes du vivier qui le tiennent, dans
// l'ordre de préférence (le plus haut niveau d'abord).
export function affecterVivier(
  deficits: { posteId: string; manque: number }[],
  candidats: Map<string, string[]>
): Map<string, string[]> {
  // Les postes au plus petit vivier d'abord : résultat stable et lisible.
  const ordre = [...deficits]
    .filter((d) => d.manque > 0)
    .sort((a, b) => (candidats.get(a.posteId)?.length ?? 0) - (candidats.get(b.posteId)?.length ?? 0) || a.posteId.localeCompare(b.posteId));
  const places: string[] = []; // place → poste
  for (const d of ordre) for (let i = 0; i < d.manque; i++) places.push(d.posteId);
  const placeDe = new Map<string, number>(); // personne → place

  const tenter = (place: number, vus: Set<string>): boolean => {
    for (const pid of candidats.get(places[place]) ?? []) {
      if (vus.has(pid)) continue;
      vus.add(pid);
      const occupee = placeDe.get(pid);
      if (occupee === undefined || tenter(occupee, vus)) {
        placeDe.set(pid, place);
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < places.length; i++) tenter(i, new Set());

  const res = new Map<string, string[]>();
  for (const [pid, place] of placeDe) {
    const poste = places[place];
    (res.get(poste) ?? res.set(poste, []).get(poste)!).push(pid);
  }
  return res;
}

// Cumul de lignes de calcul (un service, une catégorie, le site). Le besoin
// réel et le besoin total sont arrondis AU TOTAL ; le déficit, lui, est la
// somme exacte des déficits de chaque poste (un excédent ici ne compense pas
// un manque là).
export type Cumul = {
  besoinTheorique: number;
  besoinReel: number;
  departs: number;
  besoinTotal: number;
  disponibilite: number;
  enFormation: number;
  deficit: number;
  aFormer: number;
  aRecruter: number;
  couverture: number | null; // disponibilité ÷ besoin total
};
export function cumuler(lignes: (PosteCalcul & { aFormer: number; aRecruter: number })[]): Cumul {
  const s = (f: (l: PosteCalcul & { aFormer: number; aRecruter: number }) => number) => lignes.reduce((t, l) => t + f(l), 0);
  const besoinTotal = s((l) => l.besoinTotal);
  const disponibilite = s((l) => l.disponibilite);
  return {
    besoinTheorique: s((l) => l.besoinTheorique),
    besoinReel: s((l) => l.besoinReel),
    departs: s((l) => l.departs),
    besoinTotal,
    disponibilite,
    enFormation: s((l) => l.enFormation),
    deficit: s((l) => l.deficit),
    aFormer: s((l) => l.aFormer),
    aRecruter: s((l) => l.aRecruter),
    couverture: besoinTotal > 0 ? disponibilite / besoinTotal : null,
  };
}

export const LIBELLE_CATEGORIE: Record<string, string> = { manager: "Encadrement", conducteur: "Conducteurs", operateur: "Opérateurs" };
export const ORDRE_CATEGORIE = ["manager", "conducteur", "operateur"];
export const MOTIFS_DEPART = ["Retraite", "Démission", "Mobilité interne", "Fin de contrat", "Autre"];
export const MOIS_COURTS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
