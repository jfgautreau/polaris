// Vue « Par poste » du Planning (tasks/planning-par-poste.md) — règles pures.
//
// 1. `attribuerRangees` : un poste d'effectif N occupe N rangées (« places ») ; il
//    faut décider, chaque jour, sur quelle rangée tombe chaque personne placée.
//    Sans règle stable, les noms sauteraient d'une rangée à l'autre et les barres
//    « même personne plusieurs jours » ne se formeraient pas.
// 2. `classerCandidat` : groupe et raison d'une personne dans le panneau qui
//    s'ouvre sur une place vide.

export type PosteRangees = {
  /** Effectif requis sur le quart affiché (0 = tourne à 0). */
  effectif: number;
  /** Numéros de rotation du poste, dans l'ordre (`parseNumeros`) ; [] si aucun. */
  numeros: string[];
  /** Zone d'attente (0077) : aucune place requise, tout le monde en surnombre. */
  attente: boolean;
};
export type Occupant = { pid: string; numero: string | null };
export type Rangee = {
  /** Au-delà de l'effectif requis. */
  sur: boolean;
  /** Numéro de rotation de la place (rangée requise d'un poste numéroté), sinon null. */
  numero: string | null;
  /** Personne placée, jour par jour (index = jour affiché), ou null. */
  jours: (string | null)[];
};

// Ordre de placement d'une journée :
//   1. numéro de rotation — la personne prend la rangée de SON numéro ;
//   2. continuité — elle reprend la rangée REQUISE qu'elle tenait la dernière fois ;
//   3. première rangée requise libre ;
//   4. surnombre : sa rangée de surnombre précédente, sinon la première libre,
//      sinon une nouvelle.
// La continuité ne vaut d'abord que pour les rangées requises : une personne en
// surnombre la veille remonte sur une place requise restée vide, plutôt que de
// laisser « à pourvoir » à côté d'un surnombre.
export function attribuerRangees(poste: PosteRangees, occupantsParJour: Occupant[][], nbJours: number): Rangee[] {
  const req = poste.attente ? 0 : Math.max(0, poste.effectif);
  const rangees: Rangee[] = Array.from({ length: req }, (_, i) => ({
    sur: false,
    numero: poste.numeros[i] ?? null,
    jours: new Array<string | null>(nbJours).fill(null),
  }));
  const derniere = new Map<string, number>();

  for (let d = 0; d < nbJours; d++) {
    const prises = new Set<number>();
    const poser = (pid: string, i: number) => {
      rangees[i].jours[d] = pid;
      prises.add(i);
      derniere.set(pid, i);
    };
    const libreRequise = () => {
      for (let i = 0; i < req; i++) if (!prises.has(i)) return i;
      return -1;
    };

    let reste: Occupant[] = [];
    for (const o of occupantsParJour[d] ?? []) {
      const i = o.numero == null ? -1 : poste.numeros.indexOf(o.numero);
      if (i >= 0 && i < req && !prises.has(i)) poser(o.pid, i);
      else reste.push(o);
    }

    const apresContinuite: Occupant[] = [];
    for (const o of reste) {
      const i = derniere.get(o.pid);
      if (i !== undefined && i < req && !prises.has(i)) poser(o.pid, i);
      else apresContinuite.push(o);
    }

    reste = [];
    for (const o of apresContinuite) {
      const i = libreRequise();
      if (i >= 0) poser(o.pid, i);
      else reste.push(o);
    }

    for (const o of reste) {
      const prec = derniere.get(o.pid);
      let i = prec !== undefined && prec >= req && !prises.has(prec) ? prec : -1;
      if (i < 0) for (let k = req; k < rangees.length; k++) if (!prises.has(k)) { i = k; break; }
      if (i < 0) {
        rangees.push({ sur: true, numero: null, jours: new Array<string | null>(nbJours).fill(null) });
        i = rangees.length - 1;
      }
      poser(o.pid, i);
    }
  }
  return rangees;
}

// ─── Candidats d'une place vide ───────────────────────────────────────────────

export type GroupeCandidat = "attente" | "competent" | "niveau" | "habilitation" | "deplacer" | "exclu";

/** Ordre et libellés des groupes du panneau. */
export const GROUPES_CANDIDATS: { cle: GroupeCandidat; libelle: string }[] = [
  { cle: "attente", libelle: "À répartir · zone d'attente" },
  { cle: "competent", libelle: "Disponibles · compétents" },
  { cle: "niveau", libelle: "Disponibles · niveau insuffisant" },
  { cle: "habilitation", libelle: "Sans l'habilitation exigée · confirmation" },
  { cle: "deplacer", libelle: "Déjà placés sur ce quart · déplacer" },
  { cle: "exclu", libelle: "Non proposés" },
];

export type SituationCandidat = {
  /** La personne est dans le périmètre de l'utilisateur (chef d'équipe). */
  editable: boolean;
  /** Raison d'indisponibilité ce jour-là (absent, TP, hors effectif, autre quart), sinon null. */
  indispo: string | null;
  /** Poste occupé ce jour-là sur le quart affiché, sinon null. */
  posteOccupe: string | null;
  /** Le poste occupé est une zone d'attente. */
  posteOccupeAttente: boolean;
  /** Nom du poste occupé (pour « sur X »). */
  posteOccupeNom: string;
  /** Niveau dans la matrice sur le poste visé (-1 = restriction, absent = 0). */
  niveau: number;
  niveauMin: number;
  /** Habilitations exigées par le poste visé que la personne n'a pas (ou plus). */
  habManquantes: string[];
};

export function classerCandidat(posteVise: string, s: SituationCandidat): { groupe: GroupeCandidat; raison: string } {
  if (!s.editable) return { groupe: "exclu", raison: "hors de vos équipes" };
  if (s.indispo) return { groupe: "exclu", raison: s.indispo };
  if (s.posteOccupe === posteVise) return { groupe: "exclu", raison: "déjà sur ce poste" };
  const hab = s.habManquantes.length ? `sans ${s.habManquantes.join(", ")}` : "";
  const niv = s.niveau === -1 ? "restriction" : s.niveau < s.niveauMin ? "niveau insuffisant" : "";
  if (s.posteOccupe && s.posteOccupeAttente) {
    return { groupe: "attente", raison: [hab, niv].filter(Boolean).join(" · ") || "à répartir" };
  }
  if (s.posteOccupe) return { groupe: "deplacer", raison: [`sur ${s.posteOccupeNom}`, hab].filter(Boolean).join(" · ") };
  if (hab) return { groupe: "habilitation", raison: hab };
  if (niv) return { groupe: "niveau", raison: niv };
  return { groupe: "competent", raison: "" };
}
