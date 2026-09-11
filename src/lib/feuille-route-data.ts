// Rapport « Projection de compétences pour feuille de route » — couche données.
//
// Grille projetée sur 12 semaines glissantes (lundi de la semaine courante →
// 11 semaines suivantes). Une cellule = nombre de personnes du service
// d'affectation qui :
//   - sont disponibles cette semaine (contrat couvre le lundi ; pas d'absence
//     PLEINE SEMAINE — 5 jours ouvrés) ;
//   - ont AU MOINS UN poste ACTIF de la catégorie C avec niveau ACTUEL == N,
//     N étant le MAX de leurs niveaux dans cette catégorie (décision
//     2026-09-11 : une personne = un seul niveau par catégorie, le plus
//     haut — la somme des lignes d'une catégorie donne l'effectif) ;
//   - option `habilitationStricte = true` : la comparaison ne retient que
//     les postes dont TOUTES les habilitations exigées sont valides à la
//     date du lundi (une personne dont l'habilitation « chariot » a expiré
//     redescend au max de ses AUTRES postes conducteur).
//
// Le NIVEAU_MIN_REQUIS du poste est ignoré — on mesure la compétence acquise
// (pastille de la matrice), pas la capacité opérationnelle (celle-ci est le
// domaine de « Polyvalence & compétences »).
//
// Le service = ATELIER D'AFFECTATION DE LA PERSONNE (`personne.atelier_id`).
// Une compétence Fab tenue par un Condi compte dans la colonne Condi.
//
// La ligne « Cible » n'est calculée QU'AU NIVEAU seuil_competent du site (2
// par défaut), en agrégeant `poste.objectif_cible` sur les postes actifs de
// la catégorie. `objectif_cible` étant un objectif « ≥ seuil » et non un
// objectif par niveau exact, l'afficher sur chaque ligne serait trompeur.

export type Semaine = { lundi: string; num: number; annee: number };

export type Personne = {
  id: string;
  atelier_id: string | null;
  equipe_id: string | null;
};

export type Poste = {
  id: string;
  atelier_id: string | null; // hérité de la ligne — sert à ventiler le Besoin par service
  actif: boolean;
  categorie: string; // manager | conducteur | operateur
  effectif_requis: number; // abaque (besoin) par poste et PAR QUART
  // Nombre de quarts POSTÉS du poste (matin/après-midi/nuit… — la journée ne
  // compte que si c'est le seul quart, cf. `quartsEffectifs` du loader). Le
  // besoin d'un poste = effectif_requis × nbQuartsPostes : 1 manager sur
  // matin + après-midi = besoin 2. Calculé au chargement (référentiel).
  nbQuartsPostes: number;
};

export type MatCell = { personne_id: string; poste_id: string; niveau_actuel: number };

export type Contrat = { personne_id: string; date_debut: string; date_fin: string | null };

export type Atelier = { id: string; nom: string };

export const CATEGORIES = [
  { key: "manager", label: "Managers" },
  { key: "conducteur", label: "Conducteurs" },
  { key: "operateur", label: "Opérateurs" },
] as const;

export type Categorie = (typeof CATEGORIES)[number]["key"];

export type LigneNiveau = { niveau: number; parSemaine: number[] };
export type BlocCategorie = {
  cat: Categorie;
  catLabel: string;
  // Besoin (abaque) : somme des effectif_requis sur les postes actifs de la
  // catégorie DANS L'ATELIER du service (via leur ligne). Constant sur les 24
  // semaines : c'est un abaque de référentiel, pas une charge datée.
  besoin: number;
  niveaux: LigneNiveau[]; // 1..nbNiveaux
};
export type BlocService = {
  atelierId: string;
  atelierNom: string;
  blocs: BlocCategorie[];
};
export type Grille = {
  semaines: Semaine[];
  services: BlocService[];
};

// --- Utilitaires date -----------------------------------------------------

// ISO (YYYY-MM-DD) du lundi de la semaine ISO contenant `d`. Local time
// (aucun décalage TZ dans l'application, on manipule des dates civiles).
export function lundiIsoDe(d: Date): string {
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  const lun = new Date(d);
  lun.setDate(d.getDate() - dow);
  lun.setHours(0, 0, 0, 0);
  const y = lun.getFullYear();
  const m = String(lun.getMonth() + 1).padStart(2, "0");
  const j = String(lun.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}

export function ajouteJours(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}

// Numéro de semaine ISO (règle du jeudi).
export function numeroSemaineIso(iso: string): { num: number; annee: number } {
  const d = new Date(iso + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const num = 1 + Math.round((firstThursday - target.valueOf()) / 604800000);
  return { num, annee: target.getFullYear() };
}

export function construireSemaines(pivotIso: string, nb: number): Semaine[] {
  const lundi0 = lundiIsoDe(new Date(pivotIso + "T00:00:00"));
  const out: Semaine[] = [];
  for (let i = 0; i < nb; i++) {
    const iso = ajouteJours(lundi0, i * 7);
    const { num, annee } = numeroSemaineIso(iso);
    out.push({ lundi: iso, num, annee });
  }
  return out;
}

// --- Prédicats métier -----------------------------------------------------

// Une personne est « en effectif » le lundi de la semaine si l'un de ses
// contrats couvre ce jour-là. Fin ouverte (`date_fin` null) = jamais fini.
export function personneEnEffectifLundi(
  contrats: Contrat[],
  lundi: string,
): boolean {
  for (const c of contrats) {
    if (c.date_debut > lundi) continue;
    if (c.date_fin && c.date_fin < lundi) continue;
    return true;
  }
  return false;
}

// « Semaine complète d'absence » = 5 jours ouvrés (lun→ven) tous marqués
// absents. Les samedis / dimanches ne comptent pas dans le critère (une
// personne absente lun-ven mais qui travaille le samedi est jugée en
// « pleine semaine d'absence », ce qui reflète le sens métier).
export function semainePleineAbsence(
  joursAbsentsDeLaPersonne: Set<string>,
  lundi: string,
): boolean {
  for (let i = 0; i < 5; i++) {
    if (!joursAbsentsDeLaPersonne.has(ajouteJours(lundi, i))) return false;
  }
  return true;
}

// Habilitation valide un jour donné : pas d'expiration OU expiration ≥ jour.
export function habilitationValideAu(exp: string | null | undefined, jour: string): boolean {
  if (!exp) return true;
  return exp >= jour;
}

// Nombre de quarts POSTÉS d'un poste, pour le besoin. `quartsActifs` = les
// quarts sur lesquels le poste tourne (référentiel : tous sauf désactivés).
// `journeeCode` = quart « pleine journée » (sans créneau, plus petit ordre) —
// détection identique à l'ordonnancement / assez-competences. La journée est
// un AGRÉGAT : elle ne compte QUE si c'est le seul quart du poste (poste en
// régulière), sinon elle doublonnerait matin + après-midi + nuit. Ainsi
// « matin + après-midi » = 2, « journée seule » = 1, « matin + AM + nuit » = 3.
export function nbQuartsPostesDe(quartsActifs: string[], journeeCode: string | null): number {
  const postes = journeeCode ? quartsActifs.filter((c) => c !== journeeCode) : quartsActifs;
  if (postes.length > 0) return postes.length;
  return quartsActifs.length > 0 ? 1 : 0; // journée seule = régulière (1) ; aucun quart = 0
}

// --- Calcul principal -----------------------------------------------------

export type Params = {
  personnes: Personne[];
  postes: Poste[];
  matrice: MatCell[];
  // Contrats indexés par personne.
  contratsParPersonne: Map<string, Contrat[]>;
  // Jours d'absence par personne (motif renseigné).
  absencesParPersonne: Map<string, Set<string>>;
  // Habilitations exigées par poste : posteId → competenceId[].
  posteCompRequise: Map<string, string[]>;
  // Habilitations d'une personne : personneId → competenceId → date_expiration.
  competencesPersonne: Map<string, Map<string, string | null>>;
  ateliers: Atelier[];
  ateliersFiltre?: string[] | null;
  equipesFiltre?: string[] | null;
  semaines: Semaine[];
  nbNiveaux: number;
  habilitationStricte: boolean;
};

// Retourne, pour une personne à une date donnée, le max de son niveau dans
// CHAQUE catégorie (parmi ses postes actifs). Exporté pour tests unitaires.
export function maxParCategorieAuJour(
  personneId: string,
  jour: string,
  matriceIndex: Map<string, { posteId: string; niveau: number; cat: string }[]>,
  posteCompRequise: Map<string, string[]>,
  competencesPersonne: Map<string, Map<string, string | null>>,
  habilitationStricte: boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  const cells = matriceIndex.get(personneId);
  if (!cells) return out;
  const compsPers = competencesPersonne.get(personneId) ?? new Map<string, string | null>();
  for (const cell of cells) {
    if (habilitationStricte) {
      const requis = posteCompRequise.get(cell.posteId) ?? [];
      const ok = requis.every((cid) => compsPers.has(cid) && habilitationValideAu(compsPers.get(cid) ?? null, jour));
      if (!ok) continue;
    }
    const prev = out.get(cell.cat) ?? 0;
    if (cell.niveau > prev) out.set(cell.cat, cell.niveau);
  }
  return out;
}

export function calculerGrille(p: Params): Grille {
  const {
    personnes, postes, matrice, contratsParPersonne, absencesParPersonne,
    posteCompRequise, competencesPersonne, ateliers,
    ateliersFiltre, equipesFiltre, semaines, nbNiveaux,
    habilitationStricte,
  } = p;

  const posteById = new Map(postes.map((po) => [po.id, po]));
  const ateliersRetenus = ateliersFiltre && ateliersFiltre.length > 0 ? new Set(ateliersFiltre) : null;
  const equipesRetenues = equipesFiltre && equipesFiltre.length > 0 ? new Set(equipesFiltre) : null;

  // Index matrice → parPersonne : [(posteId, niveau, cat)] pour les niveaux
  // positifs sur postes actifs de catégorie reconnue.
  const catValides = new Set<string>(CATEGORIES.map((c) => c.key));
  const parPersonne = new Map<string, { posteId: string; niveau: number; cat: string }[]>();
  for (const m of matrice) {
    if (m.niveau_actuel <= 0) continue;
    const po = posteById.get(m.poste_id);
    if (!po || !po.actif) continue;
    if (!catValides.has(po.categorie)) continue;
    let arr = parPersonne.get(m.personne_id);
    if (!arr) { arr = []; parPersonne.set(m.personne_id, arr); }
    arr.push({ posteId: m.poste_id, niveau: m.niveau_actuel, cat: po.categorie });
  }

  // Personnes retenues par filtre atelier d'affectation + équipe.
  const persRetenues = personnes.filter((pe) => {
    if (ateliersRetenus && !ateliersRetenus.has(pe.atelier_id ?? "")) return false;
    if (equipesRetenues && !equipesRetenues.has(pe.equipe_id ?? "")) return false;
    return true;
  });

  const atelierNomById = new Map(ateliers.map((a) => [a.id, a.nom]));
  const atelierIdsRetenus = new Set(persRetenues.map((pe) => pe.atelier_id).filter((x): x is string => !!x));

  // Besoin par (atelier, catégorie), agrégé sur les postes actifs de la
  // catégorie rattachés à l'atelier via leur ligne (poste.atelier_id hérité
  // au chargement). Un atelier sans poste d'une catégorie n'aura pas de besoin
  // pour cette catégorie — c'est le comportement voulu.
  const besoinParCle = new Map<string, number>(); // "atelierId|cat" → int
  for (const po of postes) {
    if (!po.actif) continue;
    if (!catValides.has(po.categorie)) continue;
    if (!po.atelier_id) continue;
    const cle = `${po.atelier_id}|${po.categorie}`;
    // Besoin = effectif_requis × nombre de quarts postés (matin + après-midi
    // = 2, etc.). Un poste sans quart posté (nbQuartsPostes 0) ne contribue pas.
    besoinParCle.set(cle, (besoinParCle.get(cle) ?? 0) + (po.effectif_requis ?? 0) * (po.nbQuartsPostes ?? 0));
  }

  const services: BlocService[] = Array.from(atelierIdsRetenus)
    .map((id) => ({ id, nom: atelierNomById.get(id) ?? "?" }))
    .sort((a, b) => a.nom.localeCompare(b.nom))
    .map(({ id, nom }) => {
      const persAtelier = persRetenues.filter((pe) => pe.atelier_id === id);

      const blocs: BlocCategorie[] = CATEGORIES.map((c) => {
        const niveaux: LigneNiveau[] = Array.from({ length: nbNiveaux }, (_, i) => ({
          niveau: i + 1,
          parSemaine: Array(semaines.length).fill(0),
        }));

        for (let wi = 0; wi < semaines.length; wi++) {
          const lundi = semaines[wi].lundi;
          for (const pe of persAtelier) {
            const contrats = contratsParPersonne.get(pe.id) ?? [];
            if (!personneEnEffectifLundi(contrats, lundi)) continue;
            const jours = absencesParPersonne.get(pe.id) ?? new Set<string>();
            if (semainePleineAbsence(jours, lundi)) continue;

            const maxParCat = maxParCategorieAuJour(
              pe.id, lundi, parPersonne, posteCompRequise, competencesPersonne, habilitationStricte,
            );
            const n = maxParCat.get(c.key);
            if (n !== undefined && n >= 1 && n <= nbNiveaux) {
              niveaux[n - 1].parSemaine[wi]++;
            }
          }
        }

        const cle = `${id}|${c.key}`;
        const besoin = besoinParCle.get(cle) ?? 0;

        return { cat: c.key as Categorie, catLabel: c.label, besoin, niveaux };
      });

      return { atelierId: id, atelierNom: nom, blocs };
    });

  return { semaines, services };
}
