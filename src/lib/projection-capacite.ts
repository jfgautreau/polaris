// Projection de capacite : « avec mon effectif habilite, est-ce que je tiens le
// besoin, semaine par semaine, sans compter une personne deux fois ? »
//
// Le dedoublonnage est garanti par une AFFECTATION OPTIMALE (flot maximum). Pour
// un jour donne, on construit un graphe :
//
//   source --1--> personne --1--> (poste, quart) qualifie --eff_requis--> puits
//
// L'arc source->personne a capacite 1 : une personne = UNE place ce jour-la. Elle
// bouche donc au mieux UN poste, jamais cinq — c'est la reponse au probleme « une
// personne qui sait tenir 5 postes ne doit pas compter pour 5 ». Le flot maximum
// est le nombre de places reellement pourvoyables ; ce qui manque pour atteindre
// le besoin est la rupture, localisee poste par poste.
//
// Ce module est PUR (aucun acces reseau) et entierement testable. Le chargement
// des donnees (matrice, habilitations, besoin, rotation) est fait par l'appelant.

// ---------------------------------------------------------------------------
// 1. Max-flow generique (Dinic). Capacites entieres, petit graphe (~quelques
//    centaines de noeuds) — largement suffisant, appele une fois par jour ouvre.
// ---------------------------------------------------------------------------

type Arc = { to: number; cap: number; rev: number };

export class MaxFlow {
  private g: Arc[][];
  constructor(n: number) {
    this.g = Array.from({ length: n }, () => []);
  }
  addEdge(from: number, to: number, cap: number): void {
    this.g[from].push({ to, cap, rev: this.g[to].length });
    this.g[to].push({ to: from, cap: 0, rev: this.g[from].length - 1 });
  }
  private bfs(s: number, t: number, level: number[]): boolean {
    level.fill(-1);
    level[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const v = q[h];
      for (const e of this.g[v]) {
        if (e.cap > 0 && level[e.to] < 0) {
          level[e.to] = level[v] + 1;
          q.push(e.to);
        }
      }
    }
    return level[t] >= 0;
  }
  private dfs(v: number, t: number, f: number, level: number[], it: number[]): number {
    if (v === t) return f;
    for (; it[v] < this.g[v].length; it[v]++) {
      const e = this.g[v][it[v]];
      if (e.cap > 0 && level[v] < level[e.to]) {
        const d = this.dfs(e.to, t, Math.min(f, e.cap), level, it);
        if (d > 0) {
          e.cap -= d;
          this.g[e.to][e.rev].cap += d;
          return d;
        }
      }
    }
    return 0;
  }
  maxflow(s: number, t: number): number {
    const n = this.g.length;
    const level = new Array<number>(n);
    let flow = 0;
    while (this.bfs(s, t, level)) {
      const it = new Array<number>(n).fill(0);
      let f: number;
      while ((f = this.dfs(s, t, Infinity, level, it)) > 0) flow += f;
    }
    return flow;
  }
  // Capacite residuelle de l'arc `from -> to` apres calcul du flot. Sur un arc
  // (besoin -> puits) il n'existe qu'une seule arete vers le puits : sa capacite
  // residuelle est la part de l'effectif requis restee non couverte, donc la
  // rupture de ce besoin.
  residualToSink(from: number, to: number): number {
    for (const e of this.g[from]) if (e.to === to) return e.cap;
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 2. Modele metier d'un jour.
// ---------------------------------------------------------------------------

// Un besoin ouvert ce jour : un couple (poste, quart) avec son effectif requis.
// `cle` identifie la colonne de rupture (typiquement `${posteId}:${quart}`).
export type BesoinPoste = {
  cle: string;
  posteId: string;
  quart: string;
  effectifRequis: number;
  gabarit?: boolean; // true si le besoin vient de la semaine-type (futur non ordonnance)
};

// Une personne disponible ce jour, avec la liste des besoins qu'elle peut tenir.
// L'appelant a deja applique la qualification (matrice + habilitations datees) et,
// en couche calendrier, le filtre de quart : `peutTenir` ne contient que des cles
// de `besoins` reellement servables par cette personne ce jour-la.
export type PersonneDispo = {
  id: string;
  peutTenir: string[]; // cles de BesoinPoste
};

export type RuptureJour = { cle: string; posteId: string; quart: string; manque: number };

export type FlowJour = {
  besoin: number; // somme des effectifs requis
  couvrable: number; // flot maximum
  ruptures: RuptureJour[]; // besoins non entierement couverts
};

// Calcule l'affectation optimale d'un jour. Une personne = une place (cap 1).
export function buildJourFlow(personnes: PersonneDispo[], besoins: BesoinPoste[]): FlowJour {
  const besoinTot = besoins.reduce((s, b) => s + Math.max(0, b.effectifRequis), 0);
  if (besoinTot === 0) return { besoin: 0, couvrable: 0, ruptures: [] };

  // Indexation des noeuds : 0 = source, 1..P = personnes, P+1..P+B = besoins,
  // dernier = puits.
  const P = personnes.length;
  const idxBesoin = new Map<string, number>();
  besoins.forEach((b, i) => idxBesoin.set(b.cle, 1 + P + i));
  const source = 0;
  const puits = 1 + P + besoins.length;

  const mf = new MaxFlow(puits + 1);
  personnes.forEach((_, i) => mf.addEdge(source, 1 + i, 1));
  besoins.forEach((b, i) => mf.addEdge(1 + P + i, puits, Math.max(0, b.effectifRequis)));
  personnes.forEach((p, i) => {
    for (const cle of p.peutTenir) {
      const nb = idxBesoin.get(cle);
      if (nb !== undefined) mf.addEdge(1 + i, nb, 1);
    }
  });

  const couvrable = mf.maxflow(source, puits);

  // Rupture par besoin = capacite residuelle de l'arc (besoin -> puits) : ce qui
  // n'a pas ete sature est la part non couverte.
  const ruptures: RuptureJour[] = [];
  besoins.forEach((b, i) => {
    const residuel = mf.residualToSink(1 + P + i, puits);
    if (residuel > 0) ruptures.push({ cle: b.cle, posteId: b.posteId, quart: b.quart, manque: residuel });
  });

  return { besoin: besoinTot, couvrable, ruptures };
}

// ---------------------------------------------------------------------------
// 3. Agregation par semaine.
// ---------------------------------------------------------------------------

export type SemaineProjection = {
  semaine: string; // lundi ISO
  besoin: number;
  couvrable: number;
  taux: number; // couvrable / besoin, 1 si besoin nul
  postesEnRupture: string[]; // cles distinctes en rupture sur la semaine
  gabarit: boolean; // true si au moins un jour repose sur la semaine-type
};

// Somme les jours d'une semaine. `jours` = resultats de buildJourFlow pour chaque
// jour ouvre de la semaine ; `ruptureCles` = union des cles en rupture.
export function aggregerSemaine(
  semaine: string,
  jours: FlowJour[],
  gabarit: boolean
): SemaineProjection {
  const besoin = jours.reduce((s, j) => s + j.besoin, 0);
  const couvrable = jours.reduce((s, j) => s + j.couvrable, 0);
  const cles = new Set<string>();
  for (const j of jours) for (const r of j.ruptures) cles.add(r.cle);
  return {
    semaine,
    besoin,
    couvrable,
    taux: besoin === 0 ? 1 : couvrable / besoin,
    postesEnRupture: [...cles],
    gabarit,
  };
}
