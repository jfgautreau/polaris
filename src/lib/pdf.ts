// Générateur PDF minimal, SANS dépendance (2026-10-20) — pendant de `xlsx.ts`.
//
// Pourquoi : le bouton « PDF » ouvrait le dialogue d'impression (window.print) ;
// l'utilisateur devait choisir lui-même la destination « Enregistrer au format
// PDF ». Une page web ne sait pas produire un PDF autrement qu'en écrivant le
// fichier : on le fait ici, pour des documents faits de titres, de paragraphes
// et de tableaux (rapports). Le fichier se télécharge directement.
//
// Mise en page : A4 (paysage par défaut), en-tête (titre, sous-titre) et pied
// (date d'édition, « page n / N ») sur chaque page ; tableaux avec en-tête répété
// à chaque saut de page, retour à la ligne des cellules, fonds colorés, filets.
// Polices standard Helvetica / Helvetica-Bold (aucune police embarquée) en
// WinAnsiEncoding : accents français, « », €, œ, —, … ; tout autre caractère
// est remplacé (→ devient « -> »). Pure : renvoie des octets.

export type AlignPdf = "g" | "c" | "d";
export type CellulePdf = string | { texte: string; fond?: string; couleur?: string; gras?: boolean; align?: AlignPdf };
export type ColonnePdf = { titre: string; largeur: number; align?: AlignPdf };
export type BlocPdf =
  | { type: "titre"; texte: string; nouvellePage?: boolean }
  | { type: "texte"; texte: string; couleur?: string; gras?: boolean }
  | { type: "tableau"; colonnes: ColonnePdf[]; lignes: CellulePdf[][] };
export type DocumentPdf = { titre: string; sousTitre?: string; portrait?: boolean; edition?: string; blocs: BlocPdf[] };

// ── Métriques Helvetica (AFM Adobe, 1/1000 em), caractères 32 à 126 ─────────
const L_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const L_GRAS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// Caractères WinAnsi hors Latin-1 (plage 0x80-0x9F) : code et largeur approchée.
const SPECIAUX: Record<string, [number, number]> = {
  "€": [0x80, 556], "‚": [0x82, 222], "„": [0x84, 333], "…": [0x85, 1000], "‰": [0x89, 1000], "‹": [0x8b, 333],
  "Œ": [0x8c, 1000], "‘": [0x91, 222], "’": [0x92, 222], "“": [0x93, 333], "”": [0x94, 333], "•": [0x95, 350],
  "–": [0x96, 556], "—": [0x97, 1000], "™": [0x99, 1000], "›": [0x9b, 333], "œ": [0x9c, 944], "Ÿ": [0x9f, 667],
};

// Normalise le texte vers ce que WinAnsi sait écrire.
export function normaliserTexte(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[   ]/g, " ")
    .replace(/[‐‑]/g, "-")
    .replace(/\t/g, " ");
}

function codeWinAnsi(ch: string): number {
  const sp = SPECIAUX[ch];
  if (sp) return sp[0];
  const c = ch.codePointAt(0) ?? 63;
  if (c >= 32 && c <= 126) return c;
  if (c >= 160 && c <= 255) return c;
  return 63; // « ? »
}

function largeurCar(ch: string, gras: boolean): number {
  const t = gras ? L_GRAS : L_REG;
  const sp = SPECIAUX[ch];
  if (sp) return sp[1];
  const c = ch.codePointAt(0) ?? 63;
  if (c >= 32 && c <= 126) return t[c - 32];
  if (c === 160) return 278;
  // Lettre accentuée : largeur de la lettre de base.
  const base = ch.normalize("NFD")[0];
  const b = base.codePointAt(0) ?? 63;
  if (b >= 32 && b <= 126) return t[b - 32];
  if (ch === "Æ") return 1000;
  if (ch === "æ" || ch === "ß") return 889;
  return 556;
}

export function largeurTexte(s: string, taille: number, gras = false): number {
  let w = 0;
  for (const ch of s) w += largeurCar(ch, gras);
  return (w * taille) / 1000;
}

// Coupe un texte en lignes tenant dans `max` points (mots, puis caractères pour
// un mot trop long). Les « \n » forcent un retour.
export function couperTexte(s: string, max: number, taille: number, gras = false): string[] {
  const out: string[] = [];
  for (const para of normaliserTexte(s).split("\n")) {
    let ligne = "";
    for (const mot of para.split(/ +/)) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (largeurTexte(essai, taille, gras) <= max) {
        ligne = essai;
        continue;
      }
      if (ligne) out.push(ligne);
      // Mot plus long que la colonne : découpé au caractère.
      let reste = mot;
      while (largeurTexte(reste, taille, gras) > max && reste.length > 1) {
        let n = reste.length - 1;
        while (n > 1 && largeurTexte(reste.slice(0, n), taille, gras) > max) n--;
        out.push(reste.slice(0, n));
        reste = reste.slice(n);
      }
      ligne = reste;
    }
    out.push(ligne);
  }
  return out;
}

const hex = (s: string) => {
  let h = "";
  for (const ch of normaliserTexte(s)) h += codeWinAnsi(ch).toString(16).padStart(2, "0");
  return `<${h}>`;
};
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
function rgb(c: string | undefined, def: [number, number, number]): string {
  let r = def[0], g = def[1], b = def[2];
  const m = c ? /^#?([0-9a-f]{6})$/i.exec(c.trim()) : null;
  if (m) {
    const v = parseInt(m[1], 16);
    r = ((v >> 16) & 255) / 255;
    g = ((v >> 8) & 255) / 255;
    b = (v & 255) / 255;
  }
  return `${n2(r)} ${n2(g)} ${n2(b)}`;
}

// ── Mise en page ─────────────────────────────────────────────────────────────
const MARGE = 28;
const T_TABLE = 7.5;
const INTERLIGNE = 9.2;
const PAD = 3;
const NOIR: [number, number, number] = [0.12, 0.16, 0.22];
const GRIS: [number, number, number] = [0.39, 0.45, 0.55];

export function documentPdf(doc: DocumentPdf): Uint8Array {
  const W = doc.portrait ? 595.28 : 841.89;
  const H = doc.portrait ? 841.89 : 595.28;
  const largeurUtile = W - 2 * MARGE;
  const HAUT = H - MARGE - 34; // sous l'en-tête de page
  const BAS = MARGE + 16; // au-dessus du pied de page
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = HAUT;

  const nouvellePage = () => {
    ops = [];
    pages.push(ops);
    y = HAUT;
  };
  const texte = (s: string, x: number, yy: number, taille: number, gras: boolean, couleur: string) =>
    ops.push(`BT /${gras ? "F2" : "F1"} ${taille} Tf ${couleur} rg ${n2(x)} ${n2(yy)} Td ${hex(s)} Tj ET`);
  const rect = (x: number, yy: number, w: number, h: number, fond?: string, filet = true) => {
    if (fond) ops.push(`${rgb(fond, [1, 1, 1])} rg ${n2(x)} ${n2(yy)} ${n2(w)} ${n2(h)} re f`);
    if (filet) ops.push(`0.5 w 0.8 0.84 0.88 RG ${n2(x)} ${n2(yy)} ${n2(w)} ${n2(h)} re S`);
  };

  nouvellePage();
  for (const bloc of doc.blocs) {
    if (bloc.type === "titre") {
      // Un titre ne reste jamais seul en bas de page.
      if ((bloc.nouvellePage && y < HAUT) || y - 60 < BAS) nouvellePage();
      const lignes = couperTexte(bloc.texte, largeurUtile, 11, true);
      for (const l of lignes) {
        y -= 13;
        texte(l, MARGE, y, 11, true, rgb(undefined, NOIR));
      }
      y -= 6;
    } else if (bloc.type === "texte") {
      const lignes = couperTexte(bloc.texte, largeurUtile, 8.5, !!bloc.gras);
      for (const l of lignes) {
        if (y - 11 < BAS) nouvellePage();
        y -= 11;
        texte(l, MARGE, y, 8.5, !!bloc.gras, rgb(bloc.couleur, GRIS));
      }
      y -= 6;
    } else {
      const total = bloc.colonnes.reduce((s, c) => s + c.largeur, 0) || 1;
      const larg = bloc.colonnes.map((c) => (c.largeur / total) * largeurUtile);
      const xs = larg.map((_, i) => MARGE + larg.slice(0, i).reduce((s, v) => s + v, 0));
      const mesurer = (cells: CellulePdf[], grasDefaut: boolean) =>
        cells.map((c, i) => {
          const o = typeof c === "string" ? { texte: c } : c;
          const gras = o.gras ?? grasDefaut;
          return { o, gras, lignes: couperTexte(o.texte ?? "", Math.max(4, larg[i] - 2 * PAD), T_TABLE, gras) };
        });
      const dessinerRangee = (m: ReturnType<typeof mesurer>, h: number, entete: boolean) => {
        m.forEach((c, i) => {
          const fond = c.o.fond ?? (entete ? "#e2e8f0" : undefined);
          rect(xs[i], y - h, larg[i], h, fond);
          const align = c.o.align ?? bloc.colonnes[i].align ?? "g";
          c.lignes.forEach((l, k) => {
            const lw = largeurTexte(l, T_TABLE, c.gras);
            const x = align === "c" ? xs[i] + (larg[i] - lw) / 2 : align === "d" ? xs[i] + larg[i] - PAD - lw : xs[i] + PAD;
            texte(l, x, y - PAD - T_TABLE - k * INTERLIGNE + 1.5, T_TABLE, c.gras, rgb(c.o.couleur, NOIR));
          });
        });
        y -= h;
      };
      const hauteur = (m: ReturnType<typeof mesurer>) => Math.max(...m.map((c) => c.lignes.length)) * INTERLIGNE + 2 * PAD;
      const entete = mesurer(bloc.colonnes.map((c) => ({ texte: c.titre, align: c.align })), true);
      const hEntete = hauteur(entete);
      if (y - hEntete - 20 < BAS) nouvellePage();
      dessinerRangee(entete, hEntete, true);
      for (const ligne of bloc.lignes) {
        const m = mesurer(ligne, false);
        const h = hauteur(m);
        if (y - h < BAS) {
          nouvellePage();
          dessinerRangee(entete, hEntete, true); // en-tête répété
        }
        dessinerRangee(m, h, false);
      }
      y -= 10;
    }
  }

  // En-tête et pied de chaque page (le total des pages est enfin connu).
  const n = pages.length;
  const edition = doc.edition ?? "";
  const contenus = pages.map((p, i) => {
    ops = [];
    texte(doc.titre, MARGE, H - MARGE - 12, 14, true, rgb(undefined, NOIR));
    if (doc.sousTitre) texte(doc.sousTitre, MARGE, H - MARGE - 25, 8.5, false, rgb(undefined, GRIS));
    ops.push(`0.5 w 0.8 0.84 0.88 RG ${n2(MARGE)} ${n2(H - MARGE - 30)} m ${n2(W - MARGE)} ${n2(H - MARGE - 30)} l S`);
    if (edition) texte(edition, MARGE, MARGE, 7, false, rgb(undefined, GRIS));
    const pg = `Page ${i + 1} / ${n}`;
    texte(pg, W - MARGE - largeurTexte(pg, 7), MARGE, 7, false, rgb(undefined, GRIS));
    return [...ops, ...p].join("\n");
  });

  // ── Objets PDF ──────────────────────────────────────────────────────────────
  // 1 catalogue, 2 arbre des pages, 3-4 polices, 5 infos, puis page + contenu.
  const objets: string[] = [];
  const idsPages = contenus.map((_, i) => 6 + 2 * i);
  objets[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objets[2] = `<< /Type /Pages /Kids [${idsPages.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`;
  objets[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objets[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objets[5] = `<< /Title ${utf16(doc.titre)} /Producer (Polaris) >>`;
  contenus.forEach((c, i) => {
    const idPage = 6 + 2 * i;
    objets[idPage] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idPage + 1} 0 R >>`;
    objets[idPage + 1] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`;
  });
  // Tout est ASCII (textes en hexadécimal) : longueur en caractères = en octets.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objets.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objets[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objets.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

// Chaîne d'information (titre du document) en UTF-16BE, hors contenu des pages.
function utf16(s: string): string {
  let h = "FEFF";
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${h}>`;
}
