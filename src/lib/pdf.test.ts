import { describe, it, expect } from "vitest";
import { documentPdf, couperTexte, largeurTexte, normaliserTexte } from "./pdf";
import { pdfInterim, xlsxInterim, pdfAbsences, xlsxAbsences, texteCaseInterim } from "./syntheses-export";
import { classeurXlsx, nomsOnglets } from "./xlsx";
import { placeInterimaire, type GroupeAgence, type Absences4 } from "./synthese-data";

const lire = (b: Uint8Array) => new TextDecoder().decode(b);

// Chaque entrée de la table xref doit pointer sur « n 0 obj ».
function verifierXref(pdf: string) {
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
  expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
  const [, nb] = /xref\n0 (\d+)\n/.exec(pdf.slice(startxref))!;
  const entrees = pdf.slice(startxref).split("\n").slice(3, 2 + Number(nb));
  entrees.forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  // /Length de chaque flux = taille réelle du contenu.
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const debut = m.index! + m[0].length;
    expect(pdf.slice(debut + Number(m[1]), debut + Number(m[1]) + 10)).toBe("\nendstream");
  }
}

describe("pdf", () => {
  it("document valide : en-tête, xref, flux, polices", () => {
    const pdf = lire(
      documentPdf({
        titre: "Essai",
        sousTitre: "Semaine S43 · 20/10 → 26/10",
        edition: "édité",
        blocs: [
          { type: "titre", texte: "Agence Élite" },
          { type: "tableau", colonnes: [{ titre: "Nom", largeur: 2 }, { titre: "Lun", largeur: 1, align: "c" }], lignes: [[{ texte: "DUPONT Éloïse", fond: "#fde68a", gras: true }, "06:00-14:00\nConditionnement"]] },
          { type: "texte", texte: "Pas de besoin : œuvre — « test »" },
        ],
      }),
    );
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf).toContain("/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding");
    expect(pdf).toContain("/Count 1");
    verifierXref(pdf);
    // « É » (0xC9) en WinAnsi, flèche remplacée.
    expect(pdf).toContain("c9");
    expect(pdf).not.toContain("2192");
  });

  it("pagination : en-tête répété, page n / N", () => {
    const lignes = Array.from({ length: 120 }, (_, i) => [`Ligne ${i}`, "x"]);
    const pdf = lire(documentPdf({ titre: "Long", blocs: [{ type: "tableau", colonnes: [{ titre: "A", largeur: 1 }, { titre: "B", largeur: 1 }], lignes }] }));
    const n = Number(/\/Count (\d+)/.exec(pdf)![1]);
    expect(n).toBeGreaterThan(1);
    verifierXref(pdf);
  });

  it("nouvelle page par titre demandé", () => {
    const pdf = lire(documentPdf({ titre: "T", blocs: [{ type: "titre", texte: "A" }, { type: "titre", texte: "B", nouvellePage: true }] }));
    expect(pdf).toContain("/Count 2");
  });

  it("mesure et découpe du texte", () => {
    expect(largeurTexte("i", 10)).toBeCloseTo(2.22);
    expect(largeurTexte("é", 10)).toBeCloseTo(largeurTexte("e", 10));
    expect(couperTexte("un deux trois", largeurTexte("un deux", 10) + 0.1, 10)).toEqual(["un deux", "trois"]);
    expect(couperTexte("a\nb", 100, 10)).toEqual(["a", "b"]);
    const long = couperTexte("ABCDEFGHIJKLMNOP", 30, 10);
    expect(long.length).toBeGreaterThan(1);
    expect(long.join("")).toBe("ABCDEFGHIJKLMNOP");
    expect(normaliserTexte("S43 → S46")).toBe("S43 -> S46");
  });
});

const G: GroupeAgence[] = [
  {
    agence: "Agence A",
    lignes: [
      {
        personneId: "p1",
        nom: "DUPONT",
        prenom: "Jean",
        atelierNom: "Condi",
        cells: { "2026-10-19": [{ posteNom: "Palettisation", atelierNom: "Condi", distant: false, horaire: "06:00-14:00" }], "2026-10-20": [] },
      },
    ],
    sansAffectation: [{ personneId: "p2", nom: "MARTIN", prenom: "Léa" }],
  },
  { agence: "Agence A", lignes: [], sansAffectation: [{ personneId: "p3", nom: "X", prenom: "Y" }] },
];
const J = [
  { iso: "2026-10-19", nom: "Lundi", num: "19/10" },
  { iso: "2026-10-20", nom: "Mardi", num: "20/10" },
];

describe("exports Synthèses", () => {
  it("case intérim : horaire, poste, service", () => {
    expect(texteCaseInterim(G[0].lignes[0], "2026-10-19")).toBe("06:00-14:00\nPalettisation\nCondi");
    expect(texteCaseInterim(G[0].lignes[0], "2026-10-20")).toBe("");
  });
  it("PDF intérim : une agence par page, sans affectation listés", () => {
    const d = pdfInterim(G, J, "S43 · 19/10 → 25/10");
    expect(d.blocs.filter((b) => b.type === "titre").map((b) => (b as { nouvellePage?: boolean }).nouvellePage)).toEqual([false, true]);
    expect(d.blocs.some((b) => b.type === "texte" && b.texte.includes("MARTIN Léa"))).toBe(true);
    verifierXref(lire(documentPdf(d)));
    expect(pdfInterim([G[0]], J, "S43").sousTitre).toContain("Agence A");
  });
  it("Excel intérim : une ligne par intérimaire, sans affectation compris", () => {
    const [f] = xlsxInterim(G, J, "S43 · 19/10 → 25/10");
    expect(f.nom).toBe("Intérim S43");
    expect(f.lignes).toHaveLength(3);
    expect(f.lignes[0]).toEqual(["Agence A", "DUPONT", "Jean", "Condi", "06:00-14:00\nPalettisation\nCondi", "", 1, ""]);
    expect(f.lignes[1].slice(-2)).toEqual([0, "Sans affectation cette semaine"]);
    expect(lire(classeurXlsx(xlsxInterim(G, J, "S43")))).toContain('wrapText="1"');
  });
  it("absences : PDF et Excel (deux onglets, fonds de motif)", () => {
    const abs: Absences4 = {
      lignes: [{ personneId: "p", nom: "A", prenom: "B", atelierId: null, atelierNom: "—", equipeNom: "—", jours: { "2026-10-19": { motifId: "m", libelle: "Congés payés", couleur: "#2563eb", abbr: "CP" } }, total: 1 }],
      recap: [{ motifId: "m", libelle: "Congés payés", couleur: "#2563eb", abbr: "CP", personnes: 1, jours: 1 }],
    };
    const cols = J.map((j, i) => ({ ...j, premierDeSemaine: i === 0, weekNo: 43 }));
    verifierXref(lire(documentPdf(pdfAbsences(abs, cols, "S43 → S46", "Condi"))));
    const fs = xlsxAbsences(abs, cols);
    expect(fs.map((f) => f.nom)).toEqual(["Absences", "Par motif"]);
    expect(fs[0].lignes[0].slice(0, 5)).toEqual(["A", "B", "", "", { texte: "CP", fond: "#2563eb", gras: true }]);
    const x = lire(classeurXlsx(fs));
    expect(x).toContain("xl/worksheets/sheet2.xml");
    expect(x).toContain('rgb="FF2563EB"');
  });
  it("place d'un intérimaire : tableau, sans affectation, ou nulle part", () => {
    const S = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
    const ouvert = [{ date_debut: "2026-01-01", date_fin: null }];
    expect(placeInterimaire({ postes: 2, lignesSemaine: 3, contrats: ouvert, jours: S })).toBe("tableau");
    // JNT, absence, NT ou TP seuls : la semaine est réglée au Planning.
    expect(placeInterimaire({ postes: 0, lignesSemaine: 5, contrats: ouvert, jours: S })).toBe("aucune");
    expect(placeInterimaire({ postes: 0, lignesSemaine: 0, contrats: ouvert, jours: S })).toBe("sans-affectation");
    // Contrat couvrant un seul jour de la semaine : suffit.
    expect(placeInterimaire({ postes: 0, lignesSemaine: 0, contrats: [{ date_debut: "2026-10-25", date_fin: null }], jours: S })).toBe("sans-affectation");
    // Arrivée plus tard, mission finie, aucun contrat : nulle part.
    expect(placeInterimaire({ postes: 0, lignesSemaine: 0, contrats: [{ date_debut: "2026-11-02", date_fin: null }], jours: S })).toBe("aucune");
    expect(placeInterimaire({ postes: 0, lignesSemaine: 0, contrats: [{ date_debut: "2026-01-01", date_fin: "2026-10-18" }], jours: S })).toBe("aucune");
    expect(placeInterimaire({ postes: 0, lignesSemaine: 0, contrats: [], jours: S })).toBe("aucune");
  });
  it("noms d'onglets uniques et valides", () => {
    expect(nomsOnglets(["A/B", "a/b", "x".repeat(40)])).toEqual(["A B", "a b 2", "x".repeat(31)]);
  });
});
