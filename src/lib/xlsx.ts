// Générateur Excel (.xlsx) minimal, SANS dépendance (2026-10-20).
//
// Un .xlsx est une archive zip de quelques fichiers XML. On écrit l'archive en
// mode « stocké » (sans compression : quelques Ko pour quelques centaines de
// lignes) avec son CRC32, et une seule feuille : en-tête en gras figé, filtre
// automatique, largeurs de colonnes, dates en vraies dates Excel (triables,
// filtrables) au format jj/mm/aaaa, nombres en nombres, texte en texte.
// Pure : renvoie des octets, l'appelant en fait un Blob à télécharger.

export type CelluleXlsx = string | number | { date: string } | null;
export type FeuilleXlsx = {
  nom: string;
  colonnes: { titre: string; largeur?: number }[];
  lignes: CelluleXlsx[][];
};

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Archive zip « stockée » (méthode 0). Noms ASCII.
export function zipStocke(fichiers: { nom: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of fichiers) {
    const nom = enc.encode(f.nom);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version requise
    local.setUint16(8, 0, true); // stocké
    local.setUint16(12, 0x21, true); // date DOS : 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, nom.length, true);
    parts.push(new Uint8Array(local.buffer), nom, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, nom.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nom);
    offset += 30 + nom.length + f.data.length;
  }
  const tailleCd = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCd, true);
  fin.setUint32(16, offset, true);
  const tout = [...parts, ...central, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(tout.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of tout) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const echap = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Référence de colonne Excel : 0 -> A, 25 -> Z, 26 -> AA.
export function colonne(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Numéro de série Excel d'une date ISO (jours depuis le 30/12/1899).
export function serieExcel(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function cellule(ref: string, v: CelluleXlsx, entete: boolean): string {
  if (v === null || v === "") return "";
  if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === "object") return `<c r="${ref}" s="1"><v>${serieExcel(v.date)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${entete ? ' s="2"' : ""}><is><t xml:space="preserve">${echap(v)}</t></is></c>`;
}

function feuilleXml(f: FeuilleXlsx): string {
  const nbCol = f.colonnes.length;
  const derniere = colonne(nbCol - 1);
  const rangees = [f.colonnes.map((c) => c.titre), ...f.lignes].map(
    (ligne, r) => `<row r="${r + 1}">${ligne.map((v, c) => cellule(`${colonne(c)}${r + 1}`, v, r === 0)).join("")}</row>`,
  );
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${f.colonnes.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largeur ?? 14}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rangees.join("")}</sheetData>` +
    `<autoFilter ref="A1:${derniere}${f.lignes.length + 1}"/>` +
    "</worksheet>"
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
  "</styleSheet>";

export function classeurXlsx(f: FeuilleXlsx): Uint8Array {
  // Nom d'onglet : 31 caractères, sans []:*?/\
  const onglet = echap(f.nom.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Feuille1");
  const x = (s: string) => enc.encode(s);
  return zipStocke([
    {
      nom: "[Content_Types].xml",
      data: x(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          "</Types>",
      ),
    },
    {
      nom: "_rels/.rels",
      data: x(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      nom: "xl/workbook.xml",
      data: x(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets><sheet name="${onglet}" sheetId="1" r:id="rId1"/></sheets>` +
          `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${onglet.replace(/'/g, "''")}'!$A$1:$${colonne(f.colonnes.length - 1)}$${f.lignes.length + 1}</definedName></definedNames>` +
          "</workbook>",
      ),
    },
    {
      nom: "xl/_rels/workbook.xml.rels",
      data: x(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>",
      ),
    },
    { nom: "xl/worksheets/sheet1.xml", data: x(feuilleXml(f)) },
    { nom: "xl/styles.xml", data: x(STYLES) },
  ]);
}
