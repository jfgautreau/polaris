import { describe, it, expect } from "vitest";
import { construireRecyclages, formationsSansEcheance, dansHorizon, urgence, libelleJours, lireHorizon, lireType, type Formation, type Detention, type PersonneR } from "./recyclages";
import { crc32, colonne, serieExcel, zipStocke, classeurXlsx } from "./xlsx";

// Jours restants simulés : aujourd'hui = 2026-10-20.
const AUJ = Date.UTC(2026, 9, 20);
const jr = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - AUJ) / 86400000);
};

const F: Formation[] = [
  { id: "caces", nom: "CACES 3", categorie: "reglementaire", duree_validite_mois: 60, ordre: 2 },
  { id: "sst", nom: "SST", categorie: "reglementaire", duree_validite_mois: 24, ordre: 1 },
  { id: "hyg", nom: "Hygiène", categorie: "interne", duree_validite_mois: 12, ordre: 3 },
  { id: "libre", nom: "Accueil", categorie: null, duree_validite_mois: null, ordre: 4 },
];
const P: PersonneR[] = [
  { id: "a", nom: "DUPONT", prenom: "Jean", type_contrat: "CDI", atelier_id: "s1", equipe_id: "e1", depart: null },
  { id: "b", nom: "MARTIN", prenom: "Léa", type_contrat: "INTERIM", atelier_id: "s2", equipe_id: null, depart: "2026-11-15" },
];
const D: Detention[] = [
  { personne_id: "a", competence_id: "sst", date_obtention: "2024-11-10", date_expiration: null }, // -> 2026-11-10 : J+21
  { personne_id: "b", competence_id: "sst", date_obtention: "2024-10-01", date_expiration: null }, // -> 2026-10-01 : expirée
  { personne_id: "a", competence_id: "caces", date_obtention: "2022-01-01", date_expiration: "2027-06-01" }, // stockée, loin
  { personne_id: "b", competence_id: "hyg", date_obtention: "2025-12-01", date_expiration: null }, // -> 2026-12-01 : J+42
  { personne_id: "a", competence_id: "libre", date_obtention: "2020-01-01", date_expiration: null }, // n'expire jamais
  { personne_id: "z", competence_id: "sst", date_obtention: "2020-01-01", date_expiration: null }, // personne inactive
];

describe("construireRecyclages", () => {
  it("garde l'horizon, expirées comprises, trie par formation puis échéance", () => {
    const r = construireRecyclages(F, D, P, { type: "", horizon: "90", aujourdhui: jr });
    expect(r.map((l) => `${l.formationId}:${l.personneId}:${l.jours}`)).toEqual(["sst:b:-19", "sst:a:21", "hyg:b:42"]);
  });
  it("calcule l'échéance par la durée si non stockée, sinon prend la date stockée", () => {
    const r = construireRecyclages(F, D, P, { type: "", horizon: "tout", aujourdhui: jr });
    expect(r.find((l) => l.formationId === "sst" && l.personneId === "a")?.expiration).toBe("2026-11-10");
    expect(r.find((l) => l.formationId === "caces")?.expiration).toBe("2027-06-01");
    expect(r.some((l) => l.formationId === "libre")).toBe(false);
  });
  it("filtre par type et par formation", () => {
    expect(construireRecyclages(F, D, P, { type: "interne", horizon: "tout", aujourdhui: jr }).map((l) => l.formationId)).toEqual(["hyg"]);
    expect(construireRecyclages(F, D, P, { type: "reglementaire", horizon: "tout", formation: "caces", aujourdhui: jr })).toHaveLength(1);
    expect(construireRecyclages(F, D, P, { type: "", horizon: "expirees", aujourdhui: jr }).map((l) => l.personneId)).toEqual(["b"]);
  });
  it("signale une fin de contrat antérieure à l'échéance", () => {
    const r = construireRecyclages(F, D, P, { type: "", horizon: "tout", aujourdhui: jr });
    expect(r.find((l) => l.formationId === "hyg")?.departAvant).toBe("2026-11-15");
    expect(r.find((l) => l.formationId === "sst" && l.personneId === "b")?.departAvant).toBeNull();
  });
});

describe("règles d'affichage", () => {
  it("horizon, urgence, libellé", () => {
    expect(dansHorizon(-1, "expirees")).toBe(true);
    expect(dansHorizon(0, "expirees")).toBe(false);
    expect(dansHorizon(30, "30")).toBe(true);
    expect(dansHorizon(31, "30")).toBe(false);
    expect([urgence(-5), urgence(29), urgence(30), urgence(90), urgence(91)]).toEqual(["rouge", "rouge", "orange", "orange", "vert"]);
    expect(libelleJours(-3)).toBe("expirée depuis 3 j");
    expect(libelleJours(0)).toBe("expire aujourd'hui");
    expect(lireHorizon("n'importe")).toBe("90");
    expect(lireType("interne")).toBe("interne");
    expect(lireType("x")).toBe("");
  });
  it("formations sans échéance : ni durée ni date saisie", () => {
    expect(formationsSansEcheance(F, D).map((f) => f.id)).toEqual(["libre"]);
    expect(formationsSansEcheance(F, [...D, { personne_id: "a", competence_id: "libre", date_obtention: null, date_expiration: "2027-01-01" }])).toHaveLength(0);
  });
});

describe("xlsx", () => {
  it("crc32 de référence", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("colonnes et dates Excel", () => {
    expect([colonne(0), colonne(25), colonne(26), colonne(701), colonne(702)]).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    expect(serieExcel("1900-03-01")).toBe(61);
    expect(serieExcel("2026-10-20")).toBe(46315);
  });
  it("archive zip : signatures et répertoire central", () => {
    const z = zipStocke([{ nom: "a.txt", data: new TextEncoder().encode("bonjour") }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1);
  });
  it("classeur : six parties, texte échappé", () => {
    const x = classeurXlsx({ nom: "Recyclages", colonnes: [{ titre: "Nom" }, { titre: "Date" }], lignes: [["A & <B>", { date: "2026-10-20" }]] });
    const txt = new TextDecoder().decode(x);
    expect(txt).toContain("xl/worksheets/sheet1.xml");
    expect(txt).toContain("A &amp; &lt;B&gt;");
    expect(txt).toContain("<v>46315</v>");
  });
});
