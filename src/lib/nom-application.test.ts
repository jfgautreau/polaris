import { describe, expect, it } from "vitest";
import { lienGuide, nomApplication, validerNomApplication, NOM_APPLICATION_DEFAUT } from "./nom-application";

describe("nomApplication", () => {
  it("prend le nom du site", () => {
    expect(nomApplication("BigPlann")).toBe("BigPlann");
    expect(nomApplication("  BigPlann ")).toBe("BigPlann");
  });
  it("revient au nom par défaut quand le site n'en a pas", () => {
    expect(nomApplication(null)).toBe(NOM_APPLICATION_DEFAUT);
    expect(nomApplication(undefined)).toBe(NOM_APPLICATION_DEFAUT);
    expect(nomApplication("   ")).toBe(NOM_APPLICATION_DEFAUT);
  });
});

describe("validerNomApplication", () => {
  it("vide = nom par défaut (null en base)", () => {
    expect(validerNomApplication("  ")).toEqual({ ok: true, valeur: null });
  });
  it("normalise les espaces", () => {
    expect(validerNomApplication("  Big   Plann ")).toEqual({ ok: true, valeur: "Big Plann" });
  });
  it("refuse au-delà de 40 caractères", () => {
    expect(validerNomApplication("x".repeat(41)).ok).toBe(false);
    expect(validerNomApplication("x".repeat(40)).ok).toBe(true);
  });
});

describe("lienGuide", () => {
  it("passe le nom au guide, sauf le nom par défaut", () => {
    expect(lienGuide(NOM_APPLICATION_DEFAUT)).toBe("/guide.html");
    expect(lienGuide("Big Plann")).toBe("/guide.html?app=Big%20Plann");
    expect(lienGuide("Big Plann", "/qui-fait-quoi.html")).toBe("/qui-fait-quoi.html?app=Big%20Plann");
  });
});
