import { describe, it, expect } from "vitest";
import { LIGNE_COULEURS, couleurDeLigne, couleurLibre, estCouleurLigne } from "./ligne-couleurs";

describe("couleur des lignes (PDF du Placement)", () => {
  it("palette sans doublon, teintes en minuscules", () => {
    const codes = LIGNE_COULEURS.map((c) => c.lc);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("la couleur enregistrée l'emporte, sinon repli sur le rang", () => {
    expect(couleurDeLigne("#7A3FC4", 0).nom).toBe("Violet");
    expect(couleurDeLigne(null, 2).lc).toBe(LIGNE_COULEURS[2].lc);
    expect(couleurDeLigne("#123456", LIGNE_COULEURS.length).lc).toBe(LIGNE_COULEURS[0].lc);
  });
  it("seules les teintes de la palette sont acceptées", () => {
    expect(estCouleurLigne("#2557c7")).toBe(true);
    expect(estCouleurLigne("#ff0000")).toBe(false);
    expect(estCouleurLigne(null)).toBe(false);
  });
  it("une nouvelle ligne prend la teinte la moins utilisée du service", () => {
    expect(couleurLibre([])).toBe(LIGNE_COULEURS[0].lc);
    expect(couleurLibre([LIGNE_COULEURS[0].lc, null])).toBe(LIGNE_COULEURS[1].lc);
    const toutes = LIGNE_COULEURS.map((c) => c.lc);
    expect(couleurLibre([...toutes, LIGNE_COULEURS[0].lc])).toBe(LIGNE_COULEURS[1].lc);
  });
});
