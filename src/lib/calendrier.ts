// Grille mensuelle et sélection d'une plage, pour un calendrier type « Booking »
// (deux clics : début puis fin). Logique pure, testée — le composant React ne
// fait que l'afficher.

export type CaseJour = {
  iso: string;      // 'YYYY-MM-DD'
  jour: number;     // numéro du jour dans le mois
  moisCourant: boolean; // false pour les cases de complément (mois précédent/suivant)
};

const NOMS_MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export const JOURS_COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

export function libelleMois(annee: number, mois0: number): string {
  return `${NOMS_MOIS[mois0]} ${annee}`;
}

const iso = (a: number, m0: number, j: number) =>
  `${a}-${String(m0 + 1).padStart(2, "0")}-${String(j).padStart(2, "0")}`;

// Date du jour en ISO LOCAL (et non `toISOString()`, qui passe en UTC et décale
// d'un jour entre minuit et 2 h l'été). Sert à marquer « aujourd'hui » dans les
// calendriers.
export function isoAujourdhui(maintenant: Date = new Date()): string {
  return iso(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
}

// Marquage commun d'« aujourd'hui » dans tous les calendriers (DateRangePicker,
// JourNav) : vert, comme sur l'affichage TV. Fond pâle + anneau quand la case
// n'est pas sélectionnée ; anneau seul, à l'extérieur, quand elle l'est (le fond
// plein de la sélection reste lisible).
export const STYLE_AUJOURDHUI = {
  background: "#dcfce7",
  color: "#166534",
  fontWeight: 700,
  borderRadius: 8,
  boxShadow: "inset 0 0 0 2px #16a34a",
} as const;
export const ANNEAU_AUJOURDHUI_SELECTION = "0 0 0 2px #fff, 0 0 0 4px #16a34a";

// Grille de 6 semaines (42 cases) couvrant le mois, complétée par les jours des
// mois voisins pour que chaque ligne soit pleine. Semaine commençant le LUNDI.
export function grilleMois(annee: number, mois0: number): CaseJour[] {
  const premier = new Date(annee, mois0, 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi = 0
  const debut = new Date(annee, mois0, 1 - decalage);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + i);
    return {
      iso: iso(d.getFullYear(), d.getMonth(), d.getDate()),
      jour: d.getDate(),
      moisCourant: d.getMonth() === mois0,
    };
  });
}

// Mois suivant / précédent, sans déborder de l'année.
export function moisSuivant(annee: number, mois0: number): [number, number] {
  return mois0 === 11 ? [annee + 1, 0] : [annee, mois0 + 1];
}
export function moisPrecedent(annee: number, mois0: number): [number, number] {
  return mois0 === 0 ? [annee - 1, 11] : [annee, mois0 - 1];
}

export type Plage = { debut: string | null; fin: string | null };

// Applique un clic sur `jour` à la plage courante. Règles « Booking » :
//   - aucune borne, ou plage déjà complète        -> on repart : début = jour ;
//   - un début posé, clic APRÈS ou égal            -> fin = jour (plage complète) ;
//   - un début posé, clic AVANT                    -> le clic devient le nouveau début.
// Ne mute rien : rend la nouvelle plage.
export function clicPlage(plage: Plage, jour: string): Plage {
  const { debut, fin } = plage;
  if (!debut || fin) return { debut: jour, fin: null };
  if (jour >= debut) return { debut, fin: jour };
  return { debut: jour, fin: null };
}

export type EtatCase = "hors" | "debut" | "fin" | "dans" | "aucun";

// État d'une case vis-à-vis de la plage (pour le style). `hors` = case d'un mois
// voisin ; `aucun` = dans le mois mais hors sélection.
export function etatCase(c: CaseJour, plage: Plage): EtatCase {
  if (!c.moisCourant) return "hors";
  const { debut, fin } = plage;
  if (debut && c.iso === debut) return "debut";
  if (fin && c.iso === fin) return "fin";
  if (debut && fin && c.iso > debut && c.iso < fin) return "dans";
  return "aucun";
}
