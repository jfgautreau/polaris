import { describe, it, expect } from "vitest";
import {
  parseBasePersonnel,
  serieExcelVersIso,
  resoudreTypeContrat,
  suggererCorrespondance,
  rapprocher,
  type EffectifItem,
} from "./import-personnel-rh";

// Reproduit la forme réelle du fichier RH : colonnes A(0) matricule, B(1)
// civilité, C(2) nom, D(3) prénom, G(6) fonction, H(7) type, I(8) début, K(10) fin.
function ligne(cells: Record<number, string>): string[] {
  const arr = new Array(11).fill("");
  for (const [c, v] of Object.entries(cells)) arr[Number(c)] = v;
  return arr;
}

describe("serieExcelVersIso", () => {
  it("convertit une série Excel en ISO", () => {
    expect(serieExcelVersIso("45915")).toBe("2025-09-15");
    expect(serieExcelVersIso("41904")).toBe("2014-09-22");
  });
  it("rejette une cellule non numérique ou vide", () => {
    expect(serieExcelVersIso("")).toBeNull();
    expect(serieExcelVersIso("CDI")).toBeNull();
    expect(serieExcelVersIso("0")).toBeNull();
  });
});

describe("parseBasePersonnel", () => {
  const matrice = [
    ligne({ 0: "Section : D089STUSATL11 atelier 1 équipe verte" }),
    ligne({ 0: "Matricule", 1: "Civilite", 2: "Nom", 3: "Prenom", 7: "Type de contrat", 8: "Date début" }),
    ligne({ 0: "108415", 1: "F", 2: "ABNER", 3: "MAEVA", 6: "OPERATRICE", 7: "CDI", 8: "45915" }),
    ligne({ 0: "809870", 1: "H", 2: "AVCI", 3: "EREN", 7: "INT", 8: "46267" }),
    ligne({ 0: "Section : D089STUSATL1N atelier 1 nuit" }),
    ligne({ 0: "108432", 1: "H", 2: "ARHZAF", 3: "MUSTAPHA", 7: "CDI", 8: "45971", 10: "46300" }),
  ];

  it("lit les personnes et rattache la section courante", () => {
    const r = parseBasePersonnel(matrice);
    expect(r.personnes).toHaveLength(3);
    expect(r.sections).toEqual(["atelier 1 équipe verte", "atelier 1 nuit"]);

    const abner = r.personnes[0];
    expect(abner).toMatchObject({
      matricule: "108415",
      sexe: "F",
      nom: "ABNER",
      prenom: "MAEVA",
      fonction: "OPERATRICE",
      typeSource: "CDI",
      dateDebut: "2025-09-15",
      dateFin: null,
      section: "atelier 1 équipe verte",
    });
    expect(r.personnes[2]).toMatchObject({ section: "atelier 1 nuit", dateDebut: "2025-11-10", dateFin: "2026-10-05" });
  });

  it("ignore les en-têtes, sections vides et lignes sans nom", () => {
    const r = parseBasePersonnel([
      ligne({ 0: "Matricule", 2: "Nom" }),
      ligne({ 0: "  " }),
      ligne({ 0: "999", 2: "", 3: "" }),
    ]);
    expect(r.personnes).toHaveLength(0);
  });
});

describe("resoudreTypeContrat", () => {
  const codes = ["CDI", "CDD", "INTERIM"];
  it("traduit INT -> INTERIM", () => {
    expect(resoudreTypeContrat("INT", codes)).toBe("INTERIM");
    expect(resoudreTypeContrat("Intérim", codes)).toBe("INTERIM");
  });
  it("garde un code connu et retombe sur le défaut sinon", () => {
    expect(resoudreTypeContrat("CDI", codes)).toBe("CDI");
    expect(resoudreTypeContrat("", codes)).toBe("CDI");
    expect(resoudreTypeContrat("XYZ", codes)).toBe("CDI");
  });
});

describe("suggererCorrespondance", () => {
  const ateliers = [
    { id: "a1", nom: "Atelier 1" },
    { id: "a2", nom: "Atelier 2" },
  ];
  const equipes = [
    { id: "ev", nom: "Verte" },
    { id: "er", nom: "Rouge" },
    { id: "en", nom: "Nuit" },
  ];
  it("recoupe atelier et équipe par les mots discriminants", () => {
    expect(suggererCorrespondance("atelier 1 équipe verte", ateliers, equipes)).toEqual({
      atelierId: "a1",
      equipeId: "ev",
    });
    expect(suggererCorrespondance("atelier 2 nuit", ateliers, equipes)).toEqual({
      atelierId: "a2",
      equipeId: "en",
    });
  });
  it("renvoie null quand rien ne recoupe", () => {
    expect(suggererCorrespondance("zone froide", ateliers, equipes)).toEqual({
      atelierId: null,
      equipeId: null,
    });
  });
});

describe("rapprocher", () => {
  const effectif: EffectifItem[] = [
    { id: "p1", nom: "ABNER", prenom: "MAEVA", matricule: "108415", statut: "ACTIF" },
    { id: "p2", nom: "MARTIN", prenom: "JEAN", matricule: null, statut: "ACTIF" },
    { id: "p3", nom: "DURAND", prenom: "PAUL", matricule: "500", statut: "PARTI" },
  ];

  it("matricule connu -> existant, sans question", () => {
    const r = rapprocher({ matricule: "108415", nom: "ABNER", prenom: "MAEVA" }, effectif);
    expect(r.statut).toBe("existant");
    expect(r.candidats[0].id).toBe("p1");
  });

  it("homonyme sans matricule correspondant -> doute (à confirmer)", () => {
    // Même nom/prénom mais AUTRE matricule : peut être la même personne ou un homonyme.
    const r = rapprocher({ matricule: "999999", nom: "Martin", prenom: "Jean" }, effectif);
    expect(r.statut).toBe("doute");
    expect(r.candidats.map((c) => c.id)).toContain("p2");
  });

  it("homonyme partiel (prénom en plus) -> doute avec le libellé de statut", () => {
    const r = rapprocher({ matricule: "", nom: "DURAND", prenom: "PAUL PIERRE" }, effectif);
    expect(r.statut).toBe("doute");
    expect(r.candidats[0].libelle).toBe("DURAND PAUL (PARTI)");
  });

  it("aucun rapprochement -> nouveau", () => {
    const r = rapprocher({ matricule: "777", nom: "ZORG", prenom: "ANNA" }, effectif);
    expect(r.statut).toBe("nouveau");
    expect(r.candidats).toEqual([]);
  });
});
