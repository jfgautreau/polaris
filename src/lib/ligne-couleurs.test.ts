import { describe, it, expect } from "vitest";
import { LIGNE_COULEURS, ORDRE_AUTO_LIGNES, couleurDeLigne, couleurLibre, estCouleurLigne } from "./ligne-couleurs";

describe("couleur des lignes (PDF du Placement)", () => {
  it("palette sans doublon, teintes en minuscules", () => {
    const codes = LIGNE_COULEURS.map((c) => c.lc);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("l'ordre automatique couvre exactement la palette, les 8 teintes de 0082 en tête", () => {
    expect([...ORDRE_AUTO_LIGNES].sort()).toEqual(LIGNE_COULEURS.map((c) => c.lc).sort());
    expect(ORDRE_AUTO_LIGNES.slice(0, 8)).toEqual(["#2557c7", "#7a3fc4", "#0f7a8a", "#b3307a", "#4338ca", "#8a5a2b", "#0369a1", "#86198f"]);
  });
  it("la couleur enregistrée l'emporte, sinon repli sur le rang", () => {
    expect(couleurDeLigne("#7A3FC4", 0).nom).toBe("Violet");
    expect(couleurDeLigne(null, 2).lc).toBe(ORDRE_AUTO_LIGNES[2]);
    expect(couleurDeLigne("#123456", ORDRE_AUTO_LIGNES.length).lc).toBe(ORDRE_AUTO_LIGNES[0]);
  });
  it("seules les teintes de la palette sont acceptées", () => {
    expect(estCouleurLigne("#2557c7")).toBe(true);
    expect(estCouleurLigne("#ff0000")).toBe(false);
    expect(estCouleurLigne(null)).toBe(false);
  });
  it("une nouvelle ligne prend la teinte la moins utilisée du service", () => {
    expect(couleurLibre([])).toBe(ORDRE_AUTO_LIGNES[0]);
    expect(couleurLibre([ORDRE_AUTO_LIGNES[0], null])).toBe(ORDRE_AUTO_LIGNES[1]);
    expect(couleurLibre([...ORDRE_AUTO_LIGNES, ORDRE_AUTO_LIGNES[0]])).toBe(ORDRE_AUTO_LIGNES[1]);
  });
});
