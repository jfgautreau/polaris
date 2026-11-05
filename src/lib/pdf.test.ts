import { describe, it, expect } from "vitest";
import { documentPdf, couperTexte, largeurTexte, normaliserTexte } from "./pdf";
import { pdfInterim, xlsxInterim, pdfAbsences, xlsxAbsences, texteCaseInterim, texteCaseExcel, photoInterim, JAUNE_FLUO, LIBELLE_RETIRE } from "./syntheses-export";
import { nomFichierInterim } from "./nom-fichier-interim";
import { estCouleurService, couleurDeService } from "./service-couleurs";
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
        cells: { "2026-10-19": [{ posteNom: "Palettisation", atelierNom: "Condi", atelierCouleur: "#dcfce7", distant: false, horaire: "06:00-14:00" }], "2026-10-20": [] },
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
  it("Excel intérim : une ligne par intérimaire, sans le poste, couleur du service", () => {
    expect(texteCaseExcel(G[0].lignes[0], "2026-10-19")).toBe("06:00-14:00\nCondi");
    const [f] = xlsxInterim(G, J, "S43 · 19/10 → 25/10", { maintenant: new Date(2026, 10, 5, 14, 7) });
    expect(f.nom).toBe("Intérim S43");
    expect(f.titres?.[1]).toBe("Extrait le 05/11/2026 à 14:07");
    expect(f.colonnes.map((c) => c.titre)).toEqual(["Agence", "Nom", "Prénom", "Lun 19/10", "Mar 20/10", "Jours placés", "Observation"]);
    expect(f.lignes).toHaveLength(3);
    expect(f.lignes[0]).toEqual(["Agence A", "DUPONT", "Jean", { texte: "06:00-14:00\nCondi", fond: "#dcfce7" }, "", 1, ""]);
    expect(f.lignes[1].slice(-2)).toEqual([0, "Sans affectation cette semaine"]);
    const x = lire(classeurXlsx(xlsxInterim(G, J, "S43")));
    expect(x).toContain('wrapText="1"');
    // Mise en page d'impression : paysage, une page de large, en-tête répété.
    expect(x).toContain('orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(x).toContain("'Intérim S43'!$4:$4");
    expect(x).toContain("_xlnm.Print_Area");
  });
  it("Excel agence : cases changées en jaune fluo, nouveaux et retirés", () => {
    const g = G[0];
    const avant = photoInterim(g, J);
    // Première extraction : rien de surligné, pas de colonne Agence.
    const [f0] = xlsxInterim([g], J, "S43", { comparaison: { etat: "ok", precedente: null, retires: [] } });
    expect(f0.colonnes[0].titre).toBe("Nom");
    expect(f0.titres).toContain("Première extraction de cette agence pour cette semaine : rien à comparer.");
    expect(JSON.stringify(f0.lignes)).not.toContain(JAUNE_FLUO);
    // Horaire changé lundi, mardi ajouté, p9 retiré ; MARTIN inchangée.
    const apres = {
      ...g,
      lignes: [
        {
          ...g.lignes[0],
          cells: {
            "2026-10-19": [{ posteNom: "P", atelierNom: "Condi", atelierCouleur: "#dcfce7", distant: false, horaire: "07:00-15:00" }],
            "2026-10-20": [{ posteNom: "P", atelierNom: "Fab", atelierCouleur: null, distant: false, horaire: "06:00-14:00" }],
          },
        },
      ],
    };
    avant.lignes.p9 = { cases: { "2026-10-19": "14:00-22:00\nFab" }, jours: 1, obs: "" };
    const [f] = xlsxInterim([apres], J, "S43", {
      comparaison: { etat: "ok", precedente: { le: "2026-11-04T16:20:00", photo: avant }, retires: [{ personneId: "p9", nom: "LEROY", prenom: "Anne" }] },
    });
    expect(f.titres?.[2]).toBe("Cases en jaune fluo : modifiées depuis l'extraction du 04/11/2026 à 16:20.");
    const [dupont, martin, leroy] = f.lignes;
    expect(dupont.slice(0, 2)).toEqual(["DUPONT", "Jean"]);
    expect(dupont[2]).toEqual({ texte: "07:00-15:00\nCondi", fond: JAUNE_FLUO });
    expect(dupont[3]).toEqual({ texte: "06:00-14:00\nFab", fond: JAUNE_FLUO });
    expect(dupont[4]).toEqual({ texte: "2", fond: JAUNE_FLUO });
    expect(martin).toEqual(["MARTIN", "Léa", "", "", 0, "Sans affectation cette semaine"]);
    expect(leroy[0]).toEqual({ texte: "LEROY", fond: JAUNE_FLUO, barre: true });
    expect(leroy[2]).toEqual({ texte: "14:00-22:00\nFab", fond: JAUNE_FLUO, barre: true });
    expect(leroy[leroy.length - 1]).toEqual({ texte: LIBELLE_RETIRE, fond: JAUNE_FLUO });
    expect(lire(classeurXlsx([f]))).toContain("<strike/>");
  });
  it("Excel agence : comparaison indisponible annoncée, rien surligné", () => {
    const [f] = xlsxInterim([G[0]], J, "S43", { comparaison: { etat: "indisponible" } });
    expect(f.titres?.[2]).toContain("indisponible");
    expect(JSON.stringify(f.lignes)).not.toContain(JAUNE_FLUO);
  });
  it("nom du fichier intérim : balises, défaut, caractères interdits", () => {
    const c = { agence: "Adecco", semaine: 6, annee: 2026, site: "Le Bignon", maintenant: new Date(2026, 1, 3, 9, 5) };
    expect(nomFichierInterim(null, c)).toBe("Planning intérim Adecco S06 2026 - 2026-02-03 09h05.xlsx");
    expect(nomFichierInterim("{site} / {AGENCE} : S{semaine}", c)).toBe("Le Bignon - Adecco - S06.xlsx");
    expect(nomFichierInterim("   ", c)).toBe("Planning intérim Adecco S06 2026 - 2026-02-03 09h05.xlsx");
  });
  it("couleurs de service : palette fermée", () => {
    expect(estCouleurService("#DBEAFE")).toBe(true);
    expect(estCouleurService("#ff0000")).toBe(false);
    expect(couleurDeService("#dcfce7")?.nom).toBe("Vert");
    expect(couleurDeService(null)).toBeNull();
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
