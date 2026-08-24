// Quarts : sortir les codes du code applicatif.
//
// La table `quart` est du parametrage (libelle, horaires, ordre), mais deux
// regles etaient recopiees en dur un peu partout :
//
//  1. le quart SELECTIONNE par defaut a l'ouverture du Planning et du Placement ;
//  2. le quart attribue a un placement HISTORIQUE dont `quart_code` est NULL
//     (donnees anterieures a la migration 0014, qui a introduit la colonne).
//
// Ces deux regles vivent desormais ici, et prennent la liste des quarts du site
// en argument. Ajouter, renommer ou retirer un quart redevient du parametrage.
//
// ⚠️ Les deux regles etaient INCOHERENTES entre ecrans : `/api/placement/cell`,
// la copie de journee, l'affichage TV et le bilan de couverture lisaient
// `quart_code ?? "matin"`, tandis que `/planning` lisait `quartCodes[0]` — soit
// « journee », qui porte l'ordre 0. Les memes placements historiques
// apparaissaient donc sous deux quarts differents selon l'ecran.

export type QuartRef = { code: string; ordre?: number };

// Code technique d'un quart, derive de son libelle : minuscules, sans accents,
// mots relies par « _ ». Sert de cle (code, site_id) et de valeur stockee dans
// les 10 tables enfants. « Apres-midi » -> « apres_midi », « Journée » ->
// « journee ». Un libelle « Matin » redonne « matin », le quart prefere par
// defaut (cf. quartParDefaut) — la convention reste donc atteignable sans code
// en dur. Renvoie "" si le libelle ne contient aucune lettre ni chiffre.
export function slugifyQuart(libelle: string): string {
  return libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Quart affiche a l'ouverture d'un ecran.
//
// Regle : « matin » s'il existe, sinon le premier dans l'ordre d'affichage.
// La preference pour « matin » n'est PAS un reliquat : c'est le comportement
// attendu par les utilisateurs (cf. CLAUDE.md, « Defaut planning = matin »), et
// le premier quart dans l'ordre est « journee ». Pour un site qui n'aurait pas
// de quart nomme « matin », l'ordre d'affichage decide — donc plus rien a
// modifier dans le code.
export function quartParDefaut(quarts: QuartRef[]): string {
  if (!quarts.length) return "";
  const parOrdre = [...quarts].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  return parOrdre.find((q) => q.code === "matin")?.code ?? parOrdre[0].code;
}

// Quart d'un placement dont `quart_code` est NULL.
//
// La migration 0038 a normalise les placements SUR POSTE concernes : ce repli ne
// devrait plus se declencher pour eux. Il reste pour les lignes sans poste
// (absence, jour non travaille), ou `quart_code` est NULL a dessein — une
// absence vaut pour toute la journee, tous quarts confondus.
export function quartLegacy(quarts: QuartRef[]): string {
  return quartParDefaut(quarts);
}

// Lecture d'un `quart_code` eventuellement nul, avec le repli ci-dessus.
export function quartOuDefaut(code: string | null | undefined, quarts: QuartRef[]): string {
  return code ?? quartLegacy(quarts);
}

// Le code correspond-il au quart demande, replis compris ? Sert partout ou l'on
// filtre des placements sur le quart affiche.
export function memeQuart(code: string | null | undefined, quart: string, quarts: QuartRef[]): boolean {
  return quartOuDefaut(code, quarts) === quart;
}
