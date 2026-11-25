import { describe, it, expect } from "vitest";
import {
  affecterVivier,
  arrondiSup,
  besoinTheorique,
  calculerPoste,
  coefEtp,
  cumuler,
  hypothesesDefaut,
  joursOuvresParMois,
  lireAnnee,
  palierDe,
  quartsOuverts,
  saturationLigne,
  semainesSubies,
  volumeAnnuel,
  type LigneCapa,
} from "./gpec";

const h = hypothesesDefaut(2027);
const capa = (o: Partial<LigneCapa> = {}): LigneCapa => ({ id: "c", nom: "C3", capaciteJour: 11000, volumeAnnuel: 2214094, volumesMois: null, lignes: [], paliers: {}, ...o });

describe("palier et saturation", () => {
  it("applique les bornes de l'outil Excel", () => {
    expect(palierDe(0.49, h)).toBe(1);
    expect(palierDe(0.5, h)).toBe(2);
    expect(palierDe(0.75, h)).toBe(3);
    expect(palierDe(1.05, h)).toBe(3);
    expect(palierDe(1.06, h)).toBe(4);
  });

  it("retrouve la saturation du classeur (C3 : 2 214 094 kg, 11 000 kg/j, 254 j)", () => {
    const s = saturationLigne(capa(), h);
    expect(s.capaciteAnnuelle).toBe(11000 * 254);
    expect(s.saturation).toBeCloseTo(0.7925, 3);
    expect(s.palier).toBe(3);
    expect(s.mensuel).toBeNull();
  });

  it("ne calcule rien sans volume ou sans capacité", () => {
    expect(saturationLigne(capa({ volumeAnnuel: null }), h).palier).toBeNull();
    expect(saturationLigne(capa({ capaciteJour: null }), h).saturation).toBeNull();
  });

  it("prend la somme des mois dès qu'un mois est saisi", () => {
    const mois = Array<number | null>(12).fill(100);
    mois[7] = null;
    const l = capa({ volumesMois: mois, volumeAnnuel: 999999 });
    expect(volumeAnnuel(l)).toBe(1100);
    const s = saturationLigne(l, h);
    expect(s.mensuel).toHaveLength(12);
    expect(s.mensuel![7].saturation).toBeNull();
    expect(s.mensuel![0].palier).toBe(1);
  });

  it("répartit les jours ouvrés de l'année sur les mois", () => {
    const j = joursOuvresParMois(2027, 254);
    expect(j).toHaveLength(12);
    expect(j.reduce((s, n) => s + n, 0)).toBeCloseTo(254, 6);
  });
});

describe("besoin", () => {
  it("additionne les quarts ouverts seulement", () => {
    const eff = { matin: 2, aprem: 2, nuit: 1 };
    expect(besoinTheorique(eff, null)).toBe(5);
    expect(besoinTheorique(eff, new Set(["matin", "aprem"]))).toBe(4);
    expect(besoinTheorique(eff, new Set())).toBe(0);
  });

  it("un palier non réglé garde tous les quarts", () => {
    expect(quartsOuverts(capa(), 3)).toBeNull();
    expect([...quartsOuverts(capa({ paliers: { "4": ["matin", "nuit"] } }), 4)!]).toEqual(["matin", "nuit"]);
  });

  it("coefficient ETP = 52 ÷ (52 − semaines)", () => {
    // Exemple du classeur : 4 postes, 8 + 1 semaines → 4 × 52/43.
    expect(4 * coefEtp(8, 1)).toBeCloseTo(4.837, 3);
    expect(coefEtp(0, 0)).toBe(1);
    expect(Number.isFinite(coefEtp(60, 0))).toBe(true);
  });

  it("convertit les jours d'absence subie en semaines par salarié", () => {
    expect(semainesSubies(100, 20)).toBe(1);
    expect(semainesSubies(10, 0)).toBe(0);
  });

  it("arrondit le manque à l'entier supérieur sans bruit de virgule", () => {
    expect(arrondiSup(0)).toBe(0);
    expect(arrondiSup(0.2)).toBe(1);
    expect(arrondiSup(2.0000000001)).toBe(2);
    expect(arrondiSup(-3)).toBe(0);
  });
});

describe("calcul d'un poste", () => {
  const base = { id: "p", besoinTheorique: 4, coef: 52 / 43, niveauMin: 2, nbNiveaux: 3, departs: 0 };

  it("compte les titulaires, les référents et ceux en cours de formation", () => {
    const r = calculerPoste({ ...base, titulaires: [{ id: "a", niveau: 3 }, { id: "b", niveau: 2 }, { id: "c", niveau: 1 }] });
    expect(r.disponibilite).toBe(3);
    expect(r.referents).toBe(1);
    expect(r.enFormation).toBe(1);
    expect(r.besoinReel).toBeCloseTo(4.837, 3);
    expect(r.deficit).toBe(2); // 4,84 − 3 = 1,84 → 2
  });

  it("ajoute les départs au besoin", () => {
    const r = calculerPoste({ ...base, departs: 1, titulaires: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), niveau: 2 })) });
    expect(r.besoinTotal).toBeCloseTo(5.837, 3);
    expect(r.deficit).toBe(1);
  });

  it("un excédent ne donne pas de déficit", () => {
    const r = calculerPoste({ ...base, besoinTheorique: 1, titulaires: [{ id: "a", niveau: 2 }, { id: "b", niveau: 2 }] });
    expect(r.ecart).toBeGreaterThan(0);
    expect(r.deficit).toBe(0);
  });
});

describe("vivier sans double compte", () => {
  it("ne compte un polyvalent qu'une fois, là où il est indispensable", () => {
    // Paul tient A et B, Léa seulement A : Paul doit aller sur B.
    const res = affecterVivier(
      [{ posteId: "A", manque: 1 }, { posteId: "B", manque: 1 }],
      new Map([["A", ["paul", "lea"]], ["B", ["paul"]]])
    );
    expect(res.get("B")).toEqual(["paul"]);
    expect(res.get("A")).toEqual(["lea"]);
  });

  it("ne couvre pas plus que le manque ni plus que le vivier", () => {
    const res = affecterVivier([{ posteId: "A", manque: 2 }, { posteId: "B", manque: 3 }], new Map([["A", ["x", "y", "z"]], ["B", ["x"]]]));
    expect(res.get("A")).toHaveLength(2);
    expect(res.get("B")).toEqual(["x"]);
  });

  it("ignore les postes sans manque", () => {
    expect(affecterVivier([{ posteId: "A", manque: 0 }], new Map([["A", ["x"]]])).size).toBe(0);
  });
});

describe("cumul et année", () => {
  it("somme les déficits poste par poste (pas de compensation)", () => {
    const a = { ...calculerPoste({ id: "a", besoinTheorique: 2, coef: 1, niveauMin: 1, nbNiveaux: 3, departs: 0, titulaires: [] }), aFormer: 1, aRecruter: 1 };
    const b = { ...calculerPoste({ id: "b", besoinTheorique: 1, coef: 1, niveauMin: 1, nbNiveaux: 3, departs: 0, titulaires: [1, 2, 3].map((n) => ({ id: String(n), niveau: 1 })) }), aFormer: 0, aRecruter: 0 };
    const c = cumuler([a, b]);
    expect(c.deficit).toBe(2);
    expect(c.disponibilite).toBe(3);
    expect(c.couverture).toBe(1); // 3 / 3 : couverture à 100 % AVEC des postes en déficit
  });

  it("projette l'année suivante par défaut", () => {
    const d = new Date(2026, 10, 25);
    expect(lireAnnee(undefined, d)).toBe(2027);
    expect(lireAnnee("2028", d)).toBe(2028);
    expect(lireAnnee("abc", d)).toBe(2027);
  });
});
