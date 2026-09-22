// Lecture métier de l'export « Base personnel » RH (fichier Excel), à partir de
// la matrice déjà lue par `xlsx-min.ts`. Ce module est PUR (aucun accès réseau
// ni zlib) donc testable.
//
// FORMAT DU FICHIER (une feuille, lignes groupées par section)
//   Section : D089STUSATL11 atelier 1 équipe verte      <- en-tête de groupe (col A)
//   Matricule | Civilite | Nom | Prenom | | | Fonction | Type de contrat | Date début | | Date fin   <- en-têtes de colonnes
//   108415 | F | ABNER | MAEVA | | | OPERATRICE... | CDI | 45915 | |                 <- une personne
//   ...
//   Section : D089STUSATL12 atelier 1 equipe rouge
//   ...
//
// COLONNES UTILES (indices 0-based)
//   A(0)=Matricule  B(1)=Civilité(H/F)  C(2)=Nom  D(3)=Prénom
//   G(6)=Fonction   H(7)=Type de contrat  I(8)=Date début  K(10)=Date fin
//
// DÉCISIONS
//  - La « section » (atelier + équipe) est descriptive dans le fichier ; elle
//    est RATTACHÉE à un atelier/équipe Polaris via une correspondance choisie à
//    l'écran (le libellé du fichier ne matche pas forcément les noms Polaris).
//  - Les dates sont des SÉRIES Excel (nombre de jours depuis le 1899-12-30).

const COL = { matricule: 0, civilite: 1, nom: 2, prenom: 3, fonction: 6, type: 7, debut: 8, fin: 10 } as const;

export type PersonneImport = {
  ligne: number; // n° de ligne dans le fichier (1-based), pour l'affichage
  matricule: string; // peut être vide
  sexe: "H" | "F" | null;
  nom: string;
  prenom: string;
  fonction: string;
  typeSource: string; // brut, tel qu'écrit (« CDI », « INT », «»)
  dateDebut: string | null; // ISO (AAAA-MM-JJ)
  dateFin: string | null;
  section: string; // libellé de section du fichier (« atelier 1 équipe verte »)
};

export type FichierBasePersonnel = {
  personnes: PersonneImport[];
  sections: string[]; // sections distinctes, dans l'ordre d'apparition
};

// Série Excel -> ISO. Base 1899-12-30 (le bug historique de l'an 1900 est
// absorbé par cette base, standard côté SheetJS). null si non numérique.
export function serieExcelVersIso(v: string): string | null {
  const s = v.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.floor(Number(s));
  if (n <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// « Section : D089STUSATL11 atelier 1 équipe verte » -> « atelier 1 équipe verte ».
// On retire le préfixe et le premier token (code technique de section).
function libelleSection(cellA: string): string {
  const reste = cellA.replace(/^Section\s*:\s*/i, "").trim();
  const parts = reste.split(/\s+/);
  // Le 1er token est le code (D089STUSATL11) : on garde le reste s'il existe.
  return parts.length > 1 ? parts.slice(1).join(" ") : reste;
}

/** Découpe la matrice en personnes + liste des sections. Tolérant : ignore les
 *  lignes d'en-tête, de section vide, et les lignes sans nom. */
export function parseBasePersonnel(matrice: string[][]): FichierBasePersonnel {
  const personnes: PersonneImport[] = [];
  const sections: string[] = [];
  let sectionCourante = "";

  for (let r = 0; r < matrice.length; r++) {
    const row = matrice[r];
    const a = (row[COL.matricule] ?? "").trim();

    // En-tête de groupe / de colonnes : détectés sur la colonne A.
    if (/^Section\s*:/i.test(a)) {
      sectionCourante = libelleSection(a);
      if (sectionCourante && !sections.includes(sectionCourante)) sections.push(sectionCourante);
      continue;
    }
    if (a === "Matricule") continue; // ligne d'en-tête de colonnes

    // Une personne est repérée par son NOM/PRÉNOM, pas par son matricule : une
    // personne sans matricule (col A vide) ne doit pas être perdue.
    const nom = (row[COL.nom] ?? "").trim();
    const prenom = (row[COL.prenom] ?? "").trim();
    if (!nom && !prenom) continue; // ligne vide ou de service

    const civ = (row[COL.civilite] ?? "").trim().toUpperCase();
    personnes.push({
      ligne: r + 1,
      matricule: a,
      sexe: civ === "H" ? "H" : civ === "F" ? "F" : null,
      nom,
      prenom,
      fonction: (row[COL.fonction] ?? "").trim(),
      typeSource: (row[COL.type] ?? "").trim(),
      dateDebut: serieExcelVersIso(row[COL.debut] ?? ""),
      dateFin: serieExcelVersIso(row[COL.fin] ?? ""),
      section: sectionCourante,
    });
  }

  return { personnes, sections };
}

// ------------------------------------------------------------------
// Résolution du type de contrat
// ------------------------------------------------------------------

/** Traduit le code de contrat du fichier vers un code Polaris autorisé.
 *  « INT » -> « INTERIM » ; vide -> défaut. Sinon on garde le code s'il est
 *  connu, à défaut le défaut. */
export function resoudreTypeContrat(source: string, codesAutorises: string[], defaut = "CDI"): string {
  const up = source.trim().toUpperCase();
  const set = new Set(codesAutorises.map((c) => c.toUpperCase()));
  if (up === "") return set.has(defaut) ? defaut : codesAutorises[0] ?? defaut;
  if (up === "INT" || up === "INTERIM" || up === "INTÉRIM") {
    if (set.has("INTERIM")) return "INTERIM";
  }
  if (set.has(up)) return up;
  return set.has(defaut) ? defaut : codesAutorises[0] ?? defaut;
}

// ------------------------------------------------------------------
// Suggestion de correspondance section -> atelier / équipe
// ------------------------------------------------------------------

// Mots de liaison écartés du score : trop fréquents pour discriminer.
const BRUIT = new Set(["atelier", "equipe", "team", "de", "du", "la", "le", "les", "d"]);

function tokens(v: string): Set<string> {
  const sansAccents = v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const out = new Set<string>();
  for (const t of sansAccents.split(/[^a-z0-9]+/)) {
    if (!t) continue;
    if (BRUIT.has(t)) continue;
    out.add(t);
  }
  return out;
}

type Ref = { id: string; nom: string };

// Meilleur candidat par intersection de tokens (> 0), sinon null.
function meilleur(sectionTokens: Set<string>, refs: Ref[]): string | null {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const ref of refs) {
    const t = tokens(ref.nom);
    let score = 0;
    for (const x of t) if (sectionTokens.has(x)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestId = ref.id;
    }
  }
  return bestId;
}

export type Correspondance = { atelierId: string | null; equipeId: string | null };

/** Pré-suggère (atelier, équipe) pour une section, par recoupement de mots.
 *  Best-effort : renvoie null quand rien ne recoupe (l'utilisateur choisit). */
export function suggererCorrespondance(section: string, ateliers: Ref[], equipes: Ref[]): Correspondance {
  const t = tokens(section);
  return { atelierId: meilleur(t, ateliers), equipeId: meilleur(t, equipes) };
}
