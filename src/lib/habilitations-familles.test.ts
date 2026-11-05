import { describe, it, expect } from "vitest";
import { cleFamille, estCleFamille, famillesDe, peutActualiser, LIBELLE_SANS_FAMILLE } from "./habilitations-familles";

describe("sous-droits des habilitations par famille", () => {
  it("clé de famille : préfixe, casse et espaces neutralisés", () => {
    expect(cleFamille(" Conduite d'engin ")).toBe("habfam:conduite d'engin");
    expect(cleFamille(null)).toBe("habfam:");
    expect(estCleFamille("habfam:secours")).toBe(true);
    expect(estCleFamille("habilitations")).toBe(false);
  });
  it("familles distinctes, triées, « Sans famille » en dernier", () => {
    expect(famillesDe(["Secours", null, "conduite", "SECOURS", ""]).map((f) => f.libelle)).toEqual(["conduite", "Secours", LIBELLE_SANS_FAMILLE]);
  });
  it("actualiser = écriture Habilitations ET famille non refusée", () => {
    expect(peutActualiser(true, [], "Secours")).toBe(true);
    expect(peutActualiser(true, ["habfam:secours"], "secours ")).toBe(false);
    expect(peutActualiser(true, ["habfam:secours"], "Qualité")).toBe(true);
    expect(peutActualiser(false, [], "Qualité")).toBe(false);
    expect(peutActualiser(true, ["habfam:"], null)).toBe(false);
  });
});
