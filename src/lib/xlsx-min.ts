import { inflateRawSync } from "node:zlib";

// Lecteur XLSX minimal, SANS dépendance externe.
//
// Un .xlsx est une archive ZIP contenant du XML (OOXML). On n'a besoin ici que
// de deux entrées : `xl/sharedStrings.xml` (le pool de chaînes) et la première
// feuille `xl/worksheets/sheet1.xml`. On lit l'archive à la main (répertoire
// central ZIP + inflate) et on aplatit la feuille en une matrice de chaînes.
//
// Contraintes assumées (suffisantes pour un export RH bureautique) :
//  - ZIP classique (pas zip64), méthodes STORE (0) ou DEFLATE (8) ;
//  - dates stockées en SÉRIE Excel (nombre) — la conversion en ISO se fait
//    dans le parseur métier, pas ici (ce module ne connaît pas la sémantique).
//
// Ce module touche à zlib : il n'est pas « pur ». La logique métier testable
// (groupement, dates, appariement) vit dans `import-personnel-rh.ts` et reçoit
// la matrice déjà lue.

type EntreeZip = { methode: number; tailleComp: number; offsetLocal: number };

function u16(b: Buffer, o: number) {
  return b.readUInt16LE(o);
}
function u32(b: Buffer, o: number) {
  return b.readUInt32LE(o);
}

// Répertoire central du ZIP : nom d'entrée -> position/méthode.
function lireRepertoire(buf: Buffer): Map<string, EntreeZip> {
  // End Of Central Directory : signature 0x06054b50, cherchée depuis la fin
  // (un commentaire ZIP éventuel la suit, d'où le balayage).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Archive invalide (pas de fin de répertoire ZIP).");
  const nb = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const entrees = new Map<string, EntreeZip>();
  for (let n = 0; n < nb; n++) {
    if (u32(buf, p) !== 0x02014b50) break; // en-tête de répertoire central
    const methode = u16(buf, p + 10);
    const tailleComp = u32(buf, p + 20);
    const lgNom = u16(buf, p + 28);
    const lgExtra = u16(buf, p + 30);
    const lgComm = u16(buf, p + 32);
    const offsetLocal = u32(buf, p + 42);
    const nom = buf.toString("utf8", p + 46, p + 46 + lgNom);
    entrees.set(nom, { methode, tailleComp, offsetLocal });
    p += 46 + lgNom + lgExtra + lgComm;
  }
  return entrees;
}

function lireEntree(buf: Buffer, e: EntreeZip): Buffer {
  let o = e.offsetLocal;
  if (u32(buf, o) !== 0x04034b50) throw new Error("En-tête local ZIP invalide.");
  const lgNom = u16(buf, o + 26);
  const lgExtra = u16(buf, o + 28);
  const debut = o + 30 + lgNom + lgExtra;
  const comp = buf.subarray(debut, debut + e.tailleComp);
  if (e.methode === 0) return Buffer.from(comp); // STORE
  if (e.methode === 8) return inflateRawSync(comp); // DEFLATE
  throw new Error(`Méthode de compression ZIP non gérée (${e.methode}).`);
}

// ------------------------------------------------------------------
// XML -> valeurs
// ------------------------------------------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // en dernier, pour ne pas ré-décoder les entités ci-dessus
}

// Pool de chaînes partagées : une entrée <si> peut contenir plusieurs <t>
// (texte enrichi), on les concatène.
function lireSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const textes: string[] = [];
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tre.exec(m[1])) !== null) textes.push(t[1]);
    out.push(decodeXml(textes.join("")));
  }
  return out;
}

// « G12 » -> { col: 6, ligne: 11 } (indices 0-based).
function refVersIndices(ref: string): { col: number; ligne: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, ligne: Number(m[2]) - 1 };
}

// Aplatit une feuille en matrice de chaînes. Cellule absente -> "".
function lireFeuille(xml: string, strings: string[]): string[][] {
  const rows: Map<number, Map<number, string>> = new Map();
  let maxCol = 0;
  let maxLigne = 0;

  // Capture chaque <c ...>...</c> ou <c .../> avec ses attributs et son contenu.
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2] ?? "";
    const refM = /\br="([A-Z]+\d+)"/.exec(attrs);
    if (!refM) continue;
    const idx = refVersIndices(refM[1]);
    if (!idx) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];

    let val = "";
    if (type === "s") {
      // Chaîne partagée : <v>index</v>.
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (v) val = strings[Number(v[1])] ?? "";
    } else if (type === "inlineStr") {
      const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      if (t) val = decodeXml(t[1]);
    } else if (type === "str") {
      // Résultat de formule (texte).
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (v) val = decodeXml(v[1]);
    } else {
      // Nombre, booléen, date-série : la valeur brute suffit (la sémantique
      // — série de date, etc. — est traitée par l'appelant).
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (v) val = v[1];
    }

    let ligne = rows.get(idx.ligne);
    if (!ligne) {
      ligne = new Map();
      rows.set(idx.ligne, ligne);
    }
    ligne.set(idx.col, val);
    if (idx.col > maxCol) maxCol = idx.col;
    if (idx.ligne > maxLigne) maxLigne = idx.ligne;
  }

  const matrice: string[][] = [];
  for (let r = 0; r <= maxLigne; r++) {
    const ligne = rows.get(r);
    const arr: string[] = new Array(maxCol + 1).fill("");
    if (ligne) for (const [c, v] of ligne) arr[c] = v;
    matrice.push(arr);
  }
  return matrice;
}

/**
 * Lit la PREMIÈRE feuille d'un classeur XLSX et la renvoie en matrice de
 * chaînes (matrice[ligne][colonne], 0-based). Les dates restent en série
 * Excel (nombre) — à convertir par l'appelant.
 */
export function lirePremiereFeuilleXlsx(source: ArrayBuffer | Buffer): string[][] {
  const buf = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const entrees = lireRepertoire(buf);

  const ssEntry = entrees.get("xl/sharedStrings.xml");
  const strings = ssEntry ? lireSharedStrings(lireEntree(buf, ssEntry).toString("utf8")) : [];

  // Première feuille : sheet1.xml sinon la plus petite entrée sheetN.xml.
  let nomFeuille = "xl/worksheets/sheet1.xml";
  if (!entrees.has(nomFeuille)) {
    const feuilles = [...entrees.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();
    if (feuilles.length === 0) throw new Error("Aucune feuille de calcul dans le classeur.");
    nomFeuille = feuilles[0];
  }
  const sheetXml = lireEntree(buf, entrees.get(nomFeuille)!).toString("utf8");
  return lireFeuille(sheetXml, strings);
}
