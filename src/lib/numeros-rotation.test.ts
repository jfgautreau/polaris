import { describe, it, expect } from "vitest";
import { parseNumeros } from "./numeros-rotation";

describe("parseNumeros", () => {
  it("rend une liste vide quand le poste n'est pas numerote", () => {
    expect(parseNumeros(null)).toEqual([]);
    expect(parseNumeros("")).toEqual([]);
    expect(parseNumeros("   ")).toEqual([]);
  });

  it("decoupe sur les virgules et les points-virgules", () => {
    expect(parseNumeros("12, 13")).toEqual(["12", "13"]);
    expect(parseNumeros("12;13")).toEqual(["12", "13"]);
    expect(parseNumeros("  12 ,  13  ")).toEqual(["12", "13"]);
  });

  it("decoupe encore sur l'espace entre nombres seuls (ancienne saisie)", () => {
    expect(parseNumeros("12 13")).toEqual(["12", "13"]);
    expect(parseNumeros("12 13, 15-16")).toEqual(["12", "13", "15", "16"]);
  });

  it("garde l'espace dans un nom de place", () => {
    expect(parseNumeros("Ailes, Panés, Aide palettisation")).toEqual(["Ailes", "Panés", "Aide palettisation"]);
    expect(parseNumeros("Quai  A ; Quai B")).toEqual(["Quai A", "Quai B"]);
    expect(parseNumeros("12 bis, 13")).toEqual(["12 bis", "13"]);
  });

  it("developpe une plage de nombres", () => {
    expect(parseNumeros("15-17")).toEqual(["15", "16", "17"]);
    expect(parseNumeros("12, 15-17")).toEqual(["12", "15", "16", "17"]);
    expect(parseNumeros("15 - 17")).toEqual(["15", "16", "17"]);
    expect(parseNumeros("7-7")).toEqual(["7"]);
  });

  it("garde tel quel un numero qui n'est pas un nombre", () => {
    expect(parseNumeros("12b")).toEqual(["12b"]);
    expect(parseNumeros("A-3")).toEqual(["A-3"]); // tiret hors plage numerique
    expect(parseNumeros("12b, 13")).toEqual(["12b", "13"]);
  });

  it("ecarte les doublons", () => {
    expect(parseNumeros("12, 12")).toEqual(["12"]);
    expect(parseNumeros("12-14, 13")).toEqual(["12", "13", "14"]);
  });

  it("refuse de fabriquer des milliers de cases", () => {
    expect(parseNumeros("1-9999")).toEqual(["1-9999"]); // plage aberrante : libelle brut
    expect(parseNumeros("1-40").length).toBeLessThanOrEqual(30);
  });

  it("plafonne le nombre de numeros", () => {
    const txt = Array.from({ length: 50 }, (_, i) => String(i + 1)).join(",");
    expect(parseNumeros(txt)).toHaveLength(30);
  });
});
