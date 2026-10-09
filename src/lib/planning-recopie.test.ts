import { describe, it, expect } from "vitest";
import { planRecopie, compteRendu, type CaseCible } from "./planning-recopie";

const c = (iso: string, valeur = "", o: Partial<CaseCible> = {}): CaseCible => ({ iso, valeur, bloquee: false, horsCycle: false, ...o });

describe("recopie du Planning", () => {
  it("un poste ne remplit que les cases vides", () => {
    const p = planRecopie("poste1", [c("mar"), c("mer", "m:cp"), c("jeu", "poste2"), c("ven", "TP")], true);
    expect(p.ecrire).toEqual([{ iso: "mar", valeur: "poste1" }]);
    expect(p.laissees).toBe(3);
  });
  it("le non travaillé se recopie aussi", () => {
    expect(planRecopie("X", [c("mar"), c("mer")], true).ecrire.map((e) => e.valeur)).toEqual(["X", "X"]);
  });
  it("une absence ou un TP ne se recopient jamais", () => {
    expect(planRecopie("m:cp", [c("mar")], true).ecrire).toEqual([]);
    expect(planRecopie("TP", [c("mar")], true).ecrire).toEqual([]);
  });
  it("case bloquée jamais touchée ; poste hors cycle signalé", () => {
    const p = planRecopie("poste1", [c("mar", "", { bloquee: true }), c("mer", "", { horsCycle: true }), c("jeu")], true);
    expect(p.ecrire).toEqual([{ iso: "jeu", valeur: "poste1" }]);
    expect(p.horsCycle).toBe(1);
  });
  it("vider la suite : efface postes et NT, garde absences et TP", () => {
    const p = planRecopie("", [c("mar", "poste1"), c("mer", "X"), c("jeu", "m:am"), c("ven", "TP"), c("sam")], true);
    expect(p.ecrire).toEqual([{ iso: "mar", valeur: "" }, { iso: "mer", valeur: "" }]);
    expect(p.laissees).toBe(2);
  });
  it("copie de journée : pas de propagation du vide", () => {
    expect(planRecopie("", [c("mar", "poste1")], false).ecrire).toEqual([]);
  });
  it("compte rendu bref", () => {
    expect(compteRendu(12, 5, 1, 0)).toBe("12 case(s) recopiée(s) · 5 déjà remplie(s) laissée(s) · 1 poste(s) hors cycle ce jour-là");
    expect(compteRendu(2, 1, 0, 0, true)).toBe("2 case(s) vidée(s) · 1 absence(s) ou TP conservé(s)");
  });
});
