import { describe, it, expect } from "vitest";
import { texteAuto, texteSur, couleurTexteValide, TEXTE_CLAIR, TEXTE_SOMBRE } from "./couleur-texte";

describe("couleur du texte sur un fond", () => {
  it("fond sombre : texte clair ; fond clair : texte sombre", () => {
    expect(texteAuto("#060404")).toBe(TEXTE_CLAIR);
    expect(texteAuto("#1d4ed8")).toBe(TEXTE_CLAIR);
    expect(texteAuto("#e5e7eb")).toBe(TEXTE_SOMBRE);
    expect(texteAuto("#ffa5ff")).toBe(TEXTE_SOMBRE);
    expect(texteAuto("#fcfc1d")).toBe(TEXTE_SOMBRE);
  });
  it("fond absent ou illisible : texte sombre", () => {
    expect(texteAuto(null)).toBe(TEXTE_SOMBRE);
    expect(texteAuto("rouge")).toBe(TEXTE_SOMBRE);
  });
  it("la couleur choisie l'emporte si elle est valide", () => {
    expect(texteSur("#060404", "#FDE68A")).toBe("#fde68a");
    expect(texteSur("#060404", "")).toBe(TEXTE_CLAIR);
    expect(texteSur("#060404", "jaune")).toBe(TEXTE_CLAIR);
    expect(couleurTexteValide(" #ABCDEF ")).toBe("#abcdef");
    expect(couleurTexteValide(null)).toBeNull();
  });
});
