// Lecture et appariement du CSV d'absences exporté par le logiciel RH (GT).
//
// FORMAT DU FICHIER (séparateur « ; », une ligne par jour)
//   ;;;;;;;;
//   Section : D089STUSATL11 atelier 1 équipe verte
//   Matricule : 108432 ARHZAF MUSTAPHA
//   Date;Motif;Libellé;Valorisation;Jours;Nombre;Heures;H début;H fin
//   31/08/26;00MPSH;Mal.Prof.Sans Hospitalisation;Jours;1; ;07:00; ;
//   ...
//   Total Matricule;;7;0;35:00;;
//   Total Section;;123;0;731:30;;
//
// DÉCISIONS MÉTIER (cf. discussion 2026-09-08)
//  - Chaque ligne datée = UNE journée entière d'absence, quelle que soit la
//    durée (07:00, 05:00, 03:30) ou la valorisation (Jours / Heure). Polaris
//    ne modélise pas la demi-journée d'absence.
//  - Les MATRICULES du fichier ne correspondent PAS à ceux de Polaris :
//    l'appariement se fait par NOM (voir apparier()), les cas douteux étant
//    résolus à la main puis mémorisés (table import_absence_personne).
//
// Ce module est PUR (aucun accès réseau/DB) donc testable.

export type LigneAbsenceRh = { dateIso: string; codeGt: string; libelle: string };

export type PersonneRh = {
  matriculeRh: string;
  nomComplet: string; // tel qu'écrit dans le fichier, ex. « LE CLAINCHE ANTHONY »
  section: string; // section GT en cours (ex. « atelier 1 équipe verte »), à titre indicatif
  jours: LigneAbsenceRh[]; // dédoublonnés par date (dernière ligne gagne)
};

export type FichierAbsencesRh = {
  personnes: PersonneRh[];
  /** code GT -> libellé (premier vu), catalogue des motifs présents dans le fichier. */
  motifs: Map<string, string>;
  dateMin: string | null; // ISO, borne basse de la fenêtre couverte
  dateMax: string | null; // ISO, borne haute
};

// « 31/08/26 » -> « 2026-08-31 ». null si la cellule n'est pas une date jj/mm/aa.
function dateFrVersIso(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [, jj, mm, aa] = m;
  const j = Number(jj);
  const mo = Number(mm);
  if (mo < 1 || mo > 12 || j < 1 || j > 31) return null;
  return `20${aa}-${mm}-${jj}`;
}

/** Découpe le CSV en structure exploitable. Tolérant : ignore les lignes de
 *  total, de section vide et les en-têtes de colonnes. */
export function parseFichierAbsencesRh(texte: string): FichierAbsencesRh {
  const personnes: PersonneRh[] = [];
  const motifs = new Map<string, string>();
  let courante: PersonneRh | null = null;
  let section = "";
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  const lignes = texte.split(/\r\n|\r|\n/);
  for (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne || /^;+$/.test(ligne)) continue;

    if (ligne.startsWith("Section :")) {
      // « Section : D089STUSATL11 atelier 1 équipe verte » — on garde le
      // libellé lisible (après le code technique), purement indicatif.
      const reste = ligne.slice("Section :".length).trim();
      const parts = reste.split(/\s+/);
      section = parts.slice(1).join(" ") || reste;
      courante = null;
      continue;
    }

    if (ligne.startsWith("Matricule :")) {
      // « Matricule : 108432 ARHZAF MUSTAPHA » — 1er token = matricule RH,
      // le reste = nom complet (nom + prénom, parfois composé/suffixé).
      const reste = ligne.slice("Matricule :".length).trim().replace(/;+$/, "");
      const parts = reste.split(/\s+/);
      const matriculeRh = parts[0] ?? "";
      const nomComplet = parts.slice(1).join(" ").trim();
      courante = { matriculeRh, nomComplet, section, jours: [] };
      personnes.push(courante);
      continue;
    }

    // Lignes de service ignorées.
    if (ligne.startsWith("Total") || ligne.startsWith("Date;")) continue;

    // Ligne de données : cellule 0 = date, 1 = code GT, 2 = libellé.
    const cells = ligne.split(";");
    const dateIso = dateFrVersIso(cells[0] ?? "");
    if (!dateIso || !courante) continue;
    const codeGt = (cells[1] ?? "").trim();
    const libelle = (cells[2] ?? "").trim();
    if (!codeGt) continue;

    // Dédoublonnage par date (dernière ligne gagne).
    const idx = courante.jours.findIndex((j) => j.dateIso === dateIso);
    const jour: LigneAbsenceRh = { dateIso, codeGt, libelle };
    if (idx >= 0) courante.jours[idx] = jour;
    else courante.jours.push(jour);

    if (!motifs.has(codeGt)) motifs.set(codeGt, libelle);
    if (!dateMin || dateIso < dateMin) dateMin = dateIso;
    if (!dateMax || dateIso > dateMax) dateMax = dateIso;
  }

  // On écarte les blocs matricule sans aucun jour retenu.
  return { personnes: personnes.filter((p) => p.jours.length > 0), motifs, dateMin, dateMax };
}

// -------------------------------------------------------------------------
// Appariement par NOM
// -------------------------------------------------------------------------

// Bruit de contrat parfois accolé au nom dans l'export (« BRIEND MATHIEU CDI »).
const TOKENS_BRUIT = new Set(["CDI", "CDD", "INTERIM", "INTÉRIM", "STAGE", "ALTERNANCE"]);

/** Jeu de tokens normalisés d'un nom : sans accents, en capitales, ponctuation
 *  éclatée, tokens de bruit et mono-lettres retirés. Ex. « Le Clainché, Anthony »
 *  -> {LE, CLAINCHE, ANTHONY}. */
export function tokensNom(v: string): Set<string> {
  const sansAccents = v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
  const out = new Set<string>();
  for (const t of sansAccents.split(/[^A-Z0-9]+/)) {
    if (t.length < 2) continue;
    if (TOKENS_BRUIT.has(t)) continue;
    out.add(t);
  }
  return out;
}

function inclus(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function egaux(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && inclus(a, b);
}
function intersection(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export type PersonnePolaris = { id: string; nom: string; prenom: string };

export type Candidat = { personneId: string; libelle: string; score: number };

export type StatutAppariement = "appris" | "auto" | "ambigu" | "inconnu";

export type ResultatAppariement = {
  matriculeRh: string;
  nomComplet: string;
  section: string;
  nbJours: number;
  statut: StatutAppariement;
  /** Personne retenue par défaut (apprise, ou seule correspondance exacte, ou
   *  meilleur candidat), à confirmer/corriger dans l'aperçu. null = à choisir. */
  personneId: string | null;
  ignorer: boolean; // vrai si une équivalence apprise dit « ignorer ce matricule »
  candidats: Candidat[]; // suggestions ordonnées (meilleur d'abord)
};

export type EquivalenceApprise = { personneId: string | null; ignorer: boolean };

/** Apparie chaque bloc matricule du fichier à une personne Polaris.
 *  Priorité : équivalence apprise > correspondance exacte unique > candidats.
 */
export function apparier(
  personnesRh: PersonneRh[],
  personnesPolaris: PersonnePolaris[],
  apprises: Record<string, EquivalenceApprise>,
): ResultatAppariement[] {
  const index = personnesPolaris.map((p) => ({
    p,
    libelle: `${p.nom} ${p.prenom}`.trim(),
    tokens: tokensNom(`${p.nom} ${p.prenom}`),
  }));
  const parId = new Map(personnesPolaris.map((p) => [p.id, p]));

  return personnesRh.map((rh) => {
    const base = {
      matriculeRh: rh.matriculeRh,
      nomComplet: rh.nomComplet,
      section: rh.section,
      nbJours: rh.jours.length,
    };

    // 1) Équivalence apprise : on n'interroge plus l'utilisateur.
    const appr = apprises[rh.matriculeRh];
    if (appr && (appr.ignorer || (appr.personneId && parId.has(appr.personneId)))) {
      return {
        ...base,
        statut: "appris" as const,
        personneId: appr.ignorer ? null : appr.personneId,
        ignorer: appr.ignorer,
        candidats: [],
      };
    }

    // 2) Score contre tout l'effectif.
    const rhTokens = tokensNom(rh.nomComplet);
    const exacts: Candidat[] = [];
    const partiels: Candidat[] = [];
    for (const { p, libelle, tokens } of index) {
      if (egaux(rhTokens, tokens)) {
        exacts.push({ personneId: p.id, libelle, score: 1000 });
        continue;
      }
      const inter = intersection(rhTokens, tokens);
      // Candidat crédible : l'un est inclus dans l'autre, avec ≥ 2 tokens communs
      // (un seul token commun — un prénom fréquent — est trop faible).
      if (inter >= 2 && (inclus(tokens, rhTokens) || inclus(rhTokens, tokens))) {
        partiels.push({ personneId: p.id, libelle, score: inter });
      }
    }

    if (exacts.length === 1) {
      return { ...base, statut: "auto" as const, personneId: exacts[0].personneId, ignorer: false, candidats: exacts };
    }

    const candidats = [...exacts, ...partiels]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (candidats.length === 0) {
      return { ...base, statut: "inconnu" as const, personneId: null, ignorer: false, candidats: [] };
    }
    // Exacts multiples OU partiels : on laisse l'utilisateur trancher, meilleur
    // candidat pré-sélectionné.
    return { ...base, statut: "ambigu" as const, personneId: candidats[0].personneId, ignorer: false, candidats };
  });
}
